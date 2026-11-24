import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { structuralChanges, textHunks } from '../core/changes';
import { toDoc } from '../core/toDoc';
import { chapter, chapters, currentText, exportOpen, getView, updateChapter } from '../app/state';

export function ExportDialog() {
  const p = chapter.value!;
  const text = useMemo(() => currentText(), []);
  const hunks = useMemo(() => textHunks(p.originalText, text), [text]);
  const changes = useMemo(() => structuralChanges(p.originalText, getView()?.state.doc ?? toDoc(text)), [text]);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const close = () => (exportOpen.value = false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      const ta = document.getElementById('exportText') as HTMLTextAreaElement;
      ta.select();
      document.execCommand('copy');
      setCopied(true);
    }
  };

  const summary: string[] = [];
  if (changes.seqMoved.length) summary.push(`seq 位置變動：${changes.seqMoved.length} 個（sid ${changes.seqMoved.slice(0, 10).join(', ')}${changes.seqMoved.length > 10 ? '…' : ''}）`);
  if (changes.pagesAdded.length) summary.push(`新增頁：${changes.pagesAdded.join(', ')}`);
  if (changes.pagesRemoved.length) summary.push(`移除頁：${changes.pagesRemoved.join(', ')}`);
  if (changes.pagesRenumbered) summary.push(`頁碼變動：${changes.pagesRenumbered} 頁`);
  if (changes.breaksChanged.length) summary.push(`換行（scanbreak）數量變動：${changes.breaksChanged.length} 頁`);

  return (
    <dialog ref={ref} class="export" onClose={close} onCancel={close}>
      <header class="row spread">
        <h2>匯出 cText 格式{chapters.value.length > 1 ? `：${p.title}` : ''}</h2>
        <button class="link" onClick={close} aria-label="關閉">
          ✕
        </button>
      </header>
      <p id="exportStatus">{hunks.length === 0 ? '✅ 與原貼入文字逐字相同。' : `與原貼入文字相比有 ${hunks.length} 處修改。`}</p>
      {summary.length > 0 && (
        <div class="struct">
          <strong>結構變動（cText 指南要求在「修改摘要」中說明）：</strong>
          <ul>
            {summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {hunks.length > 0 && (
        <ol class="hunks">
          {hunks.slice(0, 200).map((h, i) => (
            <li key={i}>
              <span class="ctx">…{h.before}</span>
              {h.removed && <del>{h.removed}</del>}
              {h.added && <ins>{h.added}</ins>}
              <span class="ctx">{h.after}…</span>
            </li>
          ))}
          {hunks.length > 200 && <li class="muted">…另有 {hunks.length - 200} 處</li>}
        </ol>
      )}
      <textarea id="exportText" readOnly rows={5} value={text} />
      <div class="row">
        <button class="primary" onClick={copy}>
          {copied ? '已複製 ✓' : '複製到剪貼簿'}
        </button>
        <button
          onClick={() => {
            if (confirm('已把文字貼回 cText 並儲存了嗎？之後的差異會改以目前文字為基準。')) {
              updateChapter({ originalText: text });
              close();
            }
          }}
          disabled={hunks.length === 0}
        >
          已貼回 cText，設為新基準
        </button>
      </div>
    </dialog>
  );
}
