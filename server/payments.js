// ============================================================
// Servidor de pagos — Mercado Pago (pago único, plan "Comercio").
//
// Por qué existe un server acá: crear una "preferencia" de pago y
// confirmar que se cobró de verdad requiere el access token SECRETO
// de Mercado Pago. Esa clave no puede viajar al navegador (a
// diferencia de la public key, que sí es segura del lado del
// cliente) — por eso el botón "Activar plan" de la app llama a este
// server en vez de hablarle a Mercado Pago directo.
//
// Flujo:
//   1. La app llama POST /crear-preferencia con tu peluquero_id.
//   2. Este server crea la preferencia en Mercado Pago y te devuelve
//      la URL de checkout (init_point); la app te redirige ahí.
//   3. Pagás en Mercado Pago (con tarjetas de prueba si el access
//      token es TEST-, o de verdad si es APP_USR-).
//   4. Mercado Pago le pega a POST /webhook-mercadopago acá. Si el
//      pago está aprobado, marcamos peluqueros.plan = 'comercio'.
//
// Pago único simple, no suscripción recurrente: un solo cobro activa
// el plan sin fecha de vencimiento. Si más adelante hace falta cobro
// mensual automático, es la API de "Preapproval" de Mercado Pago —
// bastante más trabajo (altas/bajas, reintentos, cancelaciones).
// ============================================================

require("dotenv").config();
const express = require("express");
const { MercadoPagoConfig, Preference, Payment } = require("mercadopago");
const { createClient } = require("@supabase/supabase-js");

// process.env.PORT: algunos hostings (Railway, Render) lo inyectan
// solos y esperan que el proceso escuche justo ahí para enrutar el
// dominio público — PAYMENTS_PORT sigue mandando si lo seteás a mano.
const PORT = process.env.PAYMENTS_PORT || process.env.PORT || 3001;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.APP_URL || "http://localhost:8080";
const PAYMENTS_PUBLIC_URL = process.env.PAYMENTS_PUBLIC_URL || `http://localhost:${PORT}`;

if (!MP_ACCESS_TOKEN || !SUPABASE_URL) {
  console.error("Faltan MP_ACCESS_TOKEN o SUPABASE_URL en server/.env");
  process.exit(1);
}
if (!SERVICE_ROLE_KEY) {
  console.warn(
    "Falta SUPABASE_SERVICE_ROLE_KEY en server/.env — puedo crear preferencias de pago, " +
      "pero cuando llegue la confirmación del webhook NO voy a poder marcar el plan como activo."
  );
}

// service_role bypassa RLS: hace falta para poder actualizar el plan
// de CUALQUIER comercio desde el webhook (no hay sesión de usuario acá).
const supabase = SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY) : null;
const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

// Pago único, plan fijo por ahora — si mañana hay más de un plan
// pago, esto se vuelve un lookup por el plan que pida la app.
const PLAN = { id: "comercio", nombre: "Comercio", precio: 14900 };

const app = express();
app.use(express.json());

// CORS simple para que la app (otro origen en dev: 8080 vs 3001) pueda
// llamar a este server. Restringir a tu dominio real antes de producción.
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", APP_URL);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.post("/crear-preferencia", async (req, res) => {
  const { peluqueroId } = req.body || {};
  if (!peluqueroId) return res.status(400).json({ error: "Falta peluqueroId" });

  try {
    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: [
          {
            title: `Clavis — Plan ${PLAN.nombre}`,
            quantity: 1,
            unit_price: PLAN.precio,
            currency_id: "ARS",
          },
        ],
        // Así sabemos, en el webhook, a qué comercio activarle el plan.
        external_reference: peluqueroId,
        back_urls: {
          success: `${APP_URL}/index.html?pago=exito`,
          failure: `${APP_URL}/index.html?pago=error`,
          pending: `${APP_URL}/index.html?pago=pendiente`,
        },
        // auto_return exige que back_urls sean URLs públicas (https) — Mercado
        // Pago lo rechaza con localhost. En local se omite (MP muestra su
        // propio botón "Volver al sitio" en vez de redirigir solo); una vez
        // que APP_URL sea el dominio real (clavis.ar) se puede reactivar.
        ...(APP_URL.startsWith("https://") ? { auto_return: "approved" } : {}),
        notification_url: `${PAYMENTS_PUBLIC_URL}/webhook-mercadopago`,
      },
    });
    res.json({ init_point: result.init_point });
  } catch (err) {
    console.error("Error creando preferencia:", err.message);
    res.status(500).json({ error: "No se pudo iniciar el pago" });
  }
});

app.post("/webhook-mercadopago", async (req, res) => {
  // Mercado Pago manda distintas formas de notificar según el evento;
  // devolvemos 200 rápido y sin tirar error nuestro para que no reintente
  // en loop — si algo falla de nuestro lado, lo vemos en el log.
  try {
    const paymentId = (req.body && req.body.data && req.body.data.id) || req.query["data.id"];
    const topic = (req.body && req.body.type) || req.query.topic;
    if (topic !== "payment" || !paymentId) return res.sendStatus(200);

    const payment = new Payment(mpClient);
    const info = await payment.get({ id: paymentId });

    if (info.status === "approved" && info.external_reference) {
      if (!supabase) {
        console.error("Pago aprobado pero no puedo activarlo: falta SUPABASE_SERVICE_ROLE_KEY en .env");
      } else {
        const { error } = await supabase
          .from("peluqueros")
          .update({ plan: PLAN.id })
          .eq("id", info.external_reference);
        if (error) console.error("Error activando el plan:", error.message);
        else console.log("Plan activado para peluquero", info.external_reference);
      }
    }
    res.sendStatus(200);
  } catch (err) {
    console.error("Error procesando webhook de Mercado Pago:", err.message);
    res.sendStatus(200);
  }
});

app.listen(PORT, () => console.log(`Servidor de pagos escuchando en http://localhost:${PORT}`));
