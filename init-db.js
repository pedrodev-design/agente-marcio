// init-db.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

async function main() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");

  const conn = await pool.getConnection();
  try {
    // Executa bloco a bloco (separado por ;)
    const statements = sql
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await conn.query(stmt);
    }

    console.log("✅ Banco inicializado com schema.sql");
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("❌ Falha ao inicializar o banco:", e);
  process.exit(1);
});
