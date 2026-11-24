import { useState } from 'preact/hooks';
import { diagnostics, getView, jumpTo } from '../app/state';
import { fixHalfWidth } from '../editor/punctuation';
import { fixHeadingStars, joinNotes } from '../editor/commands';
import type { Command } from 'prosemirror-state';
import type { Severity } from '../core/validate';

const ICON: Record<Severity, string> = { error: '⛔', warning: '⚠', info: 'ℹ' };

export function IssuesPanel() {
  const [showInfo, setShowInfo] = useState(false);
  const all = diagnostics.value;
  const list = showInfo ? all : all.filter((d) => d.severity !== 'info');
  const halfWidth = all.filter((d) => d.fix === 'halfwidth').length;
  const run = (c: Command) => {
    const v = getView();
    if (v) c(v.state, v.dispatch);
  };
  const fix = (from?: number, to?: number) => run(fixHalfWidth(from, to));
  const joins = all.filter((d) => d.fix === 'joinNotes').length;
  const stars = all.filter((d) => d.fix === 'headingStars');
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
      {(joins > 0 || stars.length > 0) && (
        <div class="row tight">
          {joins > 0 && (
            <button onClick={() => run(joinNotes())} title="{{AB}}{{　}} → {{AB　}}">
              合併所有緊鄰的夾注（{joins}）
            </button>
          )}
          {stars.length > 0 && (
            <button onClick={() => [...stars].reverse().forEach((d) => run(fixHeadingStars(d.from)))} title="<seq/>*標題 → *<seq/>標題">
              修正所有標題記號位置（{stars.length}）
            </button>
          )}
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
              {d.fix && (
                <button
                  class="small"
                  onClick={() => run(d.fix === 'halfwidth' ? fixHalfWidth(d.from, d.to) : d.fix === 'joinNotes' ? joinNotes(d.from) : fixHeadingStars(d.from))}
                >
                  {d.fix === 'joinNotes' ? '合併' : '修正'}
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
