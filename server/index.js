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
// Qué hace, cada CHECK_INTERVAL_MINUTES:
//   - Recordatorio al cliente: turnos 'ocupado' sin recordatorio
//     mandado cuya hora ya entró en la ventana configurada por el
//     comercio (peluqueros.recordatorio_offset_horas).
//   - Aviso al cliente si el comercio cancela su turno.
//   - Aviso al COMERCIO cuando entra una reserva nueva por el link
//     público (reservar.html) — para que no se entere recién al abrir
//     la app al otro día.
// ============================================================

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHECK_INTERVAL_MINUTES = Number(process.env.CHECK_INTERVAL_MINUTES || 5);
// La misma variable que usa payments.js — la confirmación de reserva
// incluye un link para que el cliente gestione (cancele) su turno.
const APP_URL = process.env.APP_URL || "http://localhost:8080";

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
  enviarAvisosComercioNuevaReserva();
  enviarConfirmacionesReserva();
  setInterval(enviarRecordatoriosPendientes, CHECK_INTERVAL_MINUTES * 60 * 1000);
  setInterval(enviarAvisosCancelacion, CHECK_INTERVAL_MINUTES * 60 * 1000);
  setInterval(enviarAvisosComercioNuevaReserva, CHECK_INTERVAL_MINUTES * 60 * 1000);
  setInterval(enviarConfirmacionesReserva, CHECK_INTERVAL_MINUTES * 60 * 1000);
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

// notificaciones_pendientes tiene dos tipos, con destinatarios
// distintos:
//   - "cancelacion": el COMERCIO canceló desde la Agenda (app.js la
//     encola, ver migracion_v6.sql) — se avisa al CLIENTE.
//   - "cliente_cancelo": el CLIENTE canceló desde su link (la encola
//     cancelar_turno_cliente(), ver migracion_v10.sql) — se avisa al
//     COMERCIO (peluqueros.telefono), al revés que el otro caso.
// Mandar el WhatsApp necesita esta sesión, que solo vive acá — por
// eso no sale directo del navegador en ninguno de los dos casos.
async function enviarAvisosCancelacion() {
  const { data: avisos, error } = await supabase
    .from("notificaciones_pendientes")
    .select("id, tipo, cliente_nombre, cliente_telefono, fecha, hora_inicio, peluqueros(nombre, telefono)")
    .in("tipo", ["cancelacion", "cliente_cancelo"])
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

    const esAvisoAlComercio = aviso.tipo === "cliente_cancelo";
    const telefonoDestino = esAvisoAlComercio ? aviso.peluqueros && aviso.peluqueros.telefono : aviso.cliente_telefono;

    if (!telefonoDestino) {
      // Comercio sin teléfono cargado (o, más raro, turno sin
      // teléfono de cliente) — no hay a quién avisarle, no
      // reintentamos en vano.
      await supabase.from("notificaciones_pendientes").update({ enviado: true }).eq("id", aviso.id);
      continue;
    }

    const mensaje = esAvisoAlComercio
      ? `Tu cliente ${aviso.cliente_nombre || "alguien"} canceló su turno del ${fechaLarga} a las ${hora} desde su link.`
      : `Hola ${aviso.cliente_nombre || ""}! Te avisamos que ${nombreComercio} canceló tu turno ` +
        `del ${fechaLarga} a las ${hora}. Cualquier consulta, respondé este mensaje.`;

    try {
      const chatId = normalizarTelefono(telefonoDestino);
      await whatsapp.sendMessage(chatId, mensaje);
      await supabase.from("notificaciones_pendientes").update({ enviado: true }).eq("id", aviso.id);
      console.log(esAvisoAlComercio ? "Aviso de cancelación de cliente enviado al comercio" : "Aviso de cancelación enviado al cliente", "-", aviso.fecha, hora);
    } catch (err) {
      console.error("No se pudo enviar aviso de cancelación a", telefonoDestino, ":", err.message);
    }
  }
}

