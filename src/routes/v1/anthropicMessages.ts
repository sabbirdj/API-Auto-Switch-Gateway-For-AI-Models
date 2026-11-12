import { Request, Response } from 'express';
import { routerEngine } from '../../engine/router.js';
import { storage } from '../../db/storage.js';
import { ChatCompletionRequest, ChatCompletionChunk, ChatMessage } from '../../types/openai.js';

export async function handleAnthropicMessages(req: Request, res: Response) {
  // 1. Auth check
  const masterKey = storage.getSettings().masterApiKey;
  if (masterKey) {
    const authHeader = req.headers.authorization || '';
    const token =
      (req.headers['x-api-key'] as string) ||
      (authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '');
    if (token !== masterKey) {
      return res.status(401).json({
        type: 'error',
        error: {
          type: 'authentication_error',
          message: 'Invalid or missing API key.',
        },
      });
    }
  }

  const { model, messages, system, max_tokens, temperature, stream, stop_sequences } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        message: 'Missing or invalid "messages" array.',
      },
    });
  }

  // Translate Anthropic format to OpenAI ChatCompletionRequest
  const normalizedMessages: ChatMessage[] = [];

  if (system) {
    const systemContent =
      typeof system === 'string'
        ? system
        : Array.isArray(system)
        ? system.map((s: any) => s.text || '').join('\n')
        : '';
    normalizedMessages.push({ role: 'system', content: systemContent });
  }

  for (const m of messages) {
    normalizedMessages.push({
      role: m.role,
      content: m.content,
    });
  }

  const internalReq: ChatCompletionRequest = {
    model: model || 'master',
    messages: normalizedMessages,
    max_tokens: max_tokens || 4096,
    temperature: temperature ?? 0.7,
    stream: !!stream,
    stop: stop_sequences,
  };

  const isStream = !!stream;
  const messageId = `msg_${Date.now()}`;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let streamStarted = false;
    let completionTokens = 0;

    try {
      await routerEngine.executeChat(internalReq, {
        onStreamStart: () => {
          streamStarted = true;
          // 1. Send message_start event
          res.write(
            `event: message_start\ndata: ${JSON.stringify({
              type: 'message_start',
              message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                model,
                content: [],
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 15, output_tokens: 0 },
              },
            })}\n\n`
          );

          // 2. Send content_block_start event
          res.write(
            `event: content_block_start\ndata: ${JSON.stringify({
              type: 'content_block_start',
              index: 0,
              content_block: { type: 'text', text: '' },
            })}\n\n`
          );
        },
        onChunk: (chunk: ChatCompletionChunk) => {
          const deltaText = chunk.choices?.[0]?.delta?.content;
          if (deltaText) {
            completionTokens++;
            res.write(
              `event: content_block_delta\ndata: ${JSON.stringify({
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: deltaText },
              })}\n\n`
            );
          }
        },
      });

      // 3. Send content_block_stop
      res.write(
        `event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: 0,
        })}\n\n`
      );

      // 4. Send message_delta
      res.write(
        `event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: completionTokens },
        })}\n\n`
      );

      // 5. Send message_stop
      res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      res.end();
    } catch (err: any) {
      console.error('[Anthropic Stream Error]', err.message);
      if (!streamStarted && !res.headersSent) {
        return res.status(502).json({
          type: 'error',
          error: {
            type: 'api_error',
            message: err.message || 'All fallback providers failed.',
          },
        });
      }
      res.write(
        `event: error\ndata: ${JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: err.message },
        })}\n\n`
      );
      res.end();
    }
  } else {
    try {
      const response = await routerEngine.executeChat(internalReq);
      if (!response) {
        throw new Error('No response returned from provider.');
      }

      const contentText = response.choices?.[0]?.message?.content || '';
      const finishReason = response.choices?.[0]?.finish_reason;
      const stopReason = finishReason === 'length' ? 'max_tokens' : 'end_turn';

      const anthropicResponse = {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [
          {
            type: 'text',
            text: contentText,
          },
        ],
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
          input_tokens: response.usage?.prompt_tokens || 0,
          output_tokens: response.usage?.completion_tokens || 0,
        },
      };

      res.json(anthropicResponse);
    } catch (err: any) {
      console.error('[Anthropic Complete Error]', err.message);
      res.status(502).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: err.message || 'All fallback providers failed.',
        },
      });
    }
  }
}
