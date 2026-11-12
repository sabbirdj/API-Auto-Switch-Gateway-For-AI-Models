import { v4 as uuidv4 } from 'uuid';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
} from '../types/openai.js';
import { RouteTarget, RouteRule, ProviderConfig, RequestAuditLog } from '../types/provider.js';
import { storage } from '../db/storage.js';
import { adapterRegistry, ProviderError } from '../adapters/index.js';
import { keyPool } from './keyPool.js';

export interface RouteResolution {
  routeRule?: RouteRule;
  targets: RouteTarget[];
  alias: string;
}

export class RouterEngine {
  public resolveRoute(modelRequested: string): RouteResolution {
    const cleanModel = (modelRequested || 'master').trim();

    // 1. Try finding explicit route alias
    const route = storage.getRouteByAlias(cleanModel);
    if (route && route.targets.length > 0) {
      let targets = [...route.targets];
      if (route.strategy === 'load_balance' && targets.length > 1) {
        // Weighted random or shuffle based on weight
        targets = this.pickWeightedOrder(targets);
      }
      return { routeRule: route, targets, alias: route.alias };
    }

    // 2. Check if model belongs directly to an enabled provider
    const providers = storage.getProviders().filter((p) => p.enabled && p.apiKeys.length > 0);
    const directProvider = providers.find(
      (p) =>
        p.models.includes(cleanModel) ||
        p.defaultModel === cleanModel ||
        cleanModel.toLowerCase().includes(p.type)
    );

    if (directProvider) {
      return {
        alias: cleanModel,
        targets: [
          {
            providerId: directProvider.id,
            model: cleanModel,
            timeoutMs: 30000,
          },
        ],
      };
    }

    // 3. Fallback to default "master" route or first enabled route
    const defaultRoute = storage.getRouteByAlias('master') || storage.getRoutes().find((r) => r.enabled);
    if (defaultRoute && defaultRoute.targets.length > 0) {
      return {
        routeRule: defaultRoute,
        targets: [...defaultRoute.targets],
        alias: defaultRoute.alias,
      };
    }

    // 4. Default to any enabled provider with its default model
    if (providers.length > 0) {
      const p = providers[0];
      return {
        alias: cleanModel,
        targets: [
          {
            providerId: p.id,
            model: p.defaultModel || p.models[0] || 'default',
            timeoutMs: 30000,
          },
        ],
      };
    }

    throw new Error('No AI providers configured or enabled with valid API keys.');
  }

  private pickWeightedOrder(targets: RouteTarget[]): RouteTarget[] {
    const weightedTargets = targets.map((t) => ({
      target: t,
      weight: t.weight && t.weight > 0 ? t.weight : 50,
    }));

    const totalWeight = weightedTargets.reduce((sum, item) => sum + item.weight, 0);
    const rand = Math.random() * totalWeight;

    let cumulative = 0;
    let selectedIdx = 0;
    for (let i = 0; i < weightedTargets.length; i++) {
      cumulative += weightedTargets[i].weight;
      if (rand <= cumulative) {
        selectedIdx = i;
        break;
      }
    }

    // Place selected target first, followed by others in their original order for fallback
    const selected = targets[selectedIdx];
    const rest = targets.filter((_, idx) => idx !== selectedIdx);
    return [selected, ...rest];
  }

  public async executeChat(
    req: ChatCompletionRequest,
    options?: {
      onChunk?: (chunk: ChatCompletionChunk) => void;
      onStreamStart?: () => void;
    }
  ): Promise<ChatCompletionResponse | void> {
    const startTime = Date.now();
    const resolution = this.resolveRoute(req.model);
    const { targets, alias } = resolution;

    const fallbackChain: string[] = [];
    let lastError: any = null;
    let retries = 0;

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const provider = storage.getProviderById(target.providerId);

      if (!provider || !provider.enabled) {
        fallbackChain.push(`Target [${target.providerId} / ${target.model}]: Provider disabled or not found`);
        continue;
      }

      const apiKey = keyPool.getKey(provider.id, provider.apiKeys);
      if (!apiKey) {
        fallbackChain.push(`Target [${provider.name} / ${target.model}]: No API key available`);
        continue;
      }

      const adapter = adapterRegistry.getAdapter(provider.type);
      const targetTimeout = target.timeoutMs || storage.getSettings().defaultTimeoutMs || 30000;

      try {
        console.log(
          `[Router] Route "${alias}" -> Attempting target ${i + 1}/${targets.length}: ${provider.name} (${target.model})`
        );

        if (req.stream) {
          let hasStartedStreaming = false;

          const streamResult = await adapter.stream(
            req,
            apiKey,
            target.model,
            provider.baseUrl,
            provider.headers,
            targetTimeout,
            (chunk) => {
              if (!hasStartedStreaming) {
                hasStartedStreaming = true;
                if (options?.onStreamStart) options.onStreamStart();
              }
              if (options?.onChunk) {
                options.onChunk(chunk);
              }
            }
          );

          keyPool.reportSuccess(provider.id, apiKey);
          const latencyMs = Date.now() - startTime;

          // Record audit log
          storage.logRequest({
            id: uuidv4(),
            timestamp: Date.now(),
            aliasRequested: req.model,
            providerIdUsed: provider.id,
            providerNameUsed: provider.name,
            modelUsed: target.model,
            status: 'success',
            statusCode: 200,
            latencyMs,
            stream: true,
            retries,
            fallbackChain: fallbackChain.length > 0 ? fallbackChain : undefined,
            tokens: streamResult.usage,
          });

          return;
        } else {
          const response = await adapter.complete(
            req,
            apiKey,
            target.model,
            provider.baseUrl,
            provider.headers,
            targetTimeout
          );

          keyPool.reportSuccess(provider.id, apiKey);
          const latencyMs = Date.now() - startTime;

          // Record audit log
          storage.logRequest({
            id: response.id || uuidv4(),
            timestamp: Date.now(),
            aliasRequested: req.model,
            providerIdUsed: provider.id,
            providerNameUsed: provider.name,
            modelUsed: target.model,
            status: 'success',
            statusCode: 200,
            latencyMs,
            stream: false,
            retries,
            fallbackChain: fallbackChain.length > 0 ? fallbackChain : undefined,
            tokens: response.usage,
          });

          return response;
        }
      } catch (err: any) {
        lastError = err;
        retries++;

        if (err instanceof ProviderError && err.isRateLimit) {
          keyPool.reportRateLimit(provider.id, apiKey, 60);
        }

        const reason = err.message || 'Unknown error';
        const failureNote = `Target ${provider.name} (${target.model}) failed: ${reason}`;
        console.warn(`[Router Switch] ${failureNote}. Switching to next fallback target...`);
        fallbackChain.push(failureNote);
      }
    }

    // All targets failed
    const totalLatency = Date.now() - startTime;
    storage.logRequest({
      id: uuidv4(),
      timestamp: Date.now(),
      aliasRequested: req.model,
      providerIdUsed: 'none',
      providerNameUsed: 'Exhausted',
      modelUsed: req.model,
      status: 'failed',
      statusCode: lastError?.statusCode || 502,
      latencyMs: totalLatency,
      stream: !!req.stream,
      retries,
      fallbackChain,
      error: lastError?.message || 'All fallback targets exhausted',
    });

    throw new Error(
      `Master Router: All targets exhausted for model/route "${req.model}".\nFallback trace:\n - ` +
        fallbackChain.join('\n - ')
    );
  }
}

export const routerEngine = new RouterEngine();
