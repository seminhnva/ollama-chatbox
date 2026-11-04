import { Component, effect, ElementRef, HostListener, inject, input, output, signal, viewChild } from '@angular/core';
import { Session } from '../core/models';

@Component({
  selector: 'app-session-item',
  template: `
    <div
      class="group relative flex items-center rounded-lg text-sm"
      [class]="
        active()
          ? 'bg-brand-500/10 text-brand-700 dark:text-brand-500'
          : 'text-neutral-900 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-0/5'
      "
    >
      @if (renaming()) {
        <input
          #renameInput
          class="m-1 w-full rounded-md border border-brand-500 bg-neutral-0 px-2 py-1 text-neutral-900 outline-none dark:bg-neutral-900 dark:text-neutral-100"
          aria-label="Session name"
          [value]="session().title"
          (keydown.enter)="commitRename(renameInput.value)"
          (keydown.escape)="renaming.set(false)"
          (blur)="renaming.set(false)"
        />
      } @else {
        <button type="button" class="min-w-0 flex-1 truncate px-3 py-2 text-left" (click)="select.emit()">
          {{ session().title || 'New chat' }}
        </button>
        <button
          type="button"
          aria-label="Session options"
          aria-haspopup="menu"
          class="mr-1 rounded-md px-2 py-1 opacity-0 hover:bg-neutral-200 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 dark:hover:bg-neutral-0/10 [@media(hover:none)]:opacity-100"
          (click)="menuOpen.set(!menuOpen())"
        >
          ⋯
        </button>
      }

      @if (menuOpen()) {
        <div
          role="menu"
          class="absolute right-1 top-full z-20 mt-1 w-32 rounded-lg border border-neutral-200 bg-neutral-0 py-1 shadow-lg dark:border-neutral-0/10 dark:bg-neutral-900"
        >
          <button type="button" role="menuitem" class="block w-full px-3 py-1.5 text-left text-neutral-900 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-0/10" (click)="startRename()">
            Rename
          </button>
          <button type="button" role="menuitem" class="block w-full px-3 py-1.5 text-left text-danger-600 hover:bg-danger-100 dark:text-danger-500 dark:hover:bg-danger-500/15" (click)="askDelete()">
            Delete
          </button>
        </div>
      }
    </div>

    @if (confirming()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4">
        <div
          role="alertdialog"
          aria-label="Delete chat"
          class="w-full max-w-xs rounded-xl bg-neutral-0 p-5 text-neutral-900 shadow-xl dark:bg-neutral-900 dark:text-neutral-100"
        >
          <p class="font-medium">Delete this chat?</p>
          <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">All of its messages will be removed.</p>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="rounded-lg px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-0/10" (click)="confirming.set(false)">
              Cancel
            </button>
            <button type="button" class="rounded-lg bg-danger-600 px-3 py-1.5 text-neutral-0 hover:bg-danger-700" (click)="confirmDelete()">
              Delete
            </button>
          </div>
        </div>
      </div>
    }
  `,
  host: { class: 'block' },
})
export class SessionItemComponent {
  readonly session = input.required<Session>();
  readonly active = input(false);
  readonly select = output<void>();
  readonly renamed = output<string>();
  readonly deleted = output<void>();

  protected readonly menuOpen = signal(false);
  protected readonly renaming = signal(false);
  protected readonly confirming = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  constructor() {
    effect(() => {
      const input = this.renameInput()?.nativeElement;
      input?.focus();
      input?.select();
    });
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    if (this.menuOpen() && !this.host.nativeElement.contains(event.target as Node)) this.menuOpen.set(false);
  }

  protected startRename(): void {
    this.menuOpen.set(false);
    this.renaming.set(true);
  }

  protected commitRename(value: string): void {
    const title = value.trim();
    this.renaming.set(false);
    if (title && title !== this.session().title) this.renamed.emit(title);
  }

  protected askDelete(): void {
    this.menuOpen.set(false);
    this.confirming.set(true);
  }

  protected confirmDelete(): void {
    this.confirming.set(false);
    this.deleted.emit();
  }
}
