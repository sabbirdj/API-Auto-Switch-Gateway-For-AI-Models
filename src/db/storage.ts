import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'deepseek'
  | 'ollama'
  | 'custom';

export interface ApiKeyEntry {
  id: string;        // unique within provider
  key: string;
  label?: string;    // e.g. "key-1", "work key"
  enabled: boolean;
  usageCount: number;
  failureCount: number;
  cooldownUntil: number; // epoch ms, 0 = not in cooldown
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  keys: ApiKeyEntry[];
  models: string[];
  defaultModel: string;
  enabled: boolean;
  createdAt: number;
}

export interface RequestAuditLog {
  id: string;
  timestamp: number;
  provider: string;
  keyLabel: string;
  model: string;
  status: 'success' | 'failed';
  statusCode: number;
  latencyMs: number;
  ttftMs?: number;       // Time To First Token (real latency)
  cached?: boolean;      // Served in 0ms from in-memory cache
  stream: boolean;
  keyIndex: number;      // which key index was ultimately used
  switchedKeys: boolean; // did we have to rotate keys?
  error?: string;
  tokens?: { prompt: number; completion: number; total: number };
}

export interface GatewaySettings {
  port: number;
  masterApiKey: string;
  defaultProviderId: string; // which provider to use for /v1/chat/completions by default
  defaultModel: string;
  enableLogging: boolean;
  enableCache: boolean;      // Instant 0ms response cache
  cacheTtlSec: number;       // Cache TTL in seconds (default 600 = 10 min)
  cooldownSec: number;       // how long (seconds) to cool a key after 429
  defaultTimeoutMs: number;
}

export interface AppConfig {
  settings: GatewaySettings;
  providers: ProviderConfig[];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

function makeDefault(): AppConfig {
  return {
    settings: {
      port: 3000,
      masterApiKey: 'sk-switch-master-key',
      defaultProviderId: 'groq',
      defaultModel: 'llama-3.3-70b-versatile',
      enableLogging: true,
      enableCache: true,
      cacheTtlSec: 600,
      cooldownSec: 60,
      defaultTimeoutMs: 30000,
    },
    providers: [
      {
        id: 'groq',
        name: 'Groq',
        type: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        keys: [],
        models: [
          'llama-3.3-70b-versatile',
          'llama-3.1-8b-instant',
          'mixtral-8x7b-32768',
          'deepseek-r1-distill-llama-70b',
          'gemma2-9b-it',
        ],
        defaultModel: 'llama-3.3-70b-versatile',
        enabled: true,
        createdAt: Date.now(),
      },
      {
        id: 'gemini',
        name: 'Google Gemini',
        type: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        keys: [],
        models: [
          'gemini-2.0-flash',
          'gemini-2.0-flash-lite',
          'gemini-1.5-flash',
          'gemini-1.5-pro',
        ],
        defaultModel: 'gemini-2.0-flash',
        enabled: true,
        createdAt: Date.now(),
      },
      {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        keys: [],
        models: ['gpt-4o', 'gpt-4o-mini', 'o1-mini', 'o3-mini'],
        defaultModel: 'gpt-4o-mini',
        enabled: true,
        createdAt: Date.now(),
      },
      {
        id: 'anthropic',
        name: 'Anthropic Claude',
        type: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        keys: [],
        models: [
          'claude-3-5-sonnet-20241022',
          'claude-3-5-haiku-20241022',
          'claude-3-opus-20240229',
        ],
        defaultModel: 'claude-3-5-sonnet-20241022',
        enabled: true,
        createdAt: Date.now(),
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        type: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        keys: [],
        models: ['deepseek-chat', 'deepseek-reasoner'],
        defaultModel: 'deepseek-chat',
        enabled: true,
        createdAt: Date.now(),
      },
      {
        id: 'ollama',
        name: 'Ollama (Local)',
        type: 'ollama',
        baseUrl: 'http://localhost:11434/v1',
        keys: [{ id: 'ollama-local', key: 'ollama', label: 'local', enabled: true, usageCount: 0, failureCount: 0, cooldownUntil: 0 }],
        models: ['llama3.2', 'mistral', 'qwen2.5-coder', 'deepseek-r1'],
        defaultModel: 'llama3.2',
        enabled: false,
        createdAt: Date.now(),
      },
    ],
  };
}

// ─── Storage Manager ─────────────────────────────────────────────────────────

class StorageManager {
  private config: AppConfig;
  private logs: RequestAuditLog[] = [];
  private rrIndex: Record<string, number> = {}; // per-provider round-robin index

