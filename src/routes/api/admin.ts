import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage, ProviderConfig, ApiKeyEntry } from '../../db/storage.js';
import { adapterRegistry } from '../../adapters/index.js';
import { router as keyRouter } from '../../engine/router.js';

export const adminRouter = Router();

// ── Dashboard data ────────────────────────────────────────────────────────────
adminRouter.get('/dashboard', (req: Request, res: Response) => {
  const providers = storage.getProviders();
  const settings = storage.getSettings();
  const stats = storage.getStats();
  const logs = storage.getLogs(50);

  // Enrich providers: show key status (active / cooldown)
  const now = Date.now();
  const enriched = providers.map(p => ({
    ...p,
    keys: p.keys.map((k, i) => ({
      ...k,
      index: i,
      status: !k.enabled ? 'disabled' : k.cooldownUntil > now ? 'cooldown' : 'active',
      cooldownRemainsMs: Math.max(0, k.cooldownUntil - now),
    })),
    activeKeys: p.keys.filter(k => k.enabled && k.cooldownUntil <= now).length,
    totalKeys: p.keys.length,
  }));

  res.json({ providers: enriched, settings, stats, logs });
});

// ── Settings ──────────────────────────────────────────────────────────────────
adminRouter.post('/settings', (req: Request, res: Response) => {
  storage.updateSettings(req.body);
  res.json({ ok: true, settings: storage.getSettings() });
});

// ── Add keys to a provider (paste multiple at once) ───────────────────────────
adminRouter.post('/providers/:id/keys', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { keys } = req.body as { keys: string[] }; // array of raw key strings

  const provider = storage.getProvider(id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ error: '"keys" must be a non-empty array of strings' });
  }

  const existing = new Set(provider.keys.map(k => k.key));
  let added = 0;
  for (const rawKey of keys) {
    const k = rawKey.trim();
    if (!k || existing.has(k)) continue;
    provider.keys.push({
      id: uuidv4(),
      key: k,
      label: `Key ${provider.keys.length + 1}`,
      enabled: true,
      usageCount: 0,
      failureCount: 0,
      cooldownUntil: 0,
    });
    added++;
  }

  storage.saveProvider(provider);
  res.json({ ok: true, added, total: provider.keys.length });
});

// ── Remove a single key ───────────────────────────────────────────────────────
adminRouter.delete('/providers/:id/keys/:keyId', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const keyId = req.params.keyId as string;
  const provider = storage.getProvider(id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  provider.keys = provider.keys.filter(k => k.id !== keyId);
  storage.saveProvider(provider);
  res.json({ ok: true });
});

// ── Clear all keys for a provider ─────────────────────────────────────────────
adminRouter.delete('/providers/:id/keys', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const provider = storage.getProvider(id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  provider.keys = [];
  storage.saveProvider(provider);
  res.json({ ok: true });
});

// ── Reset cooldown on all keys for a provider ─────────────────────────────────
adminRouter.post('/providers/:id/keys/reset-cooldown', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const provider = storage.getProvider(id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  provider.keys.forEach(k => { k.cooldownUntil = 0; });
  storage.saveProvider(provider);
  res.json({ ok: true });
});

// ── Toggle provider enabled ───────────────────────────────────────────────────
adminRouter.patch('/providers/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const provider = storage.getProvider(id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  if (req.body.enabled !== undefined) provider.enabled = req.body.enabled;
  if (req.body.defaultModel) provider.defaultModel = req.body.defaultModel;
  if (req.body.baseUrl) provider.baseUrl = req.body.baseUrl;
  if (Array.isArray(req.body.models)) provider.models = req.body.models;
  storage.saveProvider(provider);
  res.json({ ok: true, provider });
});

// ── Add or Update a provider ──────────────────────────────────────────
adminRouter.post('/providers', (req: Request, res: Response) => {
  const { id, name, type, baseUrl, models, defaultModel, keys } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });

  const provId = (id || name.toLowerCase().replace(/[^a-z0-9_-]/g, '-')).trim();
  const existing = storage.getProvider(provId);

  let keyEntries: ApiKeyEntry[] = existing ? [...existing.keys] : [];
  if (Array.isArray(keys)) {
    const existingKeySet = new Set(keyEntries.map(k => k.key));
    for (const rawKey of keys) {
      const k = String(rawKey).trim();
      if (!k || existingKeySet.has(k)) continue;
      keyEntries.push({
        id: uuidv4(),
        key: k,
        label: `Key ${keyEntries.length + 1}`,
        enabled: true,
        usageCount: 0,
        failureCount: 0,
        cooldownUntil: 0,
      });
      existingKeySet.add(k);
    }
  }

  const modelList = Array.isArray(models)
    ? models.map((m: any) => String(m).trim()).filter(Boolean)
    : typeof models === 'string'
    ? models.split(',').map((m: string) => m.trim()).filter(Boolean)
    : [];

  const p: ProviderConfig = {
    id: provId,
    name: name.trim(),
    type,
    baseUrl: (baseUrl || '').trim(),
    keys: keyEntries,
    models: modelList.length > 0 ? modelList : ['default'],
    defaultModel: (defaultModel || modelList[0] || 'default').trim(),
    enabled: existing ? existing.enabled : true,
    createdAt: existing ? existing.createdAt : Date.now(),
  };

  storage.saveProvider(p);
  res.json({ ok: true, provider: p });
});

// ── Delete a provider ─────────────────────────────────────────────────────────
adminRouter.delete('/providers/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  storage.deleteProvider(id);
  res.json({ ok: true });
});

// ── Test a key ────────────────────────────────────────────────────────────────
adminRouter.post('/providers/:id/test', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const provider = storage.getProvider(id);
  if (!provider) return res.status(404).json({ error: 'Provider not found' });

  const { key, model } = req.body;
  const testKey = key || provider.keys[0]?.key;
  const testModel = model || provider.defaultModel || provider.models[0];

  if (!testKey) return res.json({ ok: false, message: 'No API key to test.' });

  const adapter = adapterRegistry.getAdapter(provider.type);
  const result = await adapter.testConnection(testKey, testModel, provider.baseUrl);
  res.json(result);
});

// ── Logs ──────────────────────────────────────────────────────────────────────
adminRouter.get('/logs', (req: Request, res: Response) => {
  const limit = parseInt((req.query.limit as string) || '100', 10);
  res.json({ logs: storage.getLogs(limit) });
});

adminRouter.delete('/logs', (req: Request, res: Response) => {
  storage.clearLogs();
  res.json({ ok: true });
});

// ── Quick playground test ─────────────────────────────────────────────────────
adminRouter.post('/test', async (req: Request, res: Response) => {
  const { prompt, model, providerId } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const pid = providerId || storage.getSettings().defaultProviderId;
  const provider = storage.getProvider(pid);

  try {
    const start = Date.now();
    const result = await keyRouter.execute(
      { model: model || provider?.defaultModel || 'default', messages: [{ role: 'user', content: prompt }] },
      pid
    );
    res.json({ ok: true, result, latencyMs: Date.now() - start });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: err.message });
  }
});
