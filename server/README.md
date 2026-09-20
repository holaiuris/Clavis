# Recordatorios de WhatsApp — server

Manda un WhatsApp a cada cliente antes de su turno. Es el único
componente de Clavis que necesita un proceso corriendo aparte (todo
el resto es estático, ver `../CLAUDE.md`).

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
- Los números de teléfono se asumen argentinos si no traen código de
  país — es una heurística simple (`normalizarTelefono` en
  `index.js`), revisala si cargás clientes de otros países.
- Si un cliente responde el WhatsApp, hoy **no se procesa esa
  respuesta** (el server solo manda, no lee contestaciones) — eso
  sería el siguiente paso si se quiere confirmación por WhatsApp.
