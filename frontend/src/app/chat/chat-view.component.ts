import { Component, effect, ElementRef, inject, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ChatStore } from '../core/chat.store';
import { ChatInputComponent } from './chat-input.component';
import { MessageComponent } from './message.component';

@Component({
  selector: 'app-chat-view',
  imports: [MessageComponent, ChatInputComponent],
  template: `
    <div #scroller class="flex-1 overflow-y-auto">
      <div class="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        @for (m of store.messages(); track $index) {
          <app-message [message]="m" />
        } @empty {
          <p class="mt-24 text-center text-lg text-neutral-500 dark:text-neutral-400">
            How can I help you code today?
          </p>
        }
      </div>
    </div>
    <div class="border-t border-neutral-200 bg-neutral-0 px-4 py-3 dark:border-neutral-0/10 dark:bg-neutral-900">
      <div class="mx-auto max-w-3xl">
        <app-chat-input [disabled]="store.isStreaming()" (send)="store.send($event)" />
      </div>
    </div>
  `,
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class ChatViewComponent {
  protected readonly store = inject(ChatStore);
  private readonly params = toSignal(inject(ActivatedRoute).paramMap);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  constructor() {
    effect(() => {
      const id = this.params()?.get('id');
      // Only the route param may re-trigger this; the store's own signals must not.
      untracked(() => {
        if (id) void this.store.openSession(id);
        else this.store.newChat();
      });
    });
    effect(() => {
      this.store.messages();
      const el = this.scroller().nativeElement;
      setTimeout(() => (el.scrollTop = el.scrollHeight));
    });
  }
}
