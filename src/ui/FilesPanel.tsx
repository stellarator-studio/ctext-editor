/**
 * "file id → scan image" mapping table (design §6). The user pastes one example
 * image URL and its page number; the URL template is inferred from it.
 */
import { useState } from 'preact/hooks';
import { expandTemplate, inferTemplates } from '../core/imageTemplate';
import { localImages, loadMappings, mappings, pages } from '../app/state';
import { clearLocalFolder, loadLocalFolder } from '../app/images';
import { deleteMapping, download, mappingsFromFile, mappingsToFile, saveMapping } from '../store/projects';
import type { FileMapping } from '../store/db';

export function MappingForm({ fileId, samplePage, onDone }: { fileId: string; samplePage?: number; onDone?: () => void }) {
  const existing = mappings.value.get(fileId);
  const [exUrl, setExUrl] = useState('');
  const [exPage, setExPage] = useState(samplePage && Number.isFinite(samplePage) ? String(samplePage) : '');
  const [template, setTemplate] = useState(existing?.template ?? '');
  const [offset, setOffset] = useState(String(existing?.offset ?? 0));
  const [label, setLabel] = useState(existing?.label ?? '');
  const [cands, setCands] = useState<string[]>([]);
  const [msg, setMsg] = useState('');

  const infer = () => {
    const c = inferTemplates(exUrl.trim(), Number(exPage) + 0);
    setCands(c);
    if (c.length) {
      setTemplate(c[c.length - 1]);
      setMsg(c.length > 1 ? '網址中有多處數字等於頁碼，請選擇正確的樣板。' : '');
    } else setMsg('網址中找不到這個頁碼，請手動填寫樣板（以 {page} 或 {page:4} 代表頁碼）。');
  };
  const save = async () => {
    const m: FileMapping = { fileId, template: template.trim(), offset: Number(offset) || 0, ...(label.trim() ? { label: label.trim() } : {}) };
    await saveMapping(m);
    await loadMappings();
    onDone?.();
  };
  const preview = template.includes('{page') && samplePage !== undefined && Number.isFinite(samplePage) ? expandTemplate(template, samplePage, Number(offset) || 0) : null;

  return (
    <div class="mapping-form">
      <p class="muted small">
        在 cText 圖書館手動開啟此書任一頁（例如 <code>ctext.org/library.pl?file={fileId}&amp;page=…</code>），複製該頁<strong>圖片</strong>的網址，連同頁碼貼在下面。
      </p>
      <div class="row tight">
        <input class="grow" placeholder="範例圖片網址" value={exUrl} onInput={(e) => setExUrl((e.target as HTMLInputElement).value)} aria-label="範例圖片網址" />
        <input type="number" placeholder="頁碼" value={exPage} onInput={(e) => setExPage((e.target as HTMLInputElement).value)} style={{ width: '6em' }} aria-label="範例頁碼" />
        <button onClick={infer} disabled={!exUrl.trim() || !exPage}>
          推算
        </button>
      </div>
      {cands.length > 1 && (
        <div class="cands">
          {cands.map((c) => (
            <label key={c} class="check small">
              <input type="radio" name={`cand-${fileId}`} checked={template === c} onChange={() => setTemplate(c)} /> <code>{c}</code>
            </label>
          ))}
        </div>
      )}
      {msg && <p class="warn small">{msg}</p>}
      <label class="field">
        <span>網址樣板</span>
        <input data-field="template" value={template} onInput={(e) => setTemplate((e.target as HTMLInputElement).value)} placeholder="https://…_{page:4}.jpg" />
      </label>
      <div class="row tight">
        <label class="ifield">
          <span>頁碼位移</span>
          <input type="number" value={offset} onInput={(e) => setOffset((e.target as HTMLInputElement).value)} style={{ width: '5em' }} />
        </label>
        <label class="ifield grow">
          <span>備註</span>
          <input value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} placeholder="書名、冊次…" />
        </label>
      </div>
      {preview && <p class="muted small">本頁圖片：{preview}</p>}
      <div class="row tight">
        <button class="primary" onClick={save} disabled={!template.includes('{page')}>
          儲存對照
        </button>
        <label class="button" title="使用自己下載的圖片（檔名最後一串數字＝頁碼）；只在本次開啟期間有效">
          改用本地資料夾…
          <input
            type="file"
            hidden
            multiple
            // @ts-expect-error non-standard but widely supported
            webkitdirectory=""
            onChange={(e) => {
              const files = (e.target as HTMLInputElement).files;
              if (files) setMsg(`已載入 ${loadLocalFolder(fileId, files)} 張本地圖片。`);
            }}
          />
        </label>
      </div>
    </div>
  );
}

export function FilesPanel() {
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  // file ids used in this document, with page ranges
  const files = new Map<string, { min: number; max: number; count: number }>();
  for (const p of pages.value) {
    if (p.markerPos === null) continue;
    const n = Number(p.page);
    const f = files.get(p.file) ?? { min: Infinity, max: -Infinity, count: 0 };
    files.set(p.file, { min: Math.min(f.min, n), max: Math.max(f.max, n), count: f.count + 1 });
  }
  const others = [...mappings.value.keys()].filter((k) => !files.has(k));

  return (
    <div class="files pad">
      <p class="muted small">對照表存在這個瀏覽器，所有專案共用。只有在你開啟某頁圖片時才會向圖片網站發出請求。</p>
      <table class="ftable">
        <thead>
          <tr>
            <th>file id</th>
            <th>頁</th>
            <th>圖片來源</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {[...files].map(([id, r]) => {
            const m = mappings.value.get(id);
            const local = localImages.value.get(id);
            return (
              <>
                <tr key={id}>
                  <td>
                    <code>{id}</code>
                  </td>
                  <td class="small">
                    {r.min}–{r.max}（{r.count}）
                  </td>
                  <td class="small break">
                    {local?.size ? `本地資料夾（${local.size} 張）` : m ? <code>{m.template}</code> : <span class="warn">未設定</span>}
                    {m?.offset ? `，位移 ${m.offset}` : ''}
                  </td>
                  <td class="nowrap">
                    <button onClick={() => setEditing(editing === id ? null : id)}>{m ? '編輯' : '設定'}</button>
                    {local?.size ? <button onClick={() => clearLocalFolder(id)}>取消本地</button> : null}
                  </td>
                </tr>
                {editing === id && (
                  <tr key={`${id}-form`}>
                    <td colSpan={4}>
                      <MappingForm fileId={id} samplePage={r.min} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
      {others.length > 0 && (
        <details>
          <summary class="small">其他已儲存的對照（{others.length}）</summary>
          <ul class="small">
            {others.map((id) => (
              <li key={id}>
                <code>{id}</code> {mappings.value.get(id)!.template}{' '}
                <button
                  onClick={async () => {
                    await deleteMapping(id);
                    await loadMappings();
                  }}
                >
                  刪除
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div class="row tight">
        <button onClick={() => download(mappingsToFile([...mappings.value.values()]), 'ctext-file-mappings.json')}>匯出對照表</button>
        <label class="button">
          匯入對照表…
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (!f) return;
              try {
                for (const m of mappingsFromFile(await f.text())) await saveMapping(m);
                await loadMappings();
                setErr('');
              } catch (x) {
                setErr(String((x as Error).message));
              }
            }}
          />
        </label>
      </div>
      {err && <p class="warn">{err}</p>}
    </div>
  );
}
