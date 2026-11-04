import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  const el = () => fixture.nativeElement as HTMLElement;
  const btn = (label: string) => el().querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), provideHttpClient(withFetch()), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(App);
    fixture.detectChanges();
  });

  it('shows the app title and a New Chat button', () => {
    expect(el().querySelector('h1')?.textContent).toContain("AI Coding's Chatbot");
    expect(el().textContent).toContain('New Chat');
  });

  it('theme toggle switches the dark class', () => {
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    btn('Toggle theme').click();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('hamburger opens the drawer and the backdrop closes it', () => {
    expect(btn('Open sidebar').getAttribute('aria-expanded')).toBe('false');
    btn('Open sidebar').click();
    fixture.detectChanges();
    expect(btn('Open sidebar').getAttribute('aria-expanded')).toBe('true');
    (el().querySelector('[data-testid="backdrop"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(btn('Open sidebar').getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes the drawer', () => {
    btn('Open sidebar').click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(btn('Open sidebar').getAttribute('aria-expanded')).toBe('false');
  });
});
