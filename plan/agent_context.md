# DrumHub teacher assistant — what context the agent needs

Written: 2026-10-04. Companion to `drumhub_master_plan.md` (§0.1, §4 J, §5.1).
Updated: 2026-10-05 — Trinity Rock & Pop first; first version is teacher-only;
Victor's 24-lesson teaching sequence recorded.

The agent is only as specialised as what it can look up. This file lists every piece of
context it needs, where that context lives, how the agent gets it, and whether it exists
yet.

## The rule

**Context reaches the model in one of three ways, and nothing else:**

| Way | Used for | Example |
| --- | --- | --- |
| **Instructions** (fixed text) | How to behave. Short, the same for every teacher | "You prepare material for a drum teacher. The teacher decides." |
| **Tool results** (looked up when needed) | Every fact | The skills in bars 9–16; a student's best clean tempo |
| **The request** (this one question) | What the teacher wants now | "Simplify the chorus for a Grade 2 student" |

Facts never go into the instructions. A fact in the instructions cannot be checked,
corrected, deleted or kept up to date; a fact from a tool can.

## 1. Who the agent is working for

| Context | Source | How it reaches the model | Status |
| --- | --- | --- | --- |
| The first version is teacher-only; the agent prepares, the teacher decides | Victor's decision, 2026-10-05; master plan §1 product rule | Instructions | Scope confirmed; instructions still to write (today's instructions address "a young drummer or their teacher") |
| The teacher's counting words ("1 E N A", "1 Tri Plet") | Victor's charts | A setting read by the counting tool | Missing; app says "1 e & a" |
| The teacher's terms (crotchet/quaver, "fill-in", "ear test") | Victor's charts | Instructions, one short glossary | Missing |
| Exam board in use: Trinity Rock & Pop Drums first | Victor's decision, 2026-10-05 | Setting | Board confirmed; setting and syllabus integration still to build; other boards deferred |

## 2. The score in front of the teacher

All of this exists today and stays as it is.

| Context | Source | How | Status |
| --- | --- | --- | --- |
| Bars, drums, note lengths, tempo, which bars are selected | `js/score-snapshot.js` | Tools: `get_score_overview`, `inspect_bars` | Built |
| Repeats, possible fills, notation complexity, differences between bars | `js/score-analysis.js` | Tools: `find_patterns`, `find_fill_candidates`, `find_complex_passages`, `compare_passages` | Built |
| Which imported bars nobody has checked | Bar provenance | Tool results + warning added by code | Built |
| Skills used in a bar range | `skillsInBars` (J0) | New tool | **Missing — build first** |
| Section names (Verse, Chorus), sticking, repeat signs | Score fields (J13) | Tool results | Missing; the score cannot store them |

Not sent: the title, import warning text, internal ids, the image.

## 3. The skill list and the syllabus

| Context | Source | How | Status |
| --- | --- | --- | --- |
| Skill list: name, how code detects it, level, where the level comes from | `js/skills.js` (J0) | Tool results name skills; the list itself is not sent whole | Missing |
| Trinity Rock & Pop Drums grade parameters (note values, syncopation, independence, techniques, tempos, improvisation length) | Official syllabus, graded exams from 2018; Grades 1–6 checked | Data file `js/syllabus-trinity.js`; tool `get_grade_requirements(grade)` | Missing; source PDF in hand |
| Diploma parameters (ATCL, LTCL, FTCL) | Official diploma syllabus; ATCL checked | Same file | Low priority |
| Victor's own teaching order | Victor's supplied outline of *The Art of the Drummer*, §3.1 | Same skill list, source = `teacher` | Order supplied: normally follows Lessons 1–24; skill definitions and progression criteria still needed |
| Grade limits for generated material (allowed note lengths, drums, tempo range) | Derived from the two rows above | Enforced by code, not shown to the model as rules to follow | Missing |

