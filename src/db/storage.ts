import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProviderConfig, RouteRule, RequestAuditLog, SystemConfig } from '../types/provider.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

const DEFAULT_CONFIG: SystemConfig = {
  settings: {
    port: 3000,
    masterApiKey: 'sk-switch-master-key',
    enableLogging: true,
    maxLogRetention: 1000,
    defaultTimeoutMs: 30000,
  },
  providers: [
    {
      id: 'provider-gemini',
      name: 'Google Gemini',
      type: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKeys: [],
      enabled: true,
      models: [
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
      ],
      defaultModel: 'gemini-2.0-flash',
      createdAt: Date.now(),
    },
    {
      id: 'provider-groq',
      name: 'Groq Cloud',
      type: 'groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKeys: [],
      enabled: true,
      models: [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768',
        'deepseek-r1-distill-llama-70b',
      ],
      defaultModel: 'llama-3.3-70b-versatile',
      createdAt: Date.now(),
    },
    {
      id: 'provider-openai',
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKeys: [],
      enabled: true,
      models: [
        'gpt-4o',
        'gpt-4o-mini',
        'o1-mini',
        'o3-mini',
      ],
      defaultModel: 'gpt-4o-mini',
      createdAt: Date.now(),
    },
    {
      id: 'provider-anthropic',
      name: 'Anthropic Claude',
      type: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKeys: [],
      enabled: true,
      models: [
        'claude-3-5-sonnet-20241022',
        'claude-3-5-haiku-20241022',
        'claude-3-opus-20240229',
      ],
      defaultModel: 'claude-3-5-sonnet-20241022',
      createdAt: Date.now(),
    },
    {
      id: 'provider-deepseek',
      name: 'DeepSeek',
      type: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKeys: [],
      enabled: true,
      models: [
        'deepseek-chat',
        'deepseek-reasoner',
      ],
      defaultModel: 'deepseek-chat',
      createdAt: Date.now(),
    },
    {
      id: 'provider-ollama',
      name: 'Ollama (Local)',
      type: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKeys: ['ollama-local'],
      enabled: false,
      models: [
        'llama3.2',
        'mistral',
        'qwen2.5-coder',
        'deepseek-r1',
      ],
      defaultModel: 'llama3.2',
      createdAt: Date.now(),
    },
  ],
  routes: [
    {
      id: 'route-master',
      alias: 'master',
      description: 'Primary AI Switch: Routes to fastest high-tier model with automatic failover chain',
      strategy: 'fallback',
      enabled: true,
      createdAt: Date.now(),
      targets: [
        {
          providerId: 'provider-gemini',
          model: 'gemini-2.0-flash',
          timeoutMs: 25000,
        },
        {
          providerId: 'provider-groq',
          model: 'llama-3.3-70b-versatile',
          timeoutMs: 20000,
        },
        {
          providerId: 'provider-openai',
          model: 'gpt-4o-mini',
          timeoutMs: 25000,
        },
        {
          providerId: 'provider-anthropic',
          model: 'claude-3-5-sonnet-20241022',
          timeoutMs: 30000,
        },
      ],
    },
    {
      id: 'route-smart',
      alias: 'smart',
      description: 'Intelligence tier: Claude 3.5 Sonnet -> GPT-4o -> Gemini 1.5 Pro',
      strategy: 'fallback',
      enabled: true,
      createdAt: Date.now(),
      targets: [
        {
          providerId: 'provider-anthropic',
          model: 'claude-3-5-sonnet-20241022',
          timeoutMs: 30000,
        },
        {
          providerId: 'provider-openai',
          model: 'gpt-4o',
          timeoutMs: 30000,
        },
        {
          providerId: 'provider-gemini',
          model: 'gemini-1.5-pro',
          timeoutMs: 30000,
        },
      ],
    },
    {
      id: 'route-fast',
      alias: 'fast',
      description: 'High-speed load balancing between Groq and Gemini Flash',
      strategy: 'load_balance',
      enabled: true,
      createdAt: Date.now(),
      targets: [
        {
          providerId: 'provider-groq',
          model: 'llama-3.3-70b-versatile',
          weight: 50,
          timeoutMs: 15000,
        },
        {
          providerId: 'provider-gemini',
          model: 'gemini-2.0-flash',
          weight: 50,
          timeoutMs: 15000,
        },
      ],
    },
  ],
};

class StorageManager {
  private config: SystemConfig;
  private logs: RequestAuditLog[] = [];

  constructor() {
    this.ensureDirectories();
    this.config = this.loadConfig();
    this.logs = this.loadLogs();
  }

