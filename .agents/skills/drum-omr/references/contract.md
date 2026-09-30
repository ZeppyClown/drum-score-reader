# DrumHub transcription contract

## Output

Return this object as valid JSON:

```json
{
  "schemaVersion": 1,
  "gridSlots": 32,
  "notes": [
    {"position": 0, "duration": "eighth", "drums": ["kick", "hi_hat_closed"]}
  ],
  "uncertainties": [
    {"position": 0, "reason": "The upper x-notehead may be ride rather than closed hi-hat."}
  ]
}
```

Required invariants:

- `schemaVersion` is `1` and `gridSlots` is `32`.
- `notes` is ordered by strictly increasing `position`; one object represents one onset.
- `position` is an integer from 0 through 31. It counts 32nd-note slots from the start of
  the bar: beat 1 = 0, beat 2 = 8, beat 3 = 16, beat 4 = 24. An eighth advances 4 slots,
  a sixteenth 2, and a 32nd 1.
- Simultaneous hits belong in one `drums` array. Never emit two notes at the same position.
- Silent positions and rests are omitted. DrumHub reconstructs rests from onset gaps.
- `uncertainties` is an array. Each entry has a valid `position` and a short `reason`; use
  `[]` when the image is clear.
- Use only the names below. Never emit comments, trailing commas, Markdown inside strings,
  confidence scores, beat-number strings, or additional object keys.

## Drum names

Use these exact identifiers:

| Identifier | Visual meaning in this project's convention |
| --- | --- |
| `kick` | normal notehead below the staff; bass drum |
| `hi_hat_pedal` | low x-notehead; foot-closed hi-hat |
| `floor_tom_2` | lowest normal tom notehead |
| `floor_tom_1` | normal tom notehead above floor tom 2 |
| `snare` | normal notehead on the middle staff line |
| `snare_rim` | x-notehead at snare height; side/cross stick |
| `tom_mid` | normal notehead one step above snare |
| `tom_hi` | normal notehead one step above mid tom |
| `hi_hat_closed` | upper x-notehead at hi-hat height |
| `hi_hat_open_half` | triangle notehead at hi-hat height |
| `hi_hat_open_full` | circle-x notehead at hi-hat height |
| `crash` | high x-notehead below ride height |
| `ride` | highest x-notehead |
| `ride_bell` | diamond notehead at ride height |

Drum notation varies between publishers. Prefer the visible legend when the screenshot
contains one. Record a real ambiguity in `uncertainties` instead of forcing the table onto
a conflicting legend.

Unsupported drums such as cowbell, clap, china, splash, choked crash, rimshot, sticks, and
flams cannot be imported. Omit the unsupported hit and add an uncertainty explaining it.
Ghost-note dynamics fold into the base drum identifier.

## Duration names

Use exactly one of:

`whole`, `half`, `dotted_quarter`, `quarter`, `dotted_eighth`, `eighth`, `sixteenth`,
`thirty_second`, `triplet_eighth`, `triplet_sixteenth`.

The duration describes the written note/rest value at that onset. Three eighth-note
triplets occupy one quarter-note beat; three sixteenth-note triplets occupy one eighth.
Round triplet onsets to the nearest 32-slot position while keeping them in left-to-right
order. Do not use dotted sixteenths, 64ths, ties, grace notes, or custom duration strings;
record unsupported notation in `uncertainties`.

## Example

A common 4/4 groove with eighth-note closed hi-hat, kick on beats 1 and 3, and snare on
beats 2 and 4 is:

```json
{
  "schemaVersion": 1,
  "gridSlots": 32,
  "notes": [
    {"position": 0, "duration": "eighth", "drums": ["kick", "hi_hat_closed"]},
    {"position": 4, "duration": "eighth", "drums": ["hi_hat_closed"]},
    {"position": 8, "duration": "eighth", "drums": ["snare", "hi_hat_closed"]},
    {"position": 12, "duration": "eighth", "drums": ["hi_hat_closed"]},
    {"position": 16, "duration": "eighth", "drums": ["kick", "hi_hat_closed"]},
    {"position": 20, "duration": "eighth", "drums": ["hi_hat_closed"]},
    {"position": 24, "duration": "eighth", "drums": ["snare", "hi_hat_closed"]},
    {"position": 28, "duration": "eighth", "drums": ["hi_hat_closed"]}
  ],
  "uncertainties": []
}
```
