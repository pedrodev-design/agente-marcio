-- schema.sql (MySQL 8+)
CREATE TABLE IF NOT EXISTS clientes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  whatsapp VARCHAR(32) NOT NULL,
  nome VARCHAR(120) NULL,
  cidade VARCHAR(120) NULL,
  etapa_funil VARCHAR(40) NULL,
  memory_json JSON NULL,
  memory_summary TEXT NULL,
  last_bot_question TEXT NULL,
  visit_datetime DATETIME NULL,
  visit_status VARCHAR(40) NULL,
  lead_source VARCHAR(80) NULL,
  lead_score VARCHAR(20) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clientes_whatsapp (whatsapp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mensagens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id BIGINT UNSIGNED NOT NULL,
  origem ENUM('cliente','bot','sistema') NOT NULL,
  conteudo TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mensagens_cliente_id (cliente_id),
  CONSTRAINT fk_mensagens_cliente
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
