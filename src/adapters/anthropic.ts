import { ProviderAdapter, ProviderError } from './base.js';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatMessage,
} from '../types/openai.js';

export class AnthropicAdapter implements ProviderAdapter {
  private defaultBaseUrl = 'https://api.anthropic.com/v1';

  private mapFinishReason(stopReason?: string): 'stop' | 'length' | 'tool_calls' | null {
    if (!stopReason) return null;
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }

  private transformMessages(messages: ChatMessage[]) {
    let systemPrompt = '';
    const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const msg of messages) {
      const contentStr =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
          ? msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n')
          : '';

      if (msg.role === 'system') {
        if (systemPrompt) systemPrompt += '\n\n';
        systemPrompt += contentStr;
      } else {
        const role = msg.role === 'assistant' ? 'assistant' : 'user';
        // Combine consecutive messages with same role if needed
        const prev = anthropicMessages[anthropicMessages.length - 1];
        if (prev && prev.role === role) {
          prev.content += '\n\n' + contentStr;
        } else {
          anthropicMessages.push({ role, content: contentStr });
        }
      }
    }

    // Anthropic requires at least one user message
    if (anthropicMessages.length === 0) {
      anthropicMessages.push({ role: 'user', content: 'Hello' });
    }

    return { systemPrompt, anthropicMessages };
  }

  public async complete(
    req: ChatCompletionRequest,
    apiKey: string,
    model: string,
    baseUrl?: string,
    customHeaders?: Record<string, string>,
    timeoutMs = 45000
  ): Promise<ChatCompletionResponse> {
    const url = `${(baseUrl || this.defaultBaseUrl).replace(/\/+$/, '')}/messages`;
    const { systemPrompt, anthropicMessages } = this.transformMessages(req.messages);

    const maxTokens = req.max_tokens || req.max_completion_tokens || 4096;
    const payload: any = {
      model,
      max_tokens: maxTokens,
      messages: anthropicMessages,
      temperature: req.temperature ?? 0.7,
      stream: false,
    };
    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
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
        throw new ProviderError('Anthropic', response.status, errMsg, errBody);
      }

      const data = (await response.json()) as any;
      const combinedText = (data.content || [])
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');

      const promptTokens = data.usage?.input_tokens || 0;
      const completionTokens = data.usage?.output_tokens || 0;

      return {
        id: data.id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: combinedText,
            },
            finish_reason: this.mapFinishReason(data.stop_reason),
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
        throw new ProviderError('Anthropic', 408, `Request timed out after ${timeoutMs}ms`);
      }
      if (err instanceof ProviderError) throw err;
      throw new ProviderError('Anthropic', 500, err.message || 'Unknown network error', err);
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
    const url = `${(baseUrl || this.defaultBaseUrl).replace(/\/+$/, '')}/messages`;
    const { systemPrompt, anthropicMessages } = this.transformMessages(req.messages);

    const maxTokens = req.max_tokens || req.max_completion_tokens || 4096;
    const payload: any = {
      model,
      max_tokens: maxTokens,
      messages: anthropicMessages,
      temperature: req.temperature ?? 0.7,
      stream: true,
    };
    if (systemPrompt) {
      payload.system = systemPrompt;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let messageId = `msg-${Date.now()}`;
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
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
        throw new ProviderError('Anthropic', response.status, errMsg, errBody);
      }

      if (!response.body) {
        throw new ProviderError('Anthropic', 500, 'Readable stream body is null');
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
            const event = JSON.parse(dataContent);
            if (event.type === 'message_start' && event.message) {
              messageId = event.message.id || messageId;
              if (event.message.usage?.input_tokens) {
                promptTokens = event.message.usage.input_tokens;
              }
            } else if (
              event.type === 'content_block_delta' &&
              event.delta?.type === 'text_delta' &&
              event.delta?.text
            ) {
              if (onChunk) {
                onChunk({
                  id: messageId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: { content: event.delta.text },
                      finish_reason: null,
                    },
                  ],
                });
              }
            } else if (event.type === 'message_delta') {
              if (event.usage?.output_tokens) {
                completionTokens = event.usage.output_tokens;
              }
              const finishReason = this.mapFinishReason(event.delta?.stop_reason);
              if (onChunk && finishReason) {
                onChunk({
                  id: messageId,
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model,
                  choices: [
                    {
                      index: 0,
                      delta: {},
                      finish_reason: finishReason,
                    },
                  ],
                  usage: {
                    prompt_tokens: promptTokens,
                    completion_tokens: completionTokens,
                    total_tokens: promptTokens + completionTokens,
                  },
                });
              }
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
        throw new ProviderError('Anthropic', 408, `Stream timed out after ${timeoutMs}ms`);
      }
      if (err instanceof ProviderError) throw err;
      throw new ProviderError('Anthropic', 500, err.message || 'Stream connection error', err);
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
