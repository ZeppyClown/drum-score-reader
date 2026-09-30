# Score files, undo, recovery, and exports

[Back to guide index](README.md)

## Editable documents

DrumHub saves human-readable `.drumhub.json` files. The document contains `schemaVersion`, `scoreId`, `revision`, `title`, `tempoBpm`, `meter`, and `bars`. Each bar has a stable `barId`, import provenance, and a list of notes. Each note has an `eventId`, duration, dot flag, optional triplet flag, and drum list.

Stable IDs support references across file operations, selection, and analysis. The revision identifies the score state used to compute an answer. Provenance records whether a bar was entered manually, read locally, or read through OpenAI, plus whether it has been checked and any recognition warnings.

Documents are validated when parsed and again before desktop writes. Validation checks fields, IDs and duplicates, supported drums and durations, triplet grouping, meter, and bar capacity. The format supports up to 2,000 bars. Legacy `{ bars }` documents can be migrated on opening; future schema versions are refused. Non-4/4 documents open view-only.

## File menu

New Score creates an empty document, Open reads a selected file, and Open Recent offers remembered files. Save updates the linked file; Save As chooses a new destination. The usual Cmd/Ctrl shortcuts are registered in the native menu. New and Open first resolve any unsaved changes.

File paths and disk operations stay in Electron's main process. The renderer supplies score documents and requests actions, while native dialogs choose the actual destinations. Saving a different score identity requires Save As rather than silently replacing the file associated with the previous score.

## Undo and redo

Commands describe score changes. Successful changes create history entries, increase the revision, and clear redo history. Undo and redo restore bars, metadata, and cursor, but the revision still increases. This prevents an old answer from becoming apparently current because the editor reused an earlier revision number.

History is capped at 200 entries. The unsaved marker compares the current bars and metadata with the last saved state. Undoing back to that state can clear the marker. Undo in a text field edits the text; outside fields it edits the score.

## Safe writes and conflict handling

Save writes a temporary file, flushes it, and renames it into place. This reduces the risk of a crash leaving a half-written score. If an opened file has changed or disappeared externally, the user can choose Save As, Replace, or Cancel. The implementation checks again before completing replacement.

Autosave runs about one second after an edit and writes a separate recovery copy in the app data folder. It does not overwrite the user's linked score. On startup, the app can offer to restore unsaved work. Restored work remains unsaved until explicitly saved. Closing with unsaved changes offers Save, Don't Save, and Cancel.

## Export formats

| Format | Use | Current behavior |
| --- | --- | --- |
| PDF | Print or share visible notation. | Electron prints the score with print styling, hiding controls and including the title and tempo. |
| MIDI | Move the rhythm into a sequencer or drum instrument. | Format-0 Standard MIDI File, General MIDI percussion channel 10, score tempo and time signature. |
| MusicXML | Move notation into another score application. | MusicXML 4.0 drum part with rhythmic notation derived from the document. |

Exports are available under File → Export. JSON remains the format for reopening the full DrumHub document with its IDs and review provenance. MIDI is an audio-event interchange format: it uses a fixed velocity, and half-open and fully open hi-hat share the same General MIDI note number. An exported file should not be treated as a lossless replacement for the original editable document.

The application's saved tempo is used for exports. A temporary playback practice tempo does not rewrite that metadata. Exporters preserve each bar's time offset even when a manually edited bar is underfilled.

## Source map

See [score-document.js](../../js/score-document.js), [commands.js](../../js/commands.js), [file-ui.js](../../js/file-ui.js), [score-files.cjs](../../desktop/score-files.cjs), [score-session.cjs](../../desktop/score-session.cjs), [score-ipc.cjs](../../desktop/score-ipc.cjs), [export-midi.js](../../js/export-midi.js), and [export-musicxml.js](../../js/export-musicxml.js).
