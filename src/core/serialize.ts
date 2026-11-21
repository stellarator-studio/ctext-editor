/**
 * ProseMirror document → cText text.
 *
 * Atoms print their `raw` when present, otherwise text regenerated from attrs.
 * Marks are opened/closed like tags on a stack ordered by schema rank; a mark
 * whose `iid` continues into the next block stays open across '\n\n'.
 */
import type { Mark, Node as PMNode } from 'prosemirror-model';

const OPEN: Record<string, string> = { big: '{', note: '{{', margin: '{{{', inverted: '【', circled: '〖' };
const CLOSE: Record<string, string> = { big: '}', note: '}}', margin: '}}}', inverted: '】', circled: '〗' };

const yAttr = (y: unknown) => (y == null || y === '' ? '' : ` y="${y}"`);

function genEntityOpen(m: Mark): string {
  const extra = Object.entries(m.attrs.extra as Record<string, string>)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return `<entity entityid="${m.attrs.entityid}" type="${m.attrs.type}"${extra}>`;
}

function openMark(m: Mark): string {
  return m.type.name === 'entity' ? (m.attrs.raw ?? genEntityOpen(m)) : OPEN[m.type.name];
}
function closeMark(m: Mark): string {
  return m.type.name === 'entity' ? m.attrs.rawClose : CLOSE[m.type.name];
}

export function atomText(n: PMNode): string {
  const a = n.attrs;
  switch (n.type.name) {
    case 'pageBoundary':
      return (a.rawEnd ?? `<scanend file="${a.endFile}" page="${a.endPage}" />`) + (a.rawBegin ?? `<scanbegin file="${a.beginFile}" page="${a.beginPage}"${yAttr(a.y)} />`);
    default:
      if (a.raw != null) return a.raw;
  }
  switch (n.type.name) {
    case 'pageStart':
      return `<scanbegin file="${a.file}" page="${a.page}"${yAttr(a.y)} />`;
    case 'pageEnd':
      return `<scanend file="${a.file}" page="${a.page}" />`;
    case 'scanBreak':
      return `<scanbreak file="${a.file}"${yAttr(a.y)} />`;
    case 'scanSkip':
      return `<scanskip file="${a.file}"${yAttr(a.y)} />`;
    case 'seq':
      return `<seq sid="${a.sid}" />`;
    case 'lineBreak':
      return '|';
    case 'newline':
      return '\n';
    case 'missing':
      return `●＝${a.desc}＝`;
    case 'collation':
      return a.kind === 'add' ? `［${a.corr}］＝${a.note}＝` : a.kind === 'del' ? `（${a.orig}）＝${a.note}＝` : `（${a.orig}）［${a.corr}］＝${a.note}＝`;
    case 'tag':
      return `<${a.name}>`;
  }
  throw new Error(`cannot serialize node type ${n.type.name}`);
}

type Piece = { k: 'leaf'; node: PMNode } | { k: 'raw'; text: string };

function flatten(doc: PMNode): Piece[] {
  const out: Piece[] = [];
  doc.forEach((block, _o, bi) => {
    if (bi > 0) out.push({ k: 'raw', text: '\n\n' });
    const isHeading = block.type.name === 'heading';
    const stars = isHeading ? '*'.repeat(block.attrs.level) : '';
    const prefix = isHeading ? Math.min(block.attrs.prefix, block.childCount) : -1;
    block.forEach((node, _o2, i) => {
      if (i === prefix) out.push({ k: 'raw', text: stars });
      out.push({ k: 'leaf', node });
    });
    if (prefix === block.childCount) out.push({ k: 'raw', text: stars });
  });
  return out;
}

export function serialize(doc: PMNode): string {
  const pieces = flatten(doc);
  let out = '';
  let stack: readonly Mark[] = [];

  const commonPrefix = (target: readonly Mark[]) => {
    let i = 0;
    while (i < stack.length && i < target.length && stack[i].eq(target[i])) i++;
    return i;
  };
  const closeTo = (keep: number) => {
    for (let i = stack.length - 1; i >= keep; i--) out += closeMark(stack[i]);
    stack = stack.slice(0, keep);
  };
  const nextLeafMarks = (from: number): readonly Mark[] => {
    for (let j = from; j < pieces.length; j++) {
      const p = pieces[j];
      if (p.k === 'leaf') return p.node.marks;
    }
    return [];
  };

  pieces.forEach((p, idx) => {
    if (p.k === 'raw') {
      // Close only the marks that do not continue past this separator.
      closeTo(commonPrefix(nextLeafMarks(idx + 1)));
      out += p.text;
      return;
    }
    const marks = p.node.marks;
    const keep = commonPrefix(marks);
    closeTo(keep);
    for (let i = keep; i < marks.length; i++) out += openMark(marks[i]);
    stack = marks;
    out += p.node.isText ? p.node.text! : atomText(p.node);
  });
  closeTo(0);
  return out + doc.attrs.trailing;
}
