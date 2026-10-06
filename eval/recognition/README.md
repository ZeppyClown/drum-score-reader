# Recognition benchmark lab

Master plan B5: the same labelled bars go through each recogniser and are scored the same way,
so recogniser choices rest on measured numbers. This is an adult developer tool.

```bash
node eval/recognition/run.mjs --providers local,luna --set synthetic
node eval/recognition/run.mjs --providers local --set heldout
node eval/recognition/run.mjs --providers gemini --set synthetic --concurrency 1 --resume
node eval/recognition/run.mjs --providers openrouter --set synthetic   # every open model in OPEN_MODELS
node eval/recognition/run.mjs --providers openrouter --models qwen/qwen3.8-27b,moonshotai/kimi-k3
npx electron eval/recognition/render-synthetic.cjs     # redraw the synthetic set
```

`openrouter` sends each bar to open-weight models hosted on openrouter.ai, with the same prompt
Luna gets. It needs `OPENROUTER_API_KEY` in the git-ignored `.env`. These are untrained
("out of the box") scores: they pick which model to fine-tune, they are not the final accuracy.

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
| GPT-5.6 Luna (medium) | synthetic | 45 | 28.9% | 87.6 | 70.8 | 86.6% | 6 | 34 s | US$0.15 total |
| GPT-5.6 Luna (low) | synthetic | 45 | 13.3% | 78.9 | 61.8 | 70.8% | 12 | 20 s | US$0.07 total |
| Gemini 3.6 Flash (agy) | synthetic | 45 | 40.0% | 98.8 | 82.6 | 97.8% | 0 | 45 s | Antigravity plan |
| Local `baseline-14drum-v1` | heldout (all) | 1,548 | 16.8% | 85.0 | 54.1 | 92.2% | 0 | 15 ms | free |
| Local `baseline-14drum-v1` | heldout, first 30 (Rush "2112") | 30 | 10.0% | 85.1 | 49.5 | 91.0% | 0 | 15 ms | free |
| GPT-5.6 Luna (high) | heldout, first 30 (Rush "2112") | 30 | 3.3% | 86.6 | 30.4 | 80.6% | 9 | 144 s | US$0.32 total |

What this means:

- **Gemini (adult developer check only) is close to Luna** on DrumHub's own drawing: fewer bars
  exactly right (40% vs 51%) but no refusals, and it's faster. It can never be used in the app
  (plan §2.1), so this only tells us how good another strong model is.
- **Luna's reasoning effort trades speed for accuracy, steeply.** Low is about 4× faster than high
  but gets a quarter as many bars exactly right (13% vs 51%) and gives up on 12 of 45 bars. Medium
  sits in between (29%, 34 s). The app stays on high.
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

## Open models, untrained (2026-10-06)

`--providers openrouter`, reasoning effort low, same prompt as Luna plus one line saying the
image is exactly one complete bar.

| Model | Bars answered | Exact bars (of 45) | Exact among answered | Drum F1 | Time per bar (median) |
|---|---|---|---|---|---|
| GLM 5.3 Flash | 45 | **26.7%** | 27% | 67.0 | 18 s |
| MiMo 2.6 Pro | 18 | 24.4% | 61% | 91.2 | 70 s |
| DeepSeek V4.1 Flash | 45 | 22.2% | 22% | 69.9 | 99 s |
| Qwen 3.8 Flash | 30 | 17.8% | 27% | 70.7 | 59 s |
| DeepSeek V4 Flash Vision (exp) | 21 | 13.3% | 29% | 80.9 | 87 s |
| Gemma 4 31B | 45 | 13.3% | 13% | 62.7 | 16 s |
| Ling 3.0 Flash VL | 32 | 11.1% | 16% | 62.0 | 26 s |
| Qwen 3.5 397B | 10 | 11.1% | 50% | 94.8 | 235 s |
| Muse Glimmer 30B | 44 | 8.9% | 9% | 56.6 | 28 s |
| MiniMax M3 | 18 | 8.9% | 22% | 77.7 | 52 s |
| Qwen 3.6 27B | 17 | 8.9% | 24% | 85.4 | 74 s |
| Step 3.7 Flash | 20 | 8.9% | 20% | 67.0 | 52 s |
| Llama 4 Maverick | 37 | 4.4% | 5% | 42.7 | 24 s |
| ERNIE 4.5 VL 424B | 37 | 2.2% | 3% | 32.7 | 15 s |
| Inkling | 45 | 2.2% | 2% | 39.2 | 7 s |
| Qwen 3.8 27B | 34 | 0% | 0% | 39.0 | 4 s |
| Nex N2.5 Pro | 5 | 0% | 0% | 89.2 | 61 s |
| Mistral Small 4 | 22 | 0% | 0% | 19.8 | 3 s |
| Qwen3-VL 235B | 45 | 0% | 0% | 30.6 | 10 s |
| Qwen3-VL 32B | 45 | 0% | 0% | 26.4 | 7 s |
| Qwen3-VL 8B (untrained) | 45 | 0% | 0% | 11.3 | 7 s |

For comparison on the same 45 bars: GPT-5.6 Luna (high) 51.1%, Gemini 3.6 Flash 40.0%, and
Qwen3-VL 8B after fine-tuning on 3,000 Songsterr-style bars 13.3%.

How to read it:

- **This run is incomplete.** The OpenRouter key hit its US$5 limit part-way, and several
  reasoning models used their whole 12,000-token allowance on one bar without answering, even
  with reasoning set to low. Only the rows with 44-45 bars answered are full measurements. A
  model with few answered bars (MiMo, Qwen 3.5 397B) may rank higher once it is given room.
- **No open model matches Luna out of the box.** The best full measurement is GLM 5.3 Flash at
  26.7%.
- **Untrained score says little about trained score.** Qwen3-VL 8B scores 0% here untrained,
  yet reached 72% on Songsterr bars after fine-tuning on that style.
- Kimi K3 was dropped after 3 bars: about 17 US cents a bar.
- With unlimited reasoning (first attempt) the reasoning models took 5-7 minutes a bar and most
  calls timed out. Those results were discarded.

## A mistake worth remembering

The first Gemini run scored **82% exact bars**, which was wrong. `agy` is an agent that can open
files, and it ran from the project folder, where `synthetic/manifest.json` holds the answers and
image names like `steady-rock-eighths.png` give hints. On the same 10 bars it scored 80% that way
and 50% in isolation. `run.mjs` now copies each image alone, as `bar.png`, into an empty folder
used as agy's working directory. Any recogniser that can read files must be run this way.
