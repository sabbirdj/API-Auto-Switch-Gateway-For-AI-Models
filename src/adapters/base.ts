import { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from '../types/openai.js';

export interface AdapterExecutionResult {
  response?: ChatCompletionResponse;
  rawUsage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ProviderAdapter {
  complete(
    req: ChatCompletionRequest,
    apiKey: string,
    model: string,
    baseUrl?: string,
    customHeaders?: Record<string, string>,
    timeoutMs?: number
  ): Promise<ChatCompletionResponse>;

  stream(
    req: ChatCompletionRequest,
    apiKey: string,
    model: string,
    baseUrl?: string,
    customHeaders?: Record<string, string>,
    timeoutMs?: number,
    onChunk?: (chunk: ChatCompletionChunk) => void
  ): Promise<{ usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }>;

  testConnection(
    apiKey: string,
    model: string,
    baseUrl?: string
  ): Promise<{ ok: boolean; message: string; latencyMs: number }>;
}

export class ProviderError extends Error {
  public statusCode: number;
  public provider: string;
  public details?: any;
  public isRateLimit: boolean;

  constructor(provider: string, statusCode: number, message: string, details?: any) {
    super(`[${provider} Error ${statusCode}]: ${message}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
    this.details = details;
    this.isRateLimit = statusCode === 429;
  }
}
