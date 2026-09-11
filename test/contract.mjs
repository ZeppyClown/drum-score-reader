// Test helper (not a test file): read string lists from the Python training
// contract, so the editor and the OMR model cannot silently drift apart.
import fs from 'node:fs';
import assert from 'node:assert/strict';

export function contractList(name) {
  const source = fs.readFileSync(new URL('../ml/omr/training_contract.py', import.meta.url), 'utf8');
  const block = new RegExp(`^${name} = \\[([\\s\\S]*?)\\]`, 'm').exec(source);
  assert.ok(block, `${name} list not found in training_contract.py`);
  return [...block[1].matchAll(/'([a-z0-9_]+)'/g)].map(match => match[1]);
}
