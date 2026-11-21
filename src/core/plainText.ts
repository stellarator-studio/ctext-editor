/**
 * Turn plain text without scan tags (e.g. OCR output) into cText text with
 * page and column markers, as a starting point for proofreading.
 */

export interface PlainOptions {
  file: string;
  startPage: number;
  /** each line of the input is one original column → <scanbreak/> between lines */
  linesAreColumns: boolean;
  /** a blank line starts a new page (otherwise a blank line is a paragraph break) */
  blankLineIsPage: boolean;
}

export const hasScanTags = (text: string) => /<scan(begin|end|break)\b/.test(text);

export function plainToCtext(text: string, o: PlainOptions): string {
  const norm = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const f = o.file;
  const begin = (p: number) => `<scanbegin file="${f}" page="${p}" />`;
  const end = (p: number) => `<scanend file="${f}" page="${p}" />`;
  const brk = `<scanbreak file="${f}" />`;

  const joinLines = (block: string) => (o.linesAreColumns ? block.split('\n').join(brk) : block);

  if (o.blankLineIsPage) {
    const pages = norm.split(/\n\s*\n/);
    let page = o.startPage;
    let out = begin(page);
    pages.forEach((pg, i) => {
      if (i > 0) {
        out += end(page) + begin(++page);
      }
      out += joinLines(pg);
    });
    return out + end(page) + '\n';
  }
  // single page; blank lines remain paragraph breaks
  const paras = norm.split(/\n\s*\n/).map(joinLines);
  return begin(o.startPage) + paras.join('\n\n') + end(o.startPage) + '\n';
}
