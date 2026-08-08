import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import type { ChatCompletionRequest, ChatCompletionResponse } from '@x402/types';
import { getConfig } from '@x402/config';
import { logger } from '@x402/logger';
import { retry } from '@x402/shared';

@Injectable()
export class ProxyService {
  /**
   * Forward a request to the upstream LLM endpoint (non-streaming).
   */
  async forwardRequest(
    request: ChatCompletionRequest,
    upstreamUrl: string,
    apiKey?: string,
    traceId?: string,
  ): Promise<{ response: ChatCompletionResponse; responseTime: number }> {
    const config = getConfig();
    const startTime = Date.now();

    const response = await retry(
      async () => {
        const res = await fetch(upstreamUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(traceId ? { 'X-Request-Trace-Id': traceId } : {}),
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(config.llm.requestTimeout),
        });

        if (!res.ok) {
          const errorBody = await res.text();
          throw new Error(`Upstream error: ${res.status} ${errorBody}`);
        }

        return res;
      },
      {
        maxAttempts: config.llm.maxRetries,
        baseDelayMs: 1000,
        onRetry: (attempt, error) => {
          logger.warn(`Retrying upstream call (attempt ${attempt})`, { error: error.message });
        },
      },
    );

    const data = (await response.json()) as ChatCompletionResponse;
    const responseTime = Date.now() - startTime;

    logger.info('Upstream request completed', {
      model: request.model,
      responseTime,
      tokens: data.usage?.total_tokens,
    });

    return { response: data, responseTime };
  }

  /**
   * Forward a streaming request to the upstream LLM and pipe SSE chunks
   * directly to the client response. Handles client disconnection gracefully
   * and extracts usage tokens from the final stream chunk.
   *
   * On completion, calls `onDone` with the total token count (if available).
   */
  async forwardStreamRequest(
    request: ChatCompletionRequest,
    upstreamUrl: string,
    res: Response,
    apiKey?: string,
    traceId?: string,
    onDone?: (totalTokens?: number) => void,
  ): Promise<void> {
    const config = getConfig();
    const startTime = Date.now();

    // Use configured streaming timeout (defaults to 10 minutes)
    const streamTimeout = config.llm.streamTimeout ?? 600_000;

    // AbortController for client-disconnect propagation to upstream
    const abortController = new AbortController();

    const upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(traceId ? { 'X-Request-Trace-Id': traceId } : {}),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ ...request, stream: true }),
      signal: abortController.signal,
    });

    if (!upstreamRes.ok) {
      const errorBody = await upstreamRes.text();
      throw new Error(`Upstream error: ${upstreamRes.status} ${errorBody}`);
    }

    if (!upstreamRes.body) {
      throw new Error('Upstream returned no response body for streaming');
    }

    // Set SSE headers on the client response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders(); // send headers immediately

    const reader = upstreamRes.body.getReader();
    let totalTokens: number | undefined;
    let aborted = false;
    let lastChunkJson: Record<string, unknown> | null = null;

    // Handle client disconnection → abort upstream fetch + reader
    const onClientClose = () => {
      aborted = true;
      abortController.abort();
      try {
        reader.cancel();
      } catch {
        /* ignore */
      }
    };
    res.on('close', onClientClose);

    // Safety timeout: if upstream hangs, close the stream
    const safetyTimer = setTimeout(() => {
      if (!aborted && !res.writableEnded) {
        logger.warn('Stream timeout reached, closing connection', { model: request.model });
        abortController.abort();
        try {
          reader.cancel();
        } catch {
          /* ignore */
        }
        onClientClose();
      }
    }, streamTimeout);

    try {
      const decoder = new TextDecoder();
      let lineBuffer = '';

      while (!aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        // Forward raw bytes to the client immediately
        res.write(value);

        // Parse individual SSE lines to extract usage from the last valid chunk
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        // Keep the last potentially incomplete line in the buffer
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') continue;

          try {
            const jsonStr = trimmed.slice(6);
            const parsed = JSON.parse(jsonStr);
            lastChunkJson = parsed;
            // Capture usage from any chunk that has it (typically the last)
            if (parsed.usage?.total_tokens != null) {
              totalTokens = parsed.usage.total_tokens;
            }
          } catch {
            /* skip unparseable lines */
          }
        }
      }
    } catch (err) {
      if (!aborted) {
        logger.error('Stream forwarding error', { error: String(err) });
        if (!res.writableEnded) {
          try {
            res.write(
              `data: ${JSON.stringify({ error: { message: 'Stream interrupted', type: 'gateway_error' } })}\n\n`,
            );
            res.write('data: [DONE]\n\n');
          } catch {
            /* client may have disconnected */
          }
        }
      }
    } finally {
      clearTimeout(safetyTimer);
      reader.releaseLock();
      res.removeListener('close', onClientClose);

      if (!res.writableEnded) {
        res.end();
      }

      const responseTime = Date.now() - startTime;
      logger.info('Streaming request completed', {
        model: request.model,
        responseTime,
        tokens: totalTokens,
        aborted,
      });

      onDone?.(totalTokens);
    }
  }

  /**
   * Validate that the incoming request has the expected format.
   */
  validateRequest(request: unknown): request is ChatCompletionRequest {
    if (!request || typeof request !== 'object') return false;
    const r = request as any;
    return typeof r.model === 'string' && Array.isArray(r.messages) && r.messages.length > 0;
  }
}
