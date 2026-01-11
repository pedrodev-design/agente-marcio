# Agente de Vendas (WhatsApp + Groq) — Projeto Marcio

Este projeto usa:
- Baileys (WhatsApp Web) para receber/enviar mensagens
- Express para API local
- Groq (OpenAI-compatible) para o LLM
- MySQL para memória (clientes + mensagens)
- RAG simples lendo PDFs em `/documents` (ex.: escrituras)
- ✅ Envio de PDF **somente quando o cliente pedir explicitamente**
- ✅ Envio de fotos/vídeo **somente quando o cliente pedir explicitamente**
- ✅ Transcrição de áudio do cliente (STT) usando Groq (Whisper)

## 1) Segurança (IMPORTANTE)
Se você comitou/compartilhou sua `GROQ_API_KEY`, **gere outra chave** no Groq e substitua.
Não deixe chaves no repositório.

## 2) Configurar ambiente
1. Copie `.env.example` para `.env` e preencha.
2. Suba o MySQL (opcional, recomendado):
   ```bash
   docker compose up -d
   ```
3. Inicialize as tabelas:
   ```bash
   npm run init-db
   ```

## 3) Rodar API
```bash
npm install
npm start
```

Teste:
- `GET http://localhost:3000/health`
- `POST http://localhost:3000/test-agent` com JSON:
```json
{ "whatsapp": "559999999999", "message": "Olá, quero saber se tem escritura" }
```

## 4) Rodar WhatsApp
Em outro terminal:
```bash
node whatsapp.js
```
Escaneie o QR Code.

> Observação: por segurança, este projeto NÃO inclui a pasta `auth_info/`.
> Você sempre vai conectar do zero e gerar seu próprio `auth_info` ao escanear o QR.

> Observação: a pasta `auth_info/` NÃO vem no projeto (por segurança). Ela será criada automaticamente no seu PC quando você escanear o QR.

## 5) Documentos do lote (PDF)
Coloque PDFs em `documents/`. O servidor carrega e cria uma base de trechos.
O agente usa busca simples por palavras (leve e sem embeddings).

✅ **Envio de PDF no WhatsApp:**
- Se o cliente escrever algo como “me manda o PDF da escritura”, o bot devolve a resposta e o WhatsApp envia o arquivo como anexo.
- Segurança: o WhatsApp só permite anexar arquivos dentro de `documents/`.

## 6) Áudio do cliente (STT)
- Se o cliente mandar áudio, o WhatsApp baixa e transcreve com o endpoint de transcrição do Groq.
- O texto transcrito vira a mensagem que chega no agente.

Variáveis:
- `GROQ_STT_MODEL` (default: `whisper-large-v3`)

## 7) Áudio do bot (TTS) (opcional)
O projeto já tenta enviar áudio **somente quando o cliente pedir**.
Para funcionar, instale `espeak` ou `espeak-ng` no sistema, ou adapte `voice.js` para outro provedor.

## 8) Banco (schema)
Veja `schema.sql`.

### Campos extras do cliente (para o bot não “esquecer”)
O schema inclui colunas como `memory_json`, `memory_summary` e `last_bot_question`.
O bot usa isso para manter o funil coerente e evitar repetir/voltar etapas.

### Campos extras (por que o bot não esquece)
O `clientes` agora guarda:
- `memory_json` e `memory_summary` (flags: mídia enviada, docs enviados, preço informado, etc.)
- `last_bot_question` (evita repetição)
- `visit_datetime`/`visit_status` (pronto pra agendamento)
