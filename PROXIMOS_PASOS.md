# Próximos pasos — guía paso a paso

Esto es tuyo: los 12 pasos pendientes de gestión, en el orden que
quedamos, con el detalle para hacerlos solo. No hace falta que me
consultes en cada click — pegame acá abajo cuando te trabes en un paso
puntual, o cuando termines uno y quieras que sigamos con el código que
depende de él.

Marcá cada casillero a medida que avanzás (edita este archivo y
cambiá `[ ]` por `[x]`), así la próxima vez que hablemos sé
exactamente dónde estás sin tener que contarme de nuevo.

---

## 1. Completar `SUPABASE_SERVICE_ROLE_KEY`

**Por qué:** sin esta clave, `server/index.js` no arranca — y es el
que manda TODOS los WhatsApp (recordatorios, confirmación de reserva,
aviso al comercio de reserva nueva, aviso de cancelación, aviso de
lista de espera). Hoy está vacía, así que nada de eso corrió nunca de
verdad.

**Cómo:**
1. Andá a [supabase.com](https://supabase.com) y entrá a tu proyecto.
2. En el menú lateral, el ícono de engranaje → **Project Settings**.
3. **API** (dentro de Settings).
4. Buscá la sección **Project API keys**. Vas a ver dos: `anon` `public`
   (esa ya la tenés en `config.js`, es segura de exponer) y
   `service_role` `secret` — **esa es la que falta**.
5. Click en el ojito o "Reveal" para verla, y copiala (botón de copiar
   al lado).
6. Abrí `server/.env` con cualquier editor de texto (TextEdit, VS
   Code, lo que uses).
7. Buscá la línea `SUPABASE_SERVICE_ROLE_KEY=` y pegá la clave justo
   después del `=`, sin espacios ni comillas.
8. Guardá el archivo.

**Importante — esta clave es secreta de verdad:**
- Nunca la pegues en `config.js`, en el navegador, ni en ningún chat
  o mensaje que no sea directamente conmigo en este proyecto local.
- `server/.env` ya está en `.gitignore` — no se va a subir a GitHub
  por accidente. No lo saques de ahí.
- Si alguna vez sospechás que se filtró, desde el mismo panel de
  Supabase (Project Settings → API) podés regenerarla.

**Cuándo está terminado:** el archivo `server/.env` tiene una clave
larga (arranca con `eyJ...`) después de `SUPABASE_SERVICE_ROLE_KEY=`.

**Ya está hecho** (2026-09-22) — de paso revisé el resto de
`server/.env` y todo lo crítico está cargado (incluido `MP_ACCESS_TOKEN`
con un token real de producción `APP_USR-...`, no de prueba).
`CALENDAR_PORT`/`CALENDAR_PUBLIC_URL` quedaron vacías pero no es
problema, tienen default en el código (3002/localhost).

- [x] Hecho

---

## 2. Correr el server de WhatsApp y escanear el QR

**Por qué:** aunque la clave de arriba esté puesta, el proceso nunca
se conectó a un WhatsApp real — no hay sesión guardada. Hasta que no
hagas esto una vez, ningún mensaje sale.

**Antes de arrancar — una decisión chica:** ¿qué número de WhatsApp
vas a usar? Puede ser el tuyo personal o uno dedicado al negocio (una
línea/chip aparte). No es al azar: como `server/index.js` usa la vía
NO oficial (whatsapp-web.js, no la API de Meta), existe el riesgo de
que Meta banee el número si detecta patrón de bot. Con un número
dedicado, si pasa lo peor, no perdés tu WhatsApp personal. Con el tuyo
propio, es más rápido para probar ahora. Para validar el flujo con un
solo comercio (vos), cualquiera de las dos está bien — pero decidilo
ahora, porque una vez que escaneás el QR con un número, cambiarlo
después implica volver a escanear.

**Cómo:**
1. Abrí una terminal en la carpeta del proyecto.
2. `cd server`
3. Si es la primera vez o no estás seguro de que las dependencias
   estén instaladas: `npm install` (no hace daño correrlo de nuevo
   aunque ya esté hecho).
4. `npm start`
5. En la terminal va a aparecer un código QR dibujado con caracteres
   de texto (ASCII). Esperá a que termine de imprimirse.
6. En el teléfono que vas a usar: **WhatsApp → Configuración (o los
   tres puntos) → Dispositivos vinculados → Vincular un dispositivo**.
7. Escaneá el QR de la terminal con la cámara que se abre en el
   teléfono.
8. La terminal va a mostrar `WhatsApp conectado. Revisando
   recordatorios y avisos cada 5 minuto(s).` — esa línea confirma que
   quedó.

**Después:**
- La sesión queda guardada en `server/wwebjs_auth/` — no la borres,
  no hace falta volver a escanear salvo que cierres la sesión desde
  el teléfono o borres esa carpeta.
- Mientras quieras que salgan mensajes de verdad, esa terminal tiene
  que seguir corriendo (si la cerrás, se corta). Para dejarlo andando
  en serio sin depender de tu laptop prendida, eso ya es parte del
  Paso 5 (deploy).
- El servidor de pagos (`payments.js`) es un proceso aparte — no hace
  falta para este paso, se arranca con `npm run payments` en otra
  terminal cuando lo necesites.

**Cuándo está terminado:** la terminal dice "WhatsApp conectado" y
existe la carpeta `server/wwebjs_auth/`.

- [ ] Hecho — número usado: _________________

---

## 3. Probar el flujo completo con el peluquero real

**Por qué:** todo lo que armamos se probó en local, con datos de
prueba, conmigo mirando la pantalla. Nunca pasó por manos reales de
punta a punta. Este paso es usarlo como lo va a usar tu peluquero,
buscando que algo se rompa ANTES de que se rompa con un cliente de
verdad.

**Avisale al peluquero que estás probando** — así no se confunde si
ve turnos de prueba en su agenda o le llega algún WhatsApp raro.

**Lista para ir tildando**, en este orden:

- [ ] Login con el usuario real del comercio (no una cuenta de prueba).
- [ ] Cargar los servicios reales (nombre, duración, precio) en
      Horarios.
- [ ] Cargar el/los profesional(es) real(es).
- [ ] Cargar el horario de atención real.
- [ ] En Horarios → "Marca del link público": nombre real del
      comercio, color, logo si tiene. **Ojo:** de paso, si tu comercio
      de prueba en Supabase se sigue llamando literalmente "Clavis",
      este es el momento de cambiarlo acá mismo (ver Paso 9).
- [ ] Copiar el link público (o el link corto si configuraste slug) y
      abrirlo en el celular, como si fueras un cliente.
- [ ] Hacer una reserva de prueba con TU teléfono real (no uno
      inventado).
- [ ] Confirmar que llega el WhatsApp de confirmación, y que el link
      de "cancelar tu turno" que trae funciona.
- [ ] Cancelar esa reserva desde ese mismo link (el de arriba) →
      confirmar que le llega un aviso al WhatsApp del COMERCIO
      (necesita `peluqueros.telefono` cargado).
- [ ] Cargar un turno a mano desde la Agenda (con un cliente de
      prueba con teléfono real) y cancelarlo desde ahí → confirmar
      que le llega el aviso de cancelación al cliente.
- [ ] Buscar un día/horario donde ya no queden huecos (o bloqueá vos
      mismo todo un día) → entrar por el link público → anotarse en
      "lista de espera" → cancelar algo ese día → confirmar que llega
      el WhatsApp de "se liberó un hueco".
- [ ] Cargar un turno para dentro de pocas horas (dentro de la
      ventana de recordatorio configurada en Horarios) y esperar (o
      ajustar el horario para que caiga pronto) a que salga el
      recordatorio.
- [ ] Marcar un turno como "Atendido" y otro como "Ausente" desde el
      detalle, confirmar que se reflejan bien en Métricas.
- [ ] Revisar la vista Clientes: que aparezca el historial correcto.
- [ ] Probar "Imprimir" desde la Agenda.
- [ ] Probar bien en el celular (no solo en la compu) — es donde tu
      peluquero lo va a usar la mayor parte del tiempo.

**Cuándo está terminado:** pasaste por toda la lista sin encontrar
nada roto (o volviste acá con lo que encontraste para que lo
arreglemos).

- [ ] Hecho

---

## 4. Decidir el gate de trial/plan

**Por qué:** hoy `peluqueros.plan` es 100% informativo. Nadie está
obligado a pagar nunca, aunque se le venza el trial. Si la idea es
cobrar en serio, hace falta decidir qué se corta — y esa decisión es
tuya, no la puedo tomar por vos.

**Opciones que veo** (podés combinarlas o proponer otra):

- **A — No cortar nada.** Seguís como ahora, el trial es solo un
  cartel informativo. Más simple, pero no genera presión real para
  pagar.
- **B — Cortar el link público.** El comercio sigue viendo y usando
  su agenda (turnos manuales, clientes, métricas) pero
  `reservar.html` deja de aceptar reservas nuevas hasta que pague. Es
  el corte más "amigable": no le rompés el día a día, pero sí la
  funcionalidad que más valor le da a Clavis frente al cuaderno.
- **C — Cortar la carga de turnos nuevos.** La agenda pasa a
  solo-lectura (puede ver, no puede cargar/reprogramar) hasta pagar.
  Más agresivo.
- **D — Sin corte automático, por ahora.** Vos mismo hacés seguimiento
  manual (llamás/escribís a quien se le venció) mientras el volumen
  es bajo, y programamos el corte automático más adelante.

**Qué necesito de vos:** una letra (A/B/C/D) o tu propia idea. Cuando
la tengas, volvé y lo implemento — es un cambio chico una vez que se
sabe QUÉ cortar (un chequeo en `app.js` al cargar la Agenda/al insertar
un turno, más algún aviso visual antes de que se corte).

- [ ] Decidido: _________________

---

## 5. Deploy (poner Clavis online de verdad)

**Por qué:** hoy todo vive como archivos locales en tu laptop. Nada
de esto es accesible desde internet.

**Ya está todo preparado y documentado en [`DEPLOY.md`](DEPLOY.md)**
— no repito el detalle acá para no tener dos versiones que se
desactualicen distinto.

**Ya hecho:** la parte liviana (frontend en Vercel) está online —
`https://clavis-lake-two.vercel.app` funciona de verdad contra tu
Supabase real (login, agenda, link público de reservas). Repo en
GitHub (`holaiuris/Clavis`) conectado a Vercel, redeploya solo con
cada push.

**Lo que falta:**
- [x] Cuenta en GitHub — hecho, repo `holaiuris/Clavis`.
- [x] Cuenta en Vercel — hecho, deployado.
- [ ] Cuenta en [Railway](https://railway.app) — aloja `server/`
      (WhatsApp + pagos). Tiene un nivel gratis limitado; para que
      quede corriendo 24/7 en serio vas a necesitar cargar una
      tarjeta.
- [ ] Acceso al panel de DNS de donde compraste `clavis.ar`, para
      cuando quieras que `clavis.ar` (en vez de la URL de Vercel)
      apunte a la app — hoy la demo vive en la URL de Vercel, el
      dominio propio no está conectado todavía.

**Cuándo está terminado:** `https://clavis.ar` carga el landing de
verdad, `app.html` funciona con tu Supabase real, y `server/` está
corriendo en Railway (no en tu laptop).

- [ ] Hecho (falta Railway + dominio propio)

---

## 6. Login con Google

**Ya configurado y probado** (Google Cloud Console + Supabase, ver
[`SETUP.md`](SETUP.md) sección "Login con Google") — entraste con tu
cuenta existente y te llevó a tu agenda.

**Todavía falta probar:** entrar con una cuenta de Google *distinta*
a la tuya — tiene que rechazar el login, porque el alta de comercios
sigue cerrada. Si en cambio te deja entrar y te muestra la pantalla de
"¡Bienvenido/a a Clavis!" pidiendo crear una agenda nueva, es un
problema de seguridad a cerrar antes de anunciar el login de Google
públicamente — avisame si pasa eso.

- [x] Hecho
- [ ] Probado que una cuenta ajena NO puede entrar

---

## 7. Captcha real contra bots (hoy solo hay un honeypot)

**Por qué:** `reservar.html` tiene un honeypot (un campo invisible que
atrapa bots simples), pero no un captcha de verdad. Sirve para bots
genéricos y poco sofisticados — no para alguien que apunte
específicamente a llenarte la agenda de reservas falsas.

**Recomiendo Cloudflare Turnstile** en vez de hCaptcha/reCAPTCHA: es
gratis, no le pide al cliente "elegí las imágenes con semáforos" (en
la mayoría de los casos pasa solo, sin fricción), y es más respetuoso
de la privacidad.

**Cómo conseguir las claves** (esto sí lo podés hacer vos solo, yo
después conecto el código):
1. Creá una cuenta gratis en [Cloudflare](https://dash.cloudflare.com/sign-up)
   (no hace falta mover tu dominio ahí, es solo para usar Turnstile).
2. En el dashboard, buscá **Turnstile** en el menú lateral.
3. **Add Site** (o "Add Widget"): nombre cualquiera, dominio
   `clavis.ar` (y `localhost` si querés poder probarlo en local).
4. Te da dos claves: **Site Key** (pública, va en el HTML) y **Secret
   Key** (privada, va en el server).

**Cuándo está terminado:** tenés las dos claves guardadas (no hace
falta que las pegues en ningún lado todavía) y volvés para que
conectemos el código — hay que sumar el widget en `reservar.html` y
un endpoint de verificación en `server/payments.js` o uno nuevo, para
chequear la respuesta del lado del servidor antes de aceptar una
reserva.

- [ ] Cuenta creada y claves obtenidas
- [ ] Conectado al código (lo hago yo cuando vuelvas con las claves)

---

## 8. Términos y Privacidad (hoy son links muertos)

**Por qué:** el footer del landing linkea "Términos" y "Privacidad"
pero van a `#` — no hay páginas reales. Ya estás cobrando de verdad
con Mercado Pago y guardando teléfonos/nombres de clientes de
terceros, así que esto importa.

**No soy abogado y esto no es asesoramiento legal** — armé un borrador
simple y honesto (`terminos.html` y `privacidad.html`): qué datos se
guardan y de quién (comercio y clientes del comercio), con quién se
comparten (Supabase, Mercado Pago, WhatsApp/Meta, Google si usás login
o Calendar, Vercel/Railway), cómo pedir que se borren, planes y
precios reales, etc. Los links del footer del landing ya apuntan ahí
en vez de a `#`.

**Lo que falta de tu parte:**
1. **Leerlo entero antes de confiar en él** — es un borrador honesto
   sobre cómo funciona Clavis hoy, no algo revisado por un abogado.
2. Reemplazar `hola@clavis.ar` (el email de contacto que puse como
   placeholder en las dos páginas) por tu email de contacto real —
   buscá "hola@clavis.ar" en `terminos.html` y `privacidad.html`.
3. Si tenés forma de que un abogado lo revise en algún momento,
   mejor, pero no es bloqueante para tenerlo publicado en vez de un
   link muerto.

- [x] Redactado (borrador, no revisado por abogado)
- [x] Páginas reales publicadas, links del footer actualizados
- [ ] Email de contacto real (reemplazar el placeholder)

---

## 9. Renombrar el comercio de prueba

**Por qué:** hoy tenés un comercio en Supabase que se llama
literalmente "Clavis" — por eso el logo (que dice "clavis") y el
nombre del comercio se repetían en el sidebar.

**Cómo — la forma fácil, desde la app misma:**
1. Entrá a Clavis con ese usuario.
2. Horarios → tarjeta "Marca del link público".
3. Cambiá "Nombre del comercio" por el real (ej. el de tu peluquero).
4. Guardar.

(Alternativa, si preferís tocarlo directo en la base: Supabase
Dashboard → Table Editor → tabla `peluqueros` → buscar la fila →
editar la columna `nombre` → Save. La forma de la app es más simple,
no hace falta esto salvo que quieras.)

**Cuándo está terminado:** el sidebar ya no muestra "Clavis" dos
veces.

- [ ] Hecho

---

## 10. Decidir qué hacer con "Sucursales ilimitadas" (plan Cadena)

**Por qué:** el landing promete "Sucursales ilimitadas" en el plan
Cadena, pero el modelo de datos hoy es un local por comercio
(`peluqueros` = un solo local) — si alguien paga ese plan esperando
multi-sucursal, no lo vas a poder entregar.

**Opciones:**

- **A — Sacar la promesa por ahora.** Ajustar el copy del plan Cadena
  a lo que sí existe hoy (más profesionales, soporte prioritario,
  etc.) hasta que se construya de verdad.
- **B — Construirlo.** Es un cambio de modelo de datos real (una
  tabla `sucursales`, o repensar qué significa `peluquero_id` cuando
  hay más de un local) — no es chico, hay que planearlo aparte.
- **C — Redefinir qué es "Cadena" hoy** sin tocar el modelo de datos
  (por ejemplo: varias cuentas de Clavis separadas con un descuento
  conjunto, en vez de una sola cuenta con múltiples locales) y ajustar
  el copy para que sea honesto con eso.

**Qué necesito de vos:** una letra, o tu propia idea.

- [ ] Decidido: _________________

---

## 11. Renombrar `peluqueros` a algo genérico (multi-rubro)

**Por qué:** lo notaste vos mismo — la tabla central de toda la base
se llama `peluqueros`, resabio de cuando el proyecto arrancó pensado
solo para un peluquero. Pero Clavis ya se posiciona multi-rubro (el
landing lo dice explícito: peluquerías, barberías, estética,
consultorios, tatuajes, kinesiología, veterinarias, talleres). El
nombre de la tabla no afecta a ningún usuario final — es interno,
nadie lo ve — pero sí puede confundir a cualquiera que lea el código
más adelante (¿por qué una veterinaria tiene una fila en
"peluqueros"?).

**Por qué no lo hago ya de una:** es un cambio grande y con blast
radius real, no un rename cosmético:
- La tabla `peluqueros` tiene `peluquero_id` como foreign key en
  **6 tablas** (`servicios`, `horarios_atencion`, `clientes`,
  `turnos`, `profesionales`, `notificaciones_pendientes`,
  `lista_espera`, `integraciones_google_calendar` — son más de 6 en
  realidad).
- Cada policy de RLS de esas tablas filtra explícitamente por
  `peluquero_id in (select id from peluqueros where user_id = auth.uid())`
  — hay que tocar cada una.
- Las funciones SQL (`generar_huecos_disponibles`,
  `obtener_turno_cliente`, `cancelar_turno_cliente`,
  `avisar_lista_espera`, etc.) reciben `p_peluquero_id` como parámetro.
- `app.js`, `reservar.js` y los tres servers de `server/` tienen
  `state.peluquero`, `peluqueroId`, `.from("peluqueros")` repartido
  por todos lados.
- La vista pública `peluqueros_publico` (que además tiene su propio
  historial de seguridad, ver `migracion_v7.sql`) también hay que
  renombrarla o recrearla.

Nada de esto es difícil por separado, pero hacerlo mal a medias deja
la base en un estado roto (algo escribe a `comercios`, algo lee de
`peluqueros`) — necesita ser una migración dedicada, probada de punta
a punta, no un cambio de paso.

**Cómo lo encararíamos** (cuando lo decidas):
1. Elegir el nombre nuevo (`comercios` es lo más directo — evitar
   algo más específico de un rubro, ya que la gracia es que sirva
   para cualquiera).
2. Una migración que renombre la tabla y la columna FK en cascada
   (`alter table ... rename to ...`, `alter table ... rename column
   peluquero_id to comercio_id` en cada una de las tablas que la
   referencian) — Postgres lo bancaría sin perder datos ni romper las
   foreign keys, pero cada policy/función/vista que las mencione por
   nombre hay que recrearla con el nombre nuevo.
3. Actualizar `app.js`/`reservar.js`/`server/*.js` en el mismo commit
   que la migración (no puede quedar el código viejo apuntando al
   nombre viejo ni un rato).
4. Probar el flujo completo de nuevo antes de dar por cerrado.

**Qué necesito de vos:** confirmar que querés hacer este cambio (y el
nombre elegido) antes de que lo planifique en detalle — es reversible
pero no gratis, mejor no arrancarlo a mitad de otra cosa.

- [ ] Decidido: hacerlo / dejarlo así / nombre elegido: _________________

---

## 12. Bot conversacional de WhatsApp (V2) — decisión de arquitectura tomada

**Por qué:** surgió de analizar una conversación que tuviste con otra IA
sobre cómo construir el agente de reservas por WhatsApp. La decisión
quedó documentada en `CLAUDE.md`, sección "Decisión: WhatsApp — bot
conversacional (V2)" — resumen acá:

- Va directo por la **API oficial de Meta**, con un **número nuevo,
  dedicado al bot** (no el que ya usa `server/index.js` para
  recordatorios). No arrancar con la vía QR/no oficial para "migrar
  después" — son motores de mensajería distintos, migrar sería casi
  reescribir esa parte.
- Al comercio se le vende como "recepcionista virtual con su propio
  número" — su WhatsApp de toda la vida no se toca. Configura un
  mensaje automático ahí derivando a los clientes que piden turno al
  número nuevo.
- El sistema de recordatorios actual (QR) sigue como está, conviven
  sin problema.

**Ya investigué esta parte (2026-09-22)** — resumen, detalle completo en
`CLAUDE.md`: el esquema de precios que citó la otra IA está
desactualizado. Meta pasó de cobrar "por conversación" a **"por
mensaje"** en julio 2025. Bajo el esquema nuevo, los mensajes que no
son plantilla (o sea, casi toda la conversación real del bot: cliente
escribe, bot responde) **son gratis sin tope** — mejor que el 1.000/mes
gratis que se manejaba antes. Solo se cobran las plantillas
(recordatorios proactivos tipo Utility, o Marketing), y el monto
exacto en pesos argentinos está en un rate card que pide login en Meta
Business Manager — no lo pude sacar sin esa cuenta.

**Lo que sigue de tu parte:**
1. Cuando crees el Business Manager de Meta (paso 2 de abajo),
   descargá el rate card de ahí para tener el número exacto en ARS de
   las plantillas Utility — es el único costo real que falta precisar.
2. Cuando quieras arrancar el bot de verdad: crear/verificar el
   Business Manager de Meta, dar de alta el número nuevo dedicado vía
   Embedded Signup, y elegir el proveedor de LLM (Gemini Flash o
   GPT-4o-mini son las opciones económicas que evaluamos — no hace
   falta alojar un modelo propio, el costo por reserva es ínfimo).
3. Avisarme cuando quieras que lo planifiquemos en detalle (prompt,
   function calling, tabla de estado de conversación) — es un feature
   grande, no lo arranco sin que me lo pidas explícitamente.

- [x] Precios de Meta investigados (falta el número exacto en ARS, necesita tu cuenta de Business Manager)
- [ ] Listo para planificar la construcción del bot

---

## Dónde estoy — resumen rápido

| # | Paso | Estado |
|---|------|--------|
| 1 | `SUPABASE_SERVICE_ROLE_KEY` | ✅ |
| 2 | Conectar WhatsApp (QR) | ⬜ |
| 3 | Probar flujo completo real | ⬜ |
| 4 | Decidir gate de trial/plan | ⬜ |
| 5 | Deploy (`DEPLOY.md`) | 🟡 Vercel online, falta Railway + dominio |
| 6 | Login con Google (`SETUP.md`) | ✅ (falta probar cuenta ajena) |
| 7 | Captcha real (Turnstile) | ⬜ (necesita que crees la cuenta de Cloudflare) |
| 8 | Términos y Privacidad | ✅ borrador publicado (falta tu email real) |
| 9 | Renombrar comercio de prueba | ⬜ |
| 10 | Decisión sucursales/Cadena | ⬜ |
| 11 | Renombrar `peluqueros` (multi-rubro) | ⬜ decisión pendiente |
| 12 | Bot WhatsApp V2 — confirmar precios Meta | ✅ investigado (falta ARS exacto) |
