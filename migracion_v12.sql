-- ============================================================
-- Migración v12: cancelar un turno deja de borrar la fila — ahora
-- marca estado = 'cancelado'. Antes se perdía el registro de que el
-- turno existió (no quedaba en el historial del cliente ni servía
-- para reportes tipo "¿cuántos se cancelaron esta semana?").
--
-- No hace falta tocar generar_huecos_disponibles ni el exclude
-- constraint: los dos ya filtran/aplican solo sobre
-- estado in ('ocupado', 'bloqueado') (ver schema.sql, huecos.sql) —
-- un turno 'cancelado' libera el hueco exactamente igual que antes
-- el delete, sin cambiar una línea ahí.
--
-- Solo bloqueos ('bloqueado', "Liberar horario" en la Agenda) siguen
-- borrándose de verdad — no son una cita de cliente, no hay nada que
-- valga la pena guardar en el historial.
--
-- Correr DESPUÉS de migracion_v11.sql. No borra nada existente.
-- ============================================================

alter type turno_estado add value 'cancelado';
