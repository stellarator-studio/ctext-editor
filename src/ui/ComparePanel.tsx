/**
 * Proofreading view for the current page: the text laid out like the original
 * (vertical columns, y = blank character cells, notes as double small lines)
 * next to the scan image.
 */
import { useState } from 'preact/hooks';
import type { Page, Seg } from '../core/pageIndex';
import { currentPage, cursorPos, getView, jumpTo, mappings, pages, showSeq, sideTab } from '../app/state';
import { PROOF_LABEL, proofStatus, setProofread } from '../app/proofread';
import { imageUrlFor } from '../app/images';
import { mergeWithPrevious, shiftPageNumbers } from '../editor/commands';
import { MappingForm } from './FilesPanel';

const NOTE_MARKS = new Set(['note', 'margin']);
const isNote = (s: Seg) => (s.k === 'text' || s.k === 'coll') && s.marks.some((m) => NOTE_MARKS.has(m));
const cells = (s: string) => [...s].length;

/** Column height in character cells (for sizing the page box). */
function lineCells(segs: Seg[]): number {
  let n = 0;
  let note = 0;
  for (const s of segs) {
    if (isNote(s)) {
      note += cells((s as { text: string }).text);
      continue;
    }
    n += Math.ceil(note / 2);
    note = 0;
    if (s.k === 'text' || s.k === 'coll') n += cells(s.text);
    else if (s.k === 'skip') n += s.n;
  }
  return n + Math.ceil(note / 2);
}

function TextSeg({ s }: { s: Extract<Seg, { k: 'text' | 'coll' }> }) {
  const cls = [s.k === 'coll' ? 'v-coll' : '', s.k === 'text' && s.entity ? `v-ent v-ent-${s.entity}` : '', s.marks.includes('big') ? 'v-big' : ''].join(' ').trim();
  return (
    <span data-from={s.from} data-kind={s.k} class={cls || undefined}>
      {s.text}
    </span>
  );
}

function Column({ segs }: { segs: Seg[] }) {
  // group consecutive note segments into one double-line small block
  const out: preact.JSX.Element[] = [];
  let group: Seg[] = [];
  const flush = () => {
    if (!group.length) return;
    const n = group.reduce((a, s) => a + cells((s as { text: string }).text), 0);
    out.push(
      <span class="v-note" style={{ height: `${Math.ceil(n / 2)}em` }} key={`n${out.length}`}>
        {group.map((s, i) => (
          <TextSeg key={i} s={s as Extract<Seg, { k: 'text' | 'coll' }>} />
        ))}
      </span>,
    );
    group = [];
  };
  segs.forEach((s, i) => {
    if (isNote(s)) {
      group.push(s);
      return;
    }
    flush();
    if (s.k === 'skip') out.push(<span key={i} class="v-skip" style={{ height: `${s.n}em` }} />);
    else if (s.k === 'seq') out.push(<span key={i} class="v-seq" title={`seq ${s.sid}`} />);
    else out.push(<TextSeg key={i} s={s} />);
  });
  flush();
  return <>{out}</>;
}

/** Editor position under a click in the vertical text. */
function posFromClick(e: MouseEvent): number | null {
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const c = doc.caretPositionFromPoint(e.clientX, e.clientY);
    if (c) ({ offsetNode: node, offset } = c);
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (r) ({ startContainer: node, startOffset: offset } = r);
  }
  const el = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null))?.closest<HTMLElement>('[data-from]');
  if (!el) return null;
  const from = Number(el.dataset.from);
  return el.dataset.kind === 'text' && node?.nodeType === Node.TEXT_NODE ? from + offset : from;
}

export function PageText({ page }: { page: Page }) {
  const height = Math.max(10, ...page.lines.map((l) => l.y + lineCells(l.segs))) + 1;
  const pos = cursorPos.value;
  let curLine = -1;
  page.lines.forEach((l, i) => {
    if ((l.breakPos ?? l.from) <= pos) curLine = i;
  });
  return (
    <div
      class={`vpage ${showSeq.value ? '' : 'hide-seq'}`}
      style={{ height: `${height}em` }}
      onClick={(e) => {
        const p = posFromClick(e as unknown as MouseEvent);
        if (p !== null) jumpTo(p);
      }}
    >
      {page.lines.map((l, i) => (
        <div key={i} class={`vcol ${i === curLine && pos >= page.from && pos <= page.to ? 'cur' : ''}`} style={{ paddingInlineStart: `${l.y}em` }}>
          <Column segs={l.segs} />
        </div>
      ))}
    </div>
  );
}

