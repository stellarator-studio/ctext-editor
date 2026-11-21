import { useEffect, useRef } from 'preact/hooks';
import { currentPage, diagnostics, jumpTo, pages } from '../app/state';
import { pageIndexAt } from '../core/pageIndex';
import { PROOF_ICON, PROOF_LABEL, proofStatus } from '../app/proofread';

export function PageList() {
  const list = pages.value;
  const cur = currentPage.value;
  const ref = useRef<HTMLOListElement>(null);
  const real = list.filter((p) => p.markerPos !== null);
  const done = real.filter((p) => proofStatus(p) === 'done').length;

  // issues per page
  const issues = new Map<number, number>();
  for (const d of diagnostics.value) {
    const idx = pageIndexAt(list, d.from);
    if (d.severity !== 'info') issues.set(idx, (issues.get(idx) ?? 0) + 1);
  }

  useEffect(() => {
    ref.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cur]);

  return (
    <div class="pagelist">
      <div class="pagelist-head">
        <strong>頁面</strong>
        <span class="muted">
          已校對 {done}/{real.length}
        </span>
        <div class="progress" aria-hidden="true">
          <div style={{ width: `${real.length ? (done / real.length) * 100 : 0}%` }} />
        </div>
      </div>
      <ol ref={ref}>
        {list.map((p) => {
          const st = proofStatus(p);
          return (
            <li key={`${p.idx}:${p.key}`} aria-current={p.idx === cur} class={`st-${st}`}>
              <button class="pagelink" onClick={() => jumpTo((p.markerPos ?? p.from) + (p.markerPos !== null ? 1 : 0))} title={PROOF_LABEL[st]}>
                <span class="proof-icon">{p.markerPos === null ? '·' : PROOF_ICON[st]}</span>
                <span class="pnum">{p.markerPos === null ? '（頁外）' : `p.${p.page}`}</span>
                {issues.get(p.idx) ? <span class="badge">{issues.get(p.idx)}</span> : null}
                <span class="muted small">{p.chars}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