// Aviso al COMERCIO (no al cliente) de que entró una reserva nueva
// por el link público — si alguien reserva a las 2 AM, hoy el
// comercio recién se entera cuando abre la app. Solo turnos
// origen='web': los que carga el propio comercio a mano no necesitan
// avisarle nada a sí mismo.
async function enviarAvisosComercioNuevaReserva() {
  const { data: turnos, error } = await supabase
    .from("turnos")
    .select(
      "id, fecha, hora_inicio, cliente_nombre, peluqueros(nombre, telefono), servicios(nombre), profesionales(nombre)"
    )
    .eq("origen", "web")
    .eq("aviso_comercio_enviado", false);

  if (error) {
    console.error("Error consultando turnos para avisar al comercio:", error.message);
    return;
  }

  for (const turno of turnos) {
    const telefonoComercio = turno.peluqueros && turno.peluqueros.telefono;
    if (!telefonoComercio) {
      // No tiene teléfono cargado — no hay a quién avisarle. No tiene
      // sentido reintentar en el próximo ciclo, así que lo marcamos
      // igual para no volver a procesarlo en vano.
      await supabase.from("turnos").update({ aviso_comercio_enviado: true }).eq("id", turno.id);
      continue;
    }

    const nombreServicio = turno.servicios ? turno.servicios.nombre : "un turno";
    const nombreProfesional = turno.profesionales ? turno.profesionales.nombre : "";
    const hora = turno.hora_inicio.slice(0, 5);
    const fechaLarga = new Date(`${turno.fecha}T${turno.hora_inicio}`).toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const mensaje =
      `Nueva reserva por tu link de Clavis: ${turno.cliente_nombre || "un cliente"} — ${nombreServicio}` +
      `${nombreProfesional ? " con " + nombreProfesional : ""}, ${fechaLarga} a las ${hora}.`;

    try {
      const chatId = normalizarTelefono(telefonoComercio);
      await whatsapp.sendMessage(chatId, mensaje);
      await supabase.from("turnos").update({ aviso_comercio_enviado: true }).eq("id", turno.id);
      console.log("Aviso de nueva reserva enviado al comercio -", turno.fecha, hora);
    } catch (err) {
      console.error("No se pudo avisarle al comercio de la reserva", turno.id, ":", err.message);
    }
  }
}

// Confirmación al cliente apenas reserva desde el link público — antes
// lo único que salía era el recordatorio horas antes; entre reservar y
// eso, el cliente no tenía nada en su WhatsApp que le confirmara que
// quedó agendado de verdad.
async function enviarConfirmacionesReserva() {
  const { data: turnos, error } = await supabase
    .from("turnos")
    .select(
      "id, fecha, hora_inicio, cliente_nombre, cliente_telefono, peluqueros(nombre), servicios(nombre), profesionales(nombre)"
    )
    .eq("origen", "web")
    .eq("confirmacion_enviada", false)
    .not("cliente_telefono", "is", null);

  if (error) {
    console.error("Error consultando turnos para confirmar reserva:", error.message);
    return;
  }

  for (const turno of turnos) {
    const nombreComercio = turno.peluqueros ? turno.peluqueros.nombre : "el comercio";
    const nombreServicio = turno.servicios ? turno.servicios.nombre : "tu turno";
    const nombreProfesional = turno.profesionales ? turno.profesionales.nombre : "";
    const hora = turno.hora_inicio.slice(0, 5);
    const fechaLarga = new Date(`${turno.fecha}T${turno.hora_inicio}`).toLocaleDateString("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const linkGestion = `${APP_URL}/reservar.html?turno=${turno.id}`;
    const mensaje =
      `Hola ${turno.cliente_nombre || ""}! Tu turno de ${nombreServicio} en ${nombreComercio}` +
      `${nombreProfesional ? " con " + nombreProfesional : ""} quedó confirmado para el ${fechaLarga} a las ${hora}. ` +
      `Si necesitás cancelarlo: ${linkGestion}`;

    try {
      const chatId = normalizarTelefono(turno.cliente_telefono);
      await whatsapp.sendMessage(chatId, mensaje);
      await supabase.from("turnos").update({ confirmacion_enviada: true }).eq("id", turno.id);
      console.log("Confirmación de reserva enviada a", turno.cliente_nombre, "-", turno.fecha, hora);
    } catch (err) {
      console.error("No se pudo confirmar la reserva a", turno.cliente_telefono, ":", err.message);
    }
  }
}

whatsapp.initialize();
