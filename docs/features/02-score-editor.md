# Score editor

[Back to guide index](README.md)

## Purpose

The editor turns structured drum events into notation and lets the user change those events directly. Imported notes and manually entered notes use the same representation and editing rules. The displayed score is SVG drawn through VexFlow 5, with drum-specific staff positions, noteheads, stems, beams, dots, and tuplets.

## Drum entry and chords

Pressing a drum key adds that drum at the current cursor event. Pressing it again removes it. Several drums can share an event, so a kick and closed hi-hat can sound together. Removing the last drum turns the event into a rest while keeping its length.

| Key | Drum | Shift variant |
| --- | --- | --- |
| `0` | Kick | Pedal hi-hat |
| `1` | Crash | — |
| `2` | High tom | — |
| `3` | Mid tom | — |
| `4` | Open hi-hat | Half-open hi-hat |
| `5` | Side stick | — |
| `6` | Floor tom | Second, lower floor tom |
| `7` | Closed hi-hat | — |
| `8` | Snare | — |
| `9` | Ride | Ride bell |

The floating keypad offers the same controls. Shift-click activates its alternate drum. Its handle can be dragged to reposition it.

## Rhythm editing

The base durations are 32nd, 16th, eighth, quarter, half, and whole notes. `-` shortens a note by one step and `+` lengthens it. `.` toggles a dot when supported. Dotted 32nds and dots on triplet notes are refused. Edits that would overfill a bar are also refused.

`T` converts suitable plain notation into a group of three triplet events occupying the time of two ordinary events of that duration. Activating it within a triplet group converts the group back into plain notation. Triplets are handled as complete groups, rather than unrelated notes with a triplet-looking mark.

Internally, one quarter note is 48 ticks and one 4/4 bar is 192 ticks. An eighth note takes 24 ticks; a dotted eighth takes 36; a triplet eighth takes 16. This gives exact integer timing for the supported rhythm rules. VexFlow supplies the visual spacing; the editor's ticks enforce musical capacity and feed other timing features.

## Rests and cursor movement

Left and right arrows move between events. Right can create a rest in the remaining space or advance to the next bar when the current bar is full. Up and down move the cursor vertically on the drum staff.

Backspace on a hit converts it to a rest, preserving subsequent timing. Backspace on a rest removes that event. These are different operations: removing an event changes where later events occur, whereas replacing a hit with a rest preserves its time slot.

## Selection and layout

Click a bar to select it and Shift-click to extend a range. `S` selects the cursor bar; Shift+`S` extends the selection to it. Selection is stored using bar IDs, allowing other features to refer to the same bars after unrelated edits. Selection powers looping, scoped questions, exercise recommendations, and practice sessions.

The side menu's bars-per-line setting changes score layout. It is a presentation control rather than an added note or rhythm change. The title and score tempo are editable metadata and participate in undo history.

## Accessibility

Drum controls are real buttons with accessible labels. A hidden list describes bars in words for screen readers. Dialog focus is managed, and global editing shortcuts ignore typing in fields and controls or while a modal is open. This allows a title or question to contain digits without entering drum notes accidentally.

## Implementation and limits

Keyboard input becomes a command, the editor store commits it, and rendering and subscribed features update. Pure editing functions return unchanged input when an operation is refused. Score edits receive revisions and undo entries; cursor-only movements do not.

The editor does not currently model accents, sticking, dynamics, ghost-note markings, flams, rolls, ties, repeat signs, or song sections as editable score fields. The kit vocabulary is finite, and only 4/4 is editable.

See [input.js](../../js/input.js), [bar.js](../../js/bar.js), [constants.js](../../js/constants.js), [notation.js](../../js/notation.js), [score.js](../../js/score.js), [selection.js](../../js/selection.js), and [score-a11y.js](../../js/score-a11y.js).
