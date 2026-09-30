---
name: drum-omr
description: Transcribe a pasted or attached screenshot of one 4/4 drum-notation bar into DrumHub's strict editable JSON. Use when the user asks to read, transcribe, convert, or import a drum-score screenshot.
---

# Drum OMR

Read one cropped 4/4 drum-notation bar from the image attached to the user's message and
return data that DrumHub can import.

Before transcribing, read [references/contract.md](references/contract.md). Inspect the
image at high resolution and zoom into ambiguous noteheads, dots, beams, rests, and tuplet
marks when image tools permit it.

## Method

1. Confirm the image contains one readable 4/4 drum bar. If it contains a page or several
   bars, identify the requested bar when the user made it unambiguous; otherwise ask for a
   tighter crop. Do not silently choose a bar.
2. Read onset positions from left to right. Align simultaneous noteheads on one stem/onset
   as a chord. Check vertical staff position and notehead shape independently.
3. Determine the written duration from flags, beams, dots, and tuplets. Use the contract's
   exact duration names.
4. Review the transcription against the image a second time. Check especially tom height,
   ride versus crash, open versus closed hi-hat, dotted eighths, and triplets.
5. Return exactly one fenced `json` block containing the contract object. Do not add prose
   before or after it; the user copies this block into DrumHub.

## Uncertainty

Never invent an unreadable hit. Include the most likely supported interpretation in
`notes`, then add an `uncertainties` entry describing the ambiguity. Use an empty `notes`
array only when the bar visibly has no supported hits. Do not treat an unreadable image as
an empty bar.

Do not modify repository files, retrain models, or call remote services during ordinary
transcription. The attached image and this contract are sufficient.
