import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { ChatStore } from './chat.store';
import { Session } from './models';
import { SseEvent } from './sse';

const session = (id: string, title = ''): Session => ({ id, title, createdAt: '', updatedAt: '' });

async function* events(...evs: SseEvent[]): AsyncIterable<SseEvent> {
  for (const e of evs) yield e;
}

describe('ChatStore', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let navigate: ReturnType<typeof vi.fn>;
  let store: ChatStore;

  beforeEach(() => {
    api = {
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue(session('s1')),
      listMessages: vi.fn().mockResolvedValue([]),
      renameSession: vi.fn(),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      streamMessage: vi.fn(),
    };
    navigate = vi.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: ApiService, useValue: api },
        { provide: Router, useValue: { navigate } },
      ],
    });
    store = TestBed.inject(ChatStore);
  });

  it('send creates a session on the first message', async () => {
    api['streamMessage'].mockReturnValue(
      events(
        { type: 'delta', text: 'Hel' },
        { type: 'delta', text: 'lo' },
        { type: 'done', messageId: 5, title: 'Hi there' },
      ),
    );
    await store.send('Hi there');
    expect(api['createSession']).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/c', 's1']);
    expect(store.messages()).toEqual([
      { role: 'user', content: 'Hi there' },
      { role: 'assistant', content: 'Hello', id: 5 },
    ]);
    expect(store.sessions()[0].title).toBe('Hi there');
    expect(store.isStreaming()).toBe(false);
  });

  it('send ignores input while streaming', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    api['streamMessage'].mockImplementation(async function* () {
      await gate;
      yield { type: 'done', messageId: 1, title: 't' } as SseEvent;
    });
    const first = store.send('one');
    await store.send('two');
    release();
    await first;
    expect(api['streamMessage']).toHaveBeenCalledTimes(1);
  });

  it('send ignores blank input', async () => {
    await store.send('   ');
    expect(api['createSession']).not.toHaveBeenCalled();
  });

  it('stream error marks the assistant bubble and keeps the user message', async () => {
    api['streamMessage'].mockReturnValue(events({ type: 'error', message: 'boom' }));
    await store.send('hi');
    const msgs = store.messages();
    expect(msgs[0]).toEqual({ role: 'user', content: 'hi' });
    expect(msgs[1].error).toBe('boom');
    expect(store.isStreaming()).toBe(false);
  });

  it('a thrown stream error also lands on the assistant bubble', async () => {
    api['streamMessage'].mockImplementation(async function* () {
      throw new Error('network down');
    });
    await store.send('hi');
    expect(store.messages()[1].error).toBe('network down');
  });

  it('remove of the active session resets to a new chat', async () => {
    api['streamMessage'].mockReturnValue(events({ type: 'done', messageId: 1, title: 't' }));
    await store.send('hi');
    await store.remove('s1');
    expect(navigate).toHaveBeenLastCalledWith(['/']);
    expect(store.messages()).toEqual([]);
    expect(store.activeSessionId()).toBeNull();
    expect(store.sessions().find((s) => s.id === 's1')).toBeUndefined();
  });

  it('rename updates the title in the list', async () => {
    api['listSessions'].mockResolvedValue([session('a', 'old')]);
    api['renameSession'].mockResolvedValue(session('a', 'new'));
    await store.loadSessions();
    await store.rename('a', 'new');
    expect(store.sessions()[0].title).toBe('new');
  });

  it('openSession with an unknown id navigates home', async () => {
    api['listMessages'].mockRejectedValue(new Error('session not found'));
    await store.openSession('nope');
    expect(navigate).toHaveBeenCalledWith(['/']);
    expect(store.activeSessionId()).toBeNull();
  });

  it('openSession loads the history of the session', async () => {
    api['listMessages'].mockResolvedValue([{ id: 1, role: 'user', content: 'q' }]);
    await store.openSession('a');
    expect(store.activeSessionId()).toBe('a');
    expect(store.messages()).toEqual([{ id: 1, role: 'user', content: 'q' }]);
  });

  it('openSession of the session being created does not wipe the live stream', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    api['streamMessage'].mockImplementation(async function* () {
      yield { type: 'delta', text: 'a' } as SseEvent;
      await gate;
      yield { type: 'done', messageId: 1, title: 't' } as SseEvent;
    });
    const sending = store.send('hi');
    await vi.waitFor(() => expect(store.messages()).toHaveLength(2));
    await store.openSession('s1'); // what the route does after navigate(['/c','s1'])
    expect(store.messages()[1].content).toBe('a');
    release();
    await sending;
  });
});
