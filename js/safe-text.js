// ── Hidden characters in AI-written text ─────────────────────────────────────
// Model replies are shown to children and teachers as plain text. Invisible characters
// (zero-width spaces, joiners, byte-order marks) and direction overrides can hide or
// visually reorder words, so text containing them is rejected (answers, summaries,
// action reasons) or cleaned (short messages from screenshot import). Pure, tested in Node.

// Bidirectional embeddings/overrides/isolates, zero-width characters, word joiner, BOM,
// and control characters other than tab, newline and carriage return.
const HIDDEN_SOURCE = '[\\u202A-\\u202E\\u2066-\\u2069\\u200B-\\u200F\\u2060-\\u2064\\uFEFF\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]';
const HIDDEN = new RegExp(HIDDEN_SOURCE);
const HIDDEN_ALL = new RegExp(HIDDEN_SOURCE, 'g');

export const hasHiddenCharacters = text => typeof text === 'string' && HIDDEN.test(text);

// Removes hidden characters, folds line breaks into spaces, and shortens to maxLength.
export function cleanShortText(text, maxLength = 300) {
  if (typeof text !== 'string') return '';
  const flat = text.replace(HIDDEN_ALL, '').replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}
