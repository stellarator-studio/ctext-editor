/**
 * Proofreading view for the current page: the text laid out like the original
 * (vertical columns, y = blank character cells, notes as double small lines)
 * next to the scan image.
 */
import { useRef, useState } from 'preact/hooks';
import type { Page, Seg } from '../core/pageIndex';
import { signal } from '@preact/signals';
import { compareTextWidth, currentPage, cursorPos, getView, jumpTo, mappings, pages, showSeq, sideTab } from '../app/state';
import { textRuns, stripPunct } from '../core/punct';
import { columnCells, isSpace, layoutPage, noteLength, spaceRuns, type ColumnItem, type NoteCell } from '../core/columnLayout';
import { PROOF_LABEL, proofStatus, setProofread } from '../app/proofread';
import { imageUrlFor } from '../app/images';
import { mergeWithPrevious, setLineY, shiftPageNumbers } from '../editor/commands';
import { MappingForm } from './FilesPanel';
import { Menu } from './Menu';
import { Splitter } from './Splitter';

/** Show punctuation in the page view (off: the layout matches the unpunctuated original). */
export const showPunct = signal(false);

/**
 * Drop punctuation from text segments, splitting them into runs that keep
 * their own document position (so clicking a character still maps correctly).
 */
function visibleSegs(segs: Seg[], keepPunct: boolean): Seg[] {
  if (keepPunct) return segs;
  const out: Seg[] = [];
  for (const s of segs) {
    if (s.k === 'text') for (const r of textRuns(s.text)) out.push({ ...s, text: r.text, from: s.from + r.offset });
    else if (s.k === 'coll') {
      const text = stripPunct(s.text);
      if (text) out.push({ ...s, text });
    } else out.push(s);
  }
  return out;
}

function segClass(s: Extract<Seg, { k: 'text' | 'coll' }>) {
  return [s.k === 'coll' ? 'v-coll' : '', s.k === 'text' && s.entity ? `v-ent v-ent-${s.entity}` : '', s.marks.includes('big') ? 'v-big' : ''].join(' ').trim();
}

const SPACE_TITLE: Record<string, string> = { ' ': '半形空格', '\u3000': '全形空格' };

/** Text run; spaces are drawn as visible cells so padding can be checked. */
function TextSeg({ s }: { s: Extract<Seg, { k: 'text' | 'coll' }> }) {
  const cls = segClass(s) || undefined;
  if (s.k === 'coll') {
    return (
      <span data-from={s.from} data-kind="coll" class={cls}>
        {s.text}
      </span>
    );
  }
  return (
    <>
      {spaceRuns(s.text).map((r) =>
        r.space ? (
          [...r.text].map((ch, i) => (
            <span key={`${r.offset + i}`} data-from={s.from + r.offset + i} data-kind="text" class={`v-sp ${ch === ' ' ? 'half' : ''} ${cls ?? ''}`} title={SPACE_TITLE[ch]}>
              {ch}
            </span>
          ))
        ) : (
          <span key={r.offset} data-from={s.from + r.offset} data-kind="text" class={cls}>
            {r.text}
          </span>
        ),
      )}
    </>
  );
}

function NoteLine({ cells }: { cells: NoteCell[] }) {
  return (
    <span class="v-nl">
      {cells.map((c, i) =>
        'sid' in c ? (
          <span key={i} class="v-seq" title={`seq ${c.sid}`} />
        ) : 'blank' in c ? (
          <span key={i} data-from={c.pos} data-kind="skip" class="v-blank" title="scanskip（夾注內的空白格）">
            {'\u3000'}
          </span>
        ) : (
          <span
            key={i}
            data-from={c.pos}
            data-kind={c.seg.k === 'text' ? 'text' : 'coll'}
            class={[segClass(c.seg), isSpace(c.ch) ? `v-sp ${c.ch === ' ' ? 'half' : ''}` : ''].join(' ').trim() || undefined}
            title={SPACE_TITLE[c.ch]}
          >
            {c.ch}
          </span>
        ),
      )}
    </span>
  );
}

