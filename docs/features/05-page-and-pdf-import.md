# Page and PDF import

[Back to guide index](README.md)

## What this feature adds

Page import handles a larger chart by separating it into bar-sized crops before recognition. The user can inspect the detected boxes, correct their boundaries, read each crop, and add the resulting bars in reading order. It supports PNG, JPEG, and PDF input through the local segmentation service.

The backend accepts up to 40 MB and up to 20 PDF pages. Large photos are scaled to at most 3,000 pixels on the long side before segmentation. PDF pages are rendered locally into images. Recognition remains a separate choice from segmentation.

## Workflow

1. Choose Import page or PDF… from the side menu and select a file.
2. Review the page images and suggested numbered bar boxes.
3. Add missing boxes, remove incorrect ones, or adjust their positions and size.
4. Choose the local model or the configured cloud recognizer and click Read bars.
5. Inspect progress and results, retry failed boxes, then click Add bars to score.

The cloud option requires the app's cloud-help setting and API configuration. The local option requires the local recognition model. Both currently produce 4/4 bars.

## Finding and editing crop boxes

The segmenter detects ink, groups five staff lines into systems, and looks for barlines with suitable staff-edge geometry. Its boxes are suggestions. It can miss bars or include stems and surrounding marks, especially on dense notation, so box review is part of the workflow.

Drag on a page to create a box. Drag an existing box to move it and drag its corner to resize it. The remove control deletes a box, and Add box provides another entry method. Keyboard controls include arrows to move a box, Alt+arrows to resize it, and Delete to remove it.

Box validation keeps crops within the image. The numbering represents the reading order used when appending bars, across pages and staff systems. Include complete bar boundaries and enough vertical space for cymbal noteheads and rhythm markings. A crop that visually cuts off important notation can fail even when its geometry is valid.

## Progress, failures, and retries

The main process crops each box and runs the selected recognizer. Results are saved individually, allowing completed work to survive an interruption. A failed box can be retried without rerunning every successful crop. Changing a box invalidates its earlier result so the new crop is read again.

Stop interrupts transcription. It does not erase previously saved results. The checkbox Add an empty bar for each box that could not be read preserves the position of failed crops in the final score. This is useful when bars 1, 2, and 4 were recognized but bar 3 failed: a placeholder keeps later bar numbers aligned with the chart. Disabling it omits failed boxes instead.

Bars are added as an import command in reading order. Imported notes and placeholders remain unchecked and can be corrected manually. Once the import is added, its temporary job folder is removed.

## Resuming work

Jobs are stored in the app data folder under `page-imports/`, with page images, boxes, and results. An unfinished job can be offered on the next launch with Resume or Discard. Resume restores the saved import work; Discard removes that job. The job folder is distinct from score-file autosave recovery.

## Current limits

Box detection is geometric and does not prove that a chart uses the same drum legend as DrumHub. Cloud recognition can consult a legend visible in a crop, but a separate page legend may be absent from individual bar crops. Accurate box boundaries therefore do not guarantee accurate drum identification.

The feature does not turn printed repeats or unsupported articulation symbols into full editor semantics. Keep the original chart available when checking the transcription.

## Source map

See [page-import-ui.js](../../js/page-import-ui.js), [page-boxes.js](../../js/page-boxes.js), [page-import.cjs](../../desktop/page-import.cjs), [page-import-ipc.cjs](../../desktop/page-import-ipc.cjs), and [page_segment.py](../../backend/page_segment.py).
