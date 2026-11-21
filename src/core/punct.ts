/**
 * Punctuation added during digitization (cText's allowed set plus common
 * extras). The original prints have none of it, so the page view can hide it
 * to line the text up with the scan image character by character.
 * Not included: ● □ (they stand for characters) and 〇 (a numeral).
 */
export const PUNCT = /[。，、；：！？「」『』“”‘’《》〈〉·．…—（）【】〖〗,.;:!?"'()]/u;
const PUNCT_G = new RegExp(PUNCT.source, 'gu');

export const stripPunct = (s: string) => s.replace(PUNCT_G, '');

/** Runs of non-punctuation characters with their UTF-16 offset in `s`. */
export function textRuns(s: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let start = -1;
  for (let i = 0; i <= s.length; ) {
    const cp = i < s.length ? s.codePointAt(i)! : -1;
    const ch = cp < 0 ? '' : String.fromCodePoint(cp);
    const isP = cp < 0 || PUNCT.test(ch);
    if (isP && start >= 0) {
      out.push({ text: s.slice(start, i), offset: start });
      start = -1;
    } else if (!isP && start < 0) start = i;
    i += cp < 0 ? 1 : ch.length;
  }
  return out;
}
