/**
 * Persistence in the browser's IndexedDB. Nothing leaves the user's machine.
 *
 * - projects: one cText text being worked on, plus editor-only metadata
 * - fileMappings: global table "scan file id → image URL template", shared by
 *   all projects (design §6)
 *
 * If IndexedDB is unavailable (some private windows), falls back to memory and
 * reports `persistent = false` so the UI can warn.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface ProofState {
  done: boolean;
  /** page hash when it was marked done */
  hash: string;
  at: string;
}

export interface Project {
  id: string;
  title: string;
  /** current text in cText format (the saved form of the document) */
  text: string;
  /** text as first pasted, for the export diff */
  originalText: string;
  createdAt: string;
  updatedAt: string;
  /** keyed by `${file}:${page}` */
  proofread: Record<string, ProofState>;
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
  projects: { key: string; value: Project };
  fileMappings: { key: string; value: FileMapping };
}

type Store = {
  getAll<K extends 'projects' | 'fileMappings'>(store: K): Promise<Schema[K]['value'][]>;
  get<K extends 'projects' | 'fileMappings'>(store: K, key: string): Promise<Schema[K]['value'] | undefined>;
  put<K extends 'projects' | 'fileMappings'>(store: K, value: Schema[K]['value']): Promise<unknown>;
  delete(store: 'projects' | 'fileMappings', key: string): Promise<void>;
};

function memoryStore(): Store {
  const data = { projects: new Map<string, Project>(), fileMappings: new Map<string, FileMapping>() };
  const keyOf = (store: 'projects' | 'fileMappings', v: Project | FileMapping) => (store === 'projects' ? (v as Project).id : (v as FileMapping).fileId);
  return {
    getAll: async (store) => [...data[store].values()] as never,
    get: async (store, key) => data[store].get(key) as never,
    put: async (store, value) => void (data[store] as Map<string, unknown>).set(keyOf(store, value), structuredClone(value)),
    delete: async (store, key) => void data[store].delete(key),
  };
}

export let persistent = true;
let dbPromise: Promise<Store> | null = null;

export function db(): Promise<Store> {
  dbPromise ??= openDB<Schema>('ctext-editor', 1, {
    upgrade(d) {
      d.createObjectStore('projects', { keyPath: 'id' });
      d.createObjectStore('fileMappings', { keyPath: 'fileId' });
    },
  })
    .then((d: IDBPDatabase<Schema>) => d as unknown as Store)
    .catch(() => {
      persistent = false;
      return memoryStore();
    });
  return dbPromise;
}
