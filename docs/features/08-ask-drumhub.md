# Ask DrumHub

[Back to guide index](README.md)

## Purpose and modes

Ask DrumHub answers questions about the open score and connects explanations to clickable bars. Suggested questions work offline through local analysis and templates. Typed questions use optional cloud help, with facts obtained through local read-only tools.

The current suggested questions are Explain these bars, How do I count it?, How should I practise these bars?, Find the most complex part, What repeats?, and Give me an overview. The first three use the selection or cursor bar; the others cover the shared score range.

## Asking a question

Open the Ask DrumHub tab, select a passage, and choose a suggestion. For typed questions, choose selected bars or the whole score as the scope. A selection question includes nearby bars as context when available. Requests use compact score snapshots, normally limited to 64 bars, so a long score may be only partially represented.

The panel displays the answer, bar buttons, caveats, follow-up suggestions, and optional action buttons. Stop cancels an in-flight request. If the score changes, previous references and actions become stale and need a fresh answer.

## How cloud answers are grounded

Cloud help is off by default and requires adult confirmation. The current agent-model default is `gpt-5.6-luna`, configurable with `OPENAI_AGENT_MODEL`. The model receives the question and score context, calls permitted analysis tools, and then proposes a structured answer.

| Tool | Facts it provides |
| --- | --- |
| `get_score_overview` | Score size, tempo, meter, drums, note values, and review status. |
| `inspect_bars` | Event-by-event detail for up to eight bars per call. |
| `find_complex_passages` | Ranked notation complexity with explanations. |
| `find_patterns` | Repeated and near-matching bars. |
| `compare_passages` | Differences between two bars. |
| `find_fill_candidates` | Possible fills or transitions. |
| `build_practice_plan` | Practice stages, tempos, and success conditions. |
| `find_exercises` | Relevant exercises with catalogue IDs and reasons. |

The tools execute locally against the validated snapshot. The model does not receive a write tool. It explains computed facts rather than editing the score or inferring notes directly from an image.

## Validation and fallback

The answer checker validates references, checks that claims are grounded in tool output, and rejects unsupported notation claims. A cloud answer can receive one repair attempt. If the request or answer fails, the app returns an offline response where possible. For a typed question without a matching local answer, fallback can explain the limitation and direct the user to suggested questions rather than answer the typed question fully.

Code adds caveats about unchecked imported bars and partial snapshots. A well-grounded answer can still describe incorrectly recognized notes, so reviewing imports remains necessary.

The format does not record accents, sticking, dynamics, ornaments, hands or feet, ties, repeat signs, or song sections. Questions requiring those details should receive an explicit limitation. Off-topic questions are also declined.

## Suggested actions

An answer may offer up to three actions: select bars, set a loop, choose a slower practice tempo, or open an exercise returned by the exercise tool. The user must click an action before it applies. These actions affect selection, playback, or library navigation rather than rewriting notes.

## Operational limits

Questions are limited to 500 characters. The service restricts concurrent questions, uses a 1.5-second minimum cloud-question interval, and caps cloud questions at 100 per day. The tool loop has a default maximum of four rounds. All requests also share the app's cloud spending and request-rate controls.

## Source map

See [agent-ui.js](../../js/agent-ui.js), [ask-request.js](../../js/ask-request.js), [offline-answers.js](../../js/offline-answers.js), [agent-tools.js](../../js/agent-tools.js), [agent-contract.js](../../js/agent-contract.js), [agent-actions.js](../../js/agent-actions.js), and [score-agent.cjs](../../desktop/score-agent.cjs).
