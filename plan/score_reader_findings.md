# Score reader: findings so far

Last updated 2026-10-06. Goal: read drum notation from a picture as accurately as possible.
Cost is not the constraint; accuracy is.

## 1. The short version

- The old reader (MobileNetV3) gets about 13% of bars right. It is being replaced.
- Qwen3-VL 8B, **after we trained it on our own bars**, got 72% right on bars in the style it
  was trained on, but only 13% on bars drawn by DrumHub itself.
- 21 open models were then tested **without any training**. The best fully measured one is
  GLM 5.3 Flash at 27%. None matches GPT-5.6 Luna (51%) out of the box.
- Untrained scores do not predict trained scores: Qwen3-VL 8B scores 0% untrained and 72%
  trained. The winner has to be chosen by training the finalists and comparing.

## 2. Two different tests (do not mix them up)

| | Test A: trained model | Test B: untrained models |
|---|---|---|
| What was tested | One model, Qwen3-VL 8B, after training | 21 open models as downloaded |
| Where it ran | Google Colab notebook (free T4 GPU) | openrouter.ai, a paid hosting service |
| Bars used to score | 312 Songsterr-style bars from 25 songs kept out of training | 45 bars drawn by DrumHub |
| Result | 72.4% | best 26.7% |

The two numbers are on different pictures, so 72% and 27% cannot be compared directly. The
only number that links them: the trained Qwen 8B scores 13.3% on the same 45 DrumHub bars.

## 3. Test A: what the Colab notebook did (the 72%)

Yes, the 72% is Qwen. The notebook is `ml/notebooks/Qwen OMR Fine-tune.ipynb`.

1. **Downloaded Qwen3-VL 8B**, an open model from Alibaba that can look at pictures and write
   text. Out of the box it cannot read drum notation (0% in Test B).
2. **Showed it 3,000 of our bars**, each as a pair: the picture of the bar, and the correct
   notes written as text, for example `0:eighth:hi_hat_closed+kick 4:eighth:snare`
   (position in the bar : note length : drums hit).
3. **Trained it to write that text when shown the picture.** It went through the 3,000 bars
   twice, which took 133 minutes. Only a small add-on to the model is trained (called LoRA);
   the original model stays untouched. That add-on is what was saved to Google Drive.
4. **Tested it on 312 bars it had never seen**, from 25 songs that were kept out of training.
   It wrote the notes for each picture and the notebook compared them with the right answer.

Results:

| Reader | Songsterr-style bars (312, unseen) | DrumHub-drawn bars (45) |
|---|---|---|
| Old MobileNetV3 | 12.8% | 0% |
| Qwen3-VL 8B, trained | **72.4%** | 13.3% |

- About 14 seconds per bar on the free Colab GPU.
- It is not just memorising: 36% of test bars have the same notes as some training bar, and
  the model also reads bars whose note pattern it has never seen.
- The weakness: it only learned one drawing style. DrumHub draws the kick lower, the hi-hat
  on the top line and the stems upward, so the trained model misreads DrumHub's own bars.
  Printed drum books will be a third style again.
- Only 3,000 of the 15,839 training bars were used, on the smallest Qwen3-VL. Both leave room
  to improve.

## 3a. What the trained Qwen got wrong (all 86 missed bars, analysed 2026-10-06)

Source: `eval_results.json` from the training run (312 bars scored, 226 right, 86 wrong).

**1. Some of the "misses" are the answer key being wrong, not the model.**

- One test song, "I Wish It Would Rain Down" (Songsterr), is labelled as empty bars although
  the pictures show a full groove. The model read the groove and was marked wrong 12 times.
- Without that song the score is 226 of 300 = **75.3%**, not 72.4%.
- The same fault is in the training data: 341 training bars from three Songsterr songs
  ("Seek & Destroy", "King Of Pain", "Best Of You") are labelled empty but show notes. In the
  full test set it is 68 bars, all from the Phil Collins song. These were found by a rough
  ink check, so the true count may differ a little. They teach the model wrong answers and
  should be removed or re-labelled before the next training run.

**2. What kind of mistake** (a bar can have more than one):

| Mistake | Bars |
|---|---|
| Wrong drum, right timing | 52 |
| Extra notes (22 of them are "empty" bars, see 1 and 4) | 30 |
| Wrong note length | 19 |
| Right number of notes, wrong position | 12 |
| Notes missing | 8 |
| Unreadable answer | 2 |

