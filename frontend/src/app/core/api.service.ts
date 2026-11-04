import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ChatMessage, Session } from './models';
import { readSseStream, SseEvent } from './sse';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  listSessions(): Promise<Session[]> {
    return firstValueFrom(this.http.get<Session[]>('/api/sessions'));
  }

  createSession(): Promise<Session> {
    return firstValueFrom(this.http.post<Session>('/api/sessions', {}));
  }

  listMessages(id: string): Promise<ChatMessage[]> {
    return firstValueFrom(this.http.get<ChatMessage[]>(`/api/sessions/${id}/messages`));
  }

  renameSession(id: string, title: string): Promise<Session> {
    return firstValueFrom(this.http.patch<Session>(`/api/sessions/${id}`, { title }));
  }

  async deleteSession(id: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`/api/sessions/${id}`));
  }

  async *streamMessage(id: string, content: string, signal: AbortSignal): AsyncIterable<SseEvent> {
    const res = await fetch(`/api/sessions/${id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal,
    });
    if (!res.ok || !res.body) {
      let message = `Request failed (${res.status})`;
      try {
        message = (await res.json()).error ?? message;
      } catch {
        /* keep the generic message */
      }
      throw new Error(message);
    }
    yield* readSseStream(res.body);
  }
}
