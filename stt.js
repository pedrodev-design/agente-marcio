// stt.js
// Transcrição de áudio (cliente -> texto) usando endpoint OpenAI-compatible do Groq.
// Requer: GROQ_API_KEY e (opcional) GROQ_STT_MODEL.

require("dotenv").config();
const axios = require("axios");
const FormData = require("form-data");

/**
 * @param {Buffer} buffer
 * @param {{ mimetype?: string, filename?: string }} opts
 */
async function transcribeAudio(buffer, opts = {}) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY não está definida no .env");
  }
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("transcribeAudio: buffer inválido");
  }

  const model = (process.env.GROQ_STT_MODEL || "whisper-large-v3").trim();
  const filename = (opts.filename || "audio.ogg").trim();
  const mimetype = (opts.mimetype || "audio/ogg").trim();

  const form = new FormData();
  form.append("file", buffer, { filename, contentType: mimetype });
  form.append("model", model);
  form.append("temperature", "0");
  // língua opcional (pt-BR). Se quiser deixar automático, remova.
  form.append("language", "pt");

  const response = await axios.post(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    form,
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY.trim()}`,
        ...form.getHeaders(),
      },
      maxBodyLength: Infinity,
      timeout: 45_000,
    }
  );

  const text = response?.data?.text;
  return typeof text === "string" ? text : "";
}

module.exports = { transcribeAudio };
