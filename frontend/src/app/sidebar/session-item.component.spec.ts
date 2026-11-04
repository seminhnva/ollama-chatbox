import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SessionItemComponent } from './session-item.component';

describe('SessionItemComponent', () => {
  let fixture: ComponentFixture<SessionItemComponent>;
  let renamed: string[];
  let deleted: number;
  let selected: number;

  const el = () => fixture.nativeElement as HTMLElement;
  const byText = (root: ParentNode, text: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
  const openMenu = () => {
    (el().querySelector('button[aria-label="Session options"]') as HTMLButtonElement).click();
    fixture.detectChanges();
  };
  const input = () => el().querySelector('input') as HTMLInputElement;
  const key = (target: HTMLElement, k: string) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, cancelable: true }));
    fixture.detectChanges();
  };

  beforeEach(() => {
    fixture = TestBed.createComponent(SessionItemComponent);
    fixture.componentRef.setInput('session', { id: 'a', title: 'My chat', createdAt: '', updatedAt: '' });
    renamed = [];
    deleted = 0;
    selected = 0;
    fixture.componentInstance.renamed.subscribe((t: string) => renamed.push(t));
    fixture.componentInstance.deleted.subscribe(() => deleted++);
    fixture.componentInstance.select.subscribe(() => selected++);
    fixture.detectChanges();
  });

  it('shows the title and emits select on click', () => {
    expect(el().textContent).toContain('My chat');
    byText(el(), 'My chat').click();
    expect(selected).toBe(1);
  });

  it('options button stays hidden until hover or focus (CSS classes)', () => {
    const cls = el().querySelector('button[aria-label="Session options"]')!.className;
    expect(cls).toContain('opacity-0');
    expect(cls).toContain('group-hover:opacity-100');
    expect(cls).toContain('group-focus-within:opacity-100');
  });

  it('Rename then Enter emits the trimmed title', () => {
    openMenu();
    byText(el(), 'Rename').click();
    fixture.detectChanges();
    expect(input().value).toBe('My chat');
    input().value = '  New ';
    key(input(), 'Enter');
    expect(renamed).toEqual(['New']);
    expect(input()).toBeNull();
  });

  it('Escape cancels rename', () => {
    openMenu();
    byText(el(), 'Rename').click();
    fixture.detectChanges();
    input().value = 'changed';
    key(input(), 'Escape');
    expect(renamed).toEqual([]);
    expect(el().textContent).toContain('My chat');
  });

  it('an unchanged or blank rename emits nothing', () => {
    openMenu();
    byText(el(), 'Rename').click();
    fixture.detectChanges();
    input().value = '   ';
    key(input(), 'Enter');
    expect(renamed).toEqual([]);
  });

  it('Delete asks for confirmation before emitting', () => {
    openMenu();
    byText(el(), 'Delete').click();
    fixture.detectChanges();
    const dialog = el().querySelector('[role="alertdialog"]')!;
    expect(dialog).not.toBeNull();
    byText(dialog, 'Cancel').click();
    fixture.detectChanges();
    expect(deleted).toBe(0);
    expect(el().querySelector('[role="alertdialog"]')).toBeNull();

    openMenu();
    byText(el(), 'Delete').click();
    fixture.detectChanges();
    byText(el().querySelector('[role="alertdialog"]')!, 'Delete').click();
    expect(deleted).toBe(1);
  });
});