Every level carries its source: `trinity_grade`, `trinity_diploma` or `teacher`. The agent
may say "Trinity lists ghost notes at Grade 4". It may not say "paradiddles are Grade 3".

Syllabus items the score cannot show (dynamics, accents, ghost notes, ties, grace notes,
brushes, meters other than 4/4, improvisation) can only come from a teacher's mark.

### 3.1. Victor's teaching sequence — The Art of the Drummer

Source: Victor's lesson outline, supplied on 2026-10-05. Victor normally follows the
book's order. Lesson 12 combines the earlier message with the continuation, which
completed its final topic as modern funk rhythms. Author and edition were not supplied.
This records lesson topics and teaching order; prerequisites, success criteria and
Trinity grade mappings have not been established.

| Lesson | Topics supplied by Victor |
| --- | --- |
| 1 | Single beats (crotchets) |
| 2 | Snare drum exercises |
| 3 | Half beats (quavers) |
| 4 | Exercises around the drums; fill-ins; snare drum exercises |
| 5 | Quarter beats (semiquavers); snare drum exercises; four-bar phrases; phrasing studies for the drum set |
| 6 | Semiquaver studies around the drums; fill-ins using semiquavers |
| 7 | Variations on semiquavers |
| 8 | Swing rock rhythms; studies for swing rock |
| 9 | Straight hard-rock rhythms; swingy hard-rock rhythms |
| 10 | Triplets; snare drum exercises; triplets around the drums; triplet fill-ins in swing rock |
| 11 | Jazz rhythms; independence exercises; fill-ins; bounce triplets; fill-ins using bounce triplets; independence studies using bounce triplets |
| 12 | Triplet semiquavers; snare drum exercises; fill-ins; slow rhythm cymbal variations; modern funk rhythms |
| 13 | Accents and rimshots; accent studies around the drums |
| 14 | Strengthening the left hand; bass drum technique |
| 15 | Snare drum rudiments: 5-, 6-, 7-, 9-, 10-, 11-, 13-stroke and long rolls; "the roll roll in triplet form"; paradiddle; double diddle; triplet paradiddle; flam; flam accent; flam tap; flam paradiddle; closed drag; single ratamacue; double ratamacue; open drag; closed ruff; buzz roll; open ruff |
| 16 | Note values; rest notes; dotted notes |
| 17 | Time signatures: 3/4, 2/4, 5/4, 7/4, 3/8, 6/8, 12/8; cut common time |
| 18 | Brush rhythms |
| 19 | Latin American rhythms: bossa nova; cha-cha; samba; tango; "boleno"; rhumba |
| 20 | Advanced rock rhythms; hi-hat rhythms; larger drum sets; single-headed drums; semiquaver cymbal rhythms |
| 21 | Expression markings; musical expressions; tied notes; studies |
| 22 | Tuning and care of the drum set |
| 23 | Additional techniques |
| 24 | Drum solos |

The phrases "the roll roll in triplet form" (Lesson 15) and "boleno" (Lesson 19)
retain Victor's wording pending confirmation. Lessons 23 and 24 have no further
topic detail yet.

## 4. The student

| Context | Source | How | Status |
| --- | --- | --- | --- |
| Level | `practice.sqlite`, students | Tool `get_student` | Built (table), tool missing |
| What they can play / are working on / not yet, per skill | `skill_evidence`, `teacher_marks` (J1) | Tool `get_skill_record` | Missing |
| Tempo history per skill and per passage | Sessions and tries | Tool `get_tempo_history` | Data built, tool missing |
| Open and finished assignments | Assignments table | Tool `get_assignments` | Data built, tool missing |
| What was given before, in order | `lesson_notes` (J6); for past students, the dated chart history | Tool `get_lesson_history` | Missing |
| The teacher's free-text notes | `notes` field (J1) | **Not sent** unless decision 17 allows it | Missing |

Rules for student context:

- The model never receives a name. Code swaps in "the student" before sending and puts
  the name back when showing the result.
