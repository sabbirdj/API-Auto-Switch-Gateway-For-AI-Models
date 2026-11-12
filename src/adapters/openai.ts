import { ProviderAdapter, ProviderError } from './base.js';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../types/openai.js';

export class OpenAICompatibleAdapter implements ProviderAdapter {
  private providerName: string;
  private defaultBaseUrl: string;

  constructor(providerName = 'OpenAI', defaultBaseUrl = 'https://api.openai.com/v1') {
    this.providerName = providerName;
    this.defaultBaseUrl = defaultBaseUrl;
  }

  private resolveUrl(baseUrl?: string): string {
    const base = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    if (base.endsWith('/chat/completions')) {
      return base;
    }
    return `${base}/chat/completions`;
  }

  public async complete(
    req: ChatCompletionRequest,
    apiKey: string,
    model: string,
    baseUrl?: string,
    customHeaders?: Record<string, string>,
    timeoutMs = 30000
  ): Promise<ChatCompletionResponse> {
    const url = this.resolveUrl(baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const payload = {
      ...req,
      model,
      stream: false,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(customHeaders || {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errBody: any;
        try {
          errBody = await response.json();
        } catch {
          errBody = await response.text();
        }
        const errMsg =
          typeof errBody === 'object' && errBody?.error?.message
            ? errBody.error.message
            : JSON.stringify(errBody);
        throw new ProviderError(this.providerName, response.status, errMsg, errBody);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      return data;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderError(this.providerName, 408, `Request timed out after ${timeoutMs}ms`);
      }
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(this.providerName, 500, err.message || 'Unknown network error', err);
    } finally {
      clearTimeout(timer);
    }
  }

  public async stream(
    req: ChatCompletionRequest,
    apiKey: string,
    model: string,
    baseUrl?: string,
    customHeaders?: Record<string, string>,
    timeoutMs = 60000,
    onChunk?: (chunk: ChatCompletionChunk) => void
  ): Promise<{ usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
    const url = this.resolveUrl(baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const payload = {
      ...req,
      model,
      stream: true,
      stream_options: { include_usage: true },
    };

    let finalUsage: any = undefined;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(customHeaders || {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errBody: any;
        try {
          errBody = await response.json();
        } catch {
          errBody = await response.text();
        }
        const errMsg =
          typeof errBody === 'object' && errBody?.error?.message
            ? errBody.error.message
            : JSON.stringify(errBody);
        throw new ProviderError(this.providerName, response.status, errMsg, errBody);
      }

      if (!response.body) {
        throw new ProviderError(this.providerName, 500, 'Readable stream body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const dataContent = trimmed.slice(5).trim();
          if (dataContent === '[DONE]') continue;

          try {
            const parsedChunk = JSON.parse(dataContent) as ChatCompletionChunk;
            if (parsedChunk.usage) {
              finalUsage = parsedChunk.usage;
            }
            if (onChunk) {
              onChunk(parsedChunk);
            }
          } catch {
            // Ignore malformed partial chunks
          }
        }
      }

      return { usage: finalUsage };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderError(this.providerName, 408, `Stream timed out after ${timeoutMs}ms`);
      }
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(this.providerName, 500, err.message || 'Stream connection error', err);
    } finally {
      clearTimeout(timer);
    }
  }

  public async testConnection(
    apiKey: string,
    model: string,
    baseUrl?: string
  ): Promise<{ ok: boolean; message: string; latencyMs: number }> {
    const start = Date.now();
    try {
      const res = await this.complete(
        {
          model,
          messages: [{ role: 'user', content: 'Ping' }],
          max_tokens: 5,
        },
        apiKey,
        model,
        baseUrl,
        undefined,
        10000
      );
      const latency = Date.now() - start;
      const text = res.choices[0]?.message?.content || 'OK';
      return { ok: true, message: `Connected! Response: "${text.trim().slice(0, 30)}"`, latencyMs: latency };
    } catch (err: any) {
      return { ok: false, message: err.message || 'Connection failed', latencyMs: Date.now() - start };
    }
  }
}
