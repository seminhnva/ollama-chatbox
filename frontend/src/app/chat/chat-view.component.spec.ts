import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../core/api.service';
import { ChatStore } from '../core/chat.store';
import { SseEvent } from '../core/sse';
import { ChatViewComponent } from './chat-view.component';

async function* events(...evs: SseEvent[]): AsyncIterable<SseEvent> {
  for (const e of evs) yield e;
}

describe('ChatViewComponent with the real store and router', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let store: ChatStore;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    api = {
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn(),
      listMessages: vi.fn().mockResolvedValue([{ id: 1, role: 'user', content: 'earlier' }]),
      renameSession: vi.fn(),
      deleteSession: vi.fn(),
      streamMessage: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        provideRouter([{ path: 'c/:id', component: ChatViewComponent }]),
      ],
    });
    store = TestBed.inject(ChatStore);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/c/s1', ChatViewComponent);
    await harness.fixture.whenStable();
  });

  it('opening a session by URL loads its history exactly once', () => {
    expect(api['listMessages']).toHaveBeenCalledTimes(1);
    expect(store.messages()).toHaveLength(1);
  });

  it('a stream error survives the end of the stream', async () => {
    api['streamMessage'].mockReturnValue(events({ type: 'error', message: 'boom' }));
    await store.send('hi');
    await harness.fixture.whenStable();
    harness.detectChanges();
    const last = store.messages().at(-1)!;
    expect(last.error).toBe('boom');
    expect(api['listMessages']).toHaveBeenCalledTimes(1);
  });

  it('a finished reply is not reloaded from the server', async () => {
    api['streamMessage'].mockReturnValue(
      events({ type: 'delta', text: 'ok' }, { type: 'done', messageId: 2, title: 't' }),
    );
    await store.send('hi');
    await harness.fixture.whenStable();
    expect(api['listMessages']).toHaveBeenCalledTimes(1);
    expect(store.messages().at(-1)?.content).toBe('ok');
  });
});