**3. Toms are the main real weakness.**

| Bars containing | Right | |
|---|---|---|
| Any tom | 8 of 36 | 22% |
| No toms | 218 of 276 | 79% |

Per drum, how often each note was found: floor tom 2: 0 of 45. Mid tom: 11 of 59. Floor tom 1:
29 of 54. High tom: 18 of 25. Crash: 142 of 180. Everything else (kick, snare, hi-hats, ride):
89-100%. The toms are read as the snare or as a neighbouring tom: they sit one line or space
apart. Only 83 of the 3,000 training bars contained floor tom 2 (415 exist in the full set).

**4. Other weak spots**

- 32nd notes: 0 of 10 bars right; usually read as 16ths. 63 of the 3,000 training bars had them.
- Empty bars cropped as a narrow sliver: about 10 misses, the model invents one note.
- Crash in Victor's Reflow charts: 10 of 31 bars right, against 38 of 56 in Songsterr charts.
  In the one bar looked at, Reflow's circled-x crash was read as a half-open hi-hat. Likely
  the two sources draw this differently; not confirmed.
- Reflow bars overall 67% (61 of 91), Songsterr 75% (165 of 221).

**5. Memorising or reading?**

| Bar's note pattern | Right |
|---|---|
| Same pattern was in the 3,000 training bars | 64 of 66 (97%) |
| Pattern never seen in training | 141 of 204 (69%) |
| Empty bars | 21 of 42 (50%, see 1 and 4) |

It does read new patterns (69%), but it is clearly better on ones it has seen. More training
bars should narrow that gap.

**What to fix before the next training run**

1. Remove or re-label the wrongly labelled "empty" songs (training and test).
2. Train on all bars, or at least make sure tom-heavy and 32nd-note bars are well represented.
3. Check how each source draws the crash and half-open hi-hat.
4. Look at the narrow empty-bar crops: drop them or widen the crop.

## 3b. Label audit of all 19,942 bars (2026-10-06)

A program counted the note stems in every picture and compared the count with the number of
notes in the label. It only catches a wrong **number** of notes. It cannot catch a wrong drum
or a wrong note length.

**Removed: six whole Songsterr songs, 721 bars.** Their labels come from a different track
than the one drawn (pictures show grooves, labels say empty, or the reverse). 48-98% of their
bars disagree with the label; every other song is under 8%.

| Song | Bars | Was in |
|---|---|---|
| Seek & Destroy (Metallica) | 257 | training |
| Best Of You (Foo Fighters) | 137 | training |
| King Of Pain (The Police) | 132 | training |
| 21 Guns (Green Day) | 88 | training |
| I Wish It Would Rain Down (Phil Collins) | 86 | test |
| On My Way (Phil Collins) | 21 | validation |

Now: 15,225 training, 1,898 validation, 2,098 test bars. The list is `ml/omr/excluded_bars.txt`;
`prepare_finetune.py` skips anything on it. Pictures and labels are not deleted. The test
set changed, so new scores are not exactly comparable with the 72.4% and MobileNet's 12.5%.
`finetune.zip` has not been rebuilt yet.

**For Victor to check: 243 single bars**, in `ml/data/finetune/label_review.html` (tick a bar to remove it,
or retype its notes, then press Download my changes). 72 Songsterr, 171 Reflow. Many will be fine.

Seen in the Reflow samples:

- Grace notes, ruffs and flams are drawn but are not in the label (the label format has no
  grace notes).
- At least one bar ("Respect", bar 24) has a hi-hat line in the picture and only kick and
  snare in the label.
- In Reflow a circled x is a half-open hi-hat, and a crash is the same sign one step higher
  with a small line through it. That explains the crash misreads.

## 3c. A third drawing style from MuseScore (2026-10-06)

MuseScore can draw a Songsterr chart as a drums-only PDF that looks like a printed book.
184 of 200 charts converted (787 pages), in `ml/data/songsterr_musescore/pdf/`. 16 will not
open in MuseScore 4.4.2. These are pages only: they are not yet cut into bars or labelled.

Why the six songs in 3b were mislabelled: the label script (`parse_gp7.py`) takes the first
percussion track in a chart. When a song has two, that can be the tambourine or pads while
the picture shows the drum kit. Not fixed yet.

