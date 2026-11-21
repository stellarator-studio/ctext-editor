import { persistLayout } from '../app/state';

/** Draggable column divider. Arrow keys move it, double-click resets. */
export function Splitter({ label, onDrag, onReset }: { label: string; onDrag: (dx: number) => void; onReset: () => void }) {
  const down = (e: PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    let last = e.clientX;
    const move = (ev: PointerEvent) => {
      onDrag(ev.clientX - last);
      last = ev.clientX;
    };
    const up = () => {
      el.classList.remove('dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      persistLayout();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    e.preventDefault();
  };
  return (
    <div
      class="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title={`${label}（拖曳調整，雙擊還原）`}
      onPointerDown={down}
      onDblClick={() => {
        onReset();
        persistLayout();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        onDrag(e.key === 'ArrowLeft' ? -24 : 24);
        persistLayout();
        e.preventDefault();
      }}
    />
  );
}
