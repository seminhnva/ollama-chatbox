import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ChatInputComponent } from './chat-input.component';

describe('ChatInputComponent', () => {
  let fixture: ComponentFixture<ChatInputComponent>;
  let sent: string[];

  const textarea = () => fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
  const button = () => fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  const type = (value: string) => {
    textarea().value = value;
    textarea().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const press = (shiftKey = false) =>
    textarea().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey, cancelable: true }));

  beforeEach(() => {
    fixture = TestBed.createComponent(ChatInputComponent);
    sent = [];
    fixture.componentInstance.send.subscribe((v: string) => sent.push(v));
    fixture.detectChanges();
  });

  it('Enter sends the text and clears the box', () => {
    type('hi');
    press();
    fixture.detectChanges();
    expect(sent).toEqual(['hi']);
    expect(textarea().value).toBe('');
  });

  it('Shift+Enter does not send', () => {
    type('hi');
    press(true);
    expect(sent).toEqual([]);
  });

  it('blank text is not sent', () => {
    type('   ');
    press();
    expect(sent).toEqual([]);
  });

  it('the Send button is disabled when empty or when disabled input is set', () => {
    expect(button().disabled).toBe(true);
    type('hi');
    expect(button().disabled).toBe(false);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(button().disabled).toBe(true);
  });

  it('does not send while disabled', () => {
    type('hi');
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    press();
    expect(sent).toEqual([]);
  });

  it('clicking Send sends the text', () => {
    type('hello');
    button().click();
    expect(sent).toEqual(['hello']);
  });
});
