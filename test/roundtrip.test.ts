import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { lex } from '../src/core/lexer';
import { serialize } from '../src/core/serialize';
import { toDoc } from '../src/core/toDoc';

const rt = (s: string) => serialize(toDoc(s));

function count(doc: PMNode, pred: (n: PMNode) => boolean): number {
  let c = 0;
  doc.descendants((n) => {
    if (pred(n)) c++;
  });
  return c;
}

describe('lexer', () => {
  it('concatenated raw equals input', () => {
    const s = '<scanbegin file="1" page="2" />*a{{b<entity entityid="9" type="place">c</entity>}}|（x）［y］＝z＝\n\n●＝上「髟」下「丐」＝<x>';
    expect(lex(s).map((t) => t.raw).join('')).toBe(s);
  });
});

describe('round-trip: constructed cases', () => {
  const cases: Record<string, string> = {
    'plain': '人之初，性本善。',
    'paragraphs': '甲\n\n乙\n\n丙\n',
    'odd newlines': '甲\n乙\n\n\n丙\n\n\n\n丁',
    'heading after scanbegin': '<scanbegin file="25294" page="2" />*<seq sid="10" />東南洋五{{海岸之國}}<scanbreak file="25294" />\n\n**<seq sid="20" />緬甸',
    'page boundary': '甲<scanend file="1" page="9" /><scanbegin file="1" page="10" y="1" />乙<scanend file="1" page="10" />\n',
    'note across page': '{{甲<scanend file="1" page="3" /><scanbegin file="1" page="4" />乙}}丙',
    'entity across break': '<entity entityid="426869" type="place">英吉利<scanbreak file="25294" /></entity>已得',
    'entity in note': '{{明<entity entityid="136592" type="era">萬曆</entity><entity entityid="136592" type="date" year="28">二十八年</entity>}}',
    'adjacent identical entities': '<entity entityid="1" type="place">甲</entity><entity entityid="1" type="place">甲</entity>',
    'adjacent notes': '{{甲}}{{乙}}',
    'note across paragraph': '{{甲\n\n乙}}丙',
    'big / margin / brackets': '{染於蒼則蒼，}王，{{{王舊作命。改之}}}【指歸】〖指歸〗',
    'collation': '待周（而後不乘馬）＝衍文。＝宮［室］＝據補。＝故（食）［倉］＝據改。＝',
    'missing char': '山林誰問●＝上「髟」下「丐」＝蕭蕭。',
    'line bar': '關關雎鳩、在河之洲。|窈窕淑女、君子好逑。',
    'unmatched': '甲}}乙【丙{{丁</entity>戊<entity entityid="1" type="x">',
    'empty spans': '{{}}<entity entityid="1" type="x"></entity>',
    'unknown tags': '<picture src="a.png" /><character id="x" />甲',
    'spaces': '阿瓦{{國都}}   門額爾  西糜',
  };
  for (const [name, s] of Object.entries(cases)) {
    it(name, () => expect(rt(s)).toBe(s));
  }

  it('builds expected structure', () => {
    const doc = toDoc(cases['heading after scanbegin']);
    expect(doc.child(0).type.name).toBe('heading');
    expect(doc.child(0).attrs).toMatchObject({ level: 1, prefix: 1 });
    expect(doc.child(1).attrs).toMatchObject({ level: 2, prefix: 0 });
    const pb = toDoc(cases['page boundary']);
    expect(count(pb, (n) => n.type.name === 'pageBoundary')).toBe(1);
    expect(count(pb, (n) => n.type.name === 'pageEnd')).toBe(1);
  });
});

// Local-only golden tests on real cText samples (not committed; see .work/).
const SAMPLES = resolve(import.meta.dirname, '../.work/requirement');
describe.runIf(existsSync(resolve(SAMPLES, 'sea.txt')))('round-trip: local cText samples', () => {
  for (const f of ['content.txt', 'sea.txt']) {
    it(f, () => {
      const s = readFileSync(resolve(SAMPLES, f), 'utf8');
      const doc = toDoc(s);
      expect(rt(s)).toBe(s);
      // no tag degraded to a generic atom
      expect(count(doc, (n) => n.type.name === 'tag')).toBe(0);
    });
  }
  it('sea.txt structure', () => {
    const doc = toDoc(readFileSync(resolve(SAMPLES, 'sea.txt'), 'utf8'));
    expect(count(doc, (n) => n.type.name === 'seq')).toBe(350);
    expect(count(doc, (n) => n.type.name === 'pageBoundary')).toBe(45);
    const entities = new Set<number>();
    doc.descendants((n) => n.marks.forEach((m) => m.type.name === 'entity' && entities.add(m.attrs.iid)));
    expect(entities.size).toBe(197);
  });
});
