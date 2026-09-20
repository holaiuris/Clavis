-- ============================================================
-- Migración v4: aviso mínimo para el link público de reservas.
-- Correr DESPUÉS de migracion_v3.sql. No borra nada existente.
-- ============================================================

alter table peluqueros add column aviso_minimo_horas int not null default 2;

comment on column peluqueros.aviso_minimo_horas is
  'Mínimo de horas de anticipación para reservar desde reservar.html (link público). No afecta la agenda que carga el propio comercio.';
