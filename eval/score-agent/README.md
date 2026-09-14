# Ask DrumHub evaluation

Checks Ask DrumHub answers against a fixed question bank, so a prompt, model or code
change can be compared against the last run instead of judged by eye (plan §4 I3,
ticket 12).

## Run it

```sh
npm run eval:agent                                   # offline answers, no network
OPENAI_API_KEY=… npm run eval:agent -- --provider openai --input-price <USD per 1M input tokens> --output-price <USD per 1M output tokens>
npm run eval:agent -- --provider openai --only sticking,accents --no-write
```

Each run prints a summary and writes `reports/<time>-<provider>.json`. The command exits
with an error if a release gate fails.

## What it measures

| Measure | Meaning |
| --- | --- |
| Facts mentioned | The answer contains the expected fact (e.g. "1 trip let" for bar 10) |
| References valid | Every bar button points at a real bar that was shared, with matching ids |
| Required references | The answer cites the bars it should (e.g. bars 7–8 for the busiest part) |
| Correct abstention | "Not in the score" for sticking, accents, hands, a bar that doesn't exist, off-topic requests |
| Unchecked-import warning | Answers about imported bars nobody has checked say so |
| No unsupported claims | No accents, sticking, dynamics, ornaments, ties, repeat signs or hands/feet |
| Grounded sentences | Every sentence naming a bar cites it |
| Fallbacks, latency, tokens, cost | How often cloud answers failed the checks, speed, and spend |

Release gates (plan §4 I3): references 100% valid, abstention 100%, disclosure 100%,
grounded sentences ≥ 95%, and zero score changes (the agent's tools are read-only).

## Files

- `questions.json` — 20 questions with developer-written expectations. **A teacher still
  needs to review these labels.** Changing the file changes its hash in every report.
- `fixtures/` — the frozen scores (`make-fixtures.mjs` regenerates them; only do that on
  purpose, since it makes older reports incomparable).
- `graders.mjs` — deterministic checks. A Gemini judge (synthetic data only, adult
  developer use) is deliberately not added until its agreement with teachers is measured.

Offline runs only answer the 8 suggested questions; the 12 typed questions need
`--provider openai`.
