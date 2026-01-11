// db.js (MySQL) — persistência real de memória/etapas
const mysql = require("mysql2/promise");
require("dotenv").config();

const MAX_LAST_BOT_QUESTION = Number(process.env.MAX_LAST_BOT_QUESTION || 220);

const pool = mysql.createPool({
  host: (process.env.DB_HOST || "127.0.0.1").trim(),
  port: Number(process.env.DB_PORT || 3306),
  user: (process.env.DB_USER || "root").trim(),
  password: (process.env.DB_PASSWORD || "").trim(),
  database: (process.env.DB_NAME || "agente_marcio").trim(),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

async function findOrCreateClientByWhatsApp(whatsapp) {
  const wa = String(whatsapp || "").trim();
  if (!wa) throw new Error("findOrCreateClientByWhatsApp: whatsapp vazio");

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      "SELECT * FROM clientes WHERE whatsapp = ? LIMIT 1",
      [wa]
    );

    if (rows.length > 0) return rows[0];

    const [result] = await conn.execute(
      "INSERT INTO clientes (whatsapp, memory_json) VALUES (?, JSON_OBJECT())",
      [wa]
    );

    const [newRows] = await conn.execute(
      "SELECT * FROM clientes WHERE id = ? LIMIT 1",
      [Number(result.insertId)]
    );

    return newRows[0];
  } finally {
    conn.release();
  }
}

async function saveMessage(clienteId, origem, conteudo) {
  const cid = Number(clienteId);
  const org = String(origem || "").trim();
  const txt = String(conteudo ?? "").trim();

  if (!Number.isFinite(cid)) throw new Error(`saveMessage: clienteId inválido (${clienteId})`);
  if (!["cliente", "bot", "sistema"].includes(org)) {
    throw new Error(`saveMessage: origem inválida (${origem})`);
  }
  if (!txt) throw new Error("saveMessage: conteudo vazio");

  const conn = await pool.getConnection();
  try {
    await conn.execute(
      "INSERT INTO mensagens (cliente_id, origem, conteudo) VALUES (?, ?, ?)",
      [cid, org, txt]
    );
  } finally {
    conn.release();
  }
}

async function getLastMessages(clienteId, limit = 10) {
  const cid = Number(clienteId);
  let lim = Number(limit);

  if (!Number.isFinite(cid)) throw new Error(`getLastMessages: clienteId inválido (${clienteId})`);
  if (!Number.isFinite(lim) || lim <= 0) lim = 10;
  if (lim > 50) lim = 50;

  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.execute(
      `
      SELECT origem, conteudo, created_at
      FROM mensagens
      WHERE cliente_id = ?
      ORDER BY id DESC
      LIMIT ${lim}
      `,
      [cid]
    );
    return rows.reverse();
  } finally {
    conn.release();
  }
}

async function updateClient(clienteId, updates) {
  const cid = Number(clienteId);
  if (!Number.isFinite(cid)) throw new Error(`updateClient: clienteId inválido (${clienteId})`);

  const fields = [];
  const values = [];

  const set = (col, val) => {
    fields.push(`${col} = ?`);
    values.push(val);
  };

  if (updates.nome !== undefined) set("nome", updates.nome === null ? null : String(updates.nome));
  if (updates.cidade !== undefined) set("cidade", updates.cidade === null ? null : String(updates.cidade));
  if (updates.etapa_funil !== undefined) set("etapa_funil", updates.etapa_funil === null ? null : String(updates.etapa_funil));
  if (updates.memory_summary !== undefined) set("memory_summary", updates.memory_summary === null ? null : String(updates.memory_summary));
  if (updates.last_bot_question !== undefined) set("last_bot_question", updates.last_bot_question === null ? null : String(updates.last_bot_question));
  if (updates.visit_status !== undefined) set("visit_status", updates.visit_status === null ? null : String(updates.visit_status));
  if (updates.lead_source !== undefined) set("lead_source", updates.lead_source === null ? null : String(updates.lead_source));
  if (updates.lead_score !== undefined) set("lead_score", updates.lead_score === null ? null : String(updates.lead_score));

  if (updates.visit_datetime !== undefined) {
    // aceita Date, string ou null
    const v = updates.visit_datetime;
    if (v === null) set("visit_datetime", null);
    else if (v instanceof Date) set("visit_datetime", v);
    else set("visit_datetime", String(v));
  }

  if (updates.memory_json !== undefined) {
    // guarda como JSON válido
    const v = updates.memory_json;
    let jsonStr = null;
    if (v === null) jsonStr = null;
    else if (typeof v === "string") jsonStr = v;
    else jsonStr = JSON.stringify(v);
    fields.push("memory_json = CAST(? AS JSON)");
    values.push(jsonStr ?? "{}");
  }

  if (fields.length === 0) return;
  values.push(cid);

  const conn = await pool.getConnection();
  try {
    await conn.execute(`UPDATE clientes SET ${fields.join(", ")} WHERE id = ?`, values);
  } finally {
    conn.release();
  }
}

// helpers específicos
async function updateClientName(clienteId, nome) {
  return updateClient(clienteId, { nome });
}

async function updateClientStage(clienteId, etapa_funil) {
  return updateClient(clienteId, { etapa_funil });
}

async function updateClientMemory(clienteId, { memory_json, memory_summary }) {
  return updateClient(clienteId, { memory_json, memory_summary });
}

async function updateClientLastBotQuestion(clienteId, last_bot_question) {
  let v = last_bot_question;
  if (v != null) {
    v = String(v);
    if (v.length > MAX_LAST_BOT_QUESTION) v = v.slice(0, MAX_LAST_BOT_QUESTION);
  }
  return updateClient(clienteId, { last_bot_question: v });
}

async function updateClientVisit(clienteId, { visit_datetime, visit_status }) {
  return updateClient(clienteId, { visit_datetime, visit_status });
}

module.exports = {
  pool,
  findOrCreateClientByWhatsApp,
  saveMessage,
  getLastMessages,
  updateClient,
  updateClientName,
  updateClientStage,
  updateClientMemory,
  updateClientLastBotQuestion,
  updateClientVisit,
};
