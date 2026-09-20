# Deploy — Clavis a producción

Dos piezas separadas, en dos hostings distintos:

1. **Frontend estático** (`index.html`, `app.html`, `reservar.html`,
   `style.css`, `app.js`, `reservar.js`, `assets/`) → **Vercel**. Es
   HTML/JS sin build real; Vercel solo necesita generar `config.js` a
   partir de variables de entorno antes de servir los archivos (ver
   `scripts/gen-config.js`).
2. **`server/`** (recordatorios de WhatsApp + pagos con Mercado Pago)
   → **Railway**, como **dos servicios separados** del mismo repo (no
   se pueden fusionar: son dos procesos Node distintos —
   `npm start` vs `npm run payments`).

Por qué Railway y no Vercel para `server/`: `whatsapp-web.js` necesita
un proceso siempre encendido con disco persistente (la sesión de
WhatsApp vive en `server/wwebjs_auth/`) — eso no entra en el modelo
serverless de Vercel.

## 0. Requisitos previos

- El repo de Clavis pusheado a GitHub (ver más abajo si todavía no
  existe el repo).
- Una cuenta en [vercel.com](https://vercel.com) (gratis) y otra en
  [railway.app](https://railway.app) (tiene un plan gratis limitado;
  para que `server/` quede corriendo 24/7 en serio vas a necesitar
  cargar una tarjeta — Railway cobra por uso, para estos dos servicios
  chicos ronda unos pocos dólares por mes).
- El dominio `clavis.ar` a mano (acceso al panel de DNS de donde lo
  compraste).

### Crear el repo en GitHub (si todavía no existe)

```bash
git add -A
git commit -m "Primer commit"
```

Después, en GitHub: **New repository** → sin README/gitignore (ya los
tenemos) → copiá la URL que te da y:

```bash
git remote add origin <url-que-te-dio-github>
git push -u origin main
```

## 1. Frontend en Vercel

1. **Add New → Project** → importá el repo de Clavis.
2. **Framework Preset:** "Other".
3. **Build Command:** `npm run build` (corre `scripts/gen-config.js`,
   que genera `config.js` — sin esto la app no tiene con qué
   conectarse a Supabase).
4. **Output Directory:** `.` (la raíz del repo — no hay carpeta
   `dist`, se sirve todo tal cual).
5. **Environment Variables** — cargar estas tres (los mismos valores
   que ya tenés en tu `config.js` local, ver `SETUP.md` paso 4):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY` (la *anon* key — es pública por diseño, está
     protegida por RLS, no pasa nada si viaja al navegador)
   - `PAYMENTS_API_URL` → dejalo en blanco por ahora, lo completás en
     el paso 3 una vez que sepas la URL de Railway.
6. **Deploy.**
7. Una vez andando: **Settings → Domains** → agregá `clavis.ar` (y
   `www.clavis.ar` si lo querés) → Vercel te da los registros DNS
   (normalmente un `A` a su IP o un `CNAME`) → cargalos donde
   compraste el dominio. Puede tardar hasta un rato en propagar.

## 2. `server/` en Railway — dos servicios

En Railway, **New Project → Deploy from GitHub repo** → elegí el repo
de Clavis. Esto crea el proyecto; ahora agregás dos servicios adentro
apuntando los dos a la carpeta `server/` pero con comandos distintos.

### Servicio A — WhatsApp (`server/index.js`)

1. **Settings → Root Directory:** `server`
2. **Settings → Start Command:** `npm start`
3. **Variables** (copiá los nombres de `server/.env.example`):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (la *service_role*, no la anon —
     **Project Settings → API** en Supabase. Secreta, nunca la
     compartas ni la pongas en el frontend.)
   - `CHECK_INTERVAL_MINUTES` = `5`
4. **Agregar un Volume** (pestaña **Volumes**) montado en
   `/app/wwebjs_auth` — ahí es donde `whatsapp-web.js` guarda la
   sesión después de escanear el QR. Sin esto, cada vez que Railway
   reinicie el servicio vas a tener que volver a escanear.
5. Deployá y mirá los **Logs**: la primera vez va a imprimir el QR ahí
   mismo (como texto ASCII) — escaneálo desde
   **WhatsApp → Configuración → Dispositivos vinculados**.

### Servicio B — Pagos (`server/payments.js`)

1. **Settings → Root Directory:** `server`
2. **Settings → Start Command:** `npm run payments`
3. **Settings → Networking:** generá un dominio público (Railway te da
   uno tipo `payments-production-xxxx.up.railway.app`; podés apuntar
   un subdominio propio, ej. `api.clavis.ar`, desde acá también).
4. **Variables:**
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `MP_ACCESS_TOKEN` (el real, `APP_USR-...` — dashboard de Mercado
     Pago → Tus integraciones → Credenciales de producción)
   - `APP_URL` = `https://clavis.ar` (tiene que empezar con `https://`
     para que Mercado Pago acepte el `auto_return`)
   - `PAYMENTS_PUBLIC_URL` = la URL pública de este mismo servicio
     (paso 3) — Mercado Pago le pega ahí para confirmar pagos
   - No hace falta setear `PORT` a mano: Railway lo inyecta solo y
     `payments.js` ya lo usa como fallback.
5. Deployá. Copiá la URL pública final y:
   - Volvé a **Vercel → Settings → Environment Variables** y completá
     `PAYMENTS_API_URL` con esa URL → **Redeploy**.
   - En el dashboard de Mercado Pago, configurá el webhook apuntando a
     `<esa-url>/webhook-mercadopago`.

## 3. Supabase — URLs de producción

**Authentication → URL Configuration** en el dashboard de Supabase:
- **Site URL:** `https://clavis.ar`
- **Redirect URLs:** agregar `https://clavis.ar/app.html`

Sin esto, "Olvidé mi contraseña" y los links de confirmación de mail
te van a mandar a `localhost`.

## 4. Prueba end-to-end en producción

Con todo deployado: entrar a `https://clavis.ar` → "Entrar" → login →
Horarios (configurar algo, confirmar que guarda) → copiar el link
público → abrirlo en otra pestaña/incógnito → reservar un turno →
confirmar que aparece en la Agenda → si configuraste recordatorio,
esperarlo (o probar con un turno a pocos minutos) → activar el plan
pago con una tarjeta real de Mercado Pago y confirmar que
`peluqueros.plan` cambia a `'comercio'`.

## Notas

- `migracion_v5.sql` (y cualquier migración pendiente) corren en el
  SQL Editor de Supabase — no tienen nada que ver con este deploy, son
  contra la base, no contra el hosting.
- Si en algún momento cambia el dominio o las URLs, hay que tocar:
  `config.js`/variables de Vercel (`PAYMENTS_API_URL`), `server/.env`
  de Railway (`APP_URL`, `PAYMENTS_PUBLIC_URL`), el webhook de
  Mercado Pago, y las Redirect URLs de Supabase Auth — quedan todas
  listadas arriba para no tener que buscarlas.
