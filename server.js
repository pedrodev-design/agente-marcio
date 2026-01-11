// server.js
const express = require("express");
require("dotenv").config();

const { callAgent } = require("./ai");
const { loadKnowledge } = require("./knowledge");
const { findOrCreateClientByWhatsApp, saveMessage } = require("./db");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/test-agent", async (req, res) => {
  try {
    const { message, whatsapp, meta } = req.body;

    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: "message é obrigatório" });
    }

    if (!whatsapp) {
      return res.status(400).json({ error: "whatsapp é obrigatório" });
    }

    const numero = String(whatsapp).trim();

    // 1) Busca ou cria cliente
    const cliente = await findOrCreateClientByWhatsApp(numero);

    if (!cliente || !cliente.id) {
      throw new Error("Cliente não criado corretamente");
    }

    // 2) Salva mensagem do cliente
    await saveMessage(cliente.id, "cliente", message);

    // 3) Chama o agente (IA)
    // Agora o agente pode devolver ações (ex: enviar PDF quando o cliente pedir)
    const out = await callAgent(message, cliente, { meta });

    const reply = typeof out === "string" ? out : out?.reply;
    const actions = typeof out === "string" ? [] : (out?.actions || []);

    if (!reply || typeof reply !== "string") throw new Error("Resposta inválida do agente");

    // 4) Salva resposta do bot
    await saveMessage(cliente.id, "bot", reply);

    return res.json({ reply, actions });
  } catch (err) {
    console.error("🔥 ERRO NO /test-agent:");
    console.error(err?.stack || err);

    return res.status(500).json({
      error: "Erro interno",
      detail: err?.message || String(err),
    });
  }
});

loadKnowledge()
  .then(() => console.log("📚 PDFs carregados com sucesso"))
  .catch((e) => console.error("❌ Falha ao carregar PDFs:", e?.stack || e));

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
