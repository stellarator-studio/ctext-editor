import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { toDoc } from '../src/core/toDoc';
import { serialize } from '../src/core/serialize';
import { buildPageIndex } from '../src/core/pageIndex';
import { columnCells, layoutPage } from '../src/core/columnLayout';
import { validate } from '../src/core/validate';
import { fixHeadingStars, joinNotes, padNote, setBlockLevel, toggleSpanMark } from '../src/editor/commands';

const P = '<scanbegin file="1" page="1" />';
const E = '<scanend file="1" page="1" />';

function state(src: string, from?: number, to?: number) {
  const s = EditorState.create({ doc: toDoc(src) });
  return from === undefined ? s : s.apply(s.tr.setSelection(TextSelection.create(s.doc, from, to ?? from)));
}
function run(s: EditorState, cmd: Command): string {
  let out = s;
  cmd(s, (tr) => (out = s.apply(tr)));
  return serialize(out.doc);
}
/** document position just before the n-th occurrence of `ch` */
function posOf(s: EditorState, ch: string, nth = 0): number {
  let found = -1;
  let k = 0;
  s.doc.descendants((n, p) => {
    if (found >= 0 || !n.isText) return found < 0;
    let i = n.text!.indexOf(ch);
    while (i >= 0) {
      if (k++ === nth) {
        found = p + i;
        return false;
      }
      i = n.text!.indexOf(ch, i + 1);
    }
    return false;
  });
  return found;
}
const lines = (src: string) => layoutPage(buildPageIndex(toDoc(src))[0].lines).map((c) => c.items);
/** note layout as text: each note → [line1|line2] */
const show = (src: string) =>
  lines(src)
    .map((items) =>
      items
        .map((it) =>
          it.k === 'note'
            ? `[${it.lines.map((l) => l.map((c) => ('ch' in c ? c.ch : 'blank' in c ? '□' : '^')).join('')).join('|')}]`
            : it.seg.k === 'text' || it.seg.k === 'coll'
              ? it.seg.text
              : it.seg.k === 'seq'
                ? '^'
                : '_',
        )
        .join(''),
    )
    .join(' / ');

describe('compare view: note layout', () => {
  it('splits a note into ceil(n/2) + rest, spaces counted as cells', () => {
    expect(show(`${P}甲{{ABCDE}}乙${E}`)).toBe('甲[ABC|DE]乙');
    expect(show(`${P}{{ABCD　　　}}${E}`)).toBe('[ABCD|　　　]');
    expect(show(`${P}{{A　B}}${E}`)).toBe('[A　|B]');
  });

  it('keeps adjacent notes apart: {{AB}}{{　}} is not {{AB　}}', () => {
    expect(show(`${P}{{AB}}{{　}}${E}`)).toBe('[A|B][　|]');
    expect(show(`${P}{{AB　}}${E}`)).toBe('[AB|　]');
  });

  it('a seq inside a note stays in the note, with the next character', () => {
    expect(show(`${P}{{AB<seq sid="5" />CD}}${E}`)).toBe('[AB|^CD]');
    expect(show(`${P}{{AB}}<seq sid="5" />{{CD}}${E}`)).toBe('[A|B]^[C|D]');
  });

  it('a note across a column break is laid out per column when body text comes before it', () => {
    expect(show(`${P}甲{{ABC<scanbreak file="1" />DE}}${E}`)).toBe('甲[AB|C] / [D|E]');
  });

  it('a scanbreak in a note that starts its column splits the two small lines', () => {
    expect(show(`${P}{{AB<scanbreak file="1" />CD}}${E}`)).toBe('[AB|CD]');
    expect(show(`${P}{{AB<scanbreak file="1" />CDE}}乙${E}`)).toBe('[AB|CDE]乙');
    // every second scanbreak in the note starts a new column
    expect(show(`${P}{{AB<scanbreak file="1" />CD<scanbreak file="1" />EF<scanbreak file="1" />G}}${E}`)).toBe('[AB|CD] / [EF|G]');
    // a seq before the note is not body text
    expect(show(`${P}<seq sid="1" />{{AB<scanbreak file="1" />CD}}${E}`)).toBe('^[AB|CD]');
    const [col] = lines(`${P}{{AB<scanbreak file="1" />CDE}}${E}`);
    expect(columnCells(col)).toBe(3);
    // laying out does not change the page index (it is laid out again on every render)
    const page = buildPageIndex(toDoc(`${P}{{AB<scanbreak file="1" />CD}}${E}`))[0];
    const before = JSON.stringify(page.lines);
    layoutPage(page.lines);
    layoutPage(page.lines);
    expect(JSON.stringify(page.lines)).toBe(before);
  });

  it('a scanskip inside a note is blank cells of that note', () => {
    expect(show(`${P}{{A<scanskip file="1" y="1" />BCD}}${E}`)).toBe('[A□B|CD]');
    expect(show(`${P}{{A}}<scanskip file="1" y="1" />{{BCD}}${E}`)).toBe('[A|]_[BC|D]');
  });

  it('column height counts a note as its first line', () => {
    const [col] = lines(`${P}甲乙{{ABCDE}}<scanskip file="1" y="2" />${E}`);
    expect(columnCells(col)).toBe(2 + 3 + 2);
  });
});

