// ============================================================
// Servidor de integración con Google Calendar — solo exportar (push):
// cada turno "ocupado" que se confirma en Clavis se crea como evento
// en el Google Calendar del comercio. Clavis sigue siendo la única
// fuente de verdad de disponibilidad; esto es un espejo de lectura
// para ver la agenda desde el celular sin abrir la app. No se leen
// eventos de Calendar hacia Clavis (eso sería "importar", descartado
// por ahora — ver CLAUDE.md).
//
// Por qué un server aparte: escribir en el Calendar de alguien
// requiere un refresh_token de Google guardado — un secreto que
// nunca puede viajar al navegador ni vivir en una tabla legible por
// el cliente (ver migracion_v14.sql: integraciones_google_calendar
// no tiene policy de select para nadie salvo este server, que usa la
// service_role key).
//
// Flujo de conexión (lo dispara el botón "Conectar Google Calendar"
// en Horarios, ver app.js):
//   1. GET /conectar?peluqueroId=<uuid> → redirige a la pantalla de
//      consentimiento de Google pidiendo el scope calendar.events.
//   2. Google vuelve acá: GET /oauth-callback?code=...&state=<uuid>.
//      Cambiamos el code por tokens, guardamos el refresh_token y
//      marcamos peluqueros.google_calendar_conectado = true.
//   3. Redirigimos de vuelta a la app (?calendar=conectado|error).
//
// Flujo de sync (turno → evento):
//   Un Database Webhook de Supabase sobre la tabla `turnos` (ver
//   SETUP.md) le pega a POST /webhook-turno en cada INSERT/UPDATE/
//   DELETE. Reusa el mismo Client ID/Secret que el login con Google
//   (mismo proyecto de Google Cloud), scope aparte.
// ============================================================

require("dotenv").config();
const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const { createClient } = require("@supabase/supabase-js");

