import { useEffect } from 'preact/hooks';
import { loadDictionary, loadMappings, project } from '../app/state';
import { getProject } from '../store/projects';
import { Home } from './Home';
import { Workspace } from './Workspace';

/** Open project is reflected in the URL hash (#p=<id>) so a reload reopens it. */
function readHash(): string | null {
  return new URLSearchParams(location.hash.slice(1)).get('p');
}

export function App() {
  useEffect(() => {
    void loadMappings();
    void loadDictionary();
    const open = async () => {
      const id = readHash();
      if (!id) {
        project.value = null;
        return;
      }
      if (project.value?.id === id) return;
      project.value = (await getProject(id)) ?? null;
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
