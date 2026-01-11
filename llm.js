// llm.js — Groq (OpenAI compatible)
// - Anti-repetição (presence/frequency penalties)
// - top_p + temperature ajustáveis
// - retry com backoff (mais estável)
// - compatível: askLLM(messages) ou askLLM(messages, opts)

const axios = require("axios");
require("dotenv").config();

const GROQ_URL = (process.env.GROQ_URL || "https://api.groq.com/openai/v1/chat/completions").trim();
const MODEL = (process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim();

const DEFAULTS = {
  temperature: Number(process.env.LLM_TEMPERATURE ?? 0.9),
  top_p: Number(process.env.LLM_TOP_P ?? 0.9),
  max_tokens: Number(process.env.LLM_MAX_TOKENS ?? 420),
  presence_penalty: Number(process.env.LLM_PRESENCE_PENALTY ?? 0.55),
  frequency_penalty: Number(process.env.LLM_FREQUENCY_PENALTY ?? 0.7),
  timeout_ms: Number(process.env.LLM_TIMEOUT_MS ?? 30_000),
  retries: Number(process.env.LLM_RETRIES ?? 2),
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(err) {
  const status = err?.response?.status;
  if (!status) return true; // rede/timeout/DNS
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return false;
}

async function askLLM(messages, opts = {}) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY não está definida no .env");
  }

  const cfg = {
    temperature: typeof opts.temperature === "number" ? opts.temperature : DEFAULTS.temperature,
    top_p: typeof opts.top_p === "number" ? opts.top_p : DEFAULTS.top_p,
    max_tokens: typeof opts.max_tokens === "number" ? opts.max_tokens : DEFAULTS.max_tokens,
    presence_penalty:
      typeof opts.presence_penalty === "number" ? opts.presence_penalty : DEFAULTS.presence_penalty,
    frequency_penalty:
      typeof opts.frequency_penalty === "number" ? opts.frequency_penalty : DEFAULTS.frequency_penalty,
  };

  let lastErr = null;

  for (let attempt = 0; attempt <= DEFAULTS.retries; attempt++) {
    try {
      const response = await axios.post(
        GROQ_URL,
        {
          model: MODEL,
          messages,
          temperature: cfg.temperature,
          top_p: cfg.top_p,
          max_tokens: cfg.max_tokens,
          presence_penalty: cfg.presence_penalty,
          frequency_penalty: cfg.frequency_penalty,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.GROQ_API_KEY.trim()}`,
            "Content-Type": "application/json",
          },
          timeout: DEFAULTS.timeout_ms,
        }
      );

      const content = response?.data?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new Error(`Resposta do Groq sem content: ${JSON.stringify(response.data)}`);
      }

      return content;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === DEFAULTS.retries) break;
      const base = 500 * (attempt + 1);
      const jitter = Math.floor(Math.random() * 250);
      await sleep(base + jitter);
    }
  }

  if (lastErr?.response) {
    const status = lastErr.response.status;
    const data = lastErr.response.data;
    throw new Error(`Groq HTTP ${status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  }

  throw new Error(`Falha ao chamar Groq: ${lastErr?.message || "erro desconhecido"}`);
}

module.exports = { askLLM };
