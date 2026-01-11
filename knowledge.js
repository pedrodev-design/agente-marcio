// knowledge.js
// RAG simples baseado em PDFs em /documents.
// - Extrai texto com pdf-parse
// - Quebra em trechos
// - Faz busca por overlap de palavras (sem embeddings) para manter o projeto leve

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

const STOP = new Set([
  "a","o","os","as","um","uma","de","do","da","dos","das","e","em","no","na","nos","nas","para","por",
  "com","sem","que","se","ao","à","às","é","ser","sua","seu","são","foi","como","mais","menos","ou",
  "não","sim","pra","pro","você","vc","eu","me","minha","meu","sobre","também","já","tem","têm"
]);

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(" ")
    .filter(t => t.length >= 3 && !STOP.has(t));
}

function chunkText(text, size = 900, overlap = 150) {
  const chunks = [];
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return chunks;

  let i = 0;
  while (i < clean.length) {
    const end = Math.min(clean.length, i + size);
    const chunk = clean.slice(i, end).trim();
    if (chunk) chunks.push(chunk);
    i = end - overlap;
    if (i < 0) i = 0;
    if (end === clean.length) break;
  }
  return chunks;
}

let KB = []; // { source, idx, text, tokensSet }
let DOCS = []; // { file, fullPath, sizeBytes }

async function loadKnowledge(documentsDir = path.join(__dirname, "documents")) {
  const files = fs.existsSync(documentsDir)
    ? fs.readdirSync(documentsDir).filter(f => f.toLowerCase().endsWith(".pdf"))
    : [];

  // catálogo de arquivos para envio via WhatsApp (quando o cliente pedir)
  DOCS = files.map((file) => {
    const fullPath = path.join(documentsDir, file);
    const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
    return { file, fullPath, sizeBytes: stat?.size || 0 };
  });

  const out = [];
  for (const file of files) {
    const buf = fs.readFileSync(path.join(documentsDir, file));
    const data = await pdfParse(buf);
    const chunks = chunkText(data.text || "");
    chunks.forEach((c, idx) => {
      const toks = new Set(tokenize(c));
      out.push({ source: file, idx, text: c, tokensSet: toks });
    });
  }

  KB = out;
  console.log(`📚 Knowledge carregado: ${KB.length} trechos de ${files.length} PDF(s)`);
  return KB.length;
}

function listDocuments() {
  return DOCS.slice();
}

/**
 * Tenta escolher um PDF “certo” para o pedido do cliente.
 * Regra: só usamos isso para SUGERIR/ENVIAR quando o cliente pediu documento.
 */
function findBestDocument(query = "") {
  if (!DOCS.length) return null;

  const q = normalize(query);
  // atalhos comuns
  const wantsEscritura = /(escritura|matr[ií]cula|registro|cart[oó]rio|documenta[cç][aã]o)/i.test(query);
  if (wantsEscritura) {
    // prefere um nome “principal” se existir
    const preferred = DOCS.find(d => /escritura\s+chacara\.pdf$/i.test(d.file)) || DOCS[0];
    return preferred || null;
  }

  // fallback: overlap no nome do arquivo
  const qTokens = new Set(tokenize(q));
  let best = null;
  let bestScore = -1;
  for (const d of DOCS) {
    const nameTokens = tokenize(d.file);
    let score = 0;
    for (const t of nameTokens) if (qTokens.has(t)) score += 1;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return bestScore > 0 ? best : null;
}

function retrieve(query, k = 4) {
  if (!KB.length) return [];

  const qTokens = tokenize(query);
  if (!qTokens.length) return [];

  const scored = KB.map(ch => {
    let score = 0;
    for (const t of qTokens) if (ch.tokensSet.has(t)) score += 1;
    return { ...ch, score };
  }).filter(x => x.score > 0);

  scored.sort((a,b) => b.score - a.score);
  return scored.slice(0, k);
}

function formatContext(chunks) {
  if (!chunks?.length) return "";
  return chunks.map(c => `- [${c.source} :: trecho ${c.idx+1}] ${c.text}`).join("\n\n");
}

module.exports = { loadKnowledge, retrieve, formatContext, listDocuments, findBestDocument };
