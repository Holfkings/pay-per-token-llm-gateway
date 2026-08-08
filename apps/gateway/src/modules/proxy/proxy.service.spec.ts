import { Test, TestingModule } from '@nestjs/testing';
import { ProxyService } from './proxy.service';
import type { Response } from 'express';

describe('ProxyService', () => {
  let service: ProxyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProxyService],
    }).compile();

    service = module.get<ProxyService>(ProxyService);
  });

  describe('validateRequest', () => {
    it('accepts valid chat completion request', () => {
      expect(
        service.validateRequest({
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).toBe(true);
    });

    it('rejects null', () => {
      expect(service.validateRequest(null)).toBe(false);
    });

    it('rejects missing model', () => {
      expect(
        service.validateRequest({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).toBe(false);
    });

    it('rejects empty messages', () => {
      expect(
        service.validateRequest({
          model: 'gpt-4',
          messages: [],
        }),
      ).toBe(false);
    });

    it('rejects non-array messages', () => {
      expect(
        service.validateRequest({
          model: 'gpt-4',
          messages: 'not-an-array',
        }),
      ).toBe(false);
    });
  });

  describe('forwardStreamRequest', () => {
    it('sets SSE headers before streaming', async () => {
      const headers = new Map<string, string>();
      const mockRes = {
        setHeader: (name: string, value: string) => {
          headers.set(name, value);
        },
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
        removeListener: jest.fn(),
        get writableEnded() {
          return false;
        },
      } as unknown as Response;

      const readableStream = new ReadableStream({
        start(controller) {
          const data = `data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n`;
          controller.enqueue(new TextEncoder().encode(data));
          controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: readableStream,
      });

      try {
        await service.forwardStreamRequest(
          { model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }], stream: true },
          'https://api.example.com/v1/chat/completions',
          mockRes,
        );

        expect(headers.get('Content-Type')).toBe('text/event-stream');
        expect(headers.get('Cache-Control')).toBe('no-cache, no-transform');
        expect(headers.get('Connection')).toBe('keep-alive');
        expect(headers.get('X-Accel-Buffering')).toBe('no');
        expect(mockRes.flushHeaders).toHaveBeenCalled();
        expect(mockRes.write).toHaveBeenCalled();
        expect(mockRes.end).toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('handles upstream error response', async () => {
      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
        removeListener: jest.fn(),
        get writableEnded() {
          return false;
        },
      } as unknown as Response;

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
        body: null,
      });

      try {
        await expect(
          service.forwardStreamRequest(
            { model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }], stream: true },
            'https://api.example.com/v1/chat/completions',
            mockRes,
          ),
        ).rejects.toThrow('Upstream error: 500');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('handles missing response body', async () => {
      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
        removeListener: jest.fn(),
        get writableEnded() {
          return false;
        },
      } as unknown as Response;

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: null,
      });

      try {
        await expect(
          service.forwardStreamRequest(
            { model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }], stream: true },
            'https://api.example.com/v1/chat/completions',
            mockRes,
          ),
        ).rejects.toThrow('no response body');
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('calls onDone callback with token count', async () => {
      let doneTokens: number | undefined;
      const mockRes = {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        on: jest.fn(),
        removeListener: jest.fn(),
        get writableEnded() {
          return false;
        },
      } as unknown as Response;

      const readableStream = new ReadableStream({
        start(controller) {
          const sseData = [
            `data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hi"}}]}`,
            '',
            `data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{}}],"usage":{"total_tokens":42}}`,
            '',
            `data: [DONE]`,
            '',
            '',
          ].join('\n');
          controller.enqueue(new TextEncoder().encode(sseData));
          controller.close();
        },
      });

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: readableStream,
      });

      try {
        await service.forwardStreamRequest(
          { model: 'gpt-4', messages: [{ role: 'user', content: 'Hi' }], stream: true },
          'https://api.example.com/v1/chat/completions',
          mockRes,
          undefined,
          undefined,
          (tokens) => {
            doneTokens = tokens;
          },
        );

        expect(doneTokens).toBe(42);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
