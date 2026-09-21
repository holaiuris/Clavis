-- ============================================================
-- Migración v15: color de fondo personalizable para el link público
-- (reservar.html), además del color de acento que ya existía
-- (migracion_v5.sql). Mismo criterio: opcional, si es null usa el
-- fondo celeste/blanco de Clavis por defecto.
--
-- Correr DESPUÉS de migracion_v14.sql. No borra nada existente.
-- ============================================================

alter table peluqueros add column color_fondo text;

comment on column peluqueros.color_fondo is
  'Hex (#rrggbb) opcional. Si está null, reservar.html usa el fondo de Clavis por defecto (var(--bg)).';

-- peluqueros_publico (migracion_v7.sql) es la única fuente de datos
-- de comercio que reservar.html puede leer sin login — hay que
-- agregar la columna nueva ahí también, si no reservar.js nunca la
-- va a poder leer pese a que el dueño la haya guardado.
--
-- Ojo: color_fondo va AL FINAL de la lista, no en el medio. Postgres
-- no deja insertar una columna nueva entre columnas existentes con
-- CREATE OR REPLACE VIEW — lo interpreta como un intento de renombrar
-- la columna que quedó corrida de posición (acá, logo_url) y lo
-- rechaza. Agregar solo al final es lo único que funciona sin dropear
-- la vista.
create or replace view peluqueros_publico as
  select id, nombre, slug, aviso_minimo_horas, color_acento, logo_url, color_fondo
  from peluqueros;
