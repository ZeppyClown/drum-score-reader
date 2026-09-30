# Playback and practice controls

[Back to guide index](README.md)

## Purpose

Playback lets a drummer hear the current score and practise a passage at a manageable speed. It works locally using Web Audio. Drum sounds are synthesized from oscillators and noise; the current implementation does not depend on downloadable sample files.

## Transport features

| Control | Behavior |
| --- | --- |
| Play / Stop | Starts or ends a playback run. Space also toggles playback outside typing controls. |
| Practice tempo | Slider and number field choose a playback speed from 40 to 220 BPM. |
| Loop | Repeats selected bars, or the cursor bar when no range is selected. |
| Count-in | Adds one bar of clicks before the score starts. |
| Metronome | Enables or disables the click during score playback. |

Without looping, the current transport plays the full score from the beginning. Selection affects the playback range when Loop is enabled. Turning on Loop with bars 7–8 selected creates a repeating two-bar passage; with no selection, it repeats the cursor's bar.

## Score tempo and practice tempo

The score's tempo is saved metadata, editable in the top bar. Practice tempo belongs to the transport and does not change the document. This allows a score marked 100 BPM to be practised at 60 BPM and still exported with its saved tempo.

The transport initializes from the score tempo, clamped to its supported practice range. Score metadata allows 20–300 BPM, while practice-session records have their own broader validation range. These are separate controls and should not be assumed to mirror each other automatically.

## Timing and visual feedback

The schedule builder converts note ticks to exact hit times, click times, count-in offsets, and loop duration. At 60 BPM, one quarter note takes one second and a 4/4 bar takes four seconds. Dots and triplets use the same tick rules as the editor, so they are scheduled from musical duration rather than guessed visual spacing.

The audio engine schedules events slightly ahead using the AudioContext clock. Browser timers decide when to queue upcoming work, but the audio clock determines when a sound occurs. The score highlights the current event while playback runs.

Simultaneous drums share an onset. Rests produce no drum sound. An underfilled bar still occupies a full bar's time, so the following bar begins at the expected boundary. Loop duration includes that silent remainder.

## Interaction with edits and assistant actions

When the score changes during playback, the transport stops and asks the user to play the new score. This avoids playing an outdated schedule while displaying updated notation.

Ask DrumHub can offer Loop bars or a slower tempo as action buttons. Clicking an action applies a transport effect; it does not rewrite notes. Selecting a cited passage and looping it is a common bridge from analysis to practice.

## Limits

Playback currently supports 4/4. It supplies an audible interpretation of stored drum events, without accents, sticking, or dynamics that the score format does not contain. Synthesized sounds are a timing and listening aid rather than a detailed recording of an acoustic drum kit.

The app does not capture microphone input, identify strikes from an electronic drum kit, or decide automatically whether a practice attempt was clean. Users record that information in Practice.

## Source map

See [transport-ui.js](../../js/transport-ui.js), [playback-schedule.js](../../js/playback-schedule.js), [playback-engine.js](../../js/playback-engine.js), [drum-synth.js](../../js/drum-synth.js), and [app.js](../../app.js).
