import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { toDoc } from '../src/core/toDoc';
import { serialize } from '../src/core/serialize';
import { AhoCorasick, findCandidates, harvestEntities, type DictEntry } from '../src/core/annotate';
import { project, SEP } from '../src/core/projection';
import { hasScanTags, plainToCtext } from '../src/core/plainText';
import { acceptCandidates } from '../src/editor/annotateCommands';
import { fixHalfWidth } from '../src/editor/punctuation';
import { insertScanBreakAt } from '../src/editor/commands';
import { splitPageAt } from '../src/editor/pageCommands';

const entry = (surface: string, entityid: string, extra: Partial<DictEntry> = {}): DictEntry => ({
  id: `${surface}-${entityid}`,
  surface,
  entityid,
  type: 'place',
  extra: {},
  variants: [],
  source: 'manual',
  ...extra,
});

function apply(src: string, entries: DictEntry[], pick = (_i: number) => true): string {
  const s = EditorState.create({ doc: toDoc(src) });
  const cands = findCandidates(s.doc, entries).filter((_c, i) => pick(i));
  let out = s;
  acceptCandidates(cands, new Map(entries.map((e) => [e.id, e])))(s, (tr) => (out = s.apply(tr)));
  return serialize(out.doc);
}

describe('Aho–Corasick', () => {
  it('finds overlapping matches including astral characters', () => {
    const ac = new AhoCorasick(['緬甸', '緬甸國', '甸國', '𠹵']);
    const m = ac.search('入緬甸國𠹵');
    expect(m.map(([s, e, p]) => [s, e, ac.patterns[p]])).toEqual([
      [1, 3, '緬甸'],
      [1, 4, '緬甸國'],
      [2, 4, '甸國'],
      [4, 6, '𠹵'],
    ]);
  });
});

describe('projection', () => {
  it('is transparent to layout markers, separates blocks and other atoms', () => {
    const pr = project(toDoc('英吉<scanbreak file="1" />利<seq sid="1" />國|甲\n\n乙'));
    expect(pr.text).toBe(`英吉利國${SEP}甲${SEP}乙`);
  });
});

describe('candidates', () => {
  it('matches across a column break and tags around it', () => {
    const out = apply('近日英吉<scanbreak file="1" />利已得', [entry('英吉利', '426869')]);
    expect(out).toBe('近日<entity entityid="426869" type="place">英吉<scanbreak file="1" />利</entity>已得');
  });

  it('skips text that is already tagged', () => {
    const src = '<entity entityid="1" type="place">緬甸</entity>與緬甸';
    const c = findCandidates(toDoc(src), [entry('緬甸', '1')]);
    expect(c).toHaveLength(1);
    expect(c[0].before).toBe('緬甸與');
  });

  it('lists overlapping terms, longest first, and accepts only one of them', () => {
    const entries = [entry('緬甸', '1'), entry('緬甸國', '2')];
    const c = findCandidates(toDoc('緬甸國建都'), entries);
    expect(c.map((x) => x.term)).toEqual(['緬甸國', '緬甸']);
    expect(apply('緬甸國建都', entries)).toBe('<entity entityid="2" type="place">緬甸國</entity>建都');
  });

  it('matches variants and copies extra attributes', () => {
    const out = apply('至暹邏國', [entry('暹羅', '491558', { variants: ['暹邏'], type: 'place', extra: { note: 'x' } })]);
    expect(out).toBe('至<entity entityid="491558" type="place" note="x">暹邏</entity>國');
  });

  it('fingerprint is stable when unrelated text changes elsewhere', () => {
    const a = findCandidates(toDoc('甲乙丙丁戊己庚辛壬癸緬甸與'), [entry('緬甸', '1')])[0].fingerprint;
    const b = findCandidates(toDoc('子丑寅卯甲乙丙丁戊己庚辛壬癸緬甸與'), [entry('緬甸', '1')])[0].fingerprint;
    expect(a).toBe(b);
  });

  it('harvests existing entities (deduplicated)', () => {
    const h = harvestEntities(
      toDoc('<entity entityid="1" type="place">緬<scanbreak file="1" />甸</entity>與<entity entityid="1" type="place">緬甸</entity>{{<entity entityid="9" type="era">萬曆</entity>}}'),
    );
    expect(h).toEqual([
      { surface: '緬甸', entityid: '1', type: 'place', extra: {}, variants: [] },
      { surface: '萬曆', entityid: '9', type: 'era', extra: {}, variants: [] },
    ]);
  });
});

