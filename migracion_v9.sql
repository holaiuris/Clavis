-- ============================================================
-- Migración v9: confirmación por WhatsApp al cliente apenas reserva
-- desde el link público (antes solo salía el recordatorio previo).
--
-- Correr DESPUÉS de migracion_v8.sql. No borra nada existente.
-- ============================================================

alter table turnos add column confirmacion_enviada boolean not null default false;

comment on column turnos.confirmacion_enviada is
  'Lo marca server/index.js después de mandarle al cliente la confirmación de su turno. Solo aplica a turnos con origen = ''web'' (los cargados a mano ya se los confirma el comercio en persona/por su cuenta).';

-- Mismo motivo que aviso_comercio_enviado en migracion_v8.sql: sin
-- esto, todo turno 'web' ya existente dispararía una confirmación
-- retroactiva ("tu turno de hace 2 semanas quedó confirmado") apenas
-- el server lo revise por primera vez.
update turnos set confirmacion_enviada = true where origen = 'web';
