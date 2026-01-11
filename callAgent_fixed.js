const { askLLM } = require("./llm");
const { getLastMessages } = require("./db");
const { buildSystemPrompt } = require("./ai");

async function callAgent(userMessage, cliente) {
  const historico = await getLastMessages(cliente.id, 10);

  const historyMessages = (historico || []).map((m) => ({
    role: m.origem === "bot" ? "assistant" : "user",
    content: m.conteudo,
  }));

  const messages = [
    { role: "system", content: buildSystemPrompt(cliente) },
    ...historyMessages,
    { role: "user", content: userMessage },
  ];

  const reply = await askLLM(messages);
  return reply;
}

module.exports = { callAgent };