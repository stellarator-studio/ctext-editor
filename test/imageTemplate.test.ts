import { describe, expect, it } from 'vitest';
import { expandTemplate, inferTemplates } from '../src/core/imageTemplate';

describe('image templates', () => {
  it('infers zero-padded template from an example URL', () => {
    expect(inferTemplates('https://library.ctext.org/h0005527/h0005527_0092.jpg', 92)).toEqual([
      'https://library.ctext.org/h0005527/h0005527_{page:4}.jpg',
    ]);
    expect(inferTemplates('https://library.ctext.org/02087094.cn/02087094.cn_0008.png', 8)).toEqual([
      'https://library.ctext.org/02087094.cn/02087094.cn_{page:4}.png',
    ]);
  });

  it('returns every candidate when ambiguous, none when absent', () => {
    expect(inferTemplates('https://x/8/p8.png', 8)).toEqual(['https://x/{page}/p8.png', 'https://x/8/p{page}.png']);
    expect(inferTemplates('https://x/p9.png', 8)).toEqual([]);
  });

  it('expands with padding and offset', () => {
    expect(expandTemplate('a_{page:4}.jpg', 93)).toBe('a_0093.jpg');
    expect(expandTemplate('a_{page}.jpg', 7, 2)).toBe('a_9.jpg');
  });
});