describe('plain text import', () => {
  it('lines → scanbreaks, blank lines → pages', () => {
    expect(hasScanTags('甲乙')).toBe(false);
    const out = plainToCtext('甲乙\n丙丁\n\n戊己\n', { file: '7', startPage: 3, linesAreColumns: true, blankLineIsPage: true });
    expect(out).toBe('<scanbegin file="7" page="3" />甲乙<scanbreak file="7" />丙丁<scanend file="7" page="3" /><scanbegin file="7" page="4" />戊己<scanend file="7" page="4" />\n');
    expect(serialize(toDoc(out))).toBe(out);
  });
  it('single page with paragraphs', () => {
    expect(plainToCtext('甲\n乙\n\n丙', { file: '1', startPage: 1, linesAreColumns: false, blankLineIsPage: false })).toBe(
      '<scanbegin file="1" page="1" />甲\n乙\n\n丙<scanend file="1" page="1" />\n',
    );
  });
});

describe('punctuation fix', () => {
  it('converts half-width punctuation; quotes alternate per block', () => {
    const s = EditorState.create({ doc: toDoc('曰:"甲,乙."又曰\'丙\'\n\n"丁"') });
    let out = s;
    fixHalfWidth()(s, (tr) => (out = s.apply(tr)));
    expect(serialize(out.doc)).toBe('曰：「甲，乙。」又曰『丙』\n\n「丁」');
  });
  it('keeps marks on replaced characters', () => {
    const s = EditorState.create({ doc: toDoc('{{甲,乙}}') });
    let out = s;
    fixHalfWidth()(s, (tr) => (out = s.apply(tr)));
    expect(serialize(out.doc)).toBe('{{甲，乙}}');
  });
});

describe('positioned inserts', () => {
  it('insert scanbreak / split page at a given position', () => {
    const s = EditorState.create({ doc: toDoc('<scanbegin file="1" page="1" />甲乙<scanend file="1" page="1" />') });
    let out = s;
    insertScanBreakAt(3)(s, (tr) => (out = s.apply(tr)));
    expect(serialize(out.doc)).toBe('<scanbegin file="1" page="1" />甲<scanbreak file="1" />乙<scanend file="1" page="1" />');
    splitPageAt(3)(s, (tr) => (out = s.apply(tr)));
    expect(serialize(out.doc)).toContain('甲<scanend file="1" page="1" /><scanbegin file="1" page="2" />乙');
  });
});

const SAMPLES = resolve(import.meta.dirname, '../.work/requirement');
describe.runIf(existsSync(resolve(SAMPLES, 'sea.txt')))('sea.txt', () => {
  it('dictionary harvested from the text finds no untagged occurrence of… itself after full acceptance', () => {
    const src = readFileSync(resolve(SAMPLES, 'sea.txt'), 'utf8');
    const doc = toDoc(src);
    const entries = harvestEntities(doc)
      .filter((e) => e.type === 'place')
      .map((e, i) => ({ ...e, id: String(i), source: 'harvest' as const }));
    expect(entries.length).toBeGreaterThan(5);
    expect(entries.some((e) => e.variants.length > 0)).toBe(true); // several spellings per entity
    const cands = findCandidates(doc, entries);
    // the sample has untagged occurrences of some harvested place names
    expect(cands.length).toBeGreaterThan(0);
    const s = EditorState.create({ doc });
    let out = s;
    acceptCandidates(cands, new Map(entries.map((e) => [e.id, e])))(s, (tr) => (out = s.apply(tr)));
    expect(findCandidates(out.doc, entries)).toEqual([]);
  });
});
