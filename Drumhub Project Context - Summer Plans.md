# Drum Hub — Project Context for Claude Code

## What this project is

A desktop app for drummers built with Electron + TypeScript. It has five core features:

1. **Score creator** — take a photo or screenshot of a drum score, the app reads it using a trained OMR (Optical Music Recognition) model and renders it as an editable score in VexFlow
2. **Practice agent** — an AI coaching companion (LangGraph) that guides students through practice sessions, adapts to their weak spots, and keeps a memory of past sessions
3. **Exercise library** — a RAG-powered knowledge base of drum exercises, rudiments, and fills organised by difficulty and style
4. **Fill recommender** — a fine-tuned small LLM (LoRA on Llama 3) that suggests drum fills based on the student's current level and the song context
5. **Teacher portal** — teachers can assign exercises, track student progress, and the practice agent sets appropriate BPM via the metronome

Target user: young drum students (ages 8–16) and their teachers.

---

## Tech stack

| Layer | Tech |
|---|---|
| Desktop shell | Electron + TypeScript |
| Score rendering | VexFlow 5 |
| Practice agent | LangGraph (Python backend) |
| RAG | ChromaDB + OpenAI/Anthropic embeddings |
| Fine-tuning | LoRA via `trl` library on Llama 3.2 3B |
| OMR model | MobileNetV3 fine-tuned on real drum scores (PyTorch) |
| OMR training | Google Colab (T4 GPU) |
| Local inference | ONNX runtime on M1 Mac |
| Backend API | FastAPI (bridges Electron frontend to Python ML layer) |
| Auth + storage | SQLite (local, single user for now) |

---

## Repository structure (target)

```
drumhub/
├── electron/               # Electron main process + preload
├── renderer/               # Frontend (TypeScript + VexFlow)
│   ├── score-editor/       # VexFlow score rendering + editing
│   ├── practice-agent/     # Chat UI for AI coach
│   ├── teacher-portal/     # Teacher assignment + progress view
│   └── metronome/          # BPM control UI
├── backend/                # FastAPI Python server
│   ├── agent/              # LangGraph agent definition + tools
│   ├── rag/                # ChromaDB setup + exercise retrieval
│   ├── fill_recommender/   # Fine-tuned model inference
│   ├── guardrails/         # Content filtering for child safety
│   └── observability/      # Cost + latency logging
├── ml/
│   ├── omr/                # OMR model training scripts
│   │   ├── dataset/        # GP3 export scripts + label generation
│   │   ├── train.py        # PyTorch training loop
│   │   ├── evaluate.py     # Accuracy evaluation
│   │   └── export.py       # Export to ONNX
│   └── fine_tune/          # LoRA fine-tuning scripts for fill recommender
├── data/
│   ├── gp3_files/          # Raw Guitar Pro 3 source files (~1000 bars)
│   ├── pdfs/               # Downloaded + self-charted PDFs
│   ├── dataset/            # Processed image + label pairs for OMR training
│   └── exercises/          # Exercise library content (markdown files)
└── notebooks/
    └── omr_training.ipynb  # Colab notebook for OMR model training
```

---

## What is already built

### Score editor (VexFlow)
- [x] Basic VexFlow rendering working
- [x] Correct stem grouping logic implemented
- [x] Crotchet (quarter note) rendering
- [x] Minim (half note) rendering
- [x] Semibreve (whole note) rendering
- [x] Quaver (eighth note) rendering
- [x] Semiquaver (sixteenth note) rendering
- [x] Snare hit working and tested

### Not yet built
- [ ] Triplets
- [ ] Quintuplets and other tuplets
- [ ] Ties and slurs
- [ ] Dynamic markings
- [ ] Repeats and D.S./D.C. markings
- [ ] Photo import flow (camera + file picker)
- [ ] OMR model integration (plug trained model into score editor)
- [ ] Edit mode (tap a note to change it)
- [ ] Print and export to PDF

---

## OMR model — detailed plan

### What it does
Takes an image (photo or screenshot of a drum score) and outputs a structured JSON of notes per bar.

