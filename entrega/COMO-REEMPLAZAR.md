# Cómo reemplazar tu versión actual por esta

No hace falta tocar `app.js`, `reservar.js`, `config.js` ni el SQL.
El rediseño entra por dos archivos + los SVG.

## 1. Copiá estos archivos sobre tu carpeta `turnos-app/`

```
entrega/index.html   →  turnos-app/index.html      (reemplaza)
entrega/style.css    →  turnos-app/style.css       (reemplaza)
entrega/assets/      →  turnos-app/assets/         (crea o reemplaza)
```

Los assets quedan con los nombres exactos que ya pide `app.js`:

| archivo                            | dónde se usa                         |
|------------------------------------|--------------------------------------|
| `assets/logo-clavis.svg`           | sidebar de la app + landing (navy)   |
| `assets/logo-clavis-light.svg`     | panel del login (fondo oscuro)       |
| `assets/login-ilustracion.svg`     | panel del login                      |
| `assets/sin-turnos.svg`            | agenda sin turnos / sin horarios     |

## 2. Nada más

- La tipografía nueva (Bricolage Grotesque para títulos) se carga con un
  `@import` dentro de `style.css`, así que **no hay que editar `app.html`
  ni `reservar.html`**.
- `style.css` conserva **todos** los selectores de la versión anterior
  (`.login-shell`, `.shell`, `.sidebar`, `.agenda-list`, `.turno-card`,
  `.status-badge`, `.modal`, `.switch`, `.stats-grid`, `.horarios-grid`,
  los estilos de impresión…), así que el HTML que genera `app.js` sigue
  funcionando igual: sólo cambia el aspecto.
- `reservar.html` usa el mismo `style.css`, así que el link público de
  reservas también queda actualizado.

## 3. Probar

```bash
cd turnos-app
python3 -m http.server 8080
```

- `http://localhost:8080` → landing nueva
- `http://localhost:8080/app.html` → login + agenda con el estilo nuevo
- `http://localhost:8080/entrega/_preview-app.html` (o abrilo suelto) →
  muestra todos los componentes de la app con el estilo nuevo, sin
  necesidad de loguearse. Es sólo para revisar; no lo subas a producción.

## Detalles del rediseño que conviene saber

- **Contraste**: sobre celeste `#6EABC7` la tinta pasa a navy `#243E4B`
  (blanco sobre celeste no llegaba al mínimo legible). Por eso los
  botones celestes ahora tienen texto navy.
- **Estados de turno**: `.turno-card` se colorea por `data-estado`
  (`confirmado` amarillo, `atendido` verde, `ausente` rojo, `cancelado`
  y `bloqueado` gris) con una barra de 4px a la izquierda.
- **Botón "escalón"**: se mantiene, es la firma de la marca; sólo se
  ajustaron radios y tonos.
- **Landing**: los efectos de scroll (barra de progreso, reveals,
  contadores, parallax, pasos que se encienden, marquee) van en un
  `<script>` inline al final de `index.html`. No depende de librerías.

## Pendiente que no cubre esta entrega

- El `favicon` (podés usar `assets/logo-clavis.svg` recortado al isotipo).
- Login con Google: sigue como estaba (ver SETUP.md, punto final).
