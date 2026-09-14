// Writes the frozen evaluation scores. Run once when a fixture is deliberately changed:
//   node eval/score-agent/make-fixtures.mjs
// Ids come from a counter so the files are identical on every run; results in reports
// are only comparable while these files (and their hashes in the report) stay the same.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { songEditor, counter, groove } from '../../test/fixture-scores.mjs';
import { createEditor, documentOf } from '../../js/commands.js';
import { createMeta, serializeDocument } from '../../js/score-document.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const write = (name, editor) => fs.writeFileSync(path.join(dir, name), serializeDocument(documentOf(editor)));

write('song.drumhub.json', songEditor({ idFactory: counter('song') }));
const ids = counter('long');
write('long-groove.drumhub.json', createEditor({
  meta: { ...createMeta({ idFactory: ids, title: 'Long groove' }), tempoBpm: 120 },
  bars: Array.from({ length: 80 }, () => ({ notes: groove() })),
  idFactory: ids,
}));
console.log(`Wrote fixtures to ${dir}`);
