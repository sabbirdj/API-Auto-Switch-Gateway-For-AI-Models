import { v4 as uuidv4 } from 'uuid';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../types/openai.js';
import { storage, ProviderConfig } from '../db/storage.js';
import { adapterRegistry, ProviderError } from '../adapters/index.js';
import { responseCache } from './cache.js';

export class KeyRotationRouter {
  /**
   * Execute a chat request against a specific provider,
   * rotating through its key pool if one key hits a rate limit.
   */
  async execute(
    req: ChatCompletionRequest,
    providerId: string,
    onChunk?: (chunk: ChatCompletionChunk) => void
  ): Promise<ChatCompletionResponse | void> {
    const provider = storage.getProvider(providerId);
    if (!provider) throw new Error(`Provider "${providerId}" not found.`);
    if (!provider.enabled) throw new Error(`Provider "${provider.name}" is disabled.`);

    const adapter = adapterRegistry.getAdapter(provider.type);
    const settings = storage.getSettings();
    const model = req.model || provider.defaultModel;

    // ── 1. Check instant 0ms in-memory cache ────────────────────────────────
    if (settings.enableCache !== false) {
      const cached = responseCache.get(providerId, req, (settings.cacheTtlSec || 600) * 1000);
      if (cached) {
        if (req.stream && onChunk) {
          const content = cached.choices[0]?.message?.content || '';
          onChunk({
            id: cached.id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }],
            usage: cached.usage,
          });
        }

        storage.logRequest({
          id: uuidv4(),
          timestamp: Date.now(),
          provider: provider.name,
          keyLabel: 'cache (0ms)',
          model,
          status: 'success',
          statusCode: 200,
          latencyMs: 1,
          ttftMs: 1,
          cached: true,
          stream: !!req.stream,
          keyIndex: -1,
          switchedKeys: false,
          tokens: cached.usage
            ? { prompt: cached.usage.prompt_tokens, completion: cached.usage.completion_tokens, total: cached.usage.total_tokens }
            : undefined,
        });

        if (!req.stream) return cached;
        return;
      }
    }

    // ── 2. Try each available key in round-robin order ──────────────────────
    const usedKeyIds = new Set<string>();
    let attempts = 0;
    const maxAttempts = Math.max(provider.keys.filter(k => k.enabled).length, 1);
    let switchedKeys = false;
    let startTime = Date.now();

    while (attempts < maxAttempts) {
      const picked = storage.pickKey(providerId);

      if (!picked) {
        throw new Error(
          `All ${maxAttempts} key(s) for "${provider.name}" are on cooldown due to rate limits. ` +
          `They will reset in ${settings.cooldownSec}s.`
        );
      }

      const { keyEntry, index } = picked;

      if (usedKeyIds.has(keyEntry.id)) break; // looped all keys
      usedKeyIds.add(keyEntry.id);

      if (attempts > 0) switchedKeys = true;
      attempts++;
      startTime = Date.now();

      try {
        if (req.stream && onChunk) {
          let ttft = 0;
          let assembledText = '';

          const result = await adapter.stream(
            req,
            keyEntry.key,
            model,
            provider.baseUrl,
            undefined,
            settings.defaultTimeoutMs ?? 60000,
            (chunk) => {
              if (!ttft) {
                ttft = Date.now() - startTime; // Time to First Token!
              }
              const d = chunk.choices?.[0]?.delta?.content;
              if (d) assembledText += d;
              onChunk(chunk);
            }
          );

          const totalLatency = Date.now() - startTime;
          const trueLatency = ttft || totalLatency;

          // Save to 0ms cache if complete
          if (settings.enableCache !== false && assembledText) {
            responseCache.set(providerId, req, {
              id: uuidv4(),
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, message: { role: 'assistant', content: assembledText }, finish_reason: 'stop' }],
              usage: result.usage,
            });
          }

          storage.reportSuccess(providerId, keyEntry.id);
          storage.logRequest({
            id: uuidv4(),
            timestamp: Date.now(),
            provider: provider.name,
            keyLabel: keyEntry.label || `Key ${index + 1}`,
            model,
            status: 'success',
            statusCode: 200,
            latencyMs: trueLatency, // TTFT for streaming!
            ttftMs: trueLatency,
            cached: false,
            stream: true,
            keyIndex: index,
            switchedKeys,
            tokens: result.usage
              ? { prompt: result.usage.prompt_tokens, completion: result.usage.completion_tokens, total: result.usage.total_tokens }
              : undefined,
          });
          return;
        } else {
          const response = await adapter.complete(
            req,
            keyEntry.key,
            model,
            provider.baseUrl,
            undefined,
            settings.defaultTimeoutMs ?? 30000
          );

          const latency = Date.now() - startTime;

          // Save to 0ms cache
          if (settings.enableCache !== false) {
            responseCache.set(providerId, req, response);
          }

          storage.reportSuccess(providerId, keyEntry.id);
          storage.logRequest({
            id: response.id || uuidv4(),
            timestamp: Date.now(),
            provider: provider.name,
            keyLabel: keyEntry.label || `Key ${index + 1}`,
            model,
            status: 'success',
            statusCode: 200,
            latencyMs: latency,
            ttftMs: latency,
            cached: false,
            stream: false,
            keyIndex: index,
            switchedKeys,
            tokens: response.usage
              ? { prompt: response.usage.prompt_tokens, completion: response.usage.completion_tokens, total: response.usage.total_tokens }
              : undefined,
          });
          return response;
        }
      } catch (err: any) {
        const isRateLimit = err instanceof ProviderError && err.statusCode === 429;
        const isServerErr = err instanceof ProviderError && err.statusCode >= 500;
        const isTimeout = err instanceof ProviderError && err.statusCode === 408;

        if (isRateLimit) {
          // Auto-rotate to next key
          storage.reportRateLimit(providerId, keyEntry.id);
          console.log(`[Router] 🔄 Key ${index + 1} (${keyEntry.label || keyEntry.id}) rate limited → trying next key...`);
          continue;
        }

        // For server errors / timeouts, also try next key
        if (isServerErr || isTimeout) {
          console.log(`[Router] ⚠️ Key ${index + 1} returned ${err.statusCode} → trying next key...`);
          continue;
        }

        // Auth error or bad request → don't retry
        storage.logRequest({
          id: uuidv4(),
          timestamp: Date.now(),
          provider: provider.name,
          keyLabel: keyEntry.label || `Key ${index + 1}`,
          model,
          status: 'failed',
          statusCode: err instanceof ProviderError ? err.statusCode : 500,
          latencyMs: Date.now() - startTime,
          stream: !!req.stream,
          keyIndex: index,
          switchedKeys,
          error: err.message,
        });
        throw err;
      }
    }

    // All keys exhausted
    const latencyMs = Date.now() - startTime;
    storage.logRequest({
      id: uuidv4(),
      timestamp: Date.now(),
      provider: provider.name,
      keyLabel: 'all',
      model,
      status: 'failed',
      statusCode: 429,
      latencyMs,
      stream: !!req.stream,
      keyIndex: -1,
      switchedKeys,
      error: 'All keys exhausted due to rate limits',
    });
    throw new Error(
      `All ${maxAttempts} key(s) for "${provider.name}" are rate limited. Add more keys or wait ${settings.cooldownSec}s.`
    );
  }
}

export const router = new KeyRotationRouter();
