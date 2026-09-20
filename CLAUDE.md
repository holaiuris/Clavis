# Clavis — contexto para Claude Code

## Qué es esto
"Clavis" — app para que comercios de servicios (arranca con un peluquero,
pensada para que la usen varios comercios) gestionen su agenda de turnos
sin depender de memoria o cuaderno. El origen del problema: los clientes
piden turno por WhatsApp y hoy se gestiona a mano.

**V1 (ya construida):** panel web con línea de tiempo del día (estilo
agenda/Calendly) donde el comercio ve, por profesional, sus huecos
libres, ocupados y bloqueados en horario real; toca un hueco libre para
asignar un turno o bloquearlo, y toca un turno para ver detalle, marcar
asistencia, cambiar su estado o liberarlo. Un comercio puede tener
varios profesionales (multi-empleado, sin login propio) y guarda
historial de clientes. Incluye métricas (ingresos, % ocupación, % de
ausencias). El alta de comercios nuevos es manual (invitación desde el
dashboard de Supabase), no self-service.

**V2 (pendiente, no arrancada):** bot de WhatsApp que le ofrezca huecos
disponibles al cliente y agende automáticamente.

## Stack
- Frontend: HTML + JS vanilla (sin build step, sin framework) + cliente
  `@supabase-js` vía CDN.
- Backend/datos: Supabase (Postgres + Auth + RLS). Toda la lógica de
  negocio pesada vive en funciones SQL (Postgres functions), no en el JS.
- Sin servidor propio en V1: el navegador habla directo con Supabase.

## Decisión de diseño clave (no romper esto)
Los huecos "Libre" **no se guardan como filas** en la tabla `turnos`.
Motivo: la duración de un hueco depende del servicio que se vaya a agendar
(corte 30' vs. color 90'), así que un mismo horario abierto genera huecos
distintos según el servicio elegido. Guardar de antemano todas las
combinaciones se desincroniza apenas cambia un horario o un servicio.

En cambio:
- `turnos` solo guarda lo que **realmente ocupa** la agenda: estados
  `ocupado` y `bloqueado`.
- Los huecos libres se calculan al vuelo con la función SQL
  `generar_huecos_disponibles(p_peluquero_id, p_fecha, p_servicio_id, p_profesional_id)`
  (ver `huecos.sql`), cruzando horario de atención del comercio +
  duración del servicio + turnos ya ocupados/bloqueados de ESE
  profesional ese día.

Si en algún momento hay que "materializar" huecos libres como filas,
repensar esta decisión primero — probablemente no haga falta.

## Decisión de diseño: multi-profesional
Un comercio (`peluqueros`) puede tener varios **profesionales** que
atienden (ej: Nico, Vale). Decisiones tomadas al agregar esto:
- Los profesionales **no tienen login propio** — son registros que
  gestiona el dueño de la cuenta desde "Configuración". Evita rehacer
  todo el modelo de auth/RLS por multi-empleado.
- El **horario de atención es del comercio**, no por profesional — todos
  comparten la misma ventana horaria configurada en `horarios_atencion`.
- Cada profesional tiene su **propia agenda**: el exclude constraint de
  `turnos` está scoped por `(peluquero_id, profesional_id, fecha)`, así
  que dos profesionales pueden tener turnos a la misma hora sin pisarse.
- Todo comercio nuevo arranca con un profesional default llamado "Vos"
  (se crea junto con la fila de `peluqueros`, ver `renderSetup` en
  `app.js`), para no forzar a configurar el equipo antes de poder usar
  la agenda.

## Modelo de datos (Supabase/Postgres)
- **`peluqueros`** — 1 fila por usuario de Supabase Auth = un comercio.
  Multi-comercio desde el día 1: cada login ve solo su propia agenda vía
  RLS, sin selector manual.
- **`profesionales`** — personal del comercio (nombre, activo), sin login
  propio. Ver "Decisión de diseño: multi-profesional" arriba.
