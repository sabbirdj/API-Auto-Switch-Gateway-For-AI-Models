import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { storage } from './db/storage.js';
import { handleChatCompletion } from './routes/v1/chat.js';
import { handleListModels } from './routes/v1/models.js';
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

// Serve static frontend dashboard
const publicDir = path.resolve(__dirname, '../public');
app.use(express.static(publicDir));

// Master OpenAI-Compatible Endpoints
app.post('/v1/chat/completions', handleChatCompletion);
app.get('/v1/models', handleListModels);

// Internal Admin Control Plane
app.use('/api', adminRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'online',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
    timestamp: Date.now(),
  });
});

// Fallback to dashboard for SPA
app.use((req, res, next) => {
  if (req.path.startsWith('/v1') || req.path.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
==========================================================
   🚀 AI API SWITCH & MASTER GATEWAY IS ONLINE!
==========================================================
 🌐 Web Dashboard:       http://localhost:${PORT}
 🔌 Master API Endpoint: http://localhost:${PORT}/v1
 🔑 Master API Key:      ${settings.masterApiKey || '(None / Public)'}
 
 📡 Master Chat URL:     POST http://localhost:${PORT}/v1/chat/completions
 📋 Master Models URL:   GET  http://localhost:${PORT}/v1/models
==========================================================
 Active Virtual Routes:  ${storage.getRoutes().filter((r) => r.enabled).map((r) => r.alias).join(', ')}
 Configured Providers:   ${storage.getProviders().map((p) => `${p.name} (${p.enabled ? 'Enabled' : 'Disabled'})`).join(', ')}
==========================================================
`);
});
