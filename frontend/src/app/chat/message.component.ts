import { Component, computed, input } from '@angular/core';
import { ChatMessage } from '../core/models';
import { renderMarkdown } from './markdown';

@Component({
  selector: 'app-message',
  template: `
    @if (message().role === 'user') {
      <div class="flex justify-end">
        <div
          class="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-neutral-100 px-4 py-2.5 text-neutral-900 dark:bg-neutral-0/10 dark:text-neutral-100"
        >
          {{ message().content }}
        </div>
      </div>
    } @else {
      <div class="max-w-full text-neutral-900 dark:text-neutral-100">
        @if (message().content) {
          <div class="markdown" [innerHTML]="html()"></div>
        } @else if (!message().error) {
          <span class="text-neutral-500 dark:text-neutral-400" aria-label="Assistant is typing">●●●</span>
        }
        @if (message().error) {
          <p
            class="mt-2 rounded-lg bg-danger-100 px-3 py-2 text-sm text-danger-700 dark:bg-danger-500/15 dark:text-danger-500"
            role="alert"
          >
            {{ message().error }}
          </p>
        }
      </div>
    }
  `,
})
export class MessageComponent {
  readonly message = input.required<ChatMessage>();
  protected readonly html = computed(() => renderMarkdown(this.message().content));
}
