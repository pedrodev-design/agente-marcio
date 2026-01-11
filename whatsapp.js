// whatsapp.js
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
} = require("@whiskeysockets/baileys");

const axios = require("axios");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const path = require("path");

const { textToWavFile } = require("./voice");
const { transcribeAudio } = require("./stt");

// ========= PATH SAFETY =========
function normPath(p) {
  return path.resolve(String(p || "")).replace(/\\+/g, "\\").toLowerCase();
}
function isSafePath(requestedPath, allowedDir) {
  const req = normPath(requestedPath);
  const base = normPath(allowedDir) + path.sep;
  return req.startsWith(base);
}

// ========= AUDIO INTENT =========
function clientAskedForAudio(text = "") {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;

  const patterns = [
    /manda.*áudio/,
    /envia.*áudio/,
    /me manda.*áudio/,
    /pode ser.*áudio/,
    /explica.*áudio/,
    /explica em áudio/,
    /fala.*áudio/,
    /fala em áudio/,
    /áudio por favor/,
    /pode mandar.*áudio/,
    /prefiro.*áudio/,
  ];

  return patterns.some((re) => re.test(t));
}

async function startWhatsApp(opts = {}) {
  const API_URL =
    String(opts.apiUrl || "").trim() ||
    process.env.API_URL?.trim() ||
    "http://127.0.0.1:3000/test-agent";

  // ⚠️ No Render free, filesystem pode não persistir entre deploy/sleep
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");

  const sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("📲 ESCANEIE ESTE QR CODE NO WHATSAPP:\n");
      qrcode.generate(qr, { small: true });
      console.log("\nAbra o WhatsApp > Aparelhos conectados > Conectar aparelho");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log("⚠️ Conexão fechada. statusCode:", statusCode);

      if (shouldReconnect) startWhatsApp({ apiUrl: API_URL });
      else console.log("🔒 Deslogado. Apague auth_info e conecte novamente.");
    }

    if (connection === "open") {
      console.log("✅ WhatsApp conectado com SUCESSO!");
      console.log("🔗 API_URL:", API_URL);
      console.log("🔊 ÁUDIO: somente quando o cliente pedir");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages?.[0];
    if (!msg?.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;

    // Bloqueia grupos e broadcast
    if (from.endsWith("@g.us") || from === "status@broadcast") return;

    // 1) Texto normal
    let text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption;

    // 2) Áudio: transcreve e usa como texto
    const audioMsg = msg.message.audioMessage || msg.message.voiceMessage;
    let meta = {};
    if ((!text || !String(text).trim()) && audioMsg) {
      try {
        const buf = await downloadMediaMessage(
          msg,
          "buffer",
          {},
          { reuploadRequest: sock.updateMediaMessage }
        );

        const mimetype = audioMsg.mimetype || "audio/ogg";
        const transcript = await transcribeAudio(buf, { mimetype });

        if (transcript && transcript.trim()) {
          text = transcript.trim();
          meta = { type: "audio", mimetype };
          console.log("🎙️ Áudio transcrito:", text);
        }
      } catch (e) {
        console.error("⚠️ Falha ao transcrever áudio:", e?.message || e);
      }
    }

    if (!text || !String(text).trim()) return;

    console.log("📨 Mensagem recebida:", text);

    try {
      const payload = {
        message: String(text),
        whatsapp: from.replace("@s.whatsapp.net", ""),
        meta,
      };

      const response = await axios.post(API_URL, payload, { timeout: 30_000 });

      const reply = response?.data?.reply;
      const actions = Array.isArray(response?.data?.actions) ? response.data.actions : [];

      if (!reply) {
        console.error("⚠️ API respondeu sem 'reply':", response?.data);
        return;
      }

      const wantsAudio = clientAskedForAudio(text);

      // ✅ Áudio só quando pedir. Se falhar, cai pro texto.
      if (wantsAudio) {
        let audioPath = null;
        try {
          audioPath = await textToWavFile(reply, { rate: 180, volume: 1.0 });

          const audioBuffer = fs.readFileSync(audioPath);

          await sock.sendMessage(from, {
            audio: audioBuffer,
            mimetype: "audio/wav",
            ptt: false,
          });

          console.log("🔊 Áudio enviado (cliente pediu):", audioPath);
        } catch (e) {
          console.error("⚠️ Falha no TTS, enviando texto. Motivo:", e?.message || e);
          await sock.sendMessage(from, { text: reply });
        } finally {
          if (audioPath) {
            try { fs.unlinkSync(audioPath); } catch (_) {}
          }
        }
      } else {
        await sock.sendMessage(from, { text: reply });
      }

      // 3) Ações do agente (PDFs, imagens, vídeos)
      for (const action of actions) {
        try {
          if (!action || typeof action !== "object") continue;

          if (action.type === "send_image") {
            const imagesDir = path.resolve(__dirname, "assets", "images");
            const requestedPath = path.resolve(String(action.path || ""));
            if (!isSafePath(requestedPath, imagesDir)) {
              console.error("⛔ Imagem fora de /assets/images. Bloqueado:", requestedPath);
              continue;
            }
            if (!fs.existsSync(requestedPath)) {
              console.error("⚠️ Imagem não encontrada:", requestedPath);
              continue;
            }
            const fileBuffer = fs.readFileSync(requestedPath);
            const caption = action.caption ? String(action.caption) : undefined;
            await sock.sendMessage(from, { image: fileBuffer, caption });
            console.log("🖼️ Imagem enviada:", path.basename(requestedPath));
            continue;
          }

          if (action.type === "send_video") {
            const videosDir = path.resolve(__dirname, "assets", "videos");
            const requestedPath = path.resolve(String(action.path || ""));
            if (!isSafePath(requestedPath, videosDir)) {
              console.error("⛔ Vídeo fora de /assets/videos. Bloqueado:", requestedPath);
              continue;
            }
            if (!fs.existsSync(requestedPath)) {
              console.error("⚠️ Vídeo não encontrado:", requestedPath);
              continue;
            }
            const fileBuffer = fs.readFileSync(requestedPath);
            const caption = action.caption ? String(action.caption) : undefined;
            const mimetype = action.mimetype ? String(action.mimetype) : "video/mp4";
            await sock.sendMessage(from, { video: fileBuffer, mimetype, caption });
            console.log("🎬 Vídeo enviado:", path.basename(requestedPath));
            continue;
          }

          if (action.type === "send_document") {
            const docsDir = path.resolve(__dirname, "documents");
            const requestedPath = path.resolve(String(action.path || ""));
            if (!isSafePath(requestedPath, docsDir)) {
              console.error("⛔ Documento fora de /documents. Bloqueado:", requestedPath);
              continue;
            }
            if (!fs.existsSync(requestedPath)) {
              console.error("⚠️ Documento não encontrado:", requestedPath);
              continue;
            }
            const fileBuffer = fs.readFileSync(requestedPath);
            const fileName = String(action.filename || path.basename(requestedPath));
            const caption = action.caption ? String(action.caption) : undefined;

            await sock.sendMessage(from, {
              document: fileBuffer,
              mimetype: "application/pdf",
              fileName,
              caption,
            });

            console.log("📎 Documento enviado:", fileName);
          }
        } catch (e) {
          console.error("⚠️ Falha ao executar action:", action?.type, e?.message || e);
        }
      }
    } catch (err) {
      if (err.response) {
        console.error("❌ API erro:", err.response.status, err.response.data);
      } else {
        console.error("❌ Erro ao chamar API:", err.message);
      }
    }
  });

  return sock;
}

module.exports = startWhatsApp;
