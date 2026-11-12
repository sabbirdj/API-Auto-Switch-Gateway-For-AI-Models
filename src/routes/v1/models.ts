import { Request, Response } from 'express';
import { storage } from '../../db/storage.js';
import { ModelListResponse, ModelObject } from '../../types/openai.js';

export function handleListModels(req: Request, res: Response) {
  const routes = storage.getRoutes().filter((r) => r.enabled);
  const providers = storage.getProviders().filter((p) => p.enabled);

  const models: ModelObject[] = [];

  // Add virtual route aliases
  for (const route of routes) {
    models.push({
      id: route.alias,
      object: 'model',
      created: Math.floor(route.createdAt / 1000),
      owned_by: 'api-switch-gateway',
      metadata: {
        isVirtual: true,
        strategy: route.strategy,
        targets: route.targets.map((t) => `${t.providerId}:${t.model}`),
      },
    });
  }

  // Add individual physical models from enabled providers
  for (const provider of providers) {
    for (const m of provider.models) {
      if (!models.some((existing) => existing.id === m)) {
        models.push({
          id: m,
          object: 'model',
          created: Math.floor(provider.createdAt / 1000),
          owned_by: provider.name,
          metadata: {
            isVirtual: false,
            provider: provider.id,
          },
        });
      }
    }
  }

  const response: ModelListResponse = {
    object: 'list',
    data: models,
  };

  res.json(response);
}
