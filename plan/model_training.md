# Model Training Plan

## Goal
Train PaliGemma 2 to read a drum score image and output the notes as structured JSON.

## Input / Output
- **Input:** Image of a drum score bar (any source — photo, PDF, screenshot)
- **Output:** JSON listing what drum is hit, at what beat, with what duration

Example output:
```json
{
  "bar": 1,
  "beats": [
    { "beat": "1",   "drums": ["hi-hat", "kick"] },
    { "beat": "1.5", "drums": ["hi-hat"] },
    { "beat": "2",   "drums": ["hi-hat", "snare"] },
    { "beat": "4",   "drums": ["hi-hat", "snare"] }
  ]
}
```

---

## Step 1 — Export training data from Reflow
**Status: GP5 done ✅ | PDF done ✅**

For each of the 178 Reflow songs, export:
- **GP5 file** — contains the note data (labels) ✅ saved in `reflow_gp5/`
- **PDF file** — contains the visual image of the score ✅ saved in `reflow_pdf/` (179 files)

Both exported via UI automation scripts (`export_gp5.sh`, `export_pdf.sh`).

---

## Step 2 — Parse GP5 files
**Status: Done ✅**

`process/parse_gp5.py` reads all 178 GP5 files using the `PyGuitarPro` library, finds the drum track, and saves one JSON label per bar to `labels/`.

Result: **6,811 label files** written to `labels/`.

Each label records beat position, duration, and drum names (kick, snare, hi_hat_closed, crash, etc.). Simultaneous hits (e.g. hi-hat + kick) are captured in a single beat's `drums` array.

---

## Step 3 — Slice PDFs into bar images
**Status: Not done**

Write a Python script (`process/slice_pdf.py`) that:
1. Converts each PDF page to a high-resolution image
2. Detects bar lines to cut the page into individual bar images
3. Saves one PNG per bar: `images/songname_bar001.png`
4. Uses bar count from the GP5 parse to verify alignment

---

## Step 4 — Pair images with labels
**Status: Not done**

Write a Python script (`process/pair.py`) that:
1. Matches each `images/songname_barNNN.png` with `labels/songname_barNNN.json`
2. Outputs a single `dataset.jsonl` file — one line per bar:
```json
{"image": "images/song_bar001.png", "label": "{\"bar\":1,\"beats\":[...]}"}
```
3. Splits into 90% train / 10% validation

Upload the `images/` folder and `dataset.jsonl` to Google Drive.

---

## Step 5 — Train PaliGemma 2 on Google Colab
**Status: Not done**

Resources:
- Model: `google/paligemma2-3b-pt-224`
- Compute: 139 Colab hours (A100 preferred)
- Fine-tuning: QLoRA (4-bit quantisation, fits in GPU memory)

The Colab notebook (`plan/colab_notebook.ipynb`) will:
1. Mount Google Drive
2. Load image-label pairs
3. Load PaliGemma 2 with 4-bit quantisation
4. Add LoRA adapters
5. Train for 5 epochs
6. Save the model back to Google Drive

---

## Step 6 — Evaluate
**Status: Not done**

After training:
1. Run inference on the 10% validation set
2. Check exact match accuracy (does the predicted JSON match the label?)
3. Manually test on a real drum score photo (not from Reflow)
4. If accuracy is low, go back to Step 1 and add more data / augmentation

---

## Data summary
| Source | Count | Status |
|--------|-------|--------|
| Reflow songs | 178 | GP5 exported ✅ |
| GP5 parsed bars | TBD | Pending Step 2 |
| Image-label pairs | TBD | Pending Steps 2–4 |

A typical song has 20–80 bars, so we expect roughly **3,000–8,000 training pairs** from the 178 songs.
