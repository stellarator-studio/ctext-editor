import { useState } from 'preact/hooks';
import { diagnostics, getView, jumpTo } from '../app/state';
import { fixHalfWidth } from '../editor/punctuation';
import type { Severity } from '../core/validate';

const ICON: Record<Severity, string> = { error: '⛔', warning: '⚠', info: 'ℹ' };

export function IssuesPanel() {
  const [showInfo, setShowInfo] = useState(false);
  const all = diagnostics.value;
  const list = showInfo ? all : all.filter((d) => d.severity !== 'info');
  const halfWidth = all.filter((d) => d.fix === 'halfwidth').length;
  const fix = (from?: number, to?: number) => {
    const v = getView();
    if (v) fixHalfWidth(from, to)(v.state, v.dispatch);
  };
  return (
    <div class="issues pad">
      <div class="row spread">
        <span class="muted small">
          {all.filter((d) => d.severity === 'error').length} 錯誤・{all.filter((d) => d.severity === 'warning').length} 警告・{all.filter((d) => d.severity === 'info').length} 提示
        </span>
        <label class="check small">
          <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo((e.target as HTMLInputElement).checked)} /> 顯示提示
        </label>
      </div>
      {halfWidth > 0 && (
        <div class="row tight">
          <button onClick={() => fix()} title="， 。 ； ： ！ ？ 「」 『』">
            全部半形標點轉為全形（{halfWidth}）
          </button>
        </div>
      )}
      {list.length === 0 ? (
        <p class="muted">沒有問題。</p>
      ) : (
        <ul class="issue-list">
          {list.slice(0, 500).map((d, i) => (
            <li key={i} class={`sev-${d.severity}`}>
              <button class="link" onClick={() => jumpTo(d.from, 'node')}>
                {ICON[d.severity]} {d.message}
              </button>
              {d.fix === 'halfwidth' && (
                <button class="small" onClick={() => fix(d.from, d.to)}>
                  修正
                </button>
              )}
            </li>
          ))}
          {list.length > 500 && <li class="muted">…另有 {list.length - 500} 項</li>}
        </ul>
      )}
    </div>
  );
}
