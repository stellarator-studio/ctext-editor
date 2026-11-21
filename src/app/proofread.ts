import type { Page } from '../core/pageIndex';
import { project, updateProject } from './state';

export type ProofStatus = 'none' | 'done' | 'stale';

/** done = marked and unchanged since; stale = marked, then the page's text/layout changed. */
export function proofStatus(p: Page): ProofStatus {
  const s = project.value?.proofread[p.key];
  if (!s?.done) return 'none';
  return s.hash === p.hash ? 'done' : 'stale';
}

export function setProofread(p: Page, done: boolean) {
  const proj = project.value;
  if (!proj || p.markerPos === null) return;
  const proofread = { ...proj.proofread };
  if (done) proofread[p.key] = { done: true, hash: p.hash, at: new Date().toISOString() };
  else delete proofread[p.key];
  updateProject({ proofread });
}

export const PROOF_ICON: Record<ProofStatus, string> = { none: '○', done: '✔', stale: '⚠' };
export const PROOF_LABEL: Record<ProofStatus, string> = { none: '未校對', done: '已校對', stale: '校對後已修改，待重校' };