describe('notes: joining and padding', () => {
  it('marking the space after a note extends it instead of adding a second note', () => {
    const s = state(`${P}{{AB}}　丙${E}`);
    const at = posOf(s, '　');
    expect(run(state(`${P}{{AB}}　丙${E}`, at, at + 1), toggleSpanMark('note'))).toBe(`${P}{{AB　}}丙${E}`);
  });

  it('marking text between two notes joins all three', () => {
    const s = state(`${P}{{AB}}甲{{CD}}${E}`);
    const at = posOf(s, '甲');
    expect(run(state(`${P}{{AB}}甲{{CD}}${E}`, at, at + 1), toggleSpanMark('note'))).toBe(`${P}{{AB甲CD}}${E}`);
  });

  it('lint flags touching notes and the fix joins them', () => {
    const src = `${P}{{AB}}{{　}}甲${E}`;
    const s = state(src);
    const d = validate(s.doc, buildPageIndex(s.doc)).filter((x) => x.fix === 'joinNotes');
    expect(d).toHaveLength(1);
    expect(run(s, joinNotes(d[0].from))).toBe(`${P}{{AB　}}甲${E}`);
    expect(run(s, joinNotes())).toBe(`${P}{{AB　}}甲${E}`);
  });

  it('pads a note with N−1 full-width spaces so it takes one line', () => {
    const src = `${P}甲{{ABCD}}乙${E}`;
    const s = state(src);
    expect(run(state(src, posOf(s, 'B')), padNote)).toBe(`${P}甲{{ABCD　　　}}乙${E}`);
  });

  it('padding replaces existing trailing spaces and is idempotent', () => {
    const src = `${P}{{ABC　}}${E}`;
    const s = state(src);
    expect(run(state(src, posOf(s, 'A')), padNote)).toBe(`${P}{{ABC　　}}${E}`);
    const done = `${P}{{ABC　　}}${E}`;
    expect(padNote(state(done, posOf(state(done), 'A')), () => {})).toBe(false);
  });

  it('padding works on the column of the cursor when a note crosses a column break', () => {
    const src = `${P}{{AB<scanbreak file="1" />CDE}}${E}`;
    const s = state(src);
    expect(run(state(src, posOf(s, 'A')), padNote)).toBe(`${P}{{AB　<scanbreak file="1" />CDE}}${E}`);
    expect(run(state(src, posOf(s, 'D')), padNote)).toBe(`${P}{{AB<scanbreak file="1" />CDE　　}}${E}`);
  });
});

describe('heading marker before seq', () => {
  const seqHeading = `${P}<seq sid="10" />*標題\n\n正文${E}`;

  it('setting a heading puts * after page markers and before seq', () => {
    const src = `${P}<seq sid="10" />標題\n\n正文${E}`;
    const s = state(src);
    expect(run(state(src, posOf(s, '標')), setBlockLevel(1))).toBe(`${P}*<seq sid="10" />標題\n\n正文${E}`);
    const src2 = `正文\n\n<scanbreak file="1" /><seq sid="10" />標題`;
    const s2 = state(src2);
    expect(run(state(src2, posOf(s2, '標')), setBlockLevel(2))).toBe(`正文\n\n**<scanbreak file="1" /><seq sid="10" />標題`);
  });

  it('pasted <seq/>* text is kept as is, flagged, and fixable', () => {
    const s = state(seqHeading);
    expect(serialize(s.doc)).toBe(seqHeading);
    const d = validate(s.doc, buildPageIndex(s.doc)).filter((x) => x.fix === 'headingStars');
    expect(d).toHaveLength(1);
    expect(run(s, fixHeadingStars(d[0].from))).toBe(`${P}*<seq sid="10" />標題\n\n正文${E}`);
  });

  it('sea.txt style headings are not flagged', () => {
    const ok = `${P}*<seq sid="10" />東南洋\n\n**<scanbreak file="1" y="2" /><seq sid="510" />沿革${E}`;
    const s = state(ok);
    expect(validate(s.doc, buildPageIndex(s.doc)).filter((x) => x.fix === 'headingStars')).toEqual([]);
  });
});
