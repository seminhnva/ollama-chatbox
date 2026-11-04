import { Component, inject, output } from '@angular/core';
import { Router } from '@angular/router';
import { ChatStore } from '../core/chat.store';
import { SessionItemComponent } from './session-item.component';

@Component({
  selector: 'app-sidebar',
  imports: [SessionItemComponent],
  template: `
    <nav class="flex h-full flex-col gap-3 p-3" aria-label="Chat history">
      <button
        type="button"
        class="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-3 py-2 font-medium text-neutral-0 hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        (click)="newChat()"
      >
        <span aria-hidden="true">+</span> New Chat
      </button>
      <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        @for (s of store.sessions(); track s.id) {
          <app-session-item
            [session]="s"
            [active]="s.id === store.activeSessionId()"
            (select)="open(s.id)"
            (renamed)="store.rename(s.id, $event)"
            (deleted)="store.remove(s.id)"
          />
        } @empty {
          <p class="px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400">No chats yet</p>
        }
      </div>
    </nav>
  `,
  host: { class: 'block h-full' },
})
export class SidebarComponent {
  protected readonly store = inject(ChatStore);
  private readonly router = inject(Router);

  /** Emitted after a navigation so the mobile drawer can close. */
  readonly closed = output<void>();

  constructor() {
    void this.store.loadSessions();
  }

  protected newChat(): void {
    void this.router.navigate(['/']);
    this.closed.emit();
  }

  protected open(id: string): void {
    void this.router.navigate(['/c', id]);
    this.closed.emit();
  }
}
