import crypto from 'node:crypto';
import { ChatCompletionRequest, ChatCompletionResponse } from '../types/openai.js';

interface CacheEntry {
  response: ChatCompletionResponse;
  timestamp: number;
}

export class ResponseCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxEntries = 500;

  private makeKey(providerId: string, req: ChatCompletionRequest): string {
    const raw = JSON.stringify({
      providerId,
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.max_tokens,
    });
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  public get(providerId: string, req: ChatCompletionRequest, ttlMs = 600000): ChatCompletionResponse | null {
    const key = this.makeKey(providerId, req);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.response;
  }

  public set(providerId: string, req: ChatCompletionRequest, res: ChatCompletionResponse) {
    const key = this.makeKey(providerId, req);
    if (this.cache.size >= this.maxEntries) {
      // Evict oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      response: res,
      timestamp: Date.now(),
    });
  }

  public clear() {
    this.cache.clear();
  }

  public size() {
    return this.cache.size;
  }
}

export const responseCache = new ResponseCache();
