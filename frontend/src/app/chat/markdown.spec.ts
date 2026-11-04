import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('strips script and event handlers', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('highlights fenced code blocks', () => {
    const html = renderMarkdown('```ts\nconst a = 1\n```');
    expect(html).toContain('<pre');
    expect(html).toContain('hljs');
  });

  it('renders basic markdown', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
  });
});
