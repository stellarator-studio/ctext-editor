import { useEffect } from 'preact/hooks';
import { loadDictionary, loadMappings, loadProject, project, switchChapter } from '../app/state';
import { getProject } from '../store/projects';
import { Home } from './Home';
import { Workspace } from './Workspace';

/** Open project and chapter are reflected in the URL hash (#p=<id>&c=<chapter id>) so a reload reopens them. */
function readHash(): { p: string | null; c: string | null } {
  const q = new URLSearchParams(location.hash.slice(1));
  return { p: q.get('p'), c: q.get('c') };
}

export function App() {
  useEffect(() => {
    void loadMappings();
    void loadDictionary();
    const open = async () => {
      const { p: id, c } = readHash();
      if (!id) return loadProject(null);
      if (project.value?.id === id) return c ? switchChapter(c) : undefined;
      await loadProject((await getProject(id)) ?? null, c);
    };
    void open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);

  const p = project.value;
  return p ? <Workspace key={p.id} /> : <Home />;
}

export function openProject(id: string | null) {
  location.hash = id ? `p=${encodeURIComponent(id)}` : '';
}
