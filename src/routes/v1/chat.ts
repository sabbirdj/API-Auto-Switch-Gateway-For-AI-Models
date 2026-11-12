import { Request, Response } from 'express';
import { storage } from '../../db/storage.js';
import { router } from '../../engine/router.js';
import { ChatCompletionRequest, ChatCompletionChunk } from '../../types/openai.js';

function authCheck(req: Request, res: Response): boolean {
  const masterKey = storage.getSettings().masterApiKey;
  if (!masterKey) return true;
  const auth = req.headers.authorization || '';
  const token = (req.headers['x-api-key'] as string) ||
    (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '');
  if (token !== masterKey) {
    res.status(401).json({ error: { message: 'Invalid or missing Master API key.', type: 'invalid_request_error', code: 'invalid_api_key' } });
    return false;
  }
  return true;
}

export async function handleChatCompletion(req: Request, res: Response) {
  if (!authCheck(req, res)) return;

  const body = req.body as ChatCompletionRequest;
  if (!body?.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({ error: { message: '"messages" must be an array.', type: 'invalid_request_error' } });
  }

  const settings = storage.getSettings();
  const providerId = settings.defaultProviderId;
  const isStream = !!body.stream;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    try {
      await router.execute(body, providerId, (chunk: ChatCompletionChunk) => {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      });
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      console.error('[Chat/stream error]', err.message);
      res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } else {
    try {
      const response = await router.execute(body, providerId);
      res.json(response);
    } catch (err: any) {
      console.error('[Chat error]', err.message);
      res.status(502).json({ error: { message: err.message, type: 'gateway_error' } });
    }
  }
}

export function handleListModels(req: Request, res: Response) {
  const providers = storage.getProviders().filter(p => p.enabled);
  const models: any[] = [];
  for (const p of providers) {
    for (const m of p.models) {
      models.push({ id: m, object: 'model', created: Math.floor(p.createdAt / 1000), owned_by: p.name });
    }
  }
  res.json({ object: 'list', data: models });
}