### Output format (target JSON)
```json
{
  "bars": [
    {
      "bar_number": 1,
      "time_signature": "4/4",
      "notes": [
        { "beat": 1, "instrument": "snare", "duration": "quarter", "voice": "up" },
        { "beat": 1, "instrument": "kick", "duration": "quarter", "voice": "down" },
        { "beat": 2.5, "instrument": "hi-hat", "duration": "eighth", "voice": "up" }
      ]
    }
  ]
}
```

### Drum note mapping (VexFlow keys)
| Instrument | VexFlow key | Notehead | Voice |
|---|---|---|---|
| Crash cymbal | a/5 | x | up |
| Ride cymbal | b/5 | x | up |
| Hi-hat | g/5 | x | up |
| Snare | c/5 | normal | up |
| High tom | e/5 | normal | up |
| Mid tom | d/5 | normal | up |
| Floor tom | a/4 | normal | down |
| Kick drum | c/4 | normal | down |

### Dataset — what you have
- ~1,000 bars of real drum scores in Guitar Pro 3 format (songs you charted yourself)
- Multiple PDFs of charted scores
- Additional PDFs available for download online

### Dataset preparation steps
1. Export each GP3 file to image (PNG) using Guitar Pro's export function — one image per page
2. Parse the GP3 file programmatically using `py-guitarpro` Python library to extract note data per bar
3. Align image regions (bounding boxes per bar) with parsed note data to create labelled pairs
4. Augment: apply random rotation (±3°), brightness variation, blur to simulate real photos
5. Split: 80% train, 10% validation, 10% test (held-out real photos you take yourself)

### Model architecture
- Base: MobileNetV3-Small pretrained on ImageNet (available in `torchvision.models`)
- Task: Object detection — detect noteheads, classify instrument + duration
- Approach: Transfer learning — freeze early layers, fine-tune final classification head on drum data
- Alternative if detection is too complex: treat as per-bar classification first (what notes are in this bar) then add localisation later

### Training (Colab Week 4)
- Upload dataset to Google Drive
- Mount Drive in Colab notebook
- Run transfer learning training loop (~20–40 min per run on T4 GPU)
- Evaluate on held-out real photos
- Export best model to ONNX
- Download `.onnx` file to M1

### Inference (local, post-Colab)
- Load ONNX model in Electron backend using `onnxruntime-node`
- Input: image buffer from file picker or camera
- Output: JSON notes → passed to VexFlow renderer

---

## Practice agent — detailed plan

### What it does
A conversational AI coach that lives inside the app. The student talks to it during practice. It remembers past sessions, knows their weak spots, pulls appropriate exercises from the RAG library, and sets the metronome BPM.

### Agent architecture (LangGraph)
```
[Student message]
       ↓
[Router node] — decides which tool to call
       ↓
┌──────────────────────────────────────┐
│ Tools available to agent:            │
│ - retrieve_exercise (RAG)            │
│ - set_metronome_bpm                  │
│ - get_student_history                │
│ - recommend_fill                     │
│ - render_score (calls VexFlow)       │
│ - log_session_result                 │
└──────────────────────────────────────┘
       ↓
[Response node] — generates reply
       ↓
[Memory node] — updates student profile
```

### Session memory schema (SQLite)
```sql
CREATE TABLE students (
  id TEXT PRIMARY KEY,
  name TEXT,
  level TEXT,  -- beginner / intermediate / advanced
  weak_spots TEXT,  -- JSON array of patterns they struggle with
  last_session DATETIME
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT,
  date DATETIME,
  exercises_done TEXT,  -- JSON array
  self_rating INTEGER,  -- 1-5
  agent_notes TEXT
);
```

### RAG exercise library
- Format: markdown files, one per exercise
- Each file has frontmatter: difficulty, style, tempo_range, instruments_used, tags
- Embedded with OpenAI `text-embedding-3-small` or Anthropic embeddings
- Stored in ChromaDB (local, persistent)
- Retrieved by: student level + weak spots + session goal

### Guardrails (child safety)
- System prompt explicitly scoped to drumming only
- Input/output filtered through a simple keyword blocklist
- Agent never discusses anything outside drumming, music, and encouragement
- Friendly, encouraging tone enforced via system prompt — no negative language

---

## Fill recommender — detailed plan

### What it does
Given the current song's style, tempo, and the student's level — suggests 3 drum fills they can try.

