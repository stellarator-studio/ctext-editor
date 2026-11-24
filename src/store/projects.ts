import { db, type Chapter, type FileMapping, type LegacyProject, type Project } from './db';
import { mergeEntries, type DictEntry } from '../core/annotate';

const now = () => new Date().toISOString();
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `p${Date.now()}${Math.random().toString(36).slice(2)}`);

/** Title guess: first heading line ("*…") or the first characters. */
export function guessTitle(text: string): string {
  const plain = text.replace(/<[^>]*>/g, '').replace(/\{+|\}+/g, '');
  const heading = /^\*+([^\n]+)/m.exec(plain)?.[1];
  return (heading ?? plain.trim().slice(0, 12)).trim() || '未命名';
}

export function newProject(title: string): Project {
  const t = now();
  return { id: newId(), title, createdAt: t, updatedAt: t, chapters: [], rejected: [] };
}

export function newChapter(projectId: string, text: string, title = guessTitle(text)): Chapter {
  const t = now();
  return { id: newId(), projectId, title, text, originalText: text, proofread: {}, createdAt: t, updatedAt: t };
}

/** Create a project with its first chapter. */
export async function createProject(text: string, title = guessTitle(text)): Promise<Project> {
  const p = newProject(title);
  const c = newChapter(p.id, text, title);
  await saveChapter(c);
  return saveProject({ ...p, chapters: [c.id] });
}

/**
 * Move the text of a project saved before chapters existed into its first
 * chapter. The chapter id is derived from the project id, so two reads racing
 * (project list and opened project) write the same chapter.
 */
async function migrate(p: LegacyProject): Promise<Project> {
  if (Array.isArray(p.chapters)) return p as Project;
  const { text, originalText, proofread, ...rest } = p;
  const chapters: string[] = [];
  if (typeof text === 'string') {
    const c: Chapter = { ...newChapter(p.id, text, p.title), id: `${p.id}:1`, originalText: originalText ?? text, proofread: proofread ?? {}, createdAt: p.createdAt, updatedAt: p.updatedAt };
    await saveChapter(c);
    chapters.push(c.id);
  }
  const project: Project = { ...rest, chapters };
  await (await db()).put('projects', project);
  return project;
}

export async function listProjects(): Promise<Project[]> {
  const all = await Promise.all((await (await db()).getAll('projects')).map(migrate));
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getProject(id: string): Promise<Project | undefined> {
  const p = await (await db()).get('projects', id);
  return p && migrate(p);
}
export async function saveProject(p: Project): Promise<Project> {
  const saved = { ...p, updatedAt: now() };
  await (await db()).put('projects', saved);
  return saved;
}
export async function deleteProject(id: string) {
  const d = await db();
  for (const c of await d.getAllFromIndex('chapters', 'projectId', id)) await d.delete('chapters', c.id);
  await d.delete('projects', id);
}

/** Chapters of a project in the project's order (chapters missing from the order list are appended). */
export async function listChapters(p: Project): Promise<Chapter[]> {
  const all = await (await db()).getAllFromIndex('chapters', 'projectId', p.id);
  const rank = new Map(p.chapters.map((id, i) => [id, i]));
  return all.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.createdAt.localeCompare(b.createdAt));
}
export async function saveChapter(c: Chapter): Promise<Chapter> {
  const saved = { ...c, updatedAt: now() };
  await (await db()).put('chapters', saved);
  return saved;
}
export async function deleteChapter(id: string) {
  await (await db()).delete('chapters', id);
}

// ---- project files (backup / move between machines) ----

const PROJECT_FORMAT = 'ctext-editor-project';

/** Scan file ids used in a cText text. */
export function fileIdsIn(text: string): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(/<scan(?:begin|end|break|skip)\b[^>]*\bfile="([^"]*)"/g)) ids.add(m[1]);
  return ids;
}

/** File id and page number of the last page marker in a text (to continue numbering in the next chapter). */
export function lastPageOf(text: string): { file: string; page: number } | null {
  let last: { file: string; page: number } | null = null;
  for (const m of text.matchAll(/<scan(?:begin|end)\b([^>]*)>/g)) {
    const file = /\bfile="([^"]*)"/.exec(m[1])?.[1];
    const page = Number(/\bpage="([^"]*)"/.exec(m[1])?.[1]);
    if (file !== undefined && Number.isInteger(page)) last = { file, page };
  }
  return last;
}

/**
 * A project file holds all chapters, plus the image mappings of the file ids
 * they use and the annotation dictionary, so opening it on another machine
 * (or after clearing the browser) restores the whole working setup.
 */
export async function projectFile(p: Project): Promise<Blob> {
  const chapters = await listChapters(p);
  const ids = new Set(chapters.flatMap((c) => [...fileIdsIn(c.text)]));
  const [maps, dict] = await Promise.all([listMappings(), listDictionary()]);
  const data = { format: PROJECT_FORMAT, version: 3, project: p, chapters, mappings: maps.filter((m) => ids.has(m.fileId)), dictionary: dict };
  return new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
}

export async function downloadProject(p: Project) {
  download(await projectFile(p), `${p.title}.ctext-project.json`);
}

export interface ImportResult {
  project: Project;
  mappingsAdded: number;
  /** file ids whose mapping in the file differs from the one already in this browser (kept as is) */
  mappingsKept: string[];
  entriesAdded: number;
  termsAdded: number;
}

type ChapterData = Partial<Chapter> & { text: string };

