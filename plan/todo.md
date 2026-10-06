# Victor's to-do list (score reader)

Written 2026-10-06. Only things that need Victor: a review, a decision, or a payment.
Background for every item is in `score_reader_findings.md`.

## Do first

- [ ] **Take `songsterr/guitar_pro/SUSS Timesheet.pdf` off GitHub.** It was committed by
      accident (commit "rebase") and the repository is public. Deleting the file is not
      enough: it stays in the history until the history is rewritten. Say the word and
      Claude will do it.
- [ ] **Review the 243 doubtful bars.** Open `ml/data/finetune/label_review.html` in a
      browser. For each bar: leave it alone if the label is right, tick it to remove it,
      or retype the notes. Press **Download my changes** at the end. Your work is kept in
      the browser if you close the page halfway.
- [ ] **Hand the download back.** Then run (or ask Claude to run):
      `python3 ml/data-prep/label_review.py --apply ~/Downloads/label_review_changes.json`
      and `python3 ml/omr/prepare_finetune.py --zip`.

## Decisions (each changes what the next training run learns)

- [ ] **Ghost notes.** 2,219 Songsterr bars have them; today they are taught as ordinary
      notes. DrumHub's editor has no ghost notes. Teach the reader to tell them apart
      (and add them to the editor later), or keep treating them as ordinary notes?
- [ ] **Rests.** The labels have rests, but the training text leaves them out. Add them,
      then compare the two versions on the same test bars?
- [ ] **Grace notes, ruffs and flams** in your Reflow charts are drawn but not in the
      labels. Leave them out for now, or add them to the label format?
- [ ] **Keep the best version during training.** The notebook does not score itself on
      the validation bars while it trains. Adding that costs some training time and shows
      when to stop. Yes or no?
- [ ] **Quality gate.** What score must the reader reach before it replaces MobileNetV3 in
      the app? (Master plan B6 says "not set yet".)
- [ ] **Get the six removed songs back?** Their labels came from the wrong drum track
      (tambourine or pads instead of the kit). Fixing the label script could return
      those 721 bars.

## MuseScore PDFs (the 200 Songsterr charts)

Charts and PDFs are in `ml/data/songsterr_musescore/` (PDFs in its `pdf/` folder).

- [ ] **Look at "Genesis-Invisible Touch".** The part chosen was "E-Percussion Layer",
      probably not the drum kit.
- [ ] **Glance at the other 18 charts with several percussion parts.** Listed on the
      lines marked CHECK in `.claude/or-logs/musescore2.log`.
- [ ] **16 charts MuseScore 4.4.2 cannot open.** A newer MuseScore may open them (not
      tried). Foo Fighters: Generator. Genesis: In That Quiet Earth / Afterglow, Burning
      Rope, Firth Of Fifth, Jesus He Knows Me, The Battle Of Epping Forest. Led Zeppelin:
      All Of My Love, In My Time Of Dying. Muse: Panic Station, Uprising. Rush: 2112,
      By-Tor And The Snow Dog, La Villa Strangiato. Tool: Eulogy, Invincible, Jambi.
- [ ] **Decide: turn these PDFs into training bars?** That means cutting every page into
      single bars and matching each to its notes. It gives the reader a third, book-like
      drawing style.

## Money and accounts

- [ ] **OpenRouter: raise the key limit by about US$5** to finish measuring MiMo 2.6 Pro,
      Qwen 3.5 397B, Qwen 3.8 Flash and DeepSeek V4 Vision. About US$3 of the US$8
      credit is left.
- [ ] **Paid GPU account** for training on all 15,225 bars and on bigger models. The free
      Colab GPU took 133 minutes for 3,000 bars on the smallest model.

## Colab (only Victor runs the notebook)

- [ ] Upload the rebuilt `ml/data/finetune.zip` to `MyDrive/unsloth/finetune.zip`.
- [ ] Run the two-style trial in `ml/notebooks/Qwen OMR Fine-tune.ipynb` and send back
      the summaries from cells 6 and 8.

## Later

- [ ] Buy the printed drum books, and check what the publishers allow before any book
      content goes into the product.
- [ ] Tidy `ml/data/` when you are sure what is still needed: `dataset 2` (61 MB),
      `dataset.zip` (80 MB), `training.zip` (71 MB), `finetune_alibaba.zip` (14 MB).
      Nothing was deleted.
- [ ] Move `ai-engineer-workshop-2026-project/` out of this folder. It is a separate
      project; git now ignores it.
