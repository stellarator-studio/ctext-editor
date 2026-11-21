/**
 * Find / replace over plain strings: the raw cText source, or the text
 * projection of the structured document (see projection.ts), where layout
 * markers can be made transparent so a term split by a column break is found.
 */
import { SEP } from './projection';

export interface SearchQuery {
  text: string;
  regex: boolean;
}

export interface TextMatch {
  start: number;
  end: number;
  /** [whole match, group 1, …] — for $1 … in the replacement */
  groups: string[];
}

export const MAX_MATCHES = 5000;

/** The query as a global regex, or an error message. */
export function compile(q: SearchQuery): RegExp | string {
  if (!q.text) return '';
  if (!q.regex) return new RegExp(q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu');
  try {
    return new RegExp(q.text, 'gu');
  } catch (e) {
    return `正規表示式錯誤：${(e as Error).message}`;
  }
}

/** Non-empty matches in `text`, skipping any that would span a separator. */
export function findAll(text: string, re: RegExp): TextMatch[] {
  const out: TextMatch[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === '') {
      re.lastIndex += 1;
      continue;
    }
    if (!m[0].includes(SEP)) out.push({ start: m.index, end: m.index + m[0].length, groups: [...m].map((g) => g ?? '') });
    if (out.length >= MAX_MATCHES) break;
  }
  return out;
}

/** Replacement text: in regex mode `$&`, `$1`…`$99` and `$$` are expanded. */
export function expandReplacement(rep: string, groups: string[], regex: boolean): string {
  if (!regex) return rep;
  return rep.replace(/\$(\$|&|\d{1,2})/g, (all, g: string) => {
    if (g === '$') return '$';
    if (g === '&') return groups[0];
    const n = Number(g);
    return n < groups.length ? groups[n] : all;
  });
}
