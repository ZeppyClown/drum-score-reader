# Recognition benchmark lab

Master plan B5: the same labelled bars go through each recogniser and are scored the same way,
so recogniser choices rest on measured numbers. This is an adult developer tool.

```bash
node eval/recognition/run.mjs --providers local,luna --set synthetic
node eval/recognition/run.mjs --providers local --set heldout
node eval/recognition/run.mjs --providers gemini --set synthetic --concurrency 1 --resume
npx electron eval/recognition/render-synthetic.cjs     # redraw the synthetic set
```

Each result is also saved as it arrives, in `reports/.progress-<set>-<provider>.jsonl`
(git-ignored). If a run stops part-way, `--resume` carries on from the last saved bar.
Finished reports go to `reports/` with the commit, set hash, model and settings.

## Sets and data rules

| Set | What it is | Who may see it |
|---|---|---|
| `synthetic` | 45 one-bar images DrumHub drew from its own exercise and fill catalogue, with exact notes (`synthetic/manifest.json`) | local model, Luna, **Gemini** |
| `heldout` | The training test split, **Songsterr bars only** (1,548 bars) | local model, Luna; **never Gemini** |

The Reflow teaching charts are never used here: their file names identify students.
`run.mjs` refuses to send anything but the synthetic set to Gemini (plan §2.1).

## Scores

- **exact bars:** every onset, drum and duration is right.
- **onset F1:** whether notes land on the right 32nd-note slots.
- **drum-hit F1:** each (slot, drum) pair.
- **durations:** the share of matched notes with the right length.
- **errors:** the recogniser gave no bars at all, e.g. Luna asking for a better crop.

## Results (2026-09-15)

| Recogniser | Set | Bars | Exact bars | Onset F1 | Drum F1 | Durations | Errors | Time per bar (median) | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Local `baseline-14drum-v1` | synthetic | 45 | 0% | 67.9 | 22.2 | 83.1% | 0 | 30 ms | free |
| GPT-5.6 Luna (high) | synthetic | 45 | **51.1%** | **97.7** | **84.3** | 97.3% | 1 | 89 s | US$0.43 total |
| Gemini 3.6 Flash (agy) | synthetic | 45 | 40.0% | 98.8 | 82.6 | 97.8% | 0 | 45 s | Antigravity plan |
| Local `baseline-14drum-v1` | heldout (all) | 1,548 | 16.8% | 85.0 | 54.1 | 92.2% | 0 | 15 ms | free |
| Local `baseline-14drum-v1` | heldout, first 30 (Rush "2112") | 30 | 10.0% | 85.1 | 49.5 | 91.0% | 0 | 15 ms | free |
| GPT-5.6 Luna (high) | heldout, first 30 (Rush "2112") | 30 | 3.3% | 86.6 | 30.4 | 80.6% | 9 | 144 s | US$0.32 total |

What this means:

- **Gemini (adult developer check only) is close to Luna** on DrumHub's own drawing: fewer bars
  exactly right (40% vs 51%) but no refusals, and it's faster. It can never be used in the app
  (plan §2.1), so this only tells us how good another strong model is.
- **Luna reads DrumHub-style notation well** (half the bars exactly right, almost every note in
  the right place) but slowly, at about 1.5 minutes per bar.
- **On Songsterr notation Luna is worse than the local model at naming drums** (F1 30 vs 50),
  though it places notes about as well. Luna's prompt describes DrumHub's drum positions (snare on
  the middle line, circle-x = open hi-hat), and Songsterr uses different ones. The prompt needs a
  per-publisher drum key, or should read the chart's legend, before Luna is trusted on imported
  charts. Change the prompt, then rerun this benchmark to see the effect.
- **9 of the 30 held-out crops were refused** because the dataset crops cut off a barline. Luna
  is strict about complete bars, and page import's boxes include the barlines, so real imports
  hit this less often. It still counts as an error here.
- **The local model hardly reads DrumHub's own drawing** (0% exact). It was trained only on
  Reflow and Songsterr images, so a new visual style defeats it. More varied training images
  would fix that.
- The held-out Luna sample is a single song; treat it as a warning sign, not a final number.

## A mistake worth remembering

The first Gemini run scored **82% exact bars**, which was wrong. `agy` is an agent that can open
files, and it ran from the project folder, where `synthetic/manifest.json` holds the answers and
image names like `steady-rock-eighths.png` give hints. On the same 10 bars it scored 80% that way
and 50% in isolation. `run.mjs` now copies each image alone, as `bar.png`, into an empty folder
used as agy's working directory. Any recogniser that can read files must be run this way.
