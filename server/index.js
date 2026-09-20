// ============================================================
// Recordatorios de WhatsApp para Clavis — server aparte.
//
// Por qué existe un server acá: el resto de Clavis es 100% estático
// (el navegador habla directo con Supabase, ver ../CLAUDE.md). Pero
// mandar un WhatsApp saliente y recibir la confirmación requiere un
// proceso corriendo todo el tiempo con una sesión de WhatsApp Web
// abierta — eso no se puede hacer desde el navegador del comercio.
//
// Vía elegida: whatsapp-web.js (no oficial) — gratis, arranca hoy,
// pero corre sobre TU WhatsApp real (o uno dedicado) escaneando un QR,
// y Meta podría banear el número si detecta patrón de bot. Sirve para
// validar el flujo antes de comprometerse a la API oficial de Meta.
//
// Qué hace: cada CHECK_INTERVAL_MINUTES, busca turnos 'ocupado' sin
// recordatorio mandado cuya hora ya entró en la ventana configurada
// por el comercio (peluqueros.recordatorio_offset_horas) y les manda
// un WhatsApp.
// ============================================================

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHECK_INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES || 5);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en server/.env — copiá .env.example y completalo.");
  process.exit(1);
}

// service_role bypassa RLS: este server necesita ver turnos de TODOS los
// comercios para mandar recordatorios. Esta key es secreta y NUNCA debe
// llegar al navegador (a diferencia de la anon key que usa el resto de
// la app) — vive solo acá, en un .env que no se commitea.
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const whatsapp = new Client({
  authStrategy: new LocalAuth({ dataPath: "./wwebjs_auth" }),
  puppeteer: { args: ["--no-sandbox"] },
});

whatsapp.on("qr", (qr) => {
  console.log("Escaneá este QR con WhatsApp (Dispositivos vinculados) — una sola vez, después queda guardada la sesión:");
  qrcode.generate(qr, { small: true });
});

whatsapp.on("ready", () => {
  console.log(`WhatsApp conectado. Revisando recordatorios y avisos cada ${CHECK_INTERVAL_MINUTES} minuto(s).`);
  enviarRecordatoriosPendientes();
  enviarAvisosCancelacion();
  setInterval(enviarRecordatoriosPendientes, CHECK_INTERVAL_MINUTES * 60 * 1000);
  setInterval(enviarAvisosCancelacion, CHECK_INTERVAL_MINUTES * 60 * 1000);
});

whatsapp.on("auth_failure", (msg) => console.error("Fallo de autenticación de WhatsApp:", msg));
whatsapp.on("disconnected", (reason) => console.error("WhatsApp se desconectó:", reason, "- reiniciá el proceso."));

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// whatsapp-web.js necesita "<código de país><número>@c.us", sin signos.
// Heurística simple para números argentinos: si no viene ya con código
// de país, se lo agregamos. Es best-effort — revisar si los teléfonos
// cargados no calzan con este formato.
function normalizarTelefono(telefono) {
  let digits = String(telefono).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = digits.slice(1);
  if (!digits.startsWith("54")) digits = "54" + digits;
  return digits + "@c.us";
}

async function enviarRecordatoriosPendientes() {
  const hoy = new Date();
  const hoyISO = isoDate(hoy);
  const hastaISO = isoDate(new Date(hoy.getTime() + 2 * 24 * 60 * 60 * 1000));

  const { data: turnos, error } = await supabase
    .from("turnos")
    .select(
      "id, fecha, hora_inicio, cliente_nombre, cliente_telefono, peluqueros(nombre, recordatorio_offset_horas), servicios(nombre)"
    )
    .eq("estado", "ocupado")
    .eq("recordatorio_enviado", false)
    .not("cliente_telefono", "is", null)
    .gte("fecha", hoyISO)
    .lte("fecha", hastaISO);

  if (error) {
    console.error("Error consultando turnos:", error.message);
    return;
  }

  for (const turno of turnos) {
    const offset = turno.peluqueros && turno.peluqueros.recordatorio_offset_horas;
    if (!offset) continue; // el comercio eligió "No enviar"

    const turnoDatetime = new Date(`${turno.fecha}T${turno.hora_inicio}`);
    const horasHastaElTurno = (turnoDatetime.getTime() - Date.now()) / (60 * 60 * 1000);

    // Se manda apenas entramos en la ventana [0, offset] horas antes del turno.
    if (horasHastaElTurno > offset || horasHastaElTurno < 0) continue;

    const nombreComercio = turno.peluqueros ? turno.peluqueros.nombre : "tu comercio";
    const nombreServicio = turno.servicios ? turno.servicios.nombre : "tu turno";
    const hora = turno.hora_inicio.slice(0, 5);
    const fechaLarga = turnoDatetime.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

    const mensaje =
      `Hola ${turno.cliente_nombre || ""}! Te recordamos tu turno de ${nombreServicio} en ${nombreComercio} ` +
      `el ${fechaLarga} a las ${hora}. Si no podés venir, avisanos respondiendo este mensaje.`;

    try {
      const chatId = normalizarTelefono(turno.cliente_telefono);
      await whatsapp.sendMessage(chatId, mensaje);
      await supabase.from("turnos").update({ recordatorio_enviado: true }).eq("id", turno.id);
      console.log("Recordatorio enviado a", turno.cliente_nombre, "-", turno.fecha, hora);
    } catch (err) {
      console.error("No se pudo enviar recordatorio a", turno.cliente_telefono, ":", err.message);
    }
  }
}

// Cuando el comercio cancela un turno desde la Agenda, app.js encola
// una fila acá (ver migracion_v6.sql) en vez de mandar el WhatsApp
// directo desde el navegador — mandar mensajes necesita esta sesión
// de WhatsApp, que solo vive en este server.
async function enviarAvisosCancelacion() {
  const { data: avisos, error } = await supabase
    .from("notificaciones_pendientes")
    .select("id, cliente_nombre, cliente_telefono, fecha, hora_inicio, peluqueros(nombre)")
    .eq("tipo", "cancelacion")
    .eq("enviado", false);

  if (error) {
    console.error("Error consultando notificaciones_pendientes:", error.message);
    return;
  }

  for (const aviso of avisos) {
    const nombreComercio = aviso.peluqueros ? aviso.peluqueros.nombre : "el comercio";
    const hora = aviso.hora_inicio.slice(0, 5);
    const fechaLarga = new Date(`${aviso.fecha}T${aviso.hora_inicio}`).toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const mensaje =
      `Hola ${aviso.cliente_nombre || ""}! Te avisamos que ${nombreComercio} canceló tu turno ` +
      `del ${fechaLarga} a las ${hora}. Cualquier consulta, respondé este mensaje.`;

    try {
      const chatId = normalizarTelefono(aviso.cliente_telefono);
      await whatsapp.sendMessage(chatId, mensaje);
      await supabase.from("notificaciones_pendientes").update({ enviado: true }).eq("id", aviso.id);
      console.log("Aviso de cancelación enviado a", aviso.cliente_nombre, "-", aviso.fecha, hora);
    } catch (err) {
      console.error("No se pudo enviar aviso de cancelación a", aviso.cliente_telefono, ":", err.message);
    }
  }
}

whatsapp.initialize();
