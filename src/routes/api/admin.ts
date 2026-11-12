import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../../db/storage.js';
import { adapterRegistry } from '../../adapters/index.js';
import { routerEngine } from '../../engine/router.js';
import { ProviderConfig, RouteRule } from '../../types/provider.js';

export const adminRouter = Router();

// Get full system state & metrics
adminRouter.get('/config', (req: Request, res: Response) => {
  const config = storage.getConfig();
  const stats = storage.getStats();
  res.json({
    settings: config.settings,
    providers: config.providers,
    routes: config.routes,
    stats,
  });
});

// Update settings
adminRouter.post('/settings', (req: Request, res: Response) => {
  const updates = req.body;
  const updated = storage.updateSettings(updates);
  res.json({ success: true, settings: updated });
});

// Save/Update provider
adminRouter.post('/providers', (req: Request, res: Response) => {
  const providerData = req.body as Partial<ProviderConfig>;
  if (!providerData.name || !providerData.type) {
    return res.status(400).json({ error: 'Name and type are required' });
  }

  const existing = providerData.id ? storage.getProviderById(providerData.id) : null;
  const provider: ProviderConfig = {
    id: providerData.id || `provider-${uuidv4().slice(0, 8)}`,
    name: providerData.name,
    type: providerData.type,
    baseUrl: providerData.baseUrl || '',
    apiKeys: Array.isArray(providerData.apiKeys) ? providerData.apiKeys.filter((k) => k.trim()) : [],
    enabled: providerData.enabled ?? true,
    models: Array.isArray(providerData.models) ? providerData.models.filter((m) => m.trim()) : [],
    defaultModel: providerData.defaultModel || providerData.models?.[0] || '',
    headers: providerData.headers || {},
    createdAt: existing ? existing.createdAt : Date.now(),
  };

  storage.saveProvider(provider);
  res.json({ success: true, provider });
});

// Delete provider
adminRouter.delete('/providers/:id', (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  storage.deleteProvider(id);
  res.json({ success: true });
});

// Test provider connection
adminRouter.post('/providers/:id/test', async (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const provider = storage.getProviderById(id);
  if (!provider) {
    return res.status(404).json({ error: 'Provider not found' });
  }

  const { apiKey, model } = req.body;
  const testKey = apiKey || provider.apiKeys[0];
  const testModel = model || provider.defaultModel || provider.models[0];

  if (!testKey) {
    return res.status(400).json({ ok: false, message: 'No API key provided to test.' });
  }

  const adapter = adapterRegistry.getAdapter(provider.type);
  const result = await adapter.testConnection(testKey, testModel, provider.baseUrl);
  res.json(result);
});

// Save/Update route
adminRouter.post('/routes', (req: Request, res: Response) => {
  const routeData = req.body as Partial<RouteRule>;
  if (!routeData.alias || !routeData.strategy || !routeData.targets) {
    return res.status(400).json({ error: 'Alias, strategy, and targets are required' });
  }

  const existing = routeData.id ? storage.getRouteById(routeData.id) : null;
  const route: RouteRule = {
    id: routeData.id || `route-${uuidv4().slice(0, 8)}`,
    alias: routeData.alias.trim().toLowerCase(),
    description: routeData.description || '',
    strategy: routeData.strategy,
    targets: routeData.targets,
    enabled: routeData.enabled ?? true,
    createdAt: existing ? existing.createdAt : Date.now(),
  };

  storage.saveRoute(route);
  res.json({ success: true, route });
});

// Delete route
adminRouter.delete('/routes/:id', (req: Request, res: Response) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  storage.deleteRoute(id);
  res.json({ success: true });
});

// Get logs
adminRouter.get('/logs', (req: Request, res: Response) => {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
  const logs = storage.getLogs(limit);
  res.json({ logs });
});

// Clear logs
adminRouter.delete('/logs', (req: Request, res: Response) => {
  storage.clearLogs();
  res.json({ success: true });
});

// Interactive Playground Test Route
adminRouter.post('/test-route', async (req: Request, res: Response) => {
  const { model, prompt, stream } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const chatReq = {
    model: model || 'master',
    messages: [{ role: 'user' as const, content: prompt }],
    stream: !!stream,
    max_tokens: 1000,
  };

  try {
    const startTime = Date.now();
    const result = await routerEngine.executeChat(chatReq);
    const latency = Date.now() - startTime;
    res.json({
      success: true,
      result,
      latencyMs: latency,
    });
  } catch (err: any) {
    res.status(502).json({
      success: false,
      error: err.message,
    });
  }
});
