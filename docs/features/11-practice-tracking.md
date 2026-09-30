# Students, assignments, and practice tracking

[Back to guide index](README.md)

## Purpose and storage

The Practice tab records what a student practised and how their attempts went. Students, sessions, attempts, assignments, and difficulty resets live in a local SQLite database named `practice.sqlite` in the app data folder. They are separate from `.drumhub.json` score files.

The renderer calls a narrow practice API. It does not receive the database connection or its filesystem path. This feature does not provide online accounts, classroom synchronization, or automatic performance recognition.

## Student records and permissions

Add student creates a local profile with a display name and level. Choose a student switches the practice history and assignments shown in the panel. Permission controls record guardian consent, per-student cloud-help permission, and who recorded the decision.

Per-student cloud permission requires guardian consent. App-wide cloud help is a separate setting. Optional cloud teacher summaries require the appropriate app and student permissions; saving a local profile does not automatically send it to a provider.

## Sessions and attempts

Select the passage to practise, or use the cursor bar when no range is selected. Start begins a timed session associated with the student, score ID, bar range, and target BPM.

During the session, Log a try records BPM, loop count, and whether it was played without mistakes. These are user-entered facts. A drummer can log several attempts at progressively faster speeds while keeping the same passage as the session target.

End session records minutes, completion status, and a self-rating from 1 (very hard) to 5 (easy). The app validates session timing and prevents attempts being added to an already ended session. Practice records accept BPM values from 1–400, which is distinct from the playback transport's 40–220 BPM range.

The current application wiring does not feed the transport's live practice tempo into the Practice panel. Check the session and attempt BPM fields instead of assuming they reflect the playback slider.

## Assignments

Assignments include a title, score ID, first and last bar, target BPM, practice goal, and optional due date. A student or teacher can mark an assignment done. Assignment completion is an explicit action rather than an automatic consequence of reaching a recorded BPM.

Ranges and assignments are associated with score IDs and bar numbers. If a score is heavily reorganized, check that an old assignment's bar range still refers to the intended material; practice history is not a stored copy of every historical score revision.

## Dashboard and personal difficulty

The dashboard displays session count, minutes, attempts, completed assignments, best clean BPM by passage, and personal difficulty where sufficient data exists. A date filter can narrow the displayed history.

Personal difficulty requires at least three sessions and six attempts for the same range. It combines the share of unclean attempts (40%), the gap between clean BPM and target BPM (35%), and self-ratings (25%). Recent attempts and ratings receive more influence using a 30-day exponential decay. The calculation returns reasons as well as a value.

This is a heuristic based on logs, separate from notation complexity. It can help identify passages needing more practice, but it is not an objective assessment of skill. Reset difficulty establishes a new cutoff for the calculation without deleting the underlying practice history.

## Export and deletion

Show export JSON displays a student's records for inspection, and the panel can copy that JSON. This action does not automatically download a file. Student deletion uses a desktop confirmation and removes the student's sessions, attempts, assignments, and difficulty data from the local database.

## Source map

See [practice-ui.js](../../js/practice-ui.js), [practice-store.cjs](../../desktop/practice-store.cjs), [practice-ipc.cjs](../../desktop/practice-ipc.cjs), and [preload.js](../../preload.js).
