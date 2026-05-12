// Single source of truth for all mutable app state.
// Import `state` in any module that needs to read or write it.
export const state = {
  bars:       [{ notes: [] }],
  cursor:     { barIndex: 0, position: 1, beat: 0 },
  barsPerRow: 4,
};
