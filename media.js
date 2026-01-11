// media.js
// Centraliza a seleção de mídias do imóvel.
// IMPORTANTE: este arquivo NÃO decide quando enviar.
// Quem decide é o ai.js (só envia se o cliente pedir explicitamente).

const fs = require("fs");
const path = require("path");

function listFiles(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  const all = fs.readdirSync(dir)
    .map(f => ({ file: f, fullPath: path.join(dir, f) }))
    .filter(x => fs.statSync(x.fullPath).isFile());
  return all.filter(x => exts.some(ext => x.file.toLowerCase().endsWith(ext)));
}

function getDefaultMediaPackage({ maxImages = 5, maxVideos = 1 } = {}) {
  const imagesDir = path.resolve(__dirname, "assets", "images");
  const videosDir = path.resolve(__dirname, "assets", "videos");

  const images = listFiles(imagesDir, [".jpg", ".jpeg", ".png", ".webp"]).slice(0, maxImages);
  const videos = listFiles(videosDir, [".mp4", ".mov", ".m4v"]).slice(0, maxVideos);

  return { images, videos };
}

module.exports = { getDefaultMediaPackage };