- **`servicios`** — nombre, `duracion_minutos`, precio, por peluquero.
- **`horarios_atencion`** — franjas de atención por día de semana
  (`dia_semana` 0=domingo…6=sábado), por peluquero (comercio entero, no
  por profesional).
- **`clientes`** — nombre, teléfono, por peluquero. Existe para poder
  mostrar "cliente desde X" en el detalle de un turno; se busca/crea
  automáticamente al cargar un turno ocupado (`findOrCreateCliente` en
  `app.js`), dedupeando por teléfono (o por nombre si no hay teléfono).
- **`turnos`** — `fecha`, `hora_inicio`, `hora_fin`, `estado` (enum:
  libre/ocupado/bloqueado — aunque libre no se persiste en la práctica),
  `cliente_nombre`, `cliente_telefono` (denormalizados, para no depender
  de un join al listar), `cliente_id`, `profesional_id`, `servicio_id`,
  `asistio` (boolean nullable: null=sin marcar, true=vino, false=ausente
  — alimenta la métrica de % de ausencias), `origen` (enum:
  manual/whatsapp — pensado para cuando exista el bot). Tiene un
  `exclude constraint` (gist) que impide dos turnos ocupados/bloqueados
  solapados para el mismo peluquero/profesional/fecha.

Seguridad: RLS activado en las 6 tablas. Cada política (salvo
`peluqueros`, que filtra por `user_id = auth.uid()`) filtra por
`peluquero_id in (select id from peluqueros where user_id = auth.uid())`.

## Estructura de archivos
```
turnos-app/
├── schema.sql             # tablas base + RLS + constraint de no-solapamiento (V1)
├── migracion_v2.sql       # profesionales, clientes, columnas nuevas de turnos
├── huecos.sql             # función generar_huecos_disponibles (RPC) — depende de migracion_v2.sql
├── migracion_v3_enum.sql  # agrega 'web' al enum turno_origen (va SOLO, transacción propia)
├── migracion_v3.sql       # trial, config de recordatorios, RLS pública para reservar.html
├── migracion_v4.sql       # aviso mínimo para reservar desde el link público
├── migracion_v5.sql       # color de acento + logo por comercio (bucket "logos" en Storage), para personalizar reservar.html
├── migracion_v6.sql       # slug (link corto), notificaciones_pendientes (aviso al cliente al cancelar) y teléfono obligatorio al reservar
├── migracion_v7.sql       # vista peluqueros_publico (RLS pública ya no expone la tabla entera) + valida duración real del servicio en turnos_public_insert
├── migracion_v8.sql       # turnos.aviso_comercio_enviado — avisa por WhatsApp al comercio cuando entra una reserva nueva por el link público
├── migracion_v9.sql       # turnos.confirmacion_enviada — confirma por WhatsApp al cliente apenas reserva
├── migracion_v10.sql      # obtener_turno_cliente/cancelar_turno_cliente — el cliente ve y cancela su turno desde reservar.html?turno=<id>
├── vercel.json            # rewrite /r/:slug -> /reservar.html?slug=:slug (link corto, ver DEPLOY.md)
├── index.html             # LANDING — página de marketing estática (no usa Supabase), es la raíz del sitio; "Entrar" y todos los CTA llevan a app.html
├── app.html               # shell de la app logueada (login → agenda)
├── style.css              # estilos de la app logueada (sidebar, agenda, modales)
├── app.js                 # toda la lógica de la app logueada: auth, fetch de datos, agenda, modales
├── reservar.html          # link público de reservas (sin login)
├── reservar.js            # lógica de reservar.html
├── config.js              # SUPABASE_URL, SUPABASE_ANON_KEY y PAYMENTS_API_URL (completar a mano — gitignored, no se commitea)
├── config.template.js     # plantilla de config.js con placeholders (esta sí se commitea)
├── package.json           # solo trae el script "build" (scripts/gen-config.js) para el deploy en Vercel — la app sigue sin build step propio
├── scripts/gen-config.js  # genera config.js desde variables de entorno en el build del hosting — ver DEPLOY.md
├── server/                # servers aparte (Node): recordatorios de WhatsApp y pagos con Mercado Pago — ver server/README.md
├── SETUP.md               # instrucciones paso a paso para levantar el proyecto Supabase
└── DEPLOY.md              # instrucciones paso a paso para deployar (Vercel + Railway) y conectar clavis.ar
```