const PORT = process.env.CALENDAR_PORT || process.env.PORT || 3002;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.APP_URL || "http://localhost:8080";
const CALENDAR_PUBLIC_URL = process.env.CALENDAR_PUBLIC_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${CALENDAR_PUBLIC_URL}/oauth-callback`;
const SCOPE = "https://www.googleapis.com/auth/calendar.events";

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Faltan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en server/.env"
  );
  process.exit(1);
}

// service_role bypassa RLS: hace falta para leer/escribir el
// refresh_token (nadie más puede) y para tocar turnos/peluqueros de
// cualquier comercio sin una sesión de usuario.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const oauth2Client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);

const app = express();
app.use(express.json());

// ------------------------------------------------------------
// Conexión (el dueño autoriza una vez desde Horarios)
// ------------------------------------------------------------

app.get("/conectar", (req, res) => {
  const { peluqueroId } = req.query;
  if (!peluqueroId) return res.status(400).send("Falta peluqueroId");

  const url = oauth2Client.generateAuthUrl({
    // offline + prompt=consent: sin esto Google solo manda
    // refresh_token la PRIMERA vez que alguien autoriza esta app —
    // si el comercio desconecta y vuelve a conectar, no llegaría un
    // refresh_token nuevo y quedaría el flujo roto.
    access_type: "offline",
    prompt: "consent",
    scope: [SCOPE],
    state: peluqueroId,
  });
  res.redirect(url);
});

app.get("/oauth-callback", async (req, res) => {
  const { code, state: peluqueroId, error } = req.query;
  if (error || !code || !peluqueroId) {
    console.error("Callback de Google sin code/state, o con error:", error);
    return res.redirect(`${APP_URL}/app.html?calendar=error`);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      // Pasa si el comercio ya había autorizado antes y Google no
      // manda un refresh_token nuevo pese al prompt=consent (raro,
      // pero posible si algo quedó inconsistente) — mejor avisar
      // claro que fallar en silencio con un token que no sirve.
      throw new Error("Google no devolvió un refresh_token — probá desconectar y conectar de nuevo.");
    }

    const { error: upsertErr } = await supabase
      .from("integraciones_google_calendar")
      .upsert({ peluquero_id: peluqueroId, refresh_token: tokens.refresh_token }, { onConflict: "peluquero_id" });
    if (upsertErr) throw upsertErr;

    const { error: updErr } = await supabase
      .from("peluqueros")
      .update({ google_calendar_conectado: true })
      .eq("id", peluqueroId);
    if (updErr) throw updErr;

    res.redirect(`${APP_URL}/app.html?calendar=conectado`);
  } catch (err) {
    console.error("Error conectando Google Calendar:", err.message);
    res.redirect(`${APP_URL}/app.html?calendar=error`);
  }
});

// ------------------------------------------------------------
// Sync (turno → evento) — llamado por el Database Webhook de Supabase
// ------------------------------------------------------------

// Cambia un refresh_token por un access_token fresco. Se pide de
// nuevo en cada llamada en vez de cachearlo: son turnos individuales,
// no un volumen que justifique manejar expiración a mano.
async function getAccessToken(refreshToken) {
  const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: refreshToken });
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("No se pudo refrescar el access_token de Google");
  return token;
}

async function getRefreshToken(peluqueroId) {
  const { data, error } = await supabase
    .from("integraciones_google_calendar")
    .select("refresh_token")
    .eq("peluquero_id", peluqueroId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.refresh_token : null;
}

// El payload del webhook trae la fila cruda de `turnos` — sin el join
// a servicios/profesionales que arma sus nombres. Se pide acá antes
// de armar el evento (una query más por sync, volumen bajo).
async function fetchTurnoConDetalle(id) {
  const { data, error } = await supabase
    .from("turnos")
    .select("*, servicios(nombre), profesionales(nombre)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

function eventoDesdeturno(turno) {
  const inicio = `${turno.fecha}T${turno.hora_inicio}`;
  const fin = `${turno.fecha}T${turno.hora_fin}`;
  return {
    summary: `${turno.cliente_nombre || "Turno"}${turno.servicios ? " — " + turno.servicios.nombre : ""}`,
    description: turno.profesionales ? `Con ${turno.profesionales.nombre} — vía Clavis` : "Vía Clavis",
    start: { dateTime: inicio, timeZone: "America/Argentina/Buenos_Aires" },
    end: { dateTime: fin, timeZone: "America/Argentina/Buenos_Aires" },
  };
}

async function crearEvento(accessToken, turno) {
  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventoDesdeturno(turno)),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Error creando evento en Calendar");
  return data.id;
}

async function actualizarEvento(accessToken, googleEventId, turno) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleEventId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(eventoDesdeturno(turno)),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Error actualizando evento en Calendar");
  }
}

async function borrarEvento(accessToken, googleEventId) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleEventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  // 404/410: el evento ya no existe del lado de Google (lo borraron a
  // mano, o ya lo habíamos borrado antes) — no es un error real acá.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || "Error borrando evento en Calendar");
  }
}

app.post("/webhook-turno", async (req, res) => {
  // Respondemos rápido y sin tirar error nuestro siempre que se
  // pueda — mismo criterio que el webhook de Mercado Pago: si algo
  // falla acá, se ve en el log, pero no vale la pena que Supabase
  // reintente en loop un turno que ya no existe o similar.
  const { type, record, old_record } = req.body || {};
  try {
    const turno = record || old_record;
    if (!turno) return res.sendStatus(200);

    // Los bloqueos ("Almuerzo", licencias) no son turnos de cliente —
    // no se reflejan en Calendar, solo estado = 'ocupado'.
    const esOcupadoNuevo = record && record.estado === "ocupado";
    const eraOcupado = old_record && old_record.estado === "ocupado";

    if (type === "DELETE") {
      if (old_record.google_event_id && eraOcupado) {
        const refreshToken = await getRefreshToken(old_record.peluquero_id);
        if (refreshToken) {
          const accessToken = await getAccessToken(refreshToken);
          await borrarEvento(accessToken, old_record.google_event_id);
        }
      }
      return res.sendStatus(200);
    }

    const refreshToken = await getRefreshToken(turno.peluquero_id);
    if (!refreshToken) return res.sendStatus(200); // comercio no conectó Calendar

    if (type === "INSERT" && esOcupadoNuevo) {
      const accessToken = await getAccessToken(refreshToken);
      const turnoDetalle = await fetchTurnoConDetalle(record.id);
      const googleEventId = await crearEvento(accessToken, turnoDetalle);
      await supabase.from("turnos").update({ google_event_id: googleEventId }).eq("id", record.id);
      return res.sendStatus(200);
    }

    if (type === "UPDATE") {
      const accessToken = await getAccessToken(refreshToken);

      // Se canceló o se liberó (dejó de estar ocupado): borrar el evento.
      if (eraOcupado && !esOcupadoNuevo && old_record.google_event_id) {
        await borrarEvento(accessToken, old_record.google_event_id);
        return res.sendStatus(200);
      }

      // Reprogramado (mismo turno, cambió fecha/hora): actualizar en vez
      // de recrear, así no se duplica en el Calendar.
      if (esOcupadoNuevo && record.google_event_id) {
        const turnoDetalle = await fetchTurnoConDetalle(record.id);
        await actualizarEvento(accessToken, record.google_event_id, turnoDetalle);
        return res.sendStatus(200);
      }

      // Ocupado nuevo sin google_event_id todavía (ej. se asignó un
      // turno directamente como "ocupado" en un update, no un insert
      // — no debería pasar en el flujo normal, pero por las dudas).
      if (esOcupadoNuevo && !record.google_event_id) {
        const turnoDetalle = await fetchTurnoConDetalle(record.id);
        const googleEventId = await crearEvento(accessToken, turnoDetalle);
        await supabase.from("turnos").update({ google_event_id: googleEventId }).eq("id", record.id);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error procesando webhook de turno:", err.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`Servidor de Google Calendar escuchando en http://localhost:${PORT}`));