- One failed try is never a weakness. A tool returns "not enough evidence" under three
  sessions.
- Self-reported facts ("clean" checkbox) and measured facts (MIDI kit, J2) are labelled
  differently in every tool result.
- Cloud use needs the app setting, the student's guardian consent and the student's
  cloud permission, as today.

## 5. The teacher's material

| Context | Source | How | Status |
| --- | --- | --- | --- |
| DrumHub's own 26 exercises and 21 fills | `js/exercise-catalogue.js` | Tool `find_exercises` | Built; needs re-tagging with the skill list |
| Victor's own charts, tagged by skill and level | 179 charts under `ml/data/` | Local index; tool `find_my_charts(skill, level)` | Missing |
| Songs that teach a skill | Song index from the charted songs (J9) | Tool `find_songs_for_skill` | Missing; decision 15 |
| Ear-test and sight-reading patterns by grade | Victor's ~40 hand-made sheets | Templates and limits for the generator (J12) | Missing |

Never in the shipped catalogue or index: exercises copied from a published method book,
purchased "Official" tabs, or the notation of commercial songs. Facts about them (title,
tempo, skills used) are fine.

## 6. What the teacher wants right now

| Context | Source | How | Status |
| --- | --- | --- | --- |
| The objective ("bars 9–16 this week", "not ready for 16th-note kicks") | Typed by the teacher | The request | Built (question box) |
| Which student and which bars | Practice tab, selection | The request | Partly: bars yes, student no |
| Which job: answer, teaching plan, assignment draft, lesson note, adapted copy, sight-reading sheet, ear test | The button pressed | Picks the tool set and the output shape | Only "answer" exists |

## 7. What each job needs

| Job | Score (§2) | Skills/syllabus (§3) | Student (§4) | Material (§5) | Output |
| --- | --- | --- | --- | --- | --- |
| Answer a score question | yes | — | — | exercises | Text with bar links (built) |
| Teaching plan for a song | yes | yes | optional | exercises | Ordered stages, editable |
| Next exercise / assignment draft | optional | yes | yes | exercises, charts | Draft to accept, edit or dismiss |
| Lesson note | — | yes | yes | — | Draft note |
| Parent / student summary | — | — | yes (facts only) | — | Printable page |
| Adapt material to an instruction | yes | yes | optional | — | A changed copy beside the original |
| Sight-reading sheet / ear test | — | yes (grade limits) | optional | patterns | A new chart / a played example |
| Recommend a song | — | yes | optional | song index | List with reasons |

## 8. What must never be context

- Student names, guardian details, or anything typed about a student's character,
  health or family.
- Whole scores or whole histories when a few facts answer the question.
- Text from an opened file, a title or a note treated as instructions. It is data.
- The model's own memory of a song. If a tool did not return it, the agent does not
  know it.
- Anything "remembered" by the model between sessions. Memory is the database.

## 9. Still needed from Victor

Confirmed on 2026-10-05: Trinity Rock & Pop Drums is the first exam board, and the first
version is teacher-only. Victor normally follows the 24-lesson sequence in §3.1.
These decisions are no longer outstanding.

1. Approval of the skill definitions derived from §3.1, including prerequisites and
   what counts as ready to move on. The general teaching order has been supplied.
2. Author and edition of *The Art of the Drummer*, and confirmation of which numbered
   homework sheets come from it, so copied exercises can be excluded.
3. What he tells a student or parent after a lesson; nothing in the folder records it.
4. Whether one past student's dated chart history may be used, with the name replaced by
   an id, as the test for "what should come next" (decision 20).
5. Decisions 14–19 in the master plan.

## 10. Build order for context

1. Skill list and `skillsInBars`, checked against Victor's own grade folders.
2. Trinity grade data file and grade limits.
3. Student record tables and the four student tools.
4. Index of Victor's charts.
5. Teacher instructions and glossary, then the teacher question bank.
