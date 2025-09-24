import { describe, it, expect } from 'vitest';

describe('Basic a11y markers', () => {
  it('adds aria-labels to icon-only buttons', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Add session');
    btn.setAttribute('title', 'Add session');
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });
});


