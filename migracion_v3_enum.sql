-- ============================================================
-- Correr ESTE archivo SOLO, antes que migracion_v3.sql.
--
-- Por qué va separado: Postgres no permite usar un valor de enum
-- recién agregado dentro de la misma transacción en la que se lo
-- agrega. migracion_v3.sql ya usa origen = 'web' en una política, así
-- que ese valor tiene que existir en una transacción previa y ya
-- confirmada.
-- ============================================================

alter type turno_origen add value if not exists 'web';
