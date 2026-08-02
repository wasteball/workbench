import { describe, expect, it } from 'vitest';

import { toggleTask } from '@/features/markdown/engine/toggle-task';

describe('toggleTask', () => {
  it('changes only the requested task and preserves surrounding text', () => {
    const source = '- [ ] first\n  - [x] nested\n\n- [ ] third';

    expect(toggleTask(source, 1, false)).toBe('- [ ] first\n  - [ ] nested\n\n- [ ] third');
    expect(toggleTask(source, 2, true)).toBe('- [ ] first\n  - [x] nested\n\n- [x] third');
  });

  it('supports ordered and blockquoted task lists', () => {
    const source = '> 1. [ ] quoted\n10. [X] ordered';

    expect(toggleTask(source, 0, true)).toBe('> 1. [x] quoted\n10. [X] ordered');
    expect(toggleTask(source, 1, false)).toBe('> 1. [ ] quoted\n10. [ ] ordered');
  });

  it('returns the original source for an invalid index', () => {
    const source = '- [ ] only';
    expect(toggleTask(source, -1, true)).toBe(source);
    expect(toggleTask(source, 3, true)).toBe(source);
  });
});
