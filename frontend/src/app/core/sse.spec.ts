import { describe, expect, it } from 'vitest';
import { readSseStream, SseEvent, SseParser } from './sse';

describe('SseParser', () => {
  it('parses a single event', () => {
    const p = new SseParser();
    expect(p.push('event: delta\ndata: {"text":"hi"}\n\n')).toEqual([{ type: 'delta', text: 'hi' }]);
  });

  it('handles an event split across chunks', () => {
    const p = new SseParser();
    expect(p.push('event: del')).toEqual([]);
    expect(p.push('ta\ndata: {"text":"a"}\n\n')).toEqual([{ type: 'delta', text: 'a' }]);
  });

  it('handles several events in one chunk', () => {
    const p = new SseParser();
    const evs = p.push(
      'event: delta\ndata: {"text":"a"}\n\nevent: done\ndata: {"messageId":7,"title":"x"}\n\n',
    );
    expect(evs).toHaveLength(2);
    expect(evs[1]).toEqual({ type: 'done', messageId: 7, title: 'x' });
  });

  it('handles CRLF line endings and error events', () => {
    const p = new SseParser();
    expect(p.push('event: error\r\ndata: {"message":"boom"}\r\n\r\n')).toEqual([
      { type: 'error', message: 'boom' },
    ]);
  });
});

describe('readSseStream', () => {
  it('decodes multibyte split across chunks', async () => {
    const bytes = new TextEncoder().encode('event: delta\ndata: {"text":"Việt 😀"}\n\n');
    const cut1 = bytes.indexOf(0xe1) + 1; // inside the 3-byte "ệ"
    const cut2 = bytes.length - 6; // inside the 4-byte emoji
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, cut1));
        c.enqueue(bytes.slice(cut1, cut2));
        c.enqueue(bytes.slice(cut2));
        c.close();
      },
    });
    const out: SseEvent[] = [];
    for await (const e of readSseStream(stream)) out.push(e);
    expect(out).toEqual([{ type: 'delta', text: 'Việt 😀' }]);
  });
});
