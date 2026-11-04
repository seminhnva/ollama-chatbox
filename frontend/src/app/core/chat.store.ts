import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { ChatMessage, Session } from './models';

const ERROR_TTL_MS = 4000;

@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  private readonly _sessions = signal<Session[]>([]);
  private readonly _activeSessionId = signal<string | null>(null);
  private readonly _messages = signal<ChatMessage[]>([]);
  private readonly _isStreaming = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly sessions = this._sessions.asReadonly();
  readonly activeSessionId = this._activeSessionId.asReadonly();
  readonly messages = this._messages.asReadonly();
  readonly isStreaming = this._isStreaming.asReadonly();
  readonly error = this._error.asReadonly();

  private controller: AbortController | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | undefined;

  async loadSessions(): Promise<void> {
    try {
      this._sessions.set(await this.api.listSessions());
    } catch (e) {
      this.showError(e);
    }
  }

  async openSession(id: string): Promise<void> {
    if (id === this._activeSessionId() && this._isStreaming()) return;
    this.abortStream();
    this._activeSessionId.set(id);
    this._messages.set([]);
    try {
      const msgs = await this.api.listMessages(id);
      if (this._activeSessionId() === id) this._messages.set(msgs);
    } catch {
      if (this._activeSessionId() === id) {
        this.newChat();
        void this.router.navigate(['/']);
      }
    }
  }

  newChat(): void {
    this.abortStream();
    this._activeSessionId.set(null);
    this._messages.set([]);
  }

  async send(content: string): Promise<void> {
    if (!content.trim() || this._isStreaming()) return;
    const controller = new AbortController();
    this.controller = controller;
    this._isStreaming.set(true);
    let bubbleAdded = false;
    let finished = false;
    try {
      let id = this._activeSessionId();
      if (!id) {
        const created = await this.api.createSession();
        if (controller.signal.aborted) {
          this.api.deleteSession(created.id).catch(() => undefined);
          return;
        }
        id = created.id;
        this._activeSessionId.set(id);
        this._sessions.update((list) => [created, ...list]);
        void this.router.navigate(['/c', id]);
      }
      this._messages.update((m) => [...m, { role: 'user', content }, { role: 'assistant', content: '' }]);
      bubbleAdded = true;

      for await (const ev of this.api.streamMessage(id, content, controller.signal)) {
        if (controller.signal.aborted) break;
        if (ev.type === 'delta') {
          this.patchLast((m) => ({ ...m, content: m.content + ev.text }));
        } else if (ev.type === 'done') {
          finished = true;
          this.patchLast((m) => ({ ...m, id: ev.messageId }));
          this.touchSession(id, ev.title);
        } else {
          finished = true;
          this.patchLast((m) => ({ ...m, error: ev.message }));
        }
      }
      if (!finished && !controller.signal.aborted) {
        this.patchLast((m) => ({ ...m, error: 'Connection closed unexpectedly' }));
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (bubbleAdded) this.patchLast((m) => ({ ...m, error: this.messageOf(e) }));
      else this.showError(e);
    } finally {
      if (this.controller === controller) {
        this.controller = null;
        this._isStreaming.set(false);
      }
    }
  }

  async rename(id: string, title: string): Promise<void> {
    try {
      const updated = await this.api.renameSession(id, title);
      this._sessions.update((list) => list.map((s) => (s.id === id ? updated : s)));
    } catch (e) {
      this.showError(e);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.api.deleteSession(id);
    } catch (e) {
      this.showError(e);
      return;
    }
    this._sessions.update((list) => list.filter((s) => s.id !== id));
    if (this._activeSessionId() === id) {
      this.newChat();
      void this.router.navigate(['/']);
    }
  }

  private abortStream(): void {
    this.controller?.abort();
    this.controller = null;
    this._isStreaming.set(false);
  }

  private patchLast(fn: (m: ChatMessage) => ChatMessage): void {
    this._messages.update((list) => [...list.slice(0, -1), fn(list[list.length - 1])]);
  }

  private touchSession(id: string, title: string): void {
    this._sessions.update((list) => {
      const current = list.find((s) => s.id === id);
      if (!current) return list;
      const updated = { ...current, title, updatedAt: new Date().toISOString() };
      return [updated, ...list.filter((s) => s.id !== id)];
    });
  }

  private messageOf(e: unknown): string {
    return e instanceof Error ? e.message : 'Something went wrong';
  }

  private showError(e: unknown): void {
    this._error.set(this.messageOf(e));
    clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => this._error.set(null), ERROR_TTL_MS);
  }
}
