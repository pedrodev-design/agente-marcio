-- migration.sql
-- Rode isso se seu banco já existe e está dando: Data too long for column 'last_bot_question'
ALTER TABLE clientes MODIFY COLUMN last_bot_question TEXT NULL;
ALTER TABLE clientes MODIFY COLUMN memory_summary TEXT NULL;
