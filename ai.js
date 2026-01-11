/**
 * agent.js (COMPLETO) — LOCALIZAÇÃO = SÓ LINK (SEM REPETIR TEXTO)
 *
 * O QUE MUDEI (pra ficar do jeito que você quer):
 * 1) clientAskedLocation: agora detecta também "link", "localizador", "pin" etc.
 * 2) Rota 4) Localização: responde SOMENTE com o link do Maps (sem texto extra, sem pergunta).
 * 3) Adicionei mem.flags.location_sent (anti-loop opcional). Mesmo assim ele sempre manda só o link.
 *
 * OBS: Não usa actions pra localização (evita travar no bot verde).
 */

const { askLLM } = require("./llm");
const { retrieve, formatContext, listDocuments } = require("./knowledge");
const {
  getLastMessages,
  updateClientName,
  updateClientMemory,
  updateClientLastBotQuestion,
  updateClientStage,
  saveMessage,
} = require("./db");
const { safeJsonParse } = require("./memory");
const { getDefaultMediaPackage } = require("./media");

/**
 * ============================
 * MEMÓRIA FIXA (OFICIAL)
 * ============================
 */
const IMOVEL_MEMORIA = `
IMÓVEL (ÚNICO):
- Chácara (lote) de 4.000m² no Condomínio Aroeira, Trindade/GO.
- Terreno plano, bem posicionado, pronto para construir.
- Energia trifásica disponível/instalada.
- Água encanada disponível no lote.
- Escritura individual registrada (não é quota/quotaparte).
- Documentação regular e pronta para transferência.

CONDOMÍNIO:
- Condomínio fechado e organizado.
- Ruas boas, coleta de lixo.
- Segurança com guardas dia e noite.
- Local tranquilo e seguro.
- Taxa aproximada: R$ 550/mês.

LOCALIZAÇÃO:
- Envie o link da localizacao para o cliente quando ele pedir a localizacao do imovel:
  https://www.google.com/maps?q=-16.6090515,-49.4088258&z=17&hl=pt-BR
- Trindade/GO.

PREÇO:
- Valor: R$ 850.000.
- Só informar se o cliente perguntar explicitamente sobre valor/preço/quanto custa.
- Nunca fale o valor sem o cliente perguntar.
- Nunca ofereça falar o preço.
- Negociação direta com o proprietário (sem imobiliária).
- Aceita propostas sérias.

MÍDIA/DOCUMENTOS:
- Enviar fotos/vídeos/PDFs AUTOMATICAMENTE quando o cliente pedir.
- Se o cliente apenas “sondar” (ex: “tem documentos?”), trate como pedido (ele quer receber) e envie também.
- Nunca enviar sem qualquer menção do cliente ao assunto.
`.trim();

/**
 * ============================
 * Helpers
 * ============================
 */
