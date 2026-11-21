/**
 * file id → scan image URL templates (design §6).
 * Template placeholder: {page} or {page:N} (zero-padded to N digits).
 */

const PLACEHOLDER = /\{page(?::(\d+))?\}/g;

export function expandTemplate(template: string, page: number, offset = 0): string {
  const n = page + offset;
  return template.replace(PLACEHOLDER, (_m, w?: string) => (w ? String(n).padStart(Number(w), '0') : String(n)));
}

/**
 * Given an example image URL and the image number it shows, return candidate
 * templates (one per digit run in the URL that equals the number).
 * e.g. ("https://library.ctext.org/h0005527/h0005527_0092.jpg", 92)
 *   → ["https://library.ctext.org/h0005527/h0005527_{page:4}.jpg"]
 */
export function inferTemplates(url: string, page: number): string[] {
  const out: string[] = [];
  for (const m of url.matchAll(/\d+/g)) {
    const run = m[0];
    if (Number(run) !== page) continue;
    const ph = run.startsWith('0') && run.length > 1 ? `{page:${run.length}}` : '{page}';
    out.push(url.slice(0, m.index) + ph + url.slice(m.index! + run.length));
  }
  return out;
}
