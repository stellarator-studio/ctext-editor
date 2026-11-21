import { describe, expect, it } from 'vitest';
import { stripPunct, textRuns } from '../src/core/punct';

describe('punctuation runs', () => {
  it('splits text into unpunctuated runs with offsets', () => {
    expect(textRuns('緬甸，與「暹羅」。')).toEqual([
      { text: '緬甸', offset: 0 },
      { text: '與', offset: 3 },
      { text: '暹羅', offset: 5 },
    ]);
  });
  it('handles astral characters and keeps ● □ 〇', () => {
    expect(textRuns('𠹵，●□〇')).toEqual([
      { text: '𠹵', offset: 0 },
      { text: '●□〇', offset: 3 },
    ]);
    expect(stripPunct('曰：「甲，乙。」')).toBe('曰甲乙');
  });
});