function normalizeText(s = "") {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ");
}
function lower(s = "") {
  return normalizeText(s).toLowerCase();
}
function clampText(text, max = 520) {
  const t = normalizeText(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const last = Math.max(
    cut.lastIndexOf("."),
    cut.lastIndexOf("!"),
    cut.lastIndexOf("?")
  );
  if (last > 140) return cut.slice(0, last + 1);
  return cut.trim() + "...";
}
// last_bot_question no DB: sempre curtinho pra não estourar coluna
function clampForLastBot(text) {
  return clampText(text, 220);
}

// Similaridade simples (anti-loop)
function tokenize(s = "") {
  return lower(s)
    .replace(/[^a-z0-9áéíóúàâêôãõçü\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}
function jaccard(a = "", b = "") {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

// Cumprimento / primeira mensagem
function isGreetingOnly(text = "") {
  const t = lower(text);
  if (!t) return false;
  const greeting =
    /^(oi|ol[aá]|opa|e a[ií]|ea[ií]|bom dia|boa tarde|boa noite|tudo bem\??|tudo certo\??|fala|salve|hey|hello|blz|beleza)\s*!*\?*$/i.test(
      t
    );
  return greeting;
}
function isVeryShort(text = "") {
  const t = lower(text);
  return t.length <= 10;
}

/**
 * ============================
 * Detectores (intenção)
 * ============================
 */

// Pergunta direta de preço
function clientAskedPrice(text = "") {
  const t = lower(text);
  if (!t) return false;
  const priceWord =
    /\b(pre[çc]o|valor|quanto|custa|custaria|qual o valor|quanto é|sai por|fica por)\b/i.test(
      t
    );
  const falsePos = /(valoriz|valoriza|vale a pena|valoriza[çc][aã]o)/i.test(t);
  return priceWord && !falsePos;
}

// Pedido de mídia (manda/envia/mostra + foto/vídeo)
function clientAskedMedia(text = "") {
  const t = lower(text);
  if (!t) return false;
  const wants =
    /(manda|envia|me manda|me envia|pode mandar|pode enviar|consegue mandar|tem como mandar|mostra|mostrar|quero ver|tem como ver)/i.test(
      t
    );
  const media =
    /(foto|fotos|imagem|imagens|vídeo|video|videos|filmagem|tour|grava[çc][aã]o|gravacao)/i.test(
      t
    );
  return wants && media;
}

// “Sondou” mídia (tem foto? tem vídeo?) — já é pedido
function clientInquiredMedia(text = "") {
  const t = lower(text);
  if (!t) return false;
  if (clientAskedMedia(text)) return false;
  const media =
    /(foto|fotos|imagem|imagens|vídeo|video|videos|filmagem|tour|grava[çc][aã]o|gravacao)/i.test(
      t
    );
  const inquiry =
    /(tem|possui|vcs tem|voc[eê]s tem|d[aá] pra ver|tem como ver|pode ver|consegue mostrar|mostra|mostrar)/i.test(
      t
    );
  return media && inquiry;
}

// Documento (PDF, matrícula, escritura etc.) — se mencionou querendo ver, envia
function clientAskedOrInquiredDocs(text = "") {
  const t = lower(text);
  if (!t) return false;

  const doc =
    /(documento|documentos|pdf|arquivo|escritura|matr[ií]cula|registro|cart[oó]rio|certid[aã]o|documenta[cç][aã]o)/i.test(
      t
    );
  if (!doc) return false;

  const wants =
    /(manda|envia|me manda|me envia|pode mandar|pode enviar|consegue mandar|anexa|anexar|tem|possui|d[aá] pra ver|tem como ver|pode ver|consegue mostrar)/i.test(
      t
    );

  return wants || /\?\s*$/.test(t);
}

// LOCALIZAÇÃO — (ALTERADO) pega "link", "localizador", "pin" etc.
function clientAskedLocation(text = "") {
  const t = lower(text);
  if (!t) return false;
  return /(onde fica|localiza|localiza[çc][aã]o|endereço|endereco|como chegar|maps|google maps|ponto de refer[eê]ncia|referencia|link.*localiza|localiza.*link|link do maps|localizador|pin)/i.test(
    t
  );
}

function clientAskedVisit(text = "") {
  const t = lower(text);
  if (!t) return false;
  return /(visita|visitar|marcar|agendar|agenda|quando posso ver|quero ver pessoalmente|ir a[ií]|hor[aá]rio|horario)/i.test(
    t
  );
}

function clientAskedSeller(text = "") {
  const t = lower(text);
  if (!t) return false;
  return /(quem é o vendedor|quem está vendendo|quem é Márcio|quem é o dono do lote|quem eu falo para comprar)/i.test(
    t
  );
}

function isOffensive(text = "") {
  const t = lower(text);
  if (!t) return false;
  const offenses = /(idiota|burro|imbecil|puta|caralho|foda|merda|porra|desgraçado|filho da puta|vai tomar no cu|vai se foder)/i;
  return offenses.test(t);
}

function extractName(text = "") {
  const t = normalizeText(text);
  const m =
    t.match(
      /(?:meu nome é|me chamo|eu sou|sou o|sou a|pode me chamar de)\s+([A-Za-zÀ-ÿ]{2,30})(?:\s|$)/i
    ) || t.match(/^([A-Za-zÀ-ÿ]{2,30})$/i);
  if (!m) return null;
  const name = String(m[1] || "").trim();
  if (!name) return null;
  if (
    /^(oi|olá|ola|opa|sim|não|nao|ok|blz|beleza|bom dia|boa tarde|boa noite)$/i.test(
      name
    )
  )
    return null;
  return name;
}

function extractNotes(text = "") {
  const t = lower(text);
  const notes = {};

  if (/(invest|aplica|valoriz)/i.test(t)) notes.purpose = "investir";
  else if (/(constru|obra|projeto|casa|sobrado)/i.test(t))
    notes.purpose = "construir";
  else if (/(morar|residir|muda|fam[ií]lia)/i.test(t)) notes.purpose = "morar";

  if (/(avista|à vista|a vista|pix|dinheiro)/i.test(t))
    notes.payment = "avista";
  else if (/(financia|banco|parcel|entrada)/i.test(t))
    notes.payment = "financiado";
  else if (/(permuta|troca|carro|ve[ií]culo|apartamento|casa)/i.test(t))
    notes.payment = "permuta";

  if (/(agora|urgente|essa semana|hoje|amanh[aã])/i.test(t))
    notes.timeframe = "agora";
  else if (
    /(meses|ano|daqui|mais pra frente|olhando com calma|sem pressa)/i.test(t)
  )
    notes.timeframe = "meses";

  return notes;
}

/**
 * ============================
 * Memória
 * ============================
 */
function getMem(cliente) {
  const mem = safeJsonParse(cliente.memory_json) || {};
  if (!mem.flags) mem.flags = {};
  if (!mem.flags.media_sent) mem.flags.media_sent = false;
  if (!mem.flags.docs_sent) mem.flags.docs_sent = false;
  if (!mem.flags.price_disclosed) mem.flags.price_disclosed = false;
  if (!mem.flags.visit_intent) mem.flags.visit_intent = false;
  if (!mem.flags.greeted) mem.flags.greeted = false;

  // NOVO (anti-loop opcional)
  if (!mem.flags.location_sent) mem.flags.location_sent = false;

  if (!mem.notes) mem.notes = {};
  return mem;
}

function buildMemorySummary(cliente, mem) {
  const p = [];
  if (cliente.nome) p.push(`Nome: ${cliente.nome}`);
  if (mem.notes?.purpose) p.push(`Objetivo: ${mem.notes.purpose}`);
  if (mem.notes?.payment) p.push(`Pagamento: ${mem.notes.payment}`);
  if (mem.notes?.timeframe) p.push(`Prazo: ${mem.notes.timeframe}`);

  if (mem.flags?.media_sent) p.push("Mídia: enviada");
  if (mem.flags?.docs_sent) p.push("Docs: enviados");
  if (mem.flags?.price_disclosed) p.push("Preço: informado");
  if (mem.flags?.visit_intent) p.push("Visita: em conversa");
  if (mem.flags?.location_sent) p.push("Localização: enviada");

  return p.join(" | ");
}

async function persistMem(cliente, mem) {
  const summary = buildMemorySummary(cliente, mem);
  await updateClientMemory(cliente.id, {
    memory_json: mem,
    memory_summary: summary,
  });
  cliente.memory_summary = summary;
}

// Guardrails “cirúrgicos”
function stripProhibited(reply, userMsg) {
  let r = normalizeText(reply);

  // preço sem pedir: remove valores
  if (!clientAskedPrice(userMsg)) {
    r = r.replace(/\bR\$\s*850\.?000\b/gi, "").replace(/\b850\.?000\b/gi, "");
    r = r
      .split(/(?<=[.!?])\s+/)
      .filter((s) => !/\bR\$\b/.test(s))
      .join(" ")
      .trim();
  }

  // não oferecer envio de mídia/docs “do nada”
  if (!clientAskedMedia(userMsg) && !clientInquiredMedia(userMsg)) {
    r = r
      .split(/(?<=[.!?])\s+/)
      .filter((s) => {
        const hasMedia =
          /(foto|fotos|vídeo|video|imagem|imagens|filmagem)/i.test(s);
        const hasOffer =
          /(posso|quer|consigo|vou|mando|envio|te envio|te mando)/i.test(s);
        return !(hasMedia && hasOffer);
      })
      .join(" ")
      .trim();
  }

  if (!clientAskedOrInquiredDocs(userMsg)) {
    r = r
      .split(/(?<=[.!?])\s+/)
      .filter((s) => {
        const hasDoc =
          /(pdf|documento|matr[ií]cula|escritura|registro|cart[oó]rio|certid[aã]o)/i.test(
            s
          );
        const hasOffer =
          /(posso|quer|consigo|vou|mando|envio|te envio|te mando)/i.test(s);
        return !(hasDoc && hasOffer);
      })
      .join(" ")
      .trim();
  }

  return clampText(r);
}

function buildSystemPrompt(cliente, mem, extraContext) {
  const nome = cliente.nome || "(não informado)";
  const resumo = cliente.memory_summary || "(sem resumo ainda)";
  const lastBot = cliente.last_bot_question || "";

  return `
Você se chama Lia, vendedora do lote. Você atende UM único lote (4.000m²) no Condomínio Aroeira, Trindade/GO.

ESTILO:
- Natural, direto e humano (WhatsApp real).
- Linguagem profissional, sem soar robótico.
- Responda exatamente o que o cliente perguntou.
- Evite frases prontas repetitivas.
- Sem texto desnecessário.
- Seja sempre cordial e prestativo.
- Seja direto, profissional e objetivo.
- Sem emojis, respostas curtas e diretas.
- Use linguagem simples e clara.
- Nunca diga que é uma IA ou que está aprendendo.
- Nunca peça feedback ou avaliação.
- Tom profissional, educado e objetivo, sem gírias.

REGRAS ABSOLUTAS:
1) Preço: só informe valores se o cliente perguntar explicitamente.
2) Não invente informações fora da memória oficial.
3) Se o cliente pedir fotos, vídeos ou PDFs, o sistema já enviará automaticamente.
   Você deve apenas contextualizar brevemente, sem oferecer nem perguntar se deseja receber.
4) Seja sempre direto e profissional.
5) Respostas com NO MÁXIMO 5 linhas.
6) Sempre que perguntarem sobre o vendedor, responda que é Márcio.
7) Mantenha tom profissional, educado e objetivo, sem gírias.
8) Priorize informações sobre o lote, visita, documentação e próximos passos da negociação.
9) Nunca entre em discussões pessoais ou conflitos.
10) Nunca peça para o cliente repetir informações que ele já deu.
11) Mostre apenas duas ou no maximo 5 fotos do condominio, se o cliente pedir fotos e depois pergunte oque ele quer saber mais.
ATENDIMENTO (HUMANO):
- Cumprimente só 1 vez no início (não repetir em loop).
- Pergunte se a pessoa é corretor ou comprador; se for corretor mande:
  https://wa.me/556285950399
- Se o cliente ainda não informou nome e o momento for apropriado (ex: mensagem curta tipo “oi”),
  peça o nome e siga atendendo.
- Se o cliente fizer uma pergunta objetiva, responda direto primeiro; no final faça UMA pergunta estratégica.

ANTI-LOOP:
- Nunca repita a última mensagem do bot.
- Não faça múltiplas perguntas ao mesmo tempo.
- Finalize com UMA pergunta estratégica.

DADOS DO CLIENTE:
- Nome: ${nome}
- WhatsApp: ${cliente.whatsapp}
- Resumo/memória: ${resumo}
- Última msg do bot (não repetir igual): ${lastBot}
- Flags: greeted=${mem.flags.greeted ? "SIM" : "NÃO"}, media_sent=${
    mem.flags.media_sent ? "SIM" : "NÃO"
  }, docs_sent=${mem.flags.docs_sent ? "SIM" : "NÃO"}, price_disclosed=${
    mem.flags.price_disclosed ? "SIM" : "NÃO"
  }

MEMÓRIA OFICIAL (VERDADE):
${IMOVEL_MEMORIA}

CONTEXTO EXTRA (RAG — use só se ajudar dúvidas específicas):
${extraContext || "(sem contexto adicional)"}
`.trim();
}

async function callLLMWithRetry(messages) {
  const first = await askLLM(messages);
  const r1 = normalizeText(first);
  if (r1 && r1.length >= 3) return r1;

  const retry = await askLLM([
    ...messages,
    {
      role: "system",
      content:
        "Sua resposta ficou vazia/genérica. Reescreva curto, humano e específico ao que o cliente disse. Sem frases prontas repetitivas.",
    },
  ]);
  return normalizeText(retry);
}

function enqueueMediaActions(pkg) {
  const actions = [];
  for (const img of pkg.images || [])
    actions.push({
      type: "send_image",
      path: img.fullPath,
      caption: "Foto do local.",
    });
  for (const vid of pkg.videos || [])
    actions.push({
      type: "send_video",
      path: vid.fullPath,
      mimetype: "video/mp4",
      caption: "Video do local.",
    });
  return actions;
}

function enqueueAllDocsActions(docs) {
  return (docs || []).map((d) => ({
    type: "send_document",
    path: d.fullPath,
    filename: d.file,
    mimetype: "application/pdf",
    caption: "Documentacao do lote (PDF).",
  }));
}

async function saveLastBotQuestionSafe(clienteId, text) {
  await updateClientLastBotQuestion(clienteId, clampForLastBot(text));
}

/**
 * ============================
 * callAgent
 * ============================
 */
async function callAgent(userMessage, cliente, opts = {}) {
  const historyLimit = Number(opts.historyLimit || 40);
  const msg = normalizeText(userMessage);

  // histórico
  const historico = await getLastMessages(cliente.id, historyLimit);
  const lastBotMsg =
    [...historico].reverse().find((m) => m.origem === "bot")?.conteudo || "";

  // memória
  const mem = getMem(cliente);

  // nome (captura se o usuário já falou)
  if (!cliente.nome) {
    const nm = extractName(msg);
    if (nm) {
      await updateClientName(cliente.id, nm);
      cliente.nome = nm;
    }
  }

  // notas leves
  const notes = extractNotes(msg);
  mem.notes = { ...(mem.notes || {}) };
  for (const k of Object.keys(notes)) {
    if (!mem.notes[k]) mem.notes[k] = notes[k];
  }

  /**
   * ============================
   * ONBOARDING (cumprimenta + pede nome)
   * ============================
   */
  const noHistoryYet = !historico || historico.length === 0;
  if (
    !mem.flags.greeted &&
    !cliente.nome &&
    (isGreetingOnly(msg) || (noHistoryYet && isVeryShort(msg)))
  ) {
    mem.flags.greeted = true;
    await persistMem(cliente, mem);
    await updateClientStage(cliente.id, "onboarding");

    const reply = clampText(
      "Ola. Aqui é a Lia.\nPra eu te atender direitinho, qual e o seu nome?"
    );
    await saveLastBotQuestionSafe(cliente.id, reply);
    return { reply, actions: [] };
  }

  /**
   * ============================
   * ROTAS “SENSÍVEIS” (determinísticas)
   * ============================
   */

  // 1) Preço
  if (clientAskedPrice(msg)) {
    mem.flags.price_disclosed = true;
    await persistMem(cliente, mem);
    await updateClientStage(cliente.id, "interesse");

    const base = "O valor do imovel e R$ 850.000.";
    const reply = clampText(
      !cliente.nome
        ? `${base}\nPra eu te ajudar melhor, qual seu nome?`
        : `${base}\nQuer que eu te passe mais detalhes da infraestrutura?`
    );

    await saveLastBotQuestionSafe(cliente.id, reply);
    return { reply, actions: [] };
  }

  // 2) Mídia (pediu OU sondou)
  if (clientAskedMedia(msg) || clientInquiredMedia(msg)) {
    if (mem.flags.media_sent) {
      const reply = clampText(
        "As fotos e o video ja estao ai acima na conversa. Quer que eu destaque os pontos fortes do lote?"
      );
      await saveLastBotQuestionSafe(cliente.id, reply);
      return { reply, actions: [] };
    }

    const pkg = getDefaultMediaPackage({ maxImages: 8, maxVideos: 2 });
    if (!pkg.images.length && !pkg.videos.length) {
      const reply = clampText(
        "No momento eu nao encontrei fotos/videos cadastrados aqui pra enviar. Quer que eu descreva a area e o acesso?"
      );
      await saveLastBotQuestionSafe(cliente.id, reply);
      return { reply, actions: [] };
    }

    const actions = enqueueMediaActions(pkg);

    mem.flags.media_sent = true;
    await persistMem(cliente, mem);
    await updateClientStage(cliente.id, "interesse");

    try {
      const total = (pkg.images?.length || 0) + (pkg.videos?.length || 0);
      await saveMessage(
        cliente.id,
        "sistema",
        `[MIDIA ENVIADA] ${total} arquivo(s)`
      );
    } catch (_) {}

    const reply = clampText(
      !cliente.nome
        ? "Perfeito. Vou te mandar as fotos e o video do local aqui. Me diz seu nome?"
        : "Perfeito. Vou te mandar as fotos e o video do local aqui. O que voce quer avaliar primeiro?"
    );
    await saveLastBotQuestionSafe(cliente.id, reply);
    return { reply, actions };
  }

  // 3) Documentos (pediu OU sondou)
  if (clientAskedOrInquiredDocs(msg)) {
    if (mem.flags.docs_sent) {
      const reply = clampText(
        "Os documentos ja estao ai acima na conversa. Quer que eu explique a situacao da escritura/registro?"
      );
      await saveLastBotQuestionSafe(cliente.id, reply);
      return { reply, actions: [] };
    }

    const docs = listDocuments();
    if (!docs.length) {
      const reply = clampText(
        "No momento eu nao encontrei nenhum PDF cadastrado na pasta /documents. Quais documentos voce quer ver?"
      );
      await saveLastBotQuestionSafe(cliente.id, reply);
      return { reply, actions: [] };
    }

    const actions = enqueueAllDocsActions(docs);

    mem.flags.docs_sent = true;
    await persistMem(cliente, mem);
    await updateClientStage(cliente.id, "interesse");

    try {
      await saveMessage(
        cliente.id,
        "sistema",
        `[PDF ENVIADO] ${docs.length} arquivo(s)`
      );
    } catch (_) {}

    const reply = clampText(
      !cliente.nome
        ? "Fechado. Vou te enviar a documentacao em PDF agora. Qual seu nome?"
        : "Fechado. Vou te enviar a documentacao em PDF agora. Quer que eu explique a escritura/registro?"
    );
    await saveLastBotQuestionSafe(cliente.id, reply);
    return { reply, actions };
  }

  // 4) Localização — SÓ LINK (o que você pediu)
  if (clientAskedLocation(msg)) {
    const mapsLink =
      "https://www.google.com/maps?q=-16.6090515,-49.4088258&z=17&hl=pt-BR";

    // marca que já enviou (anti-loop opcional)
    if (!mem.flags.location_sent) {
      mem.flags.location_sent = true;
      await persistMem(cliente, mem);
    }

    await updateClientStage(cliente.id, "interesse");

    const reply = mapsLink; // só isso, sem texto, sem pergunta

    await saveLastBotQuestionSafe(cliente.id, reply);
    return { reply, actions: [] };
  }

  // 5) Visita
  if (clientAskedVisit(msg)) {
    mem.flags.visit_intent = true;
    await persistMem(cliente, mem);
    await updateClientStage(cliente.id, "visita");

    const reply = clampText(
      !cliente.nome
        ? "Perfeito. Qual seu nome e qual dia/horario voce prefere?"
        : "Perfeito. Qual dia e horario ficam melhores pra voce?"
    );
    await saveLastBotQuestionSafe(cliente.id, reply);
    return { reply, actions: [] };
  }

  // 6) Vendedor
  if (clientAskedSeller(msg)) {
    const reply = "O vendedor responsável pelo lote é Márcio.";
    await saveLastBotQuestionSafe(cliente.id, reply);
    return { reply, actions: [] };
  }

  // 7) Ofensivo
  if (isOffensive(msg)) {
    const reply = "Posso te ajudar com informações sobre o lote, mas preciso que a conversa seja mantida de forma respeitosa.";
    await saveLastBotQuestionSafe(cliente.id, reply);
    return { reply, actions: [] };
  }

  /**
   * ============================
   * CONVERSA NORMAL (LLM)
   * ============================
   */
  const ragChunks = retrieve(msg, 4);
  const extraContext = formatContext(ragChunks);

  const system = buildSystemPrompt(cliente, mem, extraContext);
  const historyMessages = (historico || []).map((m) => ({
    role: m.origem === "bot" ? "assistant" : "user",
    content: m.conteudo,
  }));

  const messages = [
    { role: "system", content: system },
    ...historyMessages,
    { role: "user", content: msg },
  ];

  let reply = await callLLMWithRetry(messages);

  // anti-loop: se parece muito com a última resposta do bot, pede variação
  if (lastBotMsg && jaccard(reply, lastBotMsg) >= 0.78) {
    const varied = await callLLMWithRetry([
      ...messages,
      {
        role: "system",
        content:
          "Evite repetir sua ultima resposta. Reescreva de um jeito diferente, curto e humano.",
      },
    ]);
    if (varied && varied.length >= 3) reply = varied;
  }

  // guardrails
  reply = stripProhibited(reply, msg);

  // se ficou fraco demais depois do strip, reescreve seguro
  if (!reply || reply.length < 8) {
    const safe = await callLLMWithRetry([
      ...messages,
      {
        role: "system",
        content:
          "Reescreva sem mencionar preco e sem oferecer envio de fotos/videos/PDFs. Curto e humano.",
      },
    ]);
    reply = stripProhibited(safe, msg);
  }

  reply = clampText(reply);

  // marca greeted automaticamente quando a conversa já está andando
  if (!mem.flags.greeted) mem.flags.greeted = true;

  await persistMem(cliente, mem);
  await updateClientStage(cliente.id, "conversa");
  await saveLastBotQuestionSafe(cliente.id, reply);

  return { reply, actions: [] };
}

module.exports = {
  callAgent,
  clientAskedMedia,
  clientAskedPrice,
  clientAskedLocation,
  clientAskedVisit,
};
