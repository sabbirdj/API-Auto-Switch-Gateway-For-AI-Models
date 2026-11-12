import { Request, Response } from 'express';
import { storage } from '../../db/storage.js';
import { router } from '../../engine/router.js';
import { ChatCompletionChunk, ChatMessage } from '../../types/openai.js';

export async function handleAnthropicMessages(req: Request, res: Response) {
  // Auth check
  const masterKey = storage.getSettings().masterApiKey;
  if (masterKey) {
    const auth = req.headers.authorization || '';
    const token =
      (req.headers['x-api-key'] as string) ||
      (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '');
    if (token !== masterKey) {
      return res.status(401).json({
        type: 'error',
        error: { type: 'authentication_error', message: 'Invalid or missing API key.' },
      });
    }
  }

  const { model, messages, system, max_tokens, temperature, stream, stop_sequences } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Missing or invalid "messages" array.' },
    });
  }

  // Translate Anthropic → internal OpenAI format
  const normalized: ChatMessage[] = [];
  if (system) {
    const txt = typeof system === 'string' ? system
      : Array.isArray(system) ? system.map((s: any) => s.text || '').join('\n') : '';
    normalized.push({ role: 'system', content: txt });
  }
  for (const m of messages) {
    normalized.push({ role: m.role, content: m.content });
  }

  const settings = storage.getSettings();
  const providerId = settings.defaultProviderId;
  const internalReq = {
    model: model || storage.getProvider(providerId)?.defaultModel || 'default',
    messages: normalized,
    max_tokens: max_tokens || 4096,
    temperature: temperature ?? 0.7,
    stream: !!stream,
    stop: stop_sequences,
  };

  const msgId = `msg_${Date.now()}`;
  const isStream = !!stream;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    let started = false;
    let completionTokens = 0;

    try {
      await router.execute(internalReq, providerId, (chunk: ChatCompletionChunk) => {
        if (!started) {
          started = true;
          res.write(`event: message_start\ndata: ${JSON.stringify({
            type: 'message_start',
            message: { id: msgId, type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 0, output_tokens: 0 } }
          })}\n\n`);
          res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
        }

        const deltaText = chunk.choices?.[0]?.delta?.content;
        if (deltaText) {
          completionTokens++;
          res.write(`event: content_block_delta\ndata: ${JSON.stringify({
            type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: deltaText }
          })}\n\n`);
        }
      });

      res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
      res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: completionTokens } })}\n\n`);
      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      res.end();
    } catch (err: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { type: 'api_error', message: err.message } })}\n\n`);
      res.end();
    }
  } else {
    try {
      const response = await router.execute(internalReq, providerId);
      if (!response) throw new Error('No response from provider');

      const text = response.choices?.[0]?.message?.content || '';
      res.json({
        id: msgId,
        type: 'message',
        role: 'assistant',
        model,
        content: [{ type: 'text', text }],
        stop_reason: response.choices?.[0]?.finish_reason === 'length' ? 'max_tokens' : 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0,
        },
      });
    } catch (err: any) {
      res.status(502).json({
        type: 'error',
        error: { type: 'api_error', message: err.message || 'All keys exhausted' },
      });
    }
  }
}
