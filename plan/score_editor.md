# Score Editor Plan

## Goal
A desktop app where you import a photo or PDF of drum sheet music, the trained model reads it, and the notes appear on screen in a proper score editor that you can play back, edit, and export.

---

## What already exists
The Electron app (`/drum score reader`) has:
- A working score renderer using VexFlow (draws drum notation on screen)
- A cursor system for navigating and editing notes manually
- A keypad for entering notes by hand
- A basic "Import from Image" button that calls the Claude Vision API

---

## What needs to be built / improved

### Phase 1 — Replace Claude API with trained model
**Goal:** Swap the current Claude Vision API call with the fine-tuned PaliGemma 2 model.

Currently in `main.js`, the import flow calls `https://api.anthropic.com/v1/messages`.
This needs to be replaced with a call to the local PaliGemma 2 model.

Options:
- **Run model locally** — serve PaliGemma 2 as a local HTTP API (Python Flask/FastAPI) and call it from Electron
- **Run model on a server** — host the model and call it remotely

Local is preferred (no internet needed, faster, private).

Steps:
1. Write a Python server (`model_server.py`) that loads the trained model and exposes a `/predict` endpoint
2. Update `main.js` to call `http://localhost:5000/predict` instead of the Anthropic API
3. Update `visionReader.js` if the JSON format changes

---

### Phase 2 — Multi-bar import
**Goal:** Import a full page of notation (multiple bars at once), not just one bar.

Currently the app imports one image → one result. A real drum score page has many bars.

Steps:
1. When a PDF or multi-bar image is imported, slice it into individual bar images
2. Run the model on each bar image
3. Append all resulting bars to `state.bars` in sequence
4. Render the full imported score

---

### Phase 3 — Editing after import
**Goal:** After importing, let the user fix any notes the model got wrong.

The editing system already exists (keyboard + keypad). The gap is:
- After a two-voice import (from the model), the cursor doesn't work on the imported bars
- Need to merge the `topVoice` / `bottomVoice` imported format with the single-voice editable format

Steps:
1. Add a "convert to editable" function that flattens two-voice bars into the single-voice format
2. Make the cursor work on imported bars the same way it works on manually entered bars

---

### Phase 4 — Playback
**Goal:** Play back the drum score as audio so the user can hear what they've entered.

Steps:
1. Use the Web Audio API or a MIDI library to trigger drum sounds
2. Map each `vexKey` to a drum sample (kick, snare, hi-hat WAV files)
3. Add a Play / Stop button to the top bar
4. Highlight the current note as it plays (sync cursor to playback position)

---

### Phase 5 — Export
**Goal:** Export the score as PDF, MIDI, or MusicXML.

Steps:
1. **PDF** — use Electron's `webContents.printToPDF()` to export the SVG score as a PDF
2. **MIDI** — convert `state.bars` to MIDI events using the `midi-writer-js` library
3. **MusicXML** — convert `state.bars` to MusicXML format for use in other notation apps

---

## Tech stack
| Layer | Technology |
|-------|-----------|
| App shell | Electron |
| Score rendering | VexFlow 5 |
| UI | Tailwind CSS + Flowbite |
| Model serving | Python FastAPI (local server) |
| Audio playback | Web Audio API |
| PDF export | Electron printToPDF |

---

## Priority order
1. Phase 1 — model integration (core feature, everything else depends on this)
2. Phase 2 — multi-bar import (makes the app actually usable on real scores)
3. Phase 3 — editing after import (quality of life)
4. Phase 4 — playback (nice to have)
5. Phase 5 — export (nice to have)
