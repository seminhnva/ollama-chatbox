import { Component, computed, input, output, signal } from '@angular/core';

const MAX_HEIGHT_PX = 200;

@Component({
  selector: 'app-chat-input',
  template: `
    <div class="flex items-end gap-2">
      <textarea
        #box
        rows="1"
        placeholder="Message AI Coding's Chatbot…"
        aria-label="Message"
        class="max-h-[200px] min-h-11 flex-1 resize-none rounded-xl border border-neutral-300 bg-neutral-0 px-3 py-2.5 text-neutral-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-0/10 dark:bg-neutral-0/5 dark:text-neutral-100 dark:placeholder:text-neutral-400"
        [value]="text()"
        (input)="onInput(box)"
        (keydown.enter)="onEnter($event, box)"
      ></textarea>
      <button
        type="button"
        class="h-11 rounded-xl bg-brand-500 px-5 font-medium text-neutral-0 hover:bg-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
        [disabled]="!canSend()"
        (click)="submit(box)"
      >
        Send
      </button>
    </div>
  `,
})
export class ChatInputComponent {
  readonly disabled = input(false);
  readonly send = output<string>();

  protected readonly text = signal('');
  protected readonly canSend = computed(() => !this.disabled() && this.text().trim() !== '');

  protected onInput(box: HTMLTextAreaElement): void {
    this.text.set(box.value);
    this.resize(box);
  }

  protected onEnter(event: Event, box: HTMLTextAreaElement): void {
    if ((event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    this.submit(box);
  }

  protected submit(box: HTMLTextAreaElement): void {
    if (!this.canSend()) return;
    this.send.emit(this.text());
    this.text.set('');
    box.value = '';
    this.resize(box);
  }

  private resize(box: HTMLTextAreaElement): void {
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, MAX_HEIGHT_PX)}px`;
  }
}
