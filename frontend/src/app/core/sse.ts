export type SseEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: number; title: string }
  | { type: 'error'; message: string };

/** Incrementally splits an SSE text stream into typed events; keeps the unfinished tail between pushes. */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    const normalized = this.buffer.replace(/\r\n/g, '\n');
    const parts = normalized.split('\n\n');
    this.buffer = parts.pop() ?? '';
    for (const part of parts) {
      const ev = this.parseBlock(part);
      if (ev) events.push(ev);
    }
    return events;
  }

  private parseBlock(block: string): SseEvent | null {
    let name = '';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice(7);
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (!name || !data) return null;
    try {
      return { type: name, ...JSON.parse(data) } as SseEvent;
    } catch {
      return null;
    }
  }
}

export async function* readSseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    yield* parser.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
}
