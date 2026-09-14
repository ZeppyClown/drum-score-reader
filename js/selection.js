// ── Bar-range selection ───────────────────────────────────────────────────────
// The selected bars, stored as bar ids on the editor (editor.selection) so an edit
// elsewhere never shifts the selection onto different bars. Selecting is view state:
// it changes neither the revision nor the undo history. Pure, tested in Node.

import { goToBarCommand } from './commands.js';

export const rangeLabel = (from, to) => (from === to ? `bar ${from}` : `bars ${from}–${to}`);

// { fromIndex, toIndex } in reading order, or null when nothing (valid) is selected.
export function resolveSelection(editor) {
  const { selection } = editor;
  if (!selection) return null;
  const a = editor.bars.findIndex(b => b.barId === selection.fromBarId);
  const b = editor.bars.findIndex(bar => bar.barId === selection.toBarId);
  if (a < 0 || b < 0) return null;
  return { fromIndex: Math.min(a, b), toIndex: Math.max(a, b) };
}

// fromBarId === null clears the selection. The first id is the anchor for shift-click.
export const selectBarsCommand = (fromBarId, toBarId = fromBarId) => ({
  label: 'Select bars',
  run: editor => {
    const next = fromBarId ? { fromBarId, toBarId } : null;
    const current = editor.selection ?? null;
    if (current?.fromBarId === next?.fromBarId && current?.toBarId === next?.toBarId) return null;
    return { selection: next };
  },
});

// Click: select that bar and move the cursor there. Shift-click: extend from the anchor.
export const clickBarCommand = (barIndex, extend) => ({
  label: 'Select bars',
  run: editor => {
    const bar = editor.bars[barIndex];
    if (!bar) return null;
    const anchor = extend && resolveSelection(editor) ? editor.selection.fromBarId : bar.barId;
    const moved = goToBarCommand(barIndex).run(editor);
    return { selection: { fromBarId: anchor, toBarId: bar.barId }, ...(moved ?? {}) };
  },
});
