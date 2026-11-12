import { Request, Response } from 'express';
import { routerEngine } from '../../engine/router.js';
import { storage } from '../../db/storage.js';
import { ChatCompletionRequest, ChatCompletionChunk } from '../../types/openai.js';

export async function handleChatCompletion(req: Request, res: Response) {
  // 1. Auth check if masterApiKey is set
  const masterKey = storage.getSettings().masterApiKey;
  if (masterKey) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : (req.headers['x-api-key'] as string);
    if (token !== masterKey) {
      return res.status(401).json({
        error: {
          message: 'Incorrect or missing Master API key.',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      });
    }
  }

  const body = req.body as ChatCompletionRequest;

  if (!body || !body.messages || !Array.isArray(body.messages)) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: "messages" field must be an array.',
        type: 'invalid_request_error',
        code: 'missing_required_parameter',
      },
    });
  }

  const isStream = !!body.stream;

  if (isStream) {
    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let streamStarted = false;

    try {
      await routerEngine.executeChat(body, {
        onStreamStart: () => {
          streamStarted = true;
        },
        onChunk: (chunk: ChatCompletionChunk) => {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        },
      });

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err: any) {
      console.error('[Master Chat Error Stream]', err.message);
      if (!streamStarted && !res.headersSent) {
        return res.status(502).json({
          error: {
            message: err.message || 'All fallback providers failed.',
            type: 'gateway_error',
            code: 'router_exhaustion',
          },
        });
      }
      res.write(`data: ${JSON.stringify({ error: { message: err.message } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } else {
    try {
      const response = await routerEngine.executeChat(body);
      return res.json(response);
    } catch (err: any) {
      console.error('[Master Chat Error]', err.message);
      return res.status(502).json({
        error: {
          message: err.message || 'All fallback providers failed.',
          type: 'gateway_error',
          code: 'router_exhaustion',
        },
      });
    }
  }
}
