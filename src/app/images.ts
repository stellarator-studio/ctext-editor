import { expandTemplate } from '../core/imageTemplate';
import { localImages, mappings } from './state';

/** URL of the scan image for (file id, page), or null if no source is configured. */
export function imageUrlFor(file: string, page: string): string | null {
  const n = Number(page);
  if (!Number.isInteger(n)) return null;
  const m = mappings.value.get(file);
  const offset = m?.offset ?? 0;
  const local = localImages.value.get(file);
  if (local?.size) return local.get(n + offset) ?? null;
  if (m?.template) return expandTemplate(m.template, n, offset);
  return null;
}

/** Image number from a file name: the last run of digits ("h0005527_0092.jpg" → 92). */
export function numberFromFilename(name: string): number | null {
  const runs = name.replace(/\.[^.]+$/, '').match(/\d+/g);
  return runs ? Number(runs[runs.length - 1]) : null;
}

/** Use images from a local folder for a file id (kept in memory only). */
export function loadLocalFolder(file: string, files: FileList | File[]) {
  const map = new Map<number, string>();
  for (const f of Array.from(files)) {
    if (!f.type.startsWith('image/')) continue;
    const n = numberFromFilename(f.name);
    if (n !== null && !map.has(n)) map.set(n, URL.createObjectURL(f));
  }
  const next = new Map(localImages.value);
  next.get(file)?.forEach((u) => URL.revokeObjectURL(u));
  next.set(file, map);
  localImages.value = next;
  return map.size;
}

export function clearLocalFolder(file: string) {
  const next = new Map(localImages.value);
  next.get(file)?.forEach((u) => URL.revokeObjectURL(u));
  next.delete(file);
  localImages.value = next;
}