  private ensureDirectories() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  private loadConfig(): SystemConfig {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          settings: { ...DEFAULT_CONFIG.settings, ...parsed.settings },
          providers: parsed.providers || DEFAULT_CONFIG.providers,
          routes: parsed.routes || DEFAULT_CONFIG.routes,
        };
      }
    } catch (err) {
      console.error('[Storage] Error loading config, falling back to defaults:', err);
    }
    this.saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  private saveConfig(config: SystemConfig) {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Storage] Error saving config file:', err);
    }
  }

  private loadLogs(): RequestAuditLog[] {
    try {
      if (fs.existsSync(LOGS_FILE)) {
        const raw = fs.readFileSync(LOGS_FILE, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (err) {
      console.error('[Storage] Error loading logs:', err);
    }
    return [];
  }

  private saveLogs() {
    try {
      fs.writeFileSync(LOGS_FILE, JSON.stringify(this.logs, null, 2), 'utf-8');
    } catch (err) {
      console.error('[Storage] Error saving logs file:', err);
    }
  }

  // --- Config getters & setters ---
  public getConfig(): SystemConfig {
    return this.config;
  }

  public getSettings() {
    return this.config.settings;
  }

  public updateSettings(updates: Partial<SystemConfig['settings']>) {
    this.config.settings = { ...this.config.settings, ...updates };
    this.saveConfig(this.config);
    return this.config.settings;
  }

  // --- Provider Operations ---
  public getProviders(): ProviderConfig[] {
    return this.config.providers;
  }

  public getProviderById(id: string): ProviderConfig | undefined {
    return this.config.providers.find((p) => p.id === id);
  }

  public getProviderByType(type: string): ProviderConfig | undefined {
    return this.config.providers.find((p) => p.type === type && p.enabled);
  }

  public saveProvider(provider: ProviderConfig) {
    const idx = this.config.providers.findIndex((p) => p.id === provider.id);
    if (idx >= 0) {
      this.config.providers[idx] = provider;
    } else {
      this.config.providers.push(provider);
    }
    this.saveConfig(this.config);
    return provider;
  }

  public deleteProvider(id: string) {
    this.config.providers = this.config.providers.filter((p) => p.id !== id);
    this.saveConfig(this.config);
  }

  // --- Route Operations ---
  public getRoutes(): RouteRule[] {
    return this.config.routes;
  }

  public getRouteByAlias(alias: string): RouteRule | undefined {
    return this.config.routes.find((r) => r.alias.toLowerCase() === alias.toLowerCase() && r.enabled);
  }

  public getRouteById(id: string): RouteRule | undefined {
    return this.config.routes.find((r) => r.id === id);
  }

  public saveRoute(route: RouteRule) {
    const idx = this.config.routes.findIndex((r) => r.id === route.id);
    if (idx >= 0) {
      this.config.routes[idx] = route;
    } else {
      this.config.routes.push(route);
    }
    this.saveConfig(this.config);
    return route;
  }

  public deleteRoute(id: string) {
    this.config.routes = this.config.routes.filter((r) => r.id !== id);
    this.saveConfig(this.config);
  }

  // --- Audit Logs Operations ---
  public logRequest(log: RequestAuditLog) {
    if (!this.config.settings.enableLogging) return;
    this.logs.unshift(log);
    const max = this.config.settings.maxLogRetention || 1000;
    if (this.logs.length > max) {
      this.logs = this.logs.slice(0, max);
    }
    // Asynchronously flush logs
    this.saveLogs();
  }

  public getLogs(limit = 100): RequestAuditLog[] {
    return this.logs.slice(0, limit);
  }

  public clearLogs() {
    this.logs = [];
    this.saveLogs();
  }

  public getStats() {
    const total = this.logs.length;
    const successful = this.logs.filter((l) => l.status === 'success').length;
    const failed = this.logs.filter((l) => l.status === 'failed').length;
    const successRate = total > 0 ? ((successful / total) * 100).toFixed(1) : '100.0';
    const totalLatency = this.logs.reduce((sum, l) => sum + (l.latencyMs || 0), 0);
    const avgLatency = total > 0 ? Math.round(totalLatency / total) : 0;
    const totalTokens = this.logs.reduce((sum, l) => sum + (l.tokens?.total_tokens || 0), 0);

    const providerCounts: Record<string, number> = {};
    for (const log of this.logs) {
      const name = log.providerNameUsed || log.providerIdUsed || 'Unknown';
      providerCounts[name] = (providerCounts[name] || 0) + 1;
    }

    return {
      totalRequests: total,
      successfulRequests: successful,
      failedRequests: failed,
      successRate: `${successRate}%`,
      averageLatencyMs: avgLatency,
      totalTokens,
      providerDistribution: providerCounts,
    };
  }
}

export const storage = new StorageManager();