`index.html` (el landing) es 100% estático (sin JS de Supabase): copy, planes
y CTAs que todos apuntan a `app.html`. Ojo con el nombre: es la raíz del
sitio pero NO es la app — la app logueada vive en `app.html`. El pago de los
planes sí es real (Mercado Pago, ver `server/payments.js`); el botón de
login con Google ya está en `app.js` pero falta la configuración en
Google Cloud + Supabase (ver `SETUP.md`).

**Orden de instalación SQL:** `schema.sql` → `migracion_v2.sql` →
`huecos.sql` → `migracion_v3_enum.sql` (sola, transacción propia) →
`migracion_v3.sql` → `migracion_v4.sql` → `migracion_v5.sql` →
`migracion_v6.sql` → `migracion_v7.sql` → `migracion_v8.sql` →
`migracion_v9.sql` → `migracion_v10.sql` (ver `SETUP.md`). Todas las
migraciones son en caliente: no borran datos.

## Cómo correrlo local
```bash
cd turnos-app
python3 -m http.server 8080
# abrir http://localhost:8080        -> landing
# abrir http://localhost:8080/app.html -> login / app
```
Requiere haber completado `config.js` con las credenciales de un proyecto
Supabase real donde ya se corrió todo el SQL en el orden de arriba (ver
`SETUP.md` para el detalle paso a paso, incluye habilitar login por
email/contraseña). Los servers de `server/` (WhatsApp y pagos) son procesos
Node aparte, no los levanta `python3 -m http.server` — ver `server/README.md`.

## Estado actual / qué falta
- [x] Schema + RLS + constraint de solapamiento (v1) y migración v2
      (profesionales, clientes, ausencias)
- [x] Función `generar_huecos_disponibles` (v2, scoped por profesional)
- [x] Panel con línea de tiempo funcional (login, alta de profesionales/
      servicios/horarios desde "Configuración", asignar/bloquear/liberar
      turnos tocando la agenda, marcar asistencia)
- [x] Métricas: ingresos (hoy/semana/mes), % ocupación, % ausencias
- [x] Historial de cliente ("cliente desde X") en el detalle del turno
- [x] Alta de comercios cerrada (self-signup desactivado en Supabase Auth;
      se crean a mano desde el dashboard)
- [x] Rediseño visual completo calcado de un mockup hecho en Claude
      Design ("Clavis"): shell con sidebar (Agenda/Métricas/Horarios),
      agenda en lista cronológica con tarjetas de borde de color y badge
      de estado (Confirmado/Atendido/Ausente), login split-panel,
      detalle de turno con avatar e iniciales, métricas con gráfico de
      barras y "servicios más pedidos", horarios con toggle por día.
- [x] Probado end-to-end contra un proyecto Supabase real después del
      rediseño: crear turno, marcar asistencia, cancelar, toggle de
      horarios, franjas múltiples por día.
- [x] Landing (`index.html`, raíz del sitio) con copy/planes/precios del
      mockup; `app.html` es la app logueada (login → agenda).
- [x] Link público de reservas (`reservar.html` + `reservar.js`): un
      cliente elige profesional/servicio/horario y reserva sin login,
      vía RLS pública acotada (`migracion_v3.sql`) — nunca lee turnos
      ajenos, `generar_huecos_disponibles` corre `security definer`.
