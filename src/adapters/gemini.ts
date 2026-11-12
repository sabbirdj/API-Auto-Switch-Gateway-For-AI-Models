import { ProviderAdapter, ProviderError } from './base.js';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
} from '../types/openai.js';

export class GeminiAdapter implements ProviderAdapter {
  private defaultBaseUrl = 'https://generativelanguage.googleapis.com';

  private mapFinishReason(reason?: string): 'stop' | 'length' | 'content_filter' | null {
    if (!reason) return null;
    switch (reason.toUpperCase()) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
        return 'content_filter';
      default:
        return 'stop';
    }
  }

  private transformMessages(messages: ChatMessage[]) {
    let systemInstruction: any = undefined;
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const msg of messages) {
      const textContent =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
          ? msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
          : '';

      if (msg.role === 'system') {
        systemInstruction = {
          parts: [{ text: textContent }],
        };
      } else {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        contents.push({
          role,
          parts: [{ text: textContent }],
        });
      }
    }

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: 'Hello' }] });
    }

    return { systemInstruction, contents };
  }

  public async complete(
    req: ChatCompletionRequest,
    apiKey: string,
    model: string,
    baseUrl?: string,
    customHeaders?: Record<string, string>,
    timeoutMs = 45000
  ): Promise<ChatCompletionResponse> {
    const base = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const url = `${base}/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const { systemInstruction, contents } = this.transformMessages(req.messages);

    const payload: any = {
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.max_tokens || req.max_completion_tokens || 8192,
      },
    };
    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
        const errMsg = errBody?.error?.message || JSON.stringify(errBody);
        throw new ProviderError('Google Gemini', response.status, errMsg, errBody);
      }

      const data = (await response.json()) as any;
      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.map((p: any) => p.text).join('') || '';

      const promptTokens = data.usageMetadata?.promptTokenCount || 0;
      const completionTokens = data.usageMetadata?.candidatesTokenCount || 0;

      return {
        id: `gemini-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: text,
            },
            finish_reason: this.mapFinishReason(candidate?.finishReason),
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderError('Google Gemini', 408, `Request timed out after ${timeoutMs}ms`);
      }
      if (err instanceof ProviderError) throw err;
      throw new ProviderError('Google Gemini', 500, err.message || 'Unknown network error', err);
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
    const base = (baseUrl || this.defaultBaseUrl).replace(/\/+$/, '');
    const url = `${base}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const { systemInstruction, contents } = this.transformMessages(req.messages);

    const payload: any = {
      contents,
      generationConfig: {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: req.max_tokens || req.max_completion_tokens || 8192,
      },
    };
    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let promptTokens = 0;
    let completionTokens = 0;
    const chunkId = `gemini-stream-${Date.now()}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
        const errMsg = errBody?.error?.message || JSON.stringify(errBody);
        throw new ProviderError('Google Gemini', response.status, errMsg, errBody);
      }

      if (!response.body) {
        throw new ProviderError('Google Gemini', 500, 'Readable stream body is null');
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
          if (!trimmed.startsWith('data:')) continue;
          const dataContent = trimmed.slice(5).trim();
          if (!dataContent) continue;

          try {
            const data = JSON.parse(dataContent);
            const candidate = data.candidates?.[0];
            const textDelta = candidate?.content?.parts?.map((p: any) => p.text).join('') || '';

            if (data.usageMetadata) {
              promptTokens = data.usageMetadata.promptTokenCount || promptTokens;
              completionTokens = data.usageMetadata.candidatesTokenCount || completionTokens;
            }

            const finishReason = this.mapFinishReason(candidate?.finishReason);

            if (onChunk && (textDelta || finishReason)) {
              onChunk({
                id: chunkId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [
                  {
                    index: 0,
                    delta: textDelta ? { content: textDelta } : {},
                    finish_reason: finishReason,
                  },
                ],
                usage: finishReason
                  ? {
                      prompt_tokens: promptTokens,
                      completion_tokens: completionTokens,
                      total_tokens: promptTokens + completionTokens,
                    }
                  : undefined,
              });
            }
          } catch {
            // Ignore malformed partial chunks
          }
        }
      }

      return {
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new ProviderError('Google Gemini', 408, `Stream timed out after ${timeoutMs}ms`);
      }
      if (err instanceof ProviderError) throw err;
      throw new ProviderError('Google Gemini', 500, err.message || 'Stream connection error', err);
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
