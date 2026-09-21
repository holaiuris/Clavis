// Plantilla de config.js — copiar a config.js y completar con las
// credenciales de tu proyecto Supabase (ver SETUP.md paso 4, Project
// Settings → API). config.js está en .gitignore: nunca se commitea con
// valores reales.
//
// En producción (Vercel/Netlify) no hace falta copiarlo a mano: el
// build corre scripts/gen-config.js, que genera config.js a partir de
// las variables de entorno SUPABASE_URL / SUPABASE_ANON_KEY /
// PAYMENTS_API_URL cargadas en el dashboard del hosting (ver DEPLOY.md).
window.SUPABASE_URL = "https://tu-proyecto.supabase.co";
window.SUPABASE_ANON_KEY = "tu-anon-key";

// URL del servidor de pagos (server/payments.js). Cambiar cuando esté
// deployado (ej. https://payments-production-xxxx.up.railway.app). Es
// solo una URL, no un secreto.
window.PAYMENTS_API_URL = "http://localhost:3001";

// URL del servidor de integración con Google Calendar
// (server/calendar.js). Cambiar cuando esté deployado. Es solo una
// URL, no un secreto.
window.CALENDAR_API_URL = "http://localhost:3002";
