import { db, type FileMapping, type Project } from './db';

const now = () => new Date().toISOString();
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `p${Date.now()}${Math.random().toString(36).slice(2)}`);

/** Title guess: first heading line ("*…") or the first characters. */
export function guessTitle(text: string): string {
  const plain = text.replace(/<[^>]*>/g, '').replace(/\{+|\}+/g, '');
  const heading = /^\*+([^\n]+)/m.exec(plain)?.[1];
  return (heading ?? plain.trim().slice(0, 12)).trim() || '未命名';
}

export function newProject(text: string, title = guessTitle(text)): Project {
  const t = now();
  return { id: newId(), title, text, originalText: text, createdAt: t, updatedAt: t, proofread: {} };
}

export async function listProjects(): Promise<Project[]> {
  const all = await (await db()).getAll('projects');
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function getProject(id: string) {
  return (await db()).get('projects', id);
}
export async function saveProject(p: Project): Promise<Project> {
  const saved = { ...p, updatedAt: now() };
  await (await db()).put('projects', saved);
  return saved;
}
export async function deleteProject(id: string) {
  await (await db()).delete('projects', id);
}

// ---- project files (backup / move between machines) ----

const PROJECT_FORMAT = 'ctext-editor-project';

export function projectToFile(p: Project): Blob {
  return new Blob([JSON.stringify({ format: PROJECT_FORMAT, version: 1, project: p }, null, 1)], { type: 'application/json' });
}

export async function projectFromFile(json: string): Promise<Project> {
  const data = JSON.parse(json);
  if (data?.format !== PROJECT_FORMAT || typeof data.project?.text !== 'string') throw new Error('不是 cText Editor 專案檔');
  const p = data.project as Project;
  const exists = await getProject(p.id);
  return {
    ...newProject(p.text, p.title),
    originalText: p.originalText ?? p.text,
    proofread: p.proofread ?? {},
    ...(exists ? { title: `${p.title}（匯入）` } : { id: p.id, createdAt: p.createdAt }),
  };
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
  return data.mappings.filter((m: FileMapping) => typeof m.fileId === 'string' && typeof m.template === 'string');
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
