# Setup — Clavis (agenda de turnos)

## 1. Crear el proyecto en Supabase

1. Entrá a https://supabase.com y creá una cuenta / iniciá sesión.
2. "New project" → elegí nombre, contraseña de la base y región (la más
   cercana a Argentina es `South America (São Paulo)`).
3. Esperá 1-2 minutos a que termine de provisionar.

## 2. Correr el schema SQL

**Orden importante — corré estos archivos en este orden exacto, cada
uno con su propio "Run" (no los pegues todos juntos en una sola
consulta):**

1. En el proyecto, ir a **SQL Editor** (menú lateral).
2. Pegar el contenido completo de `schema.sql` → **Run**.
3. Pegar el contenido completo de `migracion_v2.sql` → **Run**. Agrega
   `profesionales` (multi-empleado), `clientes` (historial) y las
   columnas nuevas de `turnos`.
4. Pegar el contenido completo de `huecos.sql` → **Run**. Esta versión
   depende de las columnas que agrega `migracion_v2.sql`, por eso va
   después.
5. Pegar el contenido completo de `migracion_v3_enum.sql` → **Run**,
   **como consulta separada**. Agrega el valor `'web'` al enum
   `turno_origen` — Postgres no deja usar un valor de enum nuevo en la
   misma transacción en que se lo crea, por eso no puede ir junto con
   el paso 6.
6. Pegar el contenido completo de `migracion_v3.sql` → **Run**. Trial,
   config de recordatorios de WhatsApp, y el acceso público acotado
   para `reservar.html`.
7. Pegar el contenido completo de `migracion_v4.sql` → **Run**. Aviso
   mínimo para reservar desde el link público.
8. Pegar el contenido completo de `migracion_v5.sql` → **Run**. Color
   de acento y logo para personalizar `reservar.html`, más el bucket de
   Storage `logos` donde se guardan los logos subidos desde
   Configuración.

Si tu proyecto ya tenía datos cargados de una instalación anterior, no
hace falta borrar nada: corré igual los pasos que falten sobre lo que
ya existe — están pensados para migrar en caliente.

## 3. Habilitar login por email/contraseña

1. Ir a **Authentication → Providers**.
2. Confirmar que "Email" esté habilitado (viene activado por defecto).
3. Si no querés que pida confirmación por mail antes de poder loguearse
   (más simple para probar), ir a **Authentication → Settings** y
   desactivar "Confirm email".
4. **Importante:** en **Authentication → Settings**, desactivar "Allow new
   users to sign up". El alta de peluqueros es manual (invitación desde
   este dashboard), no self-service desde la web — ver el punto 6.

## 4. Conectar la app con tu proyecto

1. En Supabase: **Project Settings → API**.
2. Copiar **Project URL** y **anon public key**.
3. Abrir `config.js` en esta carpeta y completar:

```js
window.SUPABASE_URL = "https://xxxxxxxx.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJI...";
```

## 5. Probar localmente

Cualquier servidor estático sirve. Por ejemplo, con Python:

```bash
cd turnos-app
python3 -m http.server 8080
```

- `http://localhost:8080` → **landing** (`index.html`), la página pública.
- `http://localhost:8080/app.html` → login / app (a donde llevan todos
  los botones del landing).
- `http://localhost:8080/reservar.html?c=<peluquero_id>` → link público
  de reservas de un comercio puntual (el `<peluquero_id>` se copia desde
  la vista Horarios una vez que tenés una cuenta creada, ver abajo).

## 6. Crear la cuenta del peluquero

El alta **no es self-service** (ver punto 3.4): no hay botón de "crear
cuenta" en la web. Para dar de alta a un peluquero:

1. En Supabase: **Authentication → Users → Add user**.
2. Cargar su email y una contraseña (o usar "Send invite" si preferís que
   la elija él por mail).
3. Pasarle esas credenciales para que entre en `http://localhost:8080/app.html`
   (o donde esté deployada la app).

## 7. Primer uso (con la cuenta ya creada)

1. Iniciar sesión con el email/contraseña del paso anterior (en `app.html`).
2. Al ingresar por primera vez, la app pide un nombre, crea
   automáticamente su fila en `peluqueros` y un profesional inicial
   llamado "Vos".
3. Ir a **Horarios** (sidebar) y:
   - Agregar los **profesionales** que atienden en el comercio (si es
     solo vos, dejá el que ya está y renombralo si querés).
   - Agregar al menos un **servicio** (ej: "Corte", 30 min).
   - Prender el toggle de los **días de atención** que correspondan —
     es el horario del comercio, compartido por todos los profesionales.
   - Ahí mismo podés copiar tu **link de reservas** para pasarle a
     clientes, y elegir cuándo mandar el **recordatorio de WhatsApp**
     (necesita `server/index.js` corriendo, ver `server/README.md`).
4. Ir a **Agenda**: elegí fecha, profesional y servicio arriba — aparece
   la lista del día con los huecos libres (cada profesional tiene su
   propia agenda; dos pueden tener turnos a la misma hora sin pisarse).
5. Tocar un hueco libre para **asignar un turno** (carga cliente) o
   **bloquearlo** (almuerzo, ausencia, etc.). Tocar un turno ya cargado
   para ver el detalle, marcar si el cliente asistió o faltó, o cancelarlo.
6. **Métricas** (sidebar) muestra ingresos, % de ocupación, % de
   ausencias y servicios más pedidos, del comercio completo.
7. El botón **"Activar plan"** (abajo a la izquierda) lleva a un cobro
   real con Mercado Pago — necesita `server/payments.js` corriendo, ver
   `server/README.md`.

## Cómo usan esto varios comercios

Cada comercio se loguea con su propio email/contraseña (cuenta creada a
mano por vos, ver punto 6 de arriba). Las políticas de seguridad (RLS)
hacen que cada uno solo vea y edite su propia agenda, servicios,
horarios, profesionales y clientes — no hace falta ningún selector
manual de "cuál comercio soy": lo determina el login.

Dentro de un mismo comercio, los **profesionales** (Nico, Vale, etc.) no
tienen login propio — los gestiona el dueño de la cuenta desde Horarios,
y se elige con cuál se está trabajando desde los chips de la Agenda.

## Recordatorios de WhatsApp y cobro con Mercado Pago

Son los dos únicos componentes que necesitan un proceso corriendo
aparte (todo lo demás es estático) — ver `server/README.md` para la
instalación completa de ambos. Resumen:

- **Recordatorios**: `server/index.js`, usa whatsapp-web.js (no
  oficial — hay que escanear un QR una vez con un WhatsApp real).
  Manda un mensaje X horas antes de cada turno, según lo que configures
  en Horarios.
- **Pagos**: `server/payments.js`, usa el SDK de Mercado Pago. El botón
  "Activar plan" del sidebar crea una preferencia de pago y te redirige
  al checkout; cuando Mercado Pago confirma el pago (webhook), activa
  el plan. Es un pago único (no suscripción recurrente todavía).

Si el cliente reserva por WhatsApp en vez de por `reservar.html` más
adelante (bot conversacional completo, todavía no construido), debería
reusar `generar_huecos_disponibles` e insertar en `turnos` con
`origen = 'whatsapp'` — sin tocar el resto de la app.

## Próximo paso pendiente: login con Google

Decisión explícita de no hacerlo todavía. Cuando se retome: hay que
crear credenciales OAuth en Google Cloud (consentimiento, client
ID/secret) y cargarlas en Supabase → Authentication → Providers →
Google; el código del botón "Continuar con Google" se agrega recién
ahí, del lado de `app.js`.
