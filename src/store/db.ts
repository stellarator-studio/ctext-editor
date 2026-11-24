/**
 * Persistence in the browser's IndexedDB. Nothing leaves the user's machine.
 *
 * - projects: a work being proofread: its title, chapter order and the
 *   settings its chapters share (rejected annotation candidates)
 * - chapters: one cText text (a chapter / edit box) of a project, with its
 *   own baseline for the export diff and proofreading state
 * - fileMappings: global table "scan file id → image URL template", shared by
 *   all projects (design §6)
 * - dictionary: global annotation dictionary (term → cText entity), shared by
 *   all projects (design §5.4)
 *
 * If IndexedDB is unavailable (some private windows), falls back to memory and
 * reports `persistent = false` so the UI can warn.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DictEntry } from '../core/annotate';

export interface ProofState {
  done: boolean;
  /** page hash when it was marked done */
  hash: string;
  at: string;
}

export interface Project {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** chapter ids in display order */
  chapters: string[];
  /** annotation candidates the user rejected (fingerprints, see core/annotate); shared by all chapters */
  rejected?: string[];
}

/** Projects saved before chapters existed (database v2) held one text directly. */
export interface LegacyProject extends Omit<Project, 'chapters'> {
  chapters?: string[];
  text?: string;
  originalText?: string;
  proofread?: Record<string, ProofState>;
}

export interface Chapter {
  id: string;
  projectId: string;
  title: string;
  /** current text in cText format (the saved form of the document) */
  text: string;
  /** text as first pasted (or last marked as pasted back), for the export diff */
  originalText: string;
  /** keyed by `${file}:${page}` */
  proofread: Record<string, ProofState>;
  createdAt: string;
  updatedAt: string;
}

export interface FileMapping {
  fileId: string;
  /** e.g. https://library.ctext.org/h0005527/h0005527_{page:4}.jpg */
  template: string;
  /** image number = page + offset */
  offset: number;
  label?: string;
  verifiedPage?: number;
}

interface Schema extends DBSchema {
  projects: { key: string; value: LegacyProject };
  chapters: { key: string; value: Chapter; indexes: { projectId: string } };
  fileMappings: { key: string; value: FileMapping };
  dictionary: { key: string; value: DictEntry };
}

type StoreName = 'projects' | 'chapters' | 'fileMappings' | 'dictionary';
type Store = {
  getAll<K extends StoreName>(store: K): Promise<Schema[K]['value'][]>;
  getAllFromIndex(store: 'chapters', index: 'projectId', key: string): Promise<Chapter[]>;
  get<K extends StoreName>(store: K, key: string): Promise<Schema[K]['value'] | undefined>;
  put<K extends StoreName>(store: K, value: Schema[K]['value']): Promise<unknown>;
  delete(store: StoreName, key: string): Promise<void>;
};

function memoryStore(): Store {
  const data = {
    projects: new Map<string, LegacyProject>(),
    chapters: new Map<string, Chapter>(),
    fileMappings: new Map<string, FileMapping>(),
    dictionary: new Map<string, DictEntry>(),
  };
  const keyOf = (store: StoreName, v: { id?: string; fileId?: string }) => (store === 'fileMappings' ? v.fileId! : v.id!);
  return {
    getAll: async (store) => [...data[store].values()].map((v) => structuredClone(v)) as never,
    getAllFromIndex: async (_s, _i, key) => [...data.chapters.values()].filter((c) => c.projectId === key).map((c) => structuredClone(c)),
    get: async (store, key) => structuredClone(data[store].get(key)) as never,
    put: async (store, value) => void (data[store] as Map<string, unknown>).set(keyOf(store, value as never), structuredClone(value)),
    delete: async (store, key) => void data[store].delete(key),
  };
}

export let persistent = true;
let dbPromise: Promise<Store> | null = null;

export function db(): Promise<Store> {
  // v3: chapters. Old projects are moved into a chapter when first read (store/projects.ts).
  dbPromise ??= openDB<Schema>('ctext-editor', 3, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('fileMappings', { keyPath: 'fileId' });
      }
      if (oldVersion < 2) d.createObjectStore('dictionary', { keyPath: 'id' });
      if (oldVersion < 3) d.createObjectStore('chapters', { keyPath: 'id' }).createIndex('projectId', 'projectId');
    },
  })
    .then((d: IDBPDatabase<Schema>) => d as unknown as Store)
    .catch(() => {
      persistent = false;
      return memoryStore();
    });
  return dbPromise;
}
