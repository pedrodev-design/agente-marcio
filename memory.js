// memory.js
// Pequeno helper para JSON seguro (evita quebrar quando o campo vem NULL/""/objeto)

function safeJsonParse(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  const s = String(value).trim();
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

module.exports = { safeJsonParse };