### Fine-tuning approach
- Base model: Llama 3.2 3B (fits on M1 with Ollama)
- Training data: curate ~500–1000 examples of (song_context → fill_suggestion) pairs
  - Source: your own knowledge as a drummer, transcribed fills from your GP3 library
  - Format: instruction-response pairs
- Method: LoRA fine-tuning using `trl` SFTTrainer
- Training: run in Colab if hours remain, otherwise use M1 with `mlx-lm` (Apple's fine-tuning framework for M1)
- Output: 3 fill suggestions in ABC notation or VexFlow-compatible JSON

---

## Eval framework — detailed plan

### What to measure
| Metric | How |
|---|---|
| OMR accuracy | % of notes correctly identified on held-out test set |
| Agent helpfulness | Student self-rating (1–5) per session, logged to SQLite |
| RAG retrieval quality | Manual spot-check: did retrieved exercise match student need? |
| Fill recommender quality | Student acceptance rate (did they try the suggested fill?) |
| LLMOps | Token cost per session, latency per agent turn, logged to file |

### LLMOps logging
```python
# Log every agent API call
{
  "timestamp": "...",
  "model": "claude-sonnet-4-20250514",
  "input_tokens": 450,
  "output_tokens": 120,
  "latency_ms": 1840,
  "session_id": "...",
  "tool_called": "retrieve_exercise"
}
```

---

## Build order (what to build in what sequence)

### Phase 1 — Score editor complete (Weeks 1–3, evenings + Sundays)
1. Finish remaining note types in VexFlow (ties, tuplets)
2. Build photo import flow (file picker + camera capture in Electron)
3. Build dataset preparation script (GP3 → image + JSON labels using `py-guitarpro`)
4. Verify label quality on 10 sample bars manually

### Phase 2 — OMR model (Week 4, Friday + Saturday in Colab)
1. Upload dataset to Google Drive
2. Run `omr_training.ipynb` — transfer learning on MobileNetV3
3. Evaluate on real photos
4. Export to ONNX, download to M1
5. Wire ONNX model into Electron via FastAPI endpoint

### Phase 3 — Practice agent (Weeks 5–6, Fridays + weekends)
1. Set up FastAPI backend
2. Build LangGraph agent with router + tools
3. Set up ChromaDB + embed exercise library
4. Build session memory in SQLite
5. Build basic chat UI in Electron renderer

### Phase 4 — Fill recommender + fine-tuning (Week 7)
1. Curate 500 fill suggestion examples from GP3 library
2. Fine-tune Llama 3.2 3B with LoRA (Colab or M1 with mlx-lm)
3. Wire fill recommender as agent tool
4. Test end-to-end: student asks for fill → agent calls tool → score renders

### Phase 5 — Guardrails, eval, LLMOps (Week 8)
1. Add content filtering to agent system prompt + output layer
2. Add student self-rating UI after each session
3. Add LLMOps logging to every API call
4. Build simple eval dashboard (session history, cost per session)

### Phase 6 — Teacher portal + integration (Week 9)
1. Basic teacher portal: assign exercise, view student sessions
2. Full end-to-end test: photo → OMR → score → agent session → fill → log
3. GitHub README with architecture diagram
4. Record demo video

---

## Key libraries to install

```bash
# Python backend
pip install fastapi uvicorn langgraph langchain-anthropic chromadb
pip install py-guitarpro torch torchvision onnx onnxruntime
pip install trl transformers peft datasets  # for fine-tuning

# Node / Electron
npm install vexflow onnxruntime-node better-sqlite3
```

---

## Context for Claude Code sessions

When starting a Claude Code session on any part of this project, paste this file and add:

> "I am working on [specific feature]. The current state is [what exists]. I want to [specific goal for this session]. Walk me through it and explain what you are doing as you go."

Use Claude Code to:
- Write and explain the GP3 parsing script
- Set up the FastAPI backend skeleton
- Build the LangGraph agent step by step
- Set up ChromaDB and embed the exercise library
- Write the LoRA fine-tuning script
- Wire the ONNX model into Electron

Do NOT use Claude Code to:
- Run the Colab training notebook (do that in Colab directly)
- Make product decisions (come back here for those)
