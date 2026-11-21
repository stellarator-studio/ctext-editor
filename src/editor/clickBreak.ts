/**
 * "Click to break" mode for aligning text with the scan: while on, clicking
 * between characters inserts a <scanbreak/> there; Shift+click splits the page.
 * Clicking a marker still selects it (so it can be dragged or deleted).
 */
import { Plugin } from 'prosemirror-state';
import { insertScanBreakAt } from './commands';
import { splitPageAt } from './pageCommands';

export function clickBreak(isOn: () => boolean): Plugin {
  return new Plugin({
    props: {
      handleClick(view, pos, event) {
        if (!isOn() || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey) return false;
        if ((event.target as HTMLElement).closest?.('.ct-atom')) return false;
        if (!view.state.doc.resolve(pos).parent.inlineContent) return false;
        return (event.shiftKey ? splitPageAt(pos) : insertScanBreakAt(pos))(view.state, view.dispatch);
      },
    },
  });
}
