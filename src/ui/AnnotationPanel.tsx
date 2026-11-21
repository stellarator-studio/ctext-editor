/**
 * Global annotation management (design §5.4):
 * - 候選: occurrences of dictionary terms not yet tagged; accept / reject one by
 *   one or per term. Rejections are remembered per project.
 * - 字典: global term → entity table; add manually, harvest from the text,
 *   edit, import/export.
 */
import { useMemo, useState } from 'preact/hooks';
import { entityKey, findCandidates, harvestEntities, termsOf, withTerms, type Candidate, type DictEntry } from '../core/annotate';
import { dictionary, editorTick, getView, loadDictionary, project, selectRange, updateProject } from '../app/state';
import { acceptCandidates } from '../editor/annotateCommands';
import { deleteEntry, dictionaryFromFile, dictionaryToFile, download, mergeIntoDictionary, saveEntry } from '../store/projects';

const TYPES = ['place', 'person', 'era', 'date', 'work', 'office'];

function parseExtra(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w-]+)\s*=\s*"?([^\s"]*)"?/g)) out[m[1]] = m[2];
  return out;
}
const formatExtra = (e: Record<string, string>) =>
  Object.entries(e)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
const splitTerms = (s: string) => [
  ...new Set(
    s
      .split(/[\s,，、;；]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
];

/** The dictionary entry for an entity (same id, type and attributes), if any. */
export function entryForEntity(e: Pick<DictEntry, 'entityid' | 'type' | 'extra'>): DictEntry | undefined {
  const k = entityKey(e);
  for (const x of dictionary.value.values()) if (entityKey(x) === k) return x;
  return undefined;
}

/** Text currently selected in the editor (plain, without markers). */
export function selectedText(): string {
  const v = getView();
  if (!v || v.state.selection.empty) return '';
  const { from, to } = v.state.selection;
  return v.state.doc.textBetween(from, to, '', '');
}

// ------------------------------------------------------------------ entry form

export function EntryForm({ initial, onDone }: { initial?: Partial<DictEntry>; onDone: () => void }) {
  const [terms, setTerms] = useState(initial?.surface !== undefined ? termsOf({ surface: initial.surface, variants: initial.variants ?? [] }).join('、') : '');
  const [entityid, setEntityid] = useState(initial?.entityid ?? '');
  const [type, setType] = useState(initial?.type ?? 'place');
  const [extra, setExtra] = useState(formatExtra(initial?.extra ?? {}));
  const [note, setNote] = useState(initial?.note ?? '');
  const list = splitTerms(terms);
  const save = async () => {
    const base = { entityid: entityid.trim(), type: type.trim(), extra: parseExtra(extra), ...(note.trim() ? { note: note.trim() } : {}) };
    if (initial?.id) {
      await saveEntry(withTerms({ ...base, id: initial.id, source: initial.source ?? 'manual', surface: '', variants: [] }, list));
      await mergeIntoDictionary([], 'manual'); // the edit may have made it the same entity as another entry
    } else {
      // an entry for this entity may already exist: the terms are added to it
      await mergeIntoDictionary([withTerms({ ...base, surface: '', variants: [] }, list)], 'manual');
    }
    await loadDictionary();
    onDone();
  };
  const addSelection = () => {
    const t = selectedText().trim();
    if (t && !list.includes(t)) setTerms([...list, t].join('、'));
  };
  return (
    <div class="entry-form">
      <div class="row tight">
        <label class="ifield grow" title="同一個 entity 的各種寫法，第一個為主要詞彙；以頓號、逗號或空白分隔">
          <span>詞彙</span>
          <input class="grow" data-field="surface" value={terms} onInput={(e) => setTerms((e.target as HTMLInputElement).value)} placeholder="英吉利、英國、英" />
        </label>
        <button class="small" onClick={addSelection} title="把編輯器中選取的文字加入詞彙">
          ＋選取
        </button>
      </div>
      <div class="row tight">
        <label class="ifield">
          <span>entityid</span>
          <input data-field="dict-entityid" value={entityid} onInput={(e) => setEntityid((e.target as HTMLInputElement).value)} size={8} />
        </label>
        <label class="ifield">
          <span>type</span>
          <input list="dict-types" value={type} onInput={(e) => setType((e.target as HTMLInputElement).value)} size={7} />
          <datalist id="dict-types">
            {TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label class="ifield">
          <span>其他屬性</span>
          <input value={extra} onInput={(e) => setExtra((e.target as HTMLInputElement).value)} placeholder="year=28" size={9} />
        </label>
      </div>
      <div class="row tight">
        <label class="ifield grow">
          <span>備註</span>
          <input value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
        </label>
        <button class="primary" onClick={save} disabled={!list.length || !entityid.trim() || !type.trim()}>
          {initial?.id ? '儲存' : '加入字典'}
        </button>
        <button onClick={onDone}>取消</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ candidates

function Candidates() {
  void editorTick.value;
  const v = getView();
  const doc = v?.state.doc;
  const entries = dictionary.value;
  const rejected = new Set(project.value?.rejected ?? []);
  const [showRejected, setShowRejected] = useState(false);
  const all = useMemo(() => (doc ? findCandidates(doc, [...entries.values()]) : []), [doc, entries]);
  const list = all.filter((c) => showRejected || !rejected.has(c.fingerprint));

  const groups = new Map<string, Candidate[]>();
  for (const c of list) groups.set(c.entryId, [...(groups.get(c.entryId) ?? []), c]);

  const accept = (cs: Candidate[]) => {
    const view = getView();
    if (view) acceptCandidates(cs, entries)(view.state, view.dispatch);
  };
  const reject = (cs: Candidate[], undo = false) => {
    const set = new Set(project.value?.rejected ?? []);
    for (const c of cs) undo ? set.delete(c.fingerprint) : set.add(c.fingerprint);
    updateProject({ rejected: [...set] });
  };

  if (!entries.size) return <p class="muted">字典是空的。請到「字典」新增詞條，或從文本中已有的 entity 收集。</p>;
  const hiddenCount = all.length - all.filter((c) => !rejected.has(c.fingerprint)).length;
  return (
    <div>
      <div class="row spread">
        <span class="muted small" id="candCount">
          {list.length} 個候選・{groups.size} 個詞{hiddenCount ? `・已拒絕 ${hiddenCount}` : ''}
        </span>
        {hiddenCount > 0 && (
          <label class="check small">
            <input type="checkbox" checked={showRejected} onChange={(e) => setShowRejected((e.target as HTMLInputElement).checked)} /> 顯示已拒絕
          </label>
        )}
      </div>
      {list.length === 0 && <p class="muted">沒有未標註的候選。</p>}
      {[...groups].map(([id, cs]) => {
        const e = entries.get(id)!;
        const pending = cs.filter((c) => !rejected.has(c.fingerprint));
        return (
          <section key={id} class="cand-group">
            <header class="row spread tight">
              <span>
                <strong>{termsOf(e).join('、')}</strong>{' '}
                <span class="muted small">
                  {e.type} #{e.entityid} {formatExtra(e.extra)}
                </span>{' '}
                <span class="badge">{cs.length}</span>
              </span>
              <span class="row tight">
                <button onClick={() => accept(pending)} disabled={!pending.length} title="全部標註（重疊者只標第一個）">
                  全部接受
                </button>
                <button onClick={() => reject(pending)} disabled={!pending.length}>
                  全部拒絕
                </button>
              </span>
            </header>
            <ul class="cand-list">
              {cs.map((c) => {
                const isRejected = rejected.has(c.fingerprint);
                return (
                  <li key={`${c.start}:${c.end}:${c.entryId}`} class={isRejected ? 'rejected' : ''}>
                    <button class="link kwic" onClick={() => selectRange(c.from, c.to)} title="在編輯器中選取">
                      <span class="ctx">{c.before}</span>
                      <mark>{c.term}</mark>
                      <span class="ctx">{c.after}</span>
                    </button>
                    {isRejected ? (
                      <button onClick={() => reject([c], true)}>取消拒絕</button>
                    ) : (
                      <>
                        <button class="ok" onClick={() => accept([c])} aria-label="接受" title="接受">
                          ✓
                        </button>
                        <button onClick={() => reject([c])} aria-label="拒絕" title="拒絕">
                          ✗
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ dictionary

function Dictionary() {
  void editorTick.value;
  const entries = [...dictionary.value.values()];
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const [skipDates, setSkipDates] = useState(true);

  const harvest = async () => {
    const doc = getView()?.state.doc;
    if (!doc) return;
    const found = harvestEntities(doc).filter((h) => !skipDates || h.type !== 'date');
    const r = await mergeIntoDictionary(found, 'harvest');
    await loadDictionary();
    setMsg(`從文本收集：新增 ${r.added} 個詞條${r.termsAdded ? `，${r.termsAdded} 個詞彙併入既有詞條` : ''}。`);
  };
  const fold = async () => {
    const r = await mergeIntoDictionary([], 'manual');
    await loadDictionary();
    setMsg(r.removed.length ? `合併了 ${r.removed.length} 個重複詞條。` : '沒有重複的 entity。');
  };

  const shown = entries.filter((e) => !filter || e.surface.includes(filter) || e.variants.some((x) => x.includes(filter)) || e.entityid.includes(filter));
  return (
    <div>
      <div class="row tight">
        <button class="primary" onClick={() => setAdding(true)} disabled={adding}>
          ＋ 新增詞條
        </button>
        <button onClick={harvest} title="把文本中已標註的 entity 加入字典">
          從文本收集
        </button>
        <label class="check small" title="date 類常帶 year 等屬性，同字不同值，預設不收集">
          <input type="checkbox" checked={skipDates} onChange={(e) => setSkipDates((e.target as HTMLInputElement).checked)} /> 略過 date
        </label>
        <button onClick={fold} title="同一個 entity（entityid、type、屬性相同）分在多個詞條時，合併成一筆">
          合併同 entity
        </button>
      </div>
      {adding && <EntryForm initial={{ surface: selectedText() }} onDone={() => setAdding(false)} />}
      {msg && <p class="muted small">{msg}</p>}
      <div class="row tight">
        <input class="grow" placeholder="篩選…" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} aria-label="篩選字典" />
        <span class="muted small">{entries.length} 筆</span>
      </div>
      <table class="ftable dict-table">
        <tbody>
          {shown.map((e) =>
            editing === e.id ? (
              <tr key={e.id}>
                <td colSpan={4}>
                  <EntryForm initial={e} onDone={() => setEditing(null)} />
                </td>
              </tr>
            ) : (
              <tr key={e.id}>
                <td>
                  <strong>{e.surface}</strong>
                  {e.variants.length > 0 && <span class="small">、{e.variants.join('、')}</span>}
                </td>
                <td class="small">
                  {e.type} #{e.entityid}
                  {Object.keys(e.extra).length ? <span class="muted"> {formatExtra(e.extra)}</span> : null}
                </td>
                <td class="small muted">{e.note}</td>
                <td class="nowrap">
                  <button onClick={() => setEditing(e.id)}>編輯</button>
                  <button
                    class="danger"
                    onClick={async () => {
                      if (!confirm(`從字典刪除「${e.surface}」？（不影響已標註的文字）`)) return;
                      await deleteEntry(e.id);
                      await loadDictionary();
                    }}
                  >
                    刪除
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      <div class="row tight">
        <button onClick={() => download(dictionaryToFile(entries), 'ctext-dictionary.json')}>匯出字典</button>
        <label class="button">
          匯入字典…
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={async (ev) => {
              const f = (ev.target as HTMLInputElement).files?.[0];
              if (!f) return;
              try {
                const r = await mergeIntoDictionary(dictionaryFromFile(await f.text()), 'import');
                await loadDictionary();
                setMsg(`匯入：新增 ${r.added} 個詞條${r.termsAdded ? `，${r.termsAdded} 個詞彙併入既有詞條` : ''}。`);
              } catch (x) {
                setMsg(String((x as Error).message));
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}

export function AnnotationPanel() {
  const [tab, setTab] = useState<'cands' | 'dict'>('cands');
  return (
    <div class="annotate pad">
      <div class="seg" role="group" aria-label="標註">
        <button aria-pressed={tab === 'cands'} onClick={() => setTab('cands')}>
          候選
        </button>
        <button aria-pressed={tab === 'dict'} onClick={() => setTab('dict')}>
          字典（{dictionary.value.size}）
        </button>
      </div>
      {tab === 'cands' ? <Candidates /> : <Dictionary />}
    </div>
  );
}