- [x] Personalización del link público (`migracion_v5.sql`): cada
      comercio carga su color de acento y su logo desde Horarios →
      "Marca del link público" (`peluqueros.color_acento`/`logo_url`,
      logo subido al bucket de Storage `logos`, scoped por
      `peluquero_id`). `reservar.js` pisa `--accent` y el wordmark de
      Clavis con el logo/nombre del comercio; si no cargó nada, se ve
      la marca de Clavis por defecto. Deliberadamente acotado a un solo
      color (no un theme completo) para no romper contraste/legibilidad.
- [x] Recordatorios y avisos de WhatsApp (`server/index.js`,
      whatsapp-web.js — no oficial, riesgo de baneo, elegido a propósito
      para validar rápido antes de la API oficial de Meta): manda un
      WhatsApp X horas antes del turno según
      `peluqueros.recordatorio_offset_horas` (configurable desde
      Horarios), y otro cuando el comercio cancela un turno desde la
      Agenda (`cancelarTurnoConAviso` en `app.js` encola la fila en
      `notificaciones_pendientes` — ver `migracion_v6.sql` — porque el
      turno se borra al cancelarse, no queda de dónde sacar después el
      teléfono), y un tercero al COMERCIO (`peluqueros.telefono`)
      cuando entra una reserva nueva por el link público
      (`turnos.aviso_comercio_enviado`, `migracion_v8.sql`) — antes
      solo se enteraba al abrir la app. Solo manda, no procesa
      respuestas.
- [x] Precio visible antes de reservar (`reservar.js`): el selector de
      servicio y la pantalla de confirmación muestran `servicios.precio`
      cuando está cargado.
- [x] Confirmación por WhatsApp al reservar (`migracion_v9.sql` +
      `server/index.js`): además del recordatorio horas antes, el
      cliente recibe un WhatsApp apenas su turno queda cargado
      (`turnos.confirmacion_enviada`). Mismo patrón que
      `aviso_comercio_enviado` — lee directo de `turnos`, sin pasar por
      `notificaciones_pendientes`, para no tener que abrir una policy
      de INSERT público nueva (superficie de abuso: cualquiera podría
      encolar avisos a un teléfono ajeno sin pasar por una reserva
      real).
- [x] Vista "Clientes" (`app.js`, nueva pestaña en la sidebar):
      buscador por nombre/teléfono (client-side, sobre `clientes` ya
      cargado) y ficha por cliente al hacer click — turnos totales,
      ausencias, gasto total (suma de `servicios.precio` en turnos con
      `asistio = true`) e historial completo. No hizo falta migración,
      la tabla `clientes` ya existía desde `migracion_v2.sql` pero no
      tenía una vista dedicada.
- [x] Imprimir la agenda del día (`app.js` + `@media print` en
      `style.css`): botón "Imprimir" en el toolbar de Agenda —
      esconde sidebar/toolbar/filtros/huecos libres, deja solo la
      lista de turnos del día con un encabezado con el nombre del
      comercio y la fecha.
- [x] El cliente cancela su propio turno desde un link
      (`migracion_v10.sql`): `reservar.html?turno=<turno_id>` — el
      UUID del turno hace de contraseña (nadie lo puede adivinar, solo
      lo tiene quien reservó). Dos funciones `security definer`
      (`obtener_turno_cliente`, `cancelar_turno_cliente`) en vez de
      una policy pública de SELECT/DELETE sobre `turnos` — ninguna de
      las dos permite listar turnos, solo operar sobre un id ya
      conocido. Al cancelar, se avisa al comercio reusando
      `notificaciones_pendientes` con un tipo nuevo (`cliente_cancelo`)
      que `server/index.js` manda a `peluqueros.telefono` en vez de al
      cliente. El link va incluido en el WhatsApp de confirmación
      (`APP_URL`, ahora usada también por `index.js`, no solo
      `payments.js`).
- [x] Link corto para compartir (`migracion_v6.sql` + `vercel.json`):
      cada comercio elige un slug desde Horarios → "Marca del link
      público" (ej. `clavis.ar/r/peluqueria-lucia`) en vez del
      `reservar.html?c=<uuid>` de siempre (que sigue funcionando si no
      configuró slug). El rewrite de `vercel.json` solo aplica una vez
      deployado — en local se sigue viendo el link largo.
