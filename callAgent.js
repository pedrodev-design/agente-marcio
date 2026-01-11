const { askLLM } = require("./llm");
const { getLastMessages } = require("./db");

async function callAgent(userMessage, cliente) {
  const historico = await getLastMessages(cliente.id, 10);

  const historyMessages = historico.map((m) => ({
    role: m.origem === "bot" ? "assistant" : "user",
    content: m.conteudo,
  }));

  const messages = [
    { role: "system", content: buildSystemPrompt(cliente) }, //pedro para que serve isso
    ...historyMessages,
    { role: "user", content: userMessage },
  ];

  const reply = await askLLM(messages);
  return reply;
}
