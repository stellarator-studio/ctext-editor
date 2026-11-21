/**
 * Lexer for cText wiki text.
 *
 * Every token keeps its exact source string in `raw`, so concatenating the
 * `raw` of all tokens reproduces the input byte for byte. Pairing of spans
 * (braces, brackets, <entity>) is NOT done here; see toDoc.ts.
 */

export type Attrs = Record<string, string>;

export type Token =
  | { t: 'text'; raw: string }
  /** A run of one or more '\n'. */
  | { t: 'nl'; raw: string }
  /** Any XML-like tag. `close` = `</x>`, `self` = `<x />`. */
  | { t: 'tag'; raw: string; name: string; attrs: Attrs; close: boolean; self: boolean }
  /** A run of '{' or '}' (pairing is resolved later, because `}}}` is ambiguous). */
  | { t: 'braceOpen'; raw: string }
  | { t: 'braceClose'; raw: string }
  /** 【 】 〖 〗 */
  | { t: 'bracket'; raw: string }
  /** 校勘: （刪）＝說明＝ / ［補］＝說明＝ / （誤）［正］＝說明＝ */
  | { t: 'collation'; raw: string; kind: CollationKind; orig: string; corr: string; note: string }
  /** ●＝文字描述＝ */
  | { t: 'missing'; raw: string; desc: string }
  /** wiki '|' : line break inside the same paragraph */
  | { t: 'bar'; raw: string };

export type CollationKind = 'del' | 'add' | 'fix';

const TAG = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/y;
const ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;
const COLL_PAREN = /（([^（）<>\n]*)）(?:［([^［］<>\n]*)］)?＝([^＝<>\n]*)＝/y;
const COLL_ADD = /［([^［］<>\n]*)］＝([^＝<>\n]*)＝/y;
const MISSING = /●＝([^＝<>\n]*)＝/y;

/** Characters that may start a non-text token. */
const SPECIAL = new Set(['<', '（', '［', '●', '{', '}', '\n', '|', '【', '】', '〖', '〗']);

export function parseAttrs(src: string): Attrs {
  const out: Attrs = {};
  for (const m of src.matchAll(ATTR)) out[m[1]] = m[2];
  return out;
}

function run(src: string, i: number, ch: string): number {
  let j = i;
  while (src[j] === ch) j++;
  return j;
}

export function lex(src: string): Token[] {
  const out: Token[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', raw: text });
    text = '';
  };
  const push = (tok: Token) => {
    flush();
    out.push(tok);
  };

  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (!SPECIAL.has(c)) {
      text += c;
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    switch (c) {
      case '<':
        TAG.lastIndex = i;
        if ((m = TAG.exec(src))) {
          push({ t: 'tag', raw: m[0], close: m[1] === '/', name: m[2], attrs: parseAttrs(m[3]), self: m[4] === '/' });
          i = TAG.lastIndex;
          continue;
        }
        break;
      case '（':
        COLL_PAREN.lastIndex = i;
        if ((m = COLL_PAREN.exec(src))) {
          const corr = m[2];
          push({ t: 'collation', raw: m[0], kind: corr === undefined ? 'del' : 'fix', orig: m[1], corr: corr ?? '', note: m[3] });
          i = COLL_PAREN.lastIndex;
          continue;
        }
        break;
      case '［':
        COLL_ADD.lastIndex = i;
        if ((m = COLL_ADD.exec(src))) {
          push({ t: 'collation', raw: m[0], kind: 'add', orig: '', corr: m[1], note: m[2] });
          i = COLL_ADD.lastIndex;
          continue;
        }
        break;
      case '●':
        MISSING.lastIndex = i;
        if ((m = MISSING.exec(src))) {
          push({ t: 'missing', raw: m[0], desc: m[1] });
          i = MISSING.lastIndex;
          continue;
        }
        break;
      case '{':
      case '}':
      case '\n': {
        const j = run(src, i, c);
        push({ t: c === '{' ? 'braceOpen' : c === '}' ? 'braceClose' : 'nl', raw: src.slice(i, j) });
        i = j;
        continue;
      }
      case '|':
        push({ t: 'bar', raw: c });
        i++;
        continue;
      case '【':
      case '】':
      case '〖':
      case '〗':
        push({ t: 'bracket', raw: c });
        i++;
        continue;
    }
    // Special char that did not form a token: plain text.
    text += c;
    i++;
  }
  flush();
  return out;
}
