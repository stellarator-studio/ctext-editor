import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { toDoc } from '../src/core/toDoc';
import { serialize } from '../src/core/serialize';
import { schema } from '../src/core/schema';
import { isOrderedSubset, seqGuard, seqsOf, stepOverSeq } from '../src/editor/seqGuard';
import { splitPage } from '../src/editor/pageCommands';

const SRC = '<scanbegin file="1" page="2" />甲乙<seq sid="10" />丙丁<seq sid="20" />戊己<seq sid="30" />庚<scanend file="1" page="2" />';

function setup(src = SRC) {
  return EditorState.create({ doc: toDoc(src), plugins: [seqGuard()] });
}
const sids = (s: EditorState) => seqsOf(s.doc).map((x) => x.sid);
const text = (s: EditorState) => serialize(s.doc);
/** Document position of the n-th occurrence of a character in the text. */
function posOf(s: EditorState, ch: string): number {
  let found = -1;
  s.doc.descendants((n, pos) => {
    if (found < 0 && n.isText && n.text!.includes(ch)) found = pos + n.text!.indexOf(ch);
  });
  if (found < 0) throw new Error(`not found: ${ch}`);
  return found;
}

describe('isOrderedSubset', () => {
  it('works', () => {
    expect(isOrderedSubset(['1', '2', '3'], ['1', '3'])).toBe(true);
    expect(isOrderedSubset(['1', '2', '3'], ['2', '1', '3'])).toBe(false);
    expect(isOrderedSubset(['1', '2'], ['1', '2', '2'])).toBe(false);
  });
});

describe('seqGuard', () => {
  it('deleting a range keeps the seqs inside it', () => {
    const s = setup();
    const next = s.apply(s.tr.delete(posOf(s, '乙'), posOf(s, '己')));
    expect(sids(next)).toEqual(['10', '20', '30']);
    expect(text(next)).toBe('<scanbegin file="1" page="2" />甲<seq sid="10" /><seq sid="20" />己<seq sid="30" />庚<scanend file="1" page="2" />');
  });

  it('typing over a selection keeps the seqs (placed before the new text)', () => {
    const s = setup();
    const next = s.apply(s.tr.insertText('X', posOf(s, '乙'), posOf(s, '丁') + 1));
    expect(sids(next)).toEqual(['10', '20', '30']);
    expect(text(next)).toContain('甲<seq sid="10" />X<seq sid="20" />戊');
  });

  it('allows moving a seq between its neighbours', () => {
    const s = setup();
    const p = seqsOf(s.doc)[1].pos; // sid 20, between 丁 and 戊
    const node = s.doc.nodeAt(p)!;
    const tr = s.tr.delete(p, p + 1);
    tr.insert(tr.mapping.map(posOf(s, '丁')), node); // move to before 丁
    const next = s.apply(tr);
    expect(next).not.toBe(s);
    expect(text(next)).toContain('<seq sid="10" />丙<seq sid="20" />丁戊');
  });

  it('rejects moving a seq past a neighbour', () => {
    const s = setup();
    const p = seqsOf(s.doc)[0].pos; // sid 10
    const node = s.doc.nodeAt(p)!;
    const tr = s.tr.delete(p, p + 1);
    tr.insert(tr.mapping.map(posOf(s, '庚')), node); // past sid 20 and 30
    expect(s.apply(tr)).toBe(s);
  });

  it('rejects changing a sid', () => {
    const s = setup();
    const p = seqsOf(s.doc)[0].pos;
    expect(s.apply(s.tr.setNodeMarkup(p, null, { sid: '11', raw: null }))).toBe(s);
  });

  it('rejects inserting a new or duplicate seq', () => {
    const s = setup();
    expect(s.apply(s.tr.insert(posOf(s, '甲'), schema.nodes.seq.create({ sid: '5' })))).toBe(s);
    expect(s.apply(s.tr.insert(posOf(s, '甲'), schema.nodes.seq.create({ sid: '10' })))).toBe(s);
  });

  it('allows ordinary edits', () => {
    const s = setup();
    const next = s.apply(s.tr.insertText('乂', posOf(s, '丙')));
    expect(text(next)).toContain('<seq sid="10" />乂丙丁');
  });

  it('Backspace after a seq steps over it', () => {
    let s = setup();
    const after = seqsOf(s.doc)[0].pos + 1;
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, after)));
    let out: EditorState | null = null;
    expect(stepOverSeq(-1)(s, (tr) => (out = s.apply(tr)))).toBe(true);
    expect(out!.selection.from).toBe(after - 1);
  });
});

describe('splitPage', () => {
  it('inserts a page boundary with page+1', () => {
    let s = setup();
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, posOf(s, '戊'))));
    let out: EditorState | null = null;
    splitPage(s, (tr) => (out = s.apply(tr)));
    expect(text(out!)).toContain('丁<seq sid="20" /><scanend file="1" page="2" /><scanbegin file="1" page="3" />戊');
  });
});
