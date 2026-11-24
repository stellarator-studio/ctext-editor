/**
 * Chapters of the open project. Each chapter is one cText text (one edit
 * box); they share the project's annotation decisions, and the global image
 * mappings and dictionary.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { addChapter, chapter, chapters, moveChapter, removeChapter, renameChapter, switchChapter } from '../app/state';
import { lastPageOf } from '../store/projects';
import { Menu } from './Menu';
import { TextImport } from './TextImport';

function AddChapterDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  // plain text continues the file id and page numbering of the last chapter
  const list = chapters.value;
  const last = list.length ? lastPageOf(list[list.length - 1].text) : null;
  return (
    <dialog ref={ref} class="export add-chapter" onClose={onClose} onCancel={onClose}>
      <header class="row spread">
        <h2>加入章節</h2>
        <button class="link" onClick={onClose} aria-label="關閉">
          ✕
        </button>
      </header>
      <p class="muted small">貼上 cText 中這一章編輯框的文字。章節共用本專案的標註決定，以及圖片對照表與字典。新章節加在最後，可再調整順序。</p>
      <TextImport
        titleLabel="章節標題（可留空，自動取第一個標題）"
        submitLabel="加入並開啟"
        plainDefaults={last ? { file: last.file, startPage: last.page + 1 } : undefined}
        onCancel={onClose}
        onSubmit={async (text, title) => {
          await addChapter(text, title);
          onClose();
        }}
      />
    </dialog>
  );
}

export function ChapterList() {
  const [adding, setAdding] = useState(false);
  const list = chapters.value;
  const cur = chapter.value?.id;
  return (
    <div class="chapters">
      <div class="chapters-head">
        <strong>章節</strong>
        <span class="muted small">{list.length}</span>
        <span class="grow" />
        <button class="small" id="addChapter" onClick={() => setAdding(true)} title="從 cText 貼上另一章的文字">
          ＋ 加入
        </button>
      </div>
      <ol class="chapter-list">
        {list.map((c) => {
          const done = Object.values(c.proofread).filter((s) => s.done).length;
          return (
            <li key={c.id} aria-current={c.id === cur}>
              <button class="chapterlink" onClick={() => void switchChapter(c.id)} title={c.title}>
                <span class="chapter-title">{c.title}</span>
                {done > 0 && <span class="muted small">✔{done}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {adding && <AddChapterDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

/** Title and actions of the current chapter, in the top bar (shown when the project has several chapters). */
export function ChapterControls() {
  const list = chapters.value;
  const c = chapter.value;
  if (!c || list.length < 2) return null;
  const i = list.findIndex((x) => x.id === c.id);
  return (
    <>
      <span class="muted">／</span>
      <input
        class="title-input chapter-input"
        value={c.title}
        aria-label="章節標題"
        onChange={(e) => {
          const t = (e.target as HTMLInputElement).value.trim();
          if (t) renameChapter(c.id, t);
        }}
      />
      <Menu label="章節" title="章節順序、刪除">
        <button disabled={i === 0} onClick={() => moveChapter(c.id, -1)}>
          本章上移
        </button>
        <button disabled={i === list.length - 1} onClick={() => moveChapter(c.id, 1)}>
          本章下移
        </button>
        <button
          class="danger"
          onClick={() => {
            if (confirm(`刪除章節「${c.title}」？此動作無法復原（建議先匯出專案檔）。`)) void removeChapter(c.id);
          }}
        >
          刪除本章
        </button>
      </Menu>
    </>
  );
}
