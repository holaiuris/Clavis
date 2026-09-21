# Servers aparte de Clavis

Los procesos de este directorio son lo único de Clavis que necesita
correr aparte (todo el resto es estático, ver `../CLAUDE.md`): este
README cubre **recordatorios de WhatsApp** (`index.js`); ver más abajo
la sección **Google Calendar** (`calendar.js`). El servidor de pagos
(`payments.js`, Mercado Pago) tiene su propia lógica documentada en el
archivo mismo.

## WhatsApp

Manda WhatsApps: recordatorio al cliente antes de su turno, aviso al
cliente si el comercio cancela, y aviso al **comercio** cuando entra
una reserva nueva por el link público.

Usa **whatsapp-web.js** (no oficial): gratis y arranca hoy, pero corre
sobre un WhatsApp real (el tuyo o uno dedicado al negocio) escaneando
un QR una vez. Riesgo real: Meta puede banear el número si detecta
patrón de bot (mensajes muy seguidos, muchos destinatarios nuevos,
etc.) — para validar el flujo con un comercio está bien, para escalar
a muchos comercios conviene migrar a la API oficial de Meta más
adelante.

## 1. Instalar

```bash
cd server
npm install
```

## 2. Configurar

```bash
cp .env.example .env
```

Completá `.env`:
- `SUPABASE_URL`: la misma que ya usás en `../config.js`.
- `SUPABASE_SERVICE_ROLE_KEY`: **Project Settings → API → service_role
  key** en el dashboard de Supabase. Es secreta — bypassa todas las
  políticas de seguridad (RLS), por eso el server la necesita (tiene
  que ver los turnos de todos los comercios) y por eso **nunca** va en
  `config.js` ni en ningún archivo que llegue al navegador.

## 3. Correr

```bash
npm start
```

La primera vez va a imprimir un código QR en la terminal. Escaneálo
desde WhatsApp en tu teléfono: **Configuración → Dispositivos
vinculados → Vincular un dispositivo**. Después de eso la sesión queda
guardada en `server/wwebjs_auth/` y no hace falta escanear de nuevo
(salvo que cierres la sesión desde el teléfono).

Mientras el proceso esté corriendo, cada pocos minutos revisa si hay
turnos que necesitan recordatorio y los manda.

## Importante

- **Tiene que quedar corriendo todo el tiempo** para que los
  recordatorios salgan. En tu laptop, se corta si la cerrás o se
  suspende — para producción de verdad conviene correrlo en un
  servidor propio o un servicio tipo Railway/Render con el proceso
  siempre activo (`pm2`, systemd, o el "worker" del hosting que
  uses).
- Cada comercio configura desde la app (vista Horarios) cuántas horas
  antes se manda el recordatorio, o "No enviar".
- El aviso de "nueva reserva" al comercio necesita que el comercio
  tenga `telefono` cargado (`peluqueros.telefono`, se completa en el
  alta) — si está vacío, ese turno se marca como ya avisado sin
  mandar nada, no reintenta en cada ciclo.
- Los números de teléfono se asumen argentinos si no traen código de
  país — es una heurística simple (`normalizarTelefono` en
  `index.js`), revisala si cargás clientes de otros países.
- Si un cliente responde el WhatsApp, hoy **no se procesa esa
  respuesta** (el server solo manda, no lee contestaciones) — eso
  sería el siguiente paso si se quiere confirmación por WhatsApp.

## Google Calendar

Cada turno "ocupado" que se confirma en Clavis se refleja como evento
en el Google Calendar del comercio (solo exportar — Clavis sigue
siendo la única fuente de verdad, ver `../CLAUDE.md`).

### 1. Instalar y configurar

Mismo `npm install` de arriba (ya instala `google-auth-library`).
Completá en `.env` (ver `.env.example`): `GOOGLE_CLIENT_ID` y
`GOOGLE_CLIENT_SECRET` — el mismo cliente OAuth "Aplicación web" que
ya creaste para el login con Google (`SETUP.md`), reusado.

**Google Cloud Console → tu cliente OAuth → agregar un URI de
redireccionamiento nuevo** (además del que ya tiene Supabase):
```
http://localhost:3002/oauth-callback
```
(y el equivalente en producción cuando deployes, ej.
`https://api.clavis.ar/oauth-callback`).

### 2. Correr

```bash
npm run calendar
```

### 3. Conectar el Supabase Database Webhook

Este paso hace que Supabase le avise a `calendar.js` cada vez que se
crea/cambia/borra un turno, para mantener el Calendar sincronizado.

Supabase Dashboard → **Database → Webhooks → Create a new hook**:
- Tabla: `turnos`
- Eventos: Insert, Update, Delete
- Tipo: HTTP Request → POST
- URL: `http://localhost:3002/webhook-turno` en local no sirve (Supabase
  corre en la nube, no puede alcanzar tu laptop) — necesitás un túnel
  (ej. `ngrok http 3002`) para probar esto en desarrollo, o esperar a
  tener `calendar.js` deployado con una URL pública real.

### Importante

- Como `index.js` (WhatsApp), **tiene que quedar corriendo siempre**
  para que la sync no se corte.
- El botón "Conectar Google Calendar" vive en la app, vista Horarios.
- Mientras el proyecto de Google Cloud siga en modo "Testing", solo
  las cuentas que agregues como "Test user" pueden conectar — para
  cualquier comercio hace falta publicar la app (requiere
  verificación de Google por el scope `calendar.events`).
