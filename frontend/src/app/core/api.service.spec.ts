import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { SseEvent } from './sse';

function sseResponse(body: string, status = 200): Response {
  return new Response(new TextEncoder().encode(body), { status });
}

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withFetch()), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renameSession sends PATCH with the title', async () => {
    const p = api.renameSession('abc', 'x');
    const req = http.expectOne('/api/sessions/abc');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ title: 'x' });
    req.flush({ id: 'abc', title: 'x', createdAt: '', updatedAt: '' });
    expect((await p).title).toBe('x');
  });

  it('deleteSession sends DELETE', async () => {
    const p = api.deleteSession('abc');
    const req = http.expectOne('/api/sessions/abc');
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await p;
  });

  it('streamMessage yields events from the response body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        sseResponse('event: delta\ndata: {"text":"hi"}\n\nevent: done\ndata: {"messageId":1,"title":"t"}\n\n'),
      );
    vi.stubGlobal('fetch', fetchMock);
    const out: SseEvent[] = [];
    for await (const e of api.streamMessage('abc', 'hello', new AbortController().signal)) out.push(e);
    expect(out.map((e) => e.type)).toEqual(['delta', 'done']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/sessions/abc/messages');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ content: 'hello' });
  });

  it('streamMessage throws the server error message on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse('{"error":"session not found"}', 404)));
    const run = async () => {
      for await (const _ of api.streamMessage('x', 'hi', new AbortController().signal));
    };
    await expect(run()).rejects.toThrow('session not found');
  });
});
