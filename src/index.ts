import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { storage } from './db/storage.js';
import { handleChatCompletion, handleListModels } from './routes/v1/chat.js';
import { handleAnthropicMessages } from './routes/v1/anthropicMessages.js';
import { adminRouter } from './routes/api/admin.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const settings = storage.getSettings();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : settings.port || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static admin dashboard
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// ── OpenAI-compatible ingress ──────────────────────────────────────────────
app.post('/v1/chat/completions', handleChatCompletion);
app.get('/v1/models', handleListModels);

// ── Anthropic-compatible ingress ──────────────────────────────────────────
app.post('/v1/messages', handleAnthropicMessages);
app.post('/messages', handleAnthropicMessages);

// ── Admin management API ──────────────────────────────────────────────────
app.use('/api', adminRouter);

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'online', version: '1.0.0', uptime: Math.floor(process.uptime()) });
});

// ── SPA fallback ──────────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.startsWith('/v1') || req.path.startsWith('/api') || req.path.startsWith('/health')) return next();
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  const providers = storage.getProviders();
  const totalKeys = providers.reduce((s, p) => s + p.keys.length, 0);
  const activeProvider = storage.getProvider(settings.defaultProviderId);

  console.log(`
╔══════════════════════════════════════════════════════╗
║       🔀 AI API AUTO-SWITCH GATEWAY ONLINE           ║
╚══════════════════════════════════════════════════════╝
  🌐 Dashboard :  http://localhost:${PORT}
  🔌 OpenAI    :  POST http://localhost:${PORT}/v1/chat/completions
  🤖 Anthropic :  POST http://localhost:${PORT}/v1/messages
  🔑 Master Key:  ${settings.masterApiKey}

  Active Provider : ${activeProvider?.name ?? settings.defaultProviderId}
  Total API Keys  : ${totalKeys} key(s) across ${providers.length} providers
  Auto-rotate on  : 429 Rate Limit / 5xx / Timeout
══════════════════════════════════════════════════════
`);
});
