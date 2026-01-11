// voice.js
// TTS opcional (bot -> áudio). Mantém o projeto “leve” sem libs pesadas.
// Por padrão, se não existir um engine no sistema, ele lança erro e o WhatsApp
// envia texto (fallback já está implementado em whatsapp.js).
//
// Opções:
// 1) Linux: instalar "espeak" ou "espeak-ng".
// 2) Ou adaptar este arquivo para usar seu provedor de TTS.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

/**
 * Converte texto em WAV usando espeak/espeak-ng.
 * @param {string} text
 * @param {{ rate?: number, volume?: number }} opts
 * @returns {Promise<string>} caminho do arquivo WAV gerado
 */
function textToWavFile(text, opts = {}) {
  const t = String(text || "").trim();
  if (!t) return Promise.reject(new Error("textToWavFile: texto vazio"));

  const rate = Number.isFinite(Number(opts.rate)) ? Number(opts.rate) : 170;
  const volume = Number.isFinite(Number(opts.volume)) ? Number(opts.volume) : 1.0;

  const outPath = path.join(os.tmpdir(), `kamikaze_${Date.now()}_${Math.random().toString(16).slice(2)}.wav`);

  // tenta espeak-ng primeiro, depois espeak
  const candidates = ["espeak-ng", "espeak"]; 

  return new Promise((resolve, reject) => {
    let idx = 0;

    const trySpawn = () => {
      const bin = candidates[idx++];
      if (!bin) return reject(new Error("Nenhum TTS encontrado. Instale espeak/espeak-ng ou adapte voice.js"));

      const args = [
        "-v", "pt-br",
        "-s", String(rate),
        "-a", String(Math.max(0, Math.min(200, Math.round(volume * 100)))),
        "-w", outPath,
        t,
      ];

      const p = spawn(bin, args, { stdio: "ignore" });
      p.on("error", () => {
        // tenta próximo
        trySpawn();
      });
      p.on("close", (code) => {
        if (code === 0 && fs.existsSync(outPath)) return resolve(outPath);
        // tenta próximo
        trySpawn();
      });
    };

    trySpawn();
  });
}

module.exports = { textToWavFile };
