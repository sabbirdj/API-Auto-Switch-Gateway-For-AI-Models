export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'groq'
  | 'deepseek'
  | 'ollama'
  | 'custom';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiKeys: string[];
  enabled: boolean;
  models: string[];
  defaultModel?: string;
  headers?: Record<string, string>;
  createdAt: number;
}

export type RoutingStrategy = 'fallback' | 'load_balance' | 'direct';

export interface RouteTarget {
  providerId: string;
  model: string;
  weight?: number; // for load_balance (e.g. 50, 50)
  timeoutMs?: number; // per-target timeout before failing over
}

export interface RouteRule {
  id: string;
  alias: string; // e.g. "master", "fast", "smart", "gpt-4o"
  description?: string;
  strategy: RoutingStrategy;
  targets: RouteTarget[];
  enabled: boolean;
  createdAt: number;
}

export interface RequestAuditLog {
  id: string;
  timestamp: number;
  aliasRequested: string;
  providerIdUsed: string;
  providerNameUsed: string;
  modelUsed: string;
  status: 'success' | 'failed';
  statusCode: number;
  latencyMs: number;
  stream: boolean;
  retries: number;
  fallbackChain?: string[];
  error?: string;
  tokens?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface GatewaySettings {
  port: number;
  masterApiKey?: string;
  enableLogging: boolean;
  maxLogRetention: number;
  defaultTimeoutMs: number;
}

export interface SystemConfig {
  settings: GatewaySettings;
  providers: ProviderConfig[];
  routes: RouteRule[];
}
