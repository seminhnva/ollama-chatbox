import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeService } from './theme.service';

function stubSystemDark(dark: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark'), media: q }));
}

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to the system preference when nothing is stored', () => {
    stubSystemDark(true);
    const svc = TestBed.inject(ThemeService);
    expect(svc.theme()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('toggle flips the theme, the html class and localStorage', () => {
    stubSystemDark(true);
    const svc = TestBed.inject(ThemeService);
    svc.toggle();
    expect(svc.theme()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('a stored choice wins over the system preference', () => {
    stubSystemDark(true);
    localStorage.setItem('theme', 'light');
    const svc = TestBed.inject(ThemeService);
    expect(svc.theme()).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
