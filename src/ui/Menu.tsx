/** Small dropdown menu for less frequently used actions. Closes after a choice or a click elsewhere. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function Menu({ label, title, children, class: cls = '' }: { label: ComponentChildren; title?: string; children: ComponentChildren; class?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);
  return (
    <details class={`menu ${cls}`} ref={ref}>
      <summary title={title}>{label}</summary>
      <div
        class="menu-list"
        role="menu"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button')) ref.current!.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
