# Teacher summaries

[Back to guide index](README.md)

## Purpose

Teacher summary turns saved practice records into a short progress report. It summarizes recorded activity, current assignments, best clean tempos, and passages needing attention. It does not listen to a performance, examine a student's personality, or infer progress that was never logged.

## Facts used by the report

The summary builder collects the selected student's session count, minutes, attempt count, completed assignments, open assignment ranges and targets, best clean BPM by range, and personal-difficulty results when available. Each fact receives an ID for validating model references.

The date filter supplies a `since` boundary for session history. Open assignments provide current context. Therefore a report combines activity in the requested period with ongoing assignment information rather than treating every field as a historical event inside that period.

For example, a student may have practised bars 5–6 across several sessions, recorded a clean attempt at 70 BPM, and have an assignment targeting 90 BPM. A report can describe the saved clean tempo and the assignment target, while preserving the distinction between actual practice and the desired goal.

## Offline report

The deterministic local summary is available without cloud access. It uses templates and known facts to produce a readable report with caveats, including insufficient data where appropriate. Local storage and report generation do not require a teacher account or a network connection.

The Practice panel labels the result as an offline or cloud summary. Generating it displays text in the panel; it does not email it to a teacher or publish it elsewhere.

## Optional cloud draft

Cloud drafting requires app-wide cloud help and the student's guardian and cloud permissions. The configured agent model receives approved practice facts. The cloud payload removes student names, score identifiers, free-text assignment titles, and raw score notes; neutral labels and numeric facts support the draft.

The response format contains a summary, highlights, next steps, and caveats. Highlights and next steps cite fact IDs so code can check what supports them. The current implementation uses the agent-model configuration shared with other conversational features.

## Checking the output

The checker verifies fact references and numeric values. It also checks units: a number known as a BPM target should not be reused as a count of practice minutes. It rejects invented targets, unexpected names, unsupported judgments, and language about diagnoses or comparing the student with others.

An invalid draft can receive one repair attempt. Cloud failures or persistent validation problems fall back to the offline report. Caveats remain visible so a short or sparse practice history is not presented as a confident long-term assessment.

## Limits

The source data is self-reported. A clean attempt means someone checked the clean box, and a self-rating records how it felt to the student. A well-validated summary cannot independently verify those observations.

Personal difficulty is only available after enough sessions and attempts, and its weights are an initial policy. Reports should be read alongside the actual records and the teacher's observations. They are generated text for review, with no automatic assignment creation or delivery.

## Source map

See [teacher-summary.cjs](../../desktop/teacher-summary.cjs), [practice-store.cjs](../../desktop/practice-store.cjs), [practice-ipc.cjs](../../desktop/practice-ipc.cjs), and [practice-ui.js](../../js/practice-ui.js).
