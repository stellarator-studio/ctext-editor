import { useState } from 'preact/hooks';
import { diagnostics, jumpTo } from '../app/state';
import type { Severity } from '../core/validate';

const ICON: Record<Severity, string> = { error: '⛔', warning: '⚠', info: 'ℹ' };

export function IssuesPanel() {
  const [showInfo, setShowInfo] = useState(false);
  const all = diagnostics.value;
  const list = showInfo ? all : all.filter((d) => d.severity !== 'info');
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
      {list.length === 0 ? (
        <p class="muted">沒有問題。</p>
      ) : (
        <ul class="issue-list">
          {list.slice(0, 500).map((d, i) => (
            <li key={i} class={`sev-${d.severity}`}>
              <button class="link" onClick={() => jumpTo(d.from, 'node')}>
                {ICON[d.severity]} {d.message}
              </button>
            </li>
          ))}
          {list.length > 500 && <li class="muted">…另有 {list.length - 500} 項</li>}
        </ul>
      )}
    </div>
  );
}
