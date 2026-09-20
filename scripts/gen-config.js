// Genera config.js a partir de variables de entorno del hosting.
// Lo corre el Build Command de Vercel/Netlify (ver DEPLOY.md) — en
// local no hace falta, ahí config.js se edita a mano (ver SETUP.md).
const fs = require("fs");
const path = require("path");

const { SUPABASE_URL, SUPABASE_ANON_KEY, PAYMENTS_API_URL } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "Faltan las variables de entorno SUPABASE_URL / SUPABASE_ANON_KEY en el build. " +
      "Cargalas en el dashboard del hosting (ver DEPLOY.md)."
  );
  process.exit(1);
}

const contenido = `// Generado automáticamente por scripts/gen-config.js durante el build.
// No editar a mano acá — para desarrollo local, ver SETUP.md.
window.SUPABASE_URL = ${JSON.stringify(SUPABASE_URL)};
window.SUPABASE_ANON_KEY = ${JSON.stringify(SUPABASE_ANON_KEY)};
window.PAYMENTS_API_URL = ${JSON.stringify(PAYMENTS_API_URL || "")};
`;

fs.writeFileSync(path.join(__dirname, "..", "config.js"), contenido);
console.log("config.js generado a partir de variables de entorno.");
