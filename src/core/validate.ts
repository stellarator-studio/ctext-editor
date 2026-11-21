/**
 * Lint rules for cText documents. Pure function of the document.
 */
import type { Node as PMNode } from 'prosemirror-model';
import type { Page } from './pageIndex';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  from: number;
  to: number;
  severity: Severity;
  message: string;
}

/** Half-width punctuation that cText asks not to use in Chinese texts. */
const HALF_WIDTH = /["',.;:!?]/g;

export function validate(doc: PMNode, pages: Page[]): Diagnostic[] {
  const out: Diagnostic[] = [];

  // --- page numbering, per file id ---
  const lastByFile = new Map<string, { n: number; page: string }>();
  for (const p of pages) {
    const at = p.markerPos ?? p.from;
    if (p.markerPos === null) {
      if (p.chars > 0) out.push({ from: p.from, to: p.to, severity: 'warning', message: '這段文字不在任何頁（scanbegin/scanend）之內' });
      continue;
    }
    if (p.chars === 0 && p.lines.every((l) => l.segs.length === 0)) {
      out.push({ from: at, to: at + 1, severity: 'info', message: `p.${p.page} 是空頁` });
    }
    const n = Number(p.page);
    if (!Number.isInteger(n)) {
      out.push({ from: at, to: at + 1, severity: 'error', message: `頁碼「${p.page}」不是整數` });
      continue;
    }
    const prev = lastByFile.get(p.file);
    if (prev) {
      if (n === prev.n) out.push({ from: at, to: at + 1, severity: 'error', message: `頁碼重複：p.${p.page}（file ${p.file}）` });
      else if (n < prev.n) out.push({ from: at, to: at + 1, severity: 'error', message: `頁碼倒退：p.${prev.page} → p.${p.page}（file ${p.file}）` });
      else if (n > prev.n + 1) out.push({ from: at, to: at + 1, severity: 'info', message: `跳頁：p.${prev.page} → p.${p.page}（原書可能確有缺頁）` });
    }
    lastByFile.set(p.file, { n, page: p.page });
  }

  // --- per-node checks ---
  let pageFile: string | null = null;
  doc.descendants((node, pos) => {
    if (node.isBlock) return true;
    const t = node.type.name;
    if (t === 'pageStart' || t === 'pageBoundary') {
      pageFile = t === 'pageStart' ? node.attrs.file : node.attrs.beginFile;
    } else if ((t === 'scanBreak' || t === 'scanSkip') && pageFile !== null && node.attrs.file !== pageFile) {
      out.push({ from: pos, to: pos + 1, severity: 'warning', message: `${t === 'scanBreak' ? 'scanbreak' : 'scanskip'} 的 file（${node.attrs.file}）與所在頁（${pageFile}）不同` });
    } else if (t === 'tag') {
      const name = String(node.attrs.name);
      if (!/^\/?(picture|character)$/.test(name)) out.push({ from: pos, to: pos + 1, severity: 'warning', message: `未知或未配對的標籤 <${name}>（將原樣保留）` });
    } else if (t === 'text') {
      for (const m of node.text!.matchAll(HALF_WIDTH)) {
        out.push({ from: pos + m.index!, to: pos + m.index! + 1, severity: 'warning', message: `半形標點「${m[0]}」，cText 中文文獻應使用全形` });
      }
    }
    return false;
  });

  const rank: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return out.sort((a, b) => a.from - b.from || rank[a.severity] - rank[b.severity]);
}