- [x] Teléfono obligatorio al reservar desde el link público
      (`migracion_v6.sql` endurece `turnos_public_insert`, antes solo
      exigía el nombre) — hace falta para poder avisar cancelaciones.
- [x] Endurecimiento de seguridad del acceso público (`migracion_v7.sql`,
      encontrado en revisión de código): `peluqueros_public_select`
      (`using (true)`) exponía la tabla entera vía REST a cualquiera
      con la anon key — RLS es row-level, no column-level, así que
      acotar las columnas del lado de `reservar.js` no protegía nada.
      Reemplazada por la vista `peluqueros_publico` (solo
      id/nombre/slug/aviso_minimo_horas/color_acento/logo_url).
      `turnos_public_insert` ahora también valida que
      `hora_fin - hora_inicio` matchee `servicios.duracion_minutos`
      del servicio elegido. `reservar.js` suma un honeypot
      (`.hp-field`) contra spam de bots — un captcha de verdad
      (hCaptcha/Turnstile) queda pendiente, requiere que el dueño cree
      cuenta en ese servicio.
- [x] Cobro real con Mercado Pago (`server/payments.js`): pago único de
      $14.900 (plan "Comercio") vía Checkout Pro. El botón "Activar
      plan" del sidebar crea una preferencia y redirige; el webhook
      marca `peluqueros.plan = 'comercio'`. No es suscripción recurrente
      (eso sería la API de Preapproval, no implementada). El trial de 14
      días (`peluqueros.trial_inicio`) sigue siendo solo informativo —
      nunca bloqueó nada, y ahora además puede pasar a plan pago de verdad.
- [ ] Login con Google: pendiente, decisión explícita de no hacerlo
      todavía (requiere que el dueño cree credenciales OAuth en Google
      Cloud).
- [ ] Deliberadamente NO calcado del mockup: duración de turno global en
      Horarios (choca con que la duración depende del servicio elegido),
      log de "Actividad" tipo timeline (no hay tracking de eventos real
      detrás).
- [ ] `server/` necesita quedar corriendo 24/7 en algún lado para que
      recordatorios y pagos funcionen de verdad — en una laptop se corta
      apenas se cierra o se suspende. Nada de esto está deployado
      todavía (hay dominio comprado, clavis.ar, pero no hosting). Ya
      está preparado el repo para deployar (`DEPLOY.md`: frontend en
      Vercel, `server/` como dos servicios en Railway) — falta que el
      dueño cree las cuentas/repo de GitHub y siga esos pasos.

## Decisión pendiente: WhatsApp
Dos caminos evaluados, sin decidir todavía:
1. **API oficial de Meta (WhatsApp Business)** — requiere verificación de
   negocio, costo por conversación, sin riesgo de baneo. Recomendado si
   esto escala a varios comercios reales.
2. **Librerías no oficiales (whatsapp-web.js, Baileys)** — gratis, rápido
   de prototipar, riesgo de que Meta banee el número si detecta patrón de
   bot. Sirve para validar el flujo conversacional con un solo comercio
   antes de comprometerse con la vía oficial.

Cuando se construya, el bot debería reusar `generar_huecos_disponibles`
para ofrecer horarios por chat (va a necesitar saber con qué profesional
agendar), e insertar en `turnos` con `origen = 'whatsapp'` al confirmar
— sin tocar el panel existente.

## Convenciones a mantener
- Nombres de tablas/columnas en español (así arrancó el proyecto).
- Lógica de disponibilidad de horarios vive en SQL (Postgres function),
  no se recalculan huecos en JS.
- Sin frameworks de frontend — mantener vanilla JS a menos que el
  proyecto crezca lo suficiente para justificar el cambio (decisión a
  discutir explícitamente, no agregar por default).