function Column({ items }: { items: ColumnItem[] }) {
  return (
    <>
      {items.map((it, i) => {
        if (it.k === 'note') {
          const len = (l: NoteCell[]) => l.filter((c) => !('sid' in c)).length;
          const [a, b] = [len(it.lines[0]), len(it.lines[1])];
          const how = it.explicit ? '（夾注內的 scanbreak 分行）' : '';
          return (
            <span key={i} class={`v-note ${it.explicit ? 'split' : ''}`} style={{ height: `${Math.max(noteLength(it), 1)}em` }} title={`夾注 ${it.cells} 字格：第一行 ${a}、第二行 ${b}${how}`}>
              <NoteLine cells={it.lines[0]} />
              <NoteLine cells={it.lines[1]} />
            </span>
          );
        }
        const s = it.seg;
        if (s.k === 'skip') return <span key={i} class="v-skip" style={{ height: `${s.n}em` }} title={`scanskip ${s.n}`} />;
        if (s.k === 'seq') return <span key={i} class="v-seq" title={`seq ${s.sid}`} />;
        return <TextSeg key={i} s={s} />;
      })}
    </>
  );
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

/** Physical columns of a page (a note split by a scanbreak may join two source lines). */
const pageColumns = (page: Page, keepPunct = true) => layoutPage(page.lines, (segs) => visibleSegs(segs, keepPunct));

/**
 * Column of the page that holds the editor cursor (as the index of its first
 * source line), or -1 if the cursor is on another page.
 */
export function cursorLine(page: Page, pos: number): number {
  const line = sourceLineAt(page, pos);
  if (line < 0) return line;
  return pageColumns(page).find((c) => c.lines.includes(line))?.lines[0] ?? line;
}

function sourceLineAt(page: Page, pos: number): number {
  if (pos < (page.markerPos ?? page.from) || pos > page.to) return -1;
  let cur = 0;
  page.lines.forEach((l, i) => {
    if (i > 0 && l.from <= pos) cur = i;
  });
  return cur;
}

/** The marker that holds a column's y (its scanbreak, or the page marker for the first column). */
const yMarker = (page: Page, line: number) => (line === 0 ? page.markerPos : page.lines[line]?.breakPos ?? null);

function runCmd(c: ReturnType<typeof setLineY>) {
  const v = getView();
  if (v) c(v.state, v.dispatch);
}

export function PageText({ page }: { page: Page }) {
  const keep = showPunct.value;
  const cols = pageColumns(page, keep);
  const height = Math.max(10, ...cols.map((c) => c.y + columnCells(c.items))) + 1;
  const curLine = cursorLine(page, cursorPos.value);
  const curCol = cols.findIndex((c) => c.lines[0] === curLine);
  const goCol = (i: number) => {
    const l = cols[i] && page.lines[cols[i].lines[0]];
    if (l) jumpTo(l.from, 'cursor', false);
  };
  const setY = (d: number) => {
    if (curLine < 0 || yMarker(page, curLine) === null) return;
    runCmd(setLineY(page, curLine, Math.max(0, page.lines[curLine].y + d)));
  };
  return (
    <div
      class={`vpage ${showSeq.value ? '' : 'hide-seq'}`}
      // explicit size: an auto-sized vertical box is not re-measured reliably when the page changes
      style={{ height: `${height}em`, width: `calc(${cols.length} * (1.55em + 3px) + 0.8em)` }}
      tabIndex={0}
      aria-label="原典版面：點選一列後，↑↓ 調整該列開頭空格（y），←→ 換列"
      onClick={(e) => {
        const p = posFromClick(e as unknown as MouseEvent);
        if (p !== null) jumpTo(p, 'cursor', false);
        (e.currentTarget as HTMLElement).focus();
      }}
      onKeyDown={(e) => {
        const k = e.key;
        if (k === 'ArrowDown' || k === 'ArrowUp') setY(k === 'ArrowDown' ? 1 : -1);
        else if (k === 'ArrowLeft' || k === 'ArrowRight') goCol(Math.max(0, curCol) + (k === 'ArrowLeft' ? 1 : -1));
        else if (k === 'Enter') getView()?.focus();
        else return;
        e.preventDefault();
      }}
    >
      {cols.map((c, i) => (
        <div key={i} class={`vcol ${i === curCol ? 'cur' : ''}`} style={{ paddingInlineStart: `${c.y}em` }}>
          <Column items={c.items} />
        </div>
      ))}
    </div>
  );
}

/** y of the selected column, adjustable here and with ↑↓ in the page view; the editor updates with it. */
function LineControl({ page }: { page: Page }) {
  const line = cursorLine(page, cursorPos.value);
  if (line < 0) return <span class="muted small linectl">點選一列可調整空格</span>;
  const cols = pageColumns(page);
  const col = cols.findIndex((c) => c.lines[0] === line);
  const can = yMarker(page, line) !== null;
  const y = page.lines[line].y;
  const set = (n: number) => runCmd(setLineY(page, line, Math.max(0, n)));
  return (
    <span class="linectl row tight" title={line === 0 ? '本頁第一列：調整 scanbegin 的 y' : '調整這一列開頭 scanbreak 的 y'}>
      <span class="small">
        第 {col + 1}/{cols.length} 列 空格
      </span>
      <button onClick={() => set(y - 1)} disabled={!can || y === 0} aria-label="空格減一">
        −
      </button>
      <input
        id="lineY"
        type="number"
        min={0}
        value={y}
        disabled={!can}
        style={{ width: '3.5em' }}
        aria-label="本列空格（y）"
        onChange={(e) => set(Number((e.target as HTMLInputElement).value) || 0)}
      />
      <button onClick={() => set(y + 1)} disabled={!can} aria-label="空格加一">
        ＋
      </button>
    </span>
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
        <span class="muted small">{Math.round(zoom * 100)}%・拖曳平移・Ctrl+滾輪縮放</span>
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
      <div
        class="imgscroll grab"
        onPointerDown={(e) => {
          // drag to pan
          if (e.button !== 0) return;
          const el = e.currentTarget as HTMLElement;
          el.setPointerCapture(e.pointerId);
          el.classList.add('grabbing');
          const sx = e.clientX;
          const sy = e.clientY;
          const sl = el.scrollLeft;
          const st = el.scrollTop;
          const move = (ev: PointerEvent) => {
            el.scrollLeft = sl - (ev.clientX - sx);
            el.scrollTop = st - (ev.clientY - sy);
          };
          const up = () => {
            el.classList.remove('grabbing');
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
          };
          el.addEventListener('pointermove', move);
          el.addEventListener('pointerup', up);
          e.preventDefault();
        }}
        onWheel={(e) => {
          // Ctrl/⌘ + wheel zooms
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          setZoom((z) => Math.min(6, Math.max(0.5, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))));
        }}
      >
        <img
          draggable={false}
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
        <label class="check small" title="標點是電子化時加的，原書沒有；預設隱藏以便和影像逐字對照">
          <input type="checkbox" id="showPunct" checked={showPunct.value} onChange={(e) => (showPunct.value = (e.target as HTMLInputElement).checked)} /> 標點
        </label>
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
          <LineControl page={page} />
          <span class="grow" />
          <Menu label="頁碼" title="合併頁面、調整頁碼（較少用）" class="align-right">
            <button disabled={page.markerType !== 'pageBoundary'} onClick={() => cmd(mergeWithPrevious(list, idx))} title="刪除本頁開頭的頁界，併入上一頁">
              併入上一頁
            </button>
            <button onClick={() => cmd(shiftPageNumbers(list, idx, -1))} title="本頁及之後各頁（同 file）頁碼 −1">
              本頁起頁碼 −1
            </button>
            <button onClick={() => cmd(shiftPageNumbers(list, idx, 1))} title="本頁及之後各頁（同 file）頁碼 +1">
              本頁起頁碼 +1
            </button>
            <button
              onClick={() => {
                const n = prompt(`本頁（p.${page.page}）起，頁碼改為從幾開始？之後各頁（同 file）依序位移，保留缺頁。`, page.page);
                const delta = Number(n) - Number(page.page);
                if (n !== null && Number.isInteger(Number(n)) && delta) cmd(shiftPageNumbers(list, idx, delta));
              }}
              title="指定本頁頁碼，之後各頁同步位移"
            >
              設定本頁頁碼…
            </button>
          </Menu>
        </div>
      )}
      <CompareBody page={page} real={real} />
    </div>
  );
}

function CompareBody({ page, real }: { page: Page; real: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const w = compareTextWidth.value;
  const drag = (dx: number) => {
    const total = body.current?.clientWidth ?? 600;
    const cur = w || body.current?.querySelector<HTMLElement>('.vpage-wrap')?.offsetWidth || total / 2;
    compareTextWidth.value = Math.round(Math.min(Math.max(cur + dx, 80), total - 120));
  };
  return (
    <div class="compare-body" ref={body}>
      <div class="vpage-wrap" style={w ? { flex: `0 0 ${w}px`, maxWidth: 'none' } : undefined}>
        <PageText page={page} />
      </div>
      {real && (
        <>
          <Splitter label="原典文字與圖片分隔線" onDrag={drag} onReset={() => (compareTextWidth.value = 0)} />
          <ImagePane page={page} />
        </>
      )}
    </div>
  );
}