/** Read a project file (v2: one text; v3: chapters) and store it, together with its image mappings and dictionary. */
export async function importProjectFile(json: string): Promise<ImportResult> {
  const data = JSON.parse(json);
  const src = data?.project as (LegacyProject & { text?: string }) | undefined;
  const chapterData: ChapterData[] = Array.isArray(data?.chapters)
    ? data.chapters.filter((c: ChapterData) => typeof c?.text === 'string')
    : typeof src?.text === 'string'
      ? [{ text: src.text, originalText: src.originalText, proofread: src.proofread, title: src.title }]
      : [];
  if (data?.format !== PROJECT_FORMAT || !src || !chapterData.length) throw new Error('不是 cText Editor 專案檔');

  const exists = await getProject(String(src.id));
  const base = newProject(String(src.title ?? '未命名'));
  const project: Project = {
    ...base,
    rejected: Array.isArray(src.rejected) ? src.rejected : [],
    ...(exists ? { title: `${base.title}（匯入）` } : { id: String(src.id), createdAt: src.createdAt ?? base.createdAt }),
  };
  // chapter ids are always new: the same file may be imported twice
  for (const c of chapterData) {
    const ch: Chapter = {
      ...newChapter(project.id, c.text, c.title ?? project.title),
      originalText: c.originalText ?? c.text,
      proofread: c.proofread ?? {},
    };
    await saveChapter(ch);
    project.chapters.push(ch.id);
  }
  const saved = await saveProject(project);

  let mappingsAdded = 0;
  const mappingsKept: string[] = [];
  const have = new Map((await listMappings()).map((m) => [m.fileId, m]));
  for (const m of validMappings(data.mappings)) {
    const cur = have.get(m.fileId);
    if (!cur) {
      await saveMapping(m);
      mappingsAdded++;
    } else if (cur.template !== m.template || (cur.offset ?? 0) !== (m.offset ?? 0)) mappingsKept.push(m.fileId);
  }

  const { put, removed, added, termsAdded } = mergeEntries(await listDictionary(), validEntries(data.dictionary), (e) => ({ ...e, id: newId(), source: 'import' }));
  for (const e of put) await saveEntry(e);
  for (const id of removed) await deleteEntry(id);
  return { project: saved, mappingsAdded, mappingsKept, entriesAdded: added, termsAdded };
}

// ---- file id → image mappings ----

export async function listMappings(): Promise<FileMapping[]> {
  return (await db()).getAll('fileMappings');
}
export async function saveMapping(m: FileMapping) {
  await (await db()).put('fileMappings', m);
}
export async function deleteMapping(fileId: string) {
  await (await db()).delete('fileMappings', fileId);
}

const MAPPING_FORMAT = 'ctext-editor-file-mappings';
export function mappingsToFile(ms: FileMapping[]): Blob {
  return new Blob([JSON.stringify({ format: MAPPING_FORMAT, version: 1, mappings: ms }, null, 1)], { type: 'application/json' });
}
export function mappingsFromFile(json: string): FileMapping[] {
  const data = JSON.parse(json);
  if (data?.format !== MAPPING_FORMAT || !Array.isArray(data.mappings)) throw new Error('不是圖片對照表檔案');
  return validMappings(data.mappings);
}
function validMappings(ms: unknown): FileMapping[] {
  return Array.isArray(ms) ? ms.filter((m: FileMapping) => typeof m?.fileId === 'string' && typeof m.template === 'string') : [];
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---- annotation dictionary ----

export const newEntryId = newId;

export async function listDictionary(): Promise<DictEntry[]> {
  const all = await (await db()).getAll('dictionary');
  return all.sort((a, b) => a.surface.localeCompare(b.surface, 'zh-Hant') || a.entityid.localeCompare(b.entityid));
}
export async function saveEntry(e: DictEntry) {
  await (await db()).put('dictionary', e);
}
export async function deleteEntry(id: string) {
  await (await db()).delete('dictionary', id);
}

const DICT_FORMAT = 'ctext-editor-dictionary';
export function dictionaryToFile(es: DictEntry[]): Blob {
  return new Blob([JSON.stringify({ format: DICT_FORMAT, version: 1, entries: es }, null, 1)], { type: 'application/json' });
}
export function dictionaryFromFile(json: string): DictEntry[] {
  const data = JSON.parse(json);
  if (data?.format !== DICT_FORMAT || !Array.isArray(data.entries)) throw new Error('不是 annotation 字典檔');
  return validEntries(data.entries);
}
function validEntries(es: unknown): DictEntry[] {
  if (!Array.isArray(es)) return [];
  return es
    .filter((e: DictEntry) => typeof e.surface === 'string' && typeof e.entityid === 'string')
    .map(
      (e: Partial<DictEntry>): DictEntry => ({
        surface: e.surface!,
        entityid: e.entityid!,
        type: e.type || 'place',
        extra: e.extra ?? {},
        variants: Array.isArray(e.variants) ? e.variants : [],
        ...(e.note ? { note: e.note } : {}),
        id: e.id || newId(),
        source: 'import',
      }),
    );
}

/** Add entries to the dictionary, one entry per entity (new spellings are merged into existing entries). */
export async function mergeIntoDictionary(incoming: Omit<DictEntry, 'id' | 'source'>[], source: DictEntry['source']) {
  const r = mergeEntries(await listDictionary(), incoming, (e) => ({ ...e, id: newId(), source }));
  for (const e of r.put) await saveEntry(e);
  for (const id of r.removed) await deleteEntry(id);
  return r;
}