## 4. Test B: 21 open models, untrained

Each model got the same 45 DrumHub-drawn bars, the same instructions GPT-5.6 Luna gets, and the
same scoring. "Exactly right" means every note, drum and note length in the bar is correct.

| Model | Bars answered | Exactly right (of 45) | Right among answered |
|---|---|---|---|
| GLM 5.3 Flash | 45 | **26.7%** | 27% |
| MiMo 2.6 Pro | 18 | 24.4% | 61% |
| DeepSeek V4.1 Flash | 45 | 22.2% | 22% |
| Qwen 3.8 Flash | 30 | 17.8% | 27% |
| DeepSeek V4 Flash Vision (exp) | 21 | 13.3% | 29% |
| Gemma 4 31B | 45 | 13.3% | 13% |
| Ling 3.0 Flash VL | 32 | 11.1% | 16% |
| Qwen 3.5 397B | 10 | 11.1% | 50% |
| Muse Glimmer 30B | 44 | 8.9% | 9% |
| MiniMax M3 | 18 | 8.9% | 22% |
| Qwen 3.6 27B | 17 | 8.9% | 24% |
| Step 3.7 Flash | 20 | 8.9% | 20% |
| Llama 4 Maverick | 37 | 4.4% | 5% |
| ERNIE 4.5 VL 424B | 37 | 2.2% | 3% |
| Inkling | 45 | 2.2% | 2% |
| Qwen 3.8 27B | 34 | 0% | 0% |
| Nex N2.5 Pro | 5 | 0% | 0% |
| Mistral Small 4 | 22 | 0% | 0% |
| Qwen3-VL 235B | 45 | 0% | 0% |
| Qwen3-VL 32B | 45 | 0% | 0% |
| Qwen3-VL 8B | 45 | 0% | 0% |

Closed models on the same 45 bars, for reference: GPT-5.6 Luna 51.1%, Gemini 3.6 Flash 40.0%.

What it shows:

- **Best full measurement: GLM 5.3 Flash (26.7%)**, then DeepSeek V4.1 Flash (22.2%).
- **MiMo 2.6 Pro and Qwen 3.5 397B may be better but are not fully measured.** When they
  answered they were often right (11 of 18, and 5 of 10), but most of their bars failed.
- **Bigger is not automatically better untrained.** Qwen3-VL 235B scores 0%, the same as 8B.

Why the run is incomplete:

- The OpenRouter key reached its US$5 limit before the last models finished.
- Several "reasoning" models used their whole answer allowance thinking about one bar and
  never wrote the answer. Only rows with 44–45 bars answered are full measurements.
- Kimi K3 was dropped after 3 bars: about 17 US cents per bar.
- A first attempt, with reasoning left unlimited, took 5–7 minutes per bar and mostly timed
  out. It was thrown away and cost about US$1.50 of the US$5.

## 5. What is still unknown

- Which model is best **after training**. Nothing but Qwen3-VL 8B has been trained.
- Whether training on two drawing styles fixes the 13% on DrumHub bars. The data and notebook
  are ready (15,798 bars redrawn in DrumHub's style) but have not been run.
- Accuracy on real printed drum books. No book pages have been tested.
- Which finalists can actually be fine-tuned, and where. Not checked yet. A 397B model will
  not fit on Colab.

## 6. Next steps

1. Raise the OpenRouter key limit by about US$5 and finish MiMo 2.6 Pro, Qwen 3.5 397B,
   Qwen 3.8 Flash and DeepSeek V4 Vision with more answer room.
2. Check which of the top four or five can be fine-tuned, and on what service.
3. Train each finalist on the same 3,000 bars (both drawing styles) and compare on the same
   test bars. Choose the reader from those trained scores.
4. Train the winner on all the bars, then test on real drum-book pages.

## Where things are

- Trained-model notebook: `ml/notebooks/Qwen OMR Fine-tune.ipynb` (run with results:
  `Qwen OMR Fine-tune_after.ipynb`)
- Untrained benchmark: `node eval/recognition/run.mjs --providers openrouter`
  (details in `eval/recognition/README.md`)
- Dated log: `plan/progress.md`
- Victor's to-do list: `plan/todo.md`
