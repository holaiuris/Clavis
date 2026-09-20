-- ============================================================
-- Migración v8: aviso por WhatsApp al COMERCIO (no solo al cliente)
-- cuando entra una reserva nueva desde el link público.
--
-- Correr DESPUÉS de migracion_v7.sql. No borra nada existente.
-- ============================================================

alter table turnos add column aviso_comercio_enviado boolean not null default false;

comment on column turnos.aviso_comercio_enviado is
  'Lo marca server/index.js después de avisarle al comercio (peluqueros.telefono) que entró una reserva nueva por el link público. Solo aplica a turnos con origen = ''web''.';

-- Sin esto, todo turno 'web' ya cargado antes de esta migración
-- dispararía un aviso retroactivo apenas el server lo revise por
-- primera vez — los marcamos como ya avisados.
update turnos set aviso_comercio_enviado = true where origen = 'web';