  constructor() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    this.config = this.loadConfig();
    this.logs = this.loadLogs();
  }

  private loadConfig(): AppConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        const def = makeDefault();
        return {
          settings: { ...def.settings, ...parsed.settings },
          providers: parsed.providers ?? def.providers,
        };
      }
    } catch {}
    const def = makeDefault();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(def, null, 2));
    return def;
  }

  private save() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  private loadLogs(): RequestAuditLog[] {
    try {
      if (fs.existsSync(LOGS_FILE)) return JSON.parse(fs.readFileSync(LOGS_FILE, 'utf-8'));
    } catch {}
    return [];
  }

  private saveLogs() {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(this.logs, null, 2));
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  getSettings() { return this.config.settings; }
  updateSettings(u: Partial<GatewaySettings>) {
    this.config.settings = { ...this.config.settings, ...u };
    this.save();
  }

  // ── Providers ─────────────────────────────────────────────────────────────
  getProviders() { return this.config.providers; }
  getProvider(id: string) { return this.config.providers.find(p => p.id === id); }

  saveProvider(p: ProviderConfig) {
    const idx = this.config.providers.findIndex(x => x.id === p.id);
    if (idx >= 0) this.config.providers[idx] = p;
    else this.config.providers.push(p);
    this.save();
  }

  deleteProvider(id: string) {
    this.config.providers = this.config.providers.filter(p => p.id !== id);
    this.save();
  }

  // ── Key Pool: pick next available key with round-robin + cooldown ─────────
  pickKey(providerId: string): { keyEntry: ApiKeyEntry; index: number } | null {
    const prov = this.getProvider(providerId);
    if (!prov) return null;

    const now = Date.now();
    const available = prov.keys
      .map((k, i) => ({ k, i }))
      .filter(({ k }) => k.enabled && k.cooldownUntil <= now);

    if (available.length === 0) return null;

    const rr = this.rrIndex[providerId] ?? 0;
    const slot = available[rr % available.length];
    this.rrIndex[providerId] = rr + 1;
    return { keyEntry: slot.k, index: slot.i };
  }

  reportRateLimit(providerId: string, keyId: string) {
    const prov = this.getProvider(providerId);
    if (!prov) return;
    const k = prov.keys.find(k => k.id === keyId);
    if (!k) return;
    k.cooldownUntil = Date.now() + this.config.settings.cooldownSec * 1000;
    k.failureCount++;
    console.warn(`[KeyPool] 🔄 Key "${k.label || k.id}" of provider "${prov.name}" hit rate limit → cooldown ${this.config.settings.cooldownSec}s`);
    this.save();
  }

  reportSuccess(providerId: string, keyId: string) {
    const prov = this.getProvider(providerId);
    if (!prov) return;
    const k = prov.keys.find(k => k.id === keyId);
    if (k) { k.usageCount++; this.save(); }
  }

  // ── Logs ──────────────────────────────────────────────────────────────────
  logRequest(log: RequestAuditLog) {
    if (!this.config.settings.enableLogging) return;
    this.logs.unshift(log);
    if (this.logs.length > 500) this.logs = this.logs.slice(0, 500);
    this.saveLogs();
  }

  getLogs(limit = 100) { return this.logs.slice(0, limit); }
  clearLogs() { this.logs = []; this.saveLogs(); }

  getStats() {
    const total = this.logs.length;
    const ok = this.logs.filter(l => l.status === 'success').length;
    const switched = this.logs.filter(l => l.switchedKeys).length;
    const cachedCount = this.logs.filter(l => l.cached).length;
    const totalTokens = this.logs.reduce((s, l) => s + (l.tokens?.total ?? 0), 0);
    const avgLatency = total > 0
      ? Math.round(this.logs.reduce((s, l) => s + (l.ttftMs ?? l.latencyMs), 0) / total)
      : 0;
    return {
      total,
      successful: ok,
      failed: total - ok,
      autoSwitched: switched,
      cachedCount,
      successRate: total > 0 ? `${((ok / total) * 100).toFixed(1)}%` : '100%',
      avgLatencyMs: avgLatency,
      totalTokens,
    };
  }
}

export const storage = new StorageManager();