function ImagePane({ page }: { page: Page }) {
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState<string | null>(null);
  const url = imageUrlFor(page.file, page.page);
  const mapping = mappings.value.get(page.file);
  if (!url) {
    return (
      <div class="imgpane empty">
        <p>
          <strong>file {page.file}</strong> 尚未設定圖片來源。
        </p>
        <MappingForm fileId={page.file} samplePage={Number(page.page)} />
      </div>
    );
  }
  return (
    <div class="imgpane">
      <div class="row tight">
        <button onClick={() => setZoom(1)} aria-pressed={zoom === 1}>
          適寬
        </button>
        <button onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}>－</button>
        <button onClick={() => setZoom((z) => Math.min(6, z * 1.25))}>＋</button>
        <a class="muted small" href={url} target="_blank" rel="noreferrer noopener">
          開新分頁
        </a>
      </div>
      {failed === url ? (
        <div class="warn">
          圖片載入失敗：{url}
          <br />
          <button onClick={() => (sideTab.value = 'files')}>檢查圖片對照表</button>
        </div>
      ) : null}
      <div class="imgscroll">
        <img
          key={url}
          src={url}
          alt={`原典 p.${page.page}`}
          referrerpolicy="no-referrer"
          style={{ width: `${zoom * 100}%` }}
          onError={() => setFailed(url)}
          onLoad={() => setFailed(null)}
        />
      </div>
      {mapping?.label && <p class="muted small">{mapping.label}</p>}
    </div>
  );
}

export function ComparePanel() {
  const list = pages.value;
  const idx = Math.min(currentPage.value, list.length - 1);
  const page = list[idx];
  if (!page) return <p class="muted pad">沒有內容。</p>;
  const real = page.markerPos !== null;
  const st = proofStatus(page);
  const go = (i: number) => {
    const p = list[i];
    if (p) jumpTo((p.markerPos ?? p.from) + (p.markerPos !== null ? 1 : 0));
  };
  const cmd = (c: ReturnType<typeof shiftPageNumbers>) => {
    const v = getView();
    if (v) c(v.state, v.dispatch);
  };
  return (
    <div class="compare">
      <div class="compare-head">
        <button onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="上一頁">
          ‹
        </button>
        <strong class="pnum-big">{real ? `p.${page.page}` : '（頁外文字）'}</strong>
        <button onClick={() => go(idx + 1)} disabled={idx >= list.length - 1} aria-label="下一頁">
          ›
        </button>
        {real && <span class="muted small">file {page.file}</span>}
        <span class="grow" />
        {real && (
          <label class={`check proof st-${st}`} title={PROOF_LABEL[st]}>
            <input type="checkbox" id="proofCheck" checked={st !== 'none'} onChange={(e) => setProofread(page, (e.target as HTMLInputElement).checked)} />
            {st === 'stale' ? '待重校' : '已校對'}
          </label>
        )}
        {st === 'stale' && (
          <button onClick={() => setProofread(page, true)} title="確認目前內容已校對">
            重新確認
          </button>
        )}
      </div>
      {real && (
        <div class="row tight page-actions">
          <button disabled={page.markerType !== 'pageBoundary'} onClick={() => cmd(mergeWithPrevious(list, idx))} title="刪除本頁開頭的頁界，併入上一頁">
            併入上一頁
          </button>
          <span class="muted small">本頁起頁碼：</span>
          <button onClick={() => cmd(shiftPageNumbers(list, idx, -1))} title="本頁及之後各頁（同 file）頁碼 −1">
            −1
          </button>
          <button onClick={() => cmd(shiftPageNumbers(list, idx, 1))} title="本頁及之後各頁（同 file）頁碼 +1">
            +1
          </button>
        </div>
      )}
      <div class="compare-body">
        <div class="vpage-wrap">
          <PageText page={page} />
        </div>
        {real && <ImagePane page={page} />}
      </div>
    </div>
  );
}
