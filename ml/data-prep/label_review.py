"""Find bars whose label may not match the picture, and build a page to check and fix them.

    python3 ml/data-prep/label_review.py                    # writes ml/data/finetune/label_review.html
    python3 ml/data-prep/label_review.py --apply ~/Downloads/label_review_changes.json

The check counts note stems in each picture and compares that with the label's note count.
It only catches a wrong NUMBER of notes, never a wrong drum or a wrong note length.

On the page each bar can be left alone, ticked for removal, or have its label retyped.
"Download my changes" saves a JSON file; --apply adds its removals to
ml/omr/excluded_bars.txt and its new labels to ml/omr/label_corrections.json, which
prepare_finetune.py reads. Run after prepare_finetune.py (it reads ml/data/finetune/*.jsonl).
"""
import argparse
import csv
import html
import json
import sys
from multiprocessing import Pool
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'ml' / 'omr'))
from prepare_finetune import EXCLUDED, decode_text  # noqa: E402
from training_contract import DRUMS, DUR_IDX  # noqa: E402

CORRECTIONS = EXCLUDED.with_name('label_corrections.json')
FOOT = {'kick', 'hi_hat_pedal'}
STEM_PIXELS = 16   # a dark vertical run this tall counts as a stem (or a barline)


def stems(image):
    dark = np.array(Image.open(ROOT / image).convert('L')) < 128
    longest = current = np.zeros(dark.shape[1], int)
    for row in dark:
        current = np.where(row, current + 1, 0)
        longest = np.maximum(longest, current)
    tall = longest >= STEM_PIXELS
    return int(np.sum(tall[1:] & ~tall[:-1]) + tall[0])


def doubt(row):
    """Why this bar looks wrong, or None. Thresholds were set by looking at samples (2026-10-06)."""
    hits = [h for h in decode_text(row['target']) if h['duration'] != 'whole']
    count = stems(row['image'])
    if row['kind'] == 'gp7':                       # Songsterr: one stem per hit, plus barlines
        extra = count - len(hits)
        if extra >= 4:
            return 'Picture seems to have MORE notes than the label'
        if extra <= -2:
            return 'Picture seems to have FEWER notes than the label'
    else:                                          # Reflow: hands and feet have separate stems
        extra = count - sum(bool(set(h['drums']) & FOOT) + bool(set(h['drums']) - FOOT) for h in hits)
        if extra >= 6:
            return 'Picture seems to have MORE notes than the label (grace notes, flams, or a missing line?)'
        if extra <= -4:
            return 'Picture seems to have FEWER notes than the label'
    return None


def flagged(row):
    return {**row, 'why': doubt(row)}


def to_lines(target):
    """"0:eighth:kick+crash 4:eighth:snare" → one editable line per hit: "1 kick+crash eighth"."""
    sub = {0: '', 2: 'e', 4: '&', 6: 'a'}
    return '\n'.join(f"{h['position'] // 8 + 1}{sub.get(h['position'] % 8, '.' + str(h['position'] % 8))} "
                     f"{'+'.join(h['drums'])} {h['duration']}" for h in decode_text(target))


PAGE = """<!doctype html><meta charset=utf-8><title>Bars to check</title>
<style>
body{font:15px system-ui;margin:16px;max-width:1300px}
.card{border:1px solid #ccc;border-radius:6px;padding:10px;margin:12px 0}
.card.edited{border-color:#06c;background:#f3f8ff}.card.remove{border-color:#b00;background:#fff3f3}
img{max-width:100%;display:block;margin:8px 0;background:#fff;border:1px solid #eee}
.src{color:#666;margin-left:12px}.why{color:#b00;margin-top:4px}.err{color:#b00;min-height:1.2em}
textarea{width:100%;font:14px ui-monospace,monospace;box-sizing:border-box}
#bar{position:sticky;top:0;background:#fffbe6;border:1px solid #e0c060;padding:8px;z-index:2}
code{background:#eee;padding:1px 4px;border-radius:3px}
</style>
<h1>__COUNT__ bars to check</h1>
<p>A program counted the note stems in each picture and compared that with the label. These are the bars where the two
disagree. Many will be fine. For each bar you can leave it, tick <b>remove</b>, or <b>retype the label</b> in the box.
Your work is kept in this browser as you go. When done, press <b>Download my changes</b> and tell Claude.</p>
<details open><summary><b>How to write a label</b></summary>
<p>One hit per line: <code>beat drums length</code>, for example <code>1 kick+crash eighth</code> or <code>2&amp; snare sixteenth</code>.
An empty box means an empty bar.</p>
<p><b>Beat:</b> <code>1 1e 1&amp; 1a 2 2e 2&amp; 2a</code> … up to <code>4a</code>. For a 32nd-note position write
<code>1.1 1.3 1.5 1.7</code> (the number after the dot is the 32nd inside that beat, 0-7).<br>
<b>Drums</b> (join with +): __DRUMS__<br>
<b>Length:</b> __DURATIONS__</p></details>
<div id=bar><b id=nEdit>0</b> retyped, <b id=nRemove>0</b> to remove.
<button id=download>Download my changes</button> <span id=problems class=err></span></div>
__CARDS__
<script>
const DRUMS = __DRUM_LIST__, DURS = __DUR_LIST__, SUB = {'': 0, e: 2, '&': 4, a: 6};
const KEY = 'drumhub-label-review';
let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
// lines → "slot:length:drums ..." or throws with a message naming the line
function toTarget(text) {
  const hits = text.split('\\n').map(l => l.trim()).filter(Boolean).map((line, i) => {
    const parts = line.split(/\\s+/);
    if (parts.length !== 3) throw new Error(`Line ${i + 1}: write beat, drums, length`);
    const m = parts[0].match(/^([1-4])(e|&|a|\\.[0-7])?$/);
    if (!m) throw new Error(`Line ${i + 1}: beat "${parts[0]}" is not like 1, 2e, 3& or 4.5`);
    const slot = (m[1] - 1) * 8 + (m[2]?.startsWith('.') ? Number(m[2].slice(1)) : SUB[m[2] || '']);
    const drums = parts[1].split('+');
    const bad = drums.find(d => !DRUMS.includes(d));
    if (bad) throw new Error(`Line ${i + 1}: "${bad}" is not a drum name`);
    if (new Set(drums).size !== drums.length) throw new Error(`Line ${i + 1}: a drum is repeated`);
    if (!DURS.includes(parts[2])) throw new Error(`Line ${i + 1}: "${parts[2]}" is not a length`);
    return { slot, text: `${slot}:${parts[2]}:${drums.sort((a, b) => DRUMS.indexOf(a) - DRUMS.indexOf(b)).join('+')}` };
  }).sort((a, b) => a.slot - b.slot);
  if (hits.some((h, i) => i && h.slot === hits[i - 1].slot)) throw new Error('Two lines are on the same beat: join the drums with +');
  return hits.map(h => h.text).join(' ') || 'rest';
}
function refresh() {
  let edits = 0, removes = 0, problems = 0;
  for (const card of document.querySelectorAll('.card')) {
    const box = card.querySelector('textarea'), tick = card.querySelector('input'), err = card.querySelector('.err');
    let target = null; err.textContent = '';
    try { target = toTarget(box.value); } catch (e) { err.textContent = e.message; if (!tick.checked) problems++; }
    const edited = !tick.checked && target !== card.dataset.target;
    card.className = 'card' + (tick.checked ? ' remove' : edited ? ' edited' : '');
    card.dataset.now = target ?? '';
    const state = tick.checked ? { remove: true } : edited ? { text: box.value } : null;
    if (state) saved[card.dataset.name] = state; else delete saved[card.dataset.name];
    edits += edited && target !== null; removes += tick.checked;
  }
  nEdit.textContent = edits; nRemove.textContent = removes;
  document.getElementById('problems').textContent = problems ? `${problems} box(es) have a mistake and will not be saved` : '';
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {}
}
for (const card of document.querySelectorAll('.card')) {
  const state = saved[card.dataset.name];
  if (state?.remove) card.querySelector('input').checked = true;
  if (state?.text !== undefined) card.querySelector('textarea').value = state.text;
  card.querySelector('.reset').onclick = () => { card.querySelector('textarea').value = card.dataset.lines; card.querySelector('input').checked = false; refresh(); };
}
document.addEventListener('input', refresh); refresh();
download.onclick = () => {
  const out = { remove: [], corrections: {} };
  for (const card of document.querySelectorAll('.card')) {
    if (card.classList.contains('remove')) out.remove.push(card.dataset.name);
    else if (card.classList.contains('edited') && card.dataset.now) out.corrections[card.dataset.name] = card.dataset.now;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
  a.download = 'label_review_changes.json'; a.click();
};
</script>"""


def write_page(output):
    kind = {Path(r['image_path']).name: r['source_kind'] for r in csv.DictReader((ROOT / 'ml/training_manifest.csv').open())}
    rows = []
    for split in ('train', 'validation', 'test'):
        for line in (output.parent / f'{split}.jsonl').open():
            row = json.loads(line)
            rows.append({**row, 'split': split, 'kind': kind[Path(row['image']).name]})
    with Pool() as pool:
        doubtful = [r for r in pool.map(flagged, rows, chunksize=200) if r['why']]
    doubtful.sort(key=lambda r: (r['kind'], r['song'], r['image']))
    cards = []
    for number, row in enumerate(doubtful, 1):
        name, lines = Path(row['image']).name, to_lines(row['target'])
        cards.append(
            f'<div class=card data-name="{html.escape(name)}" data-target="{html.escape(row["target"])}" data-lines="{html.escape(lines)}">'
            f'<b>#{number}</b> <label><input type=checkbox> remove this bar</label> <button class=reset>Undo my change</button>'
            f'<span class=src>{"Songsterr" if row["kind"] == "gp7" else "Reflow"} · {html.escape(row["song"])} · {row["split"]}</span>'
            f'<div class=why>{row["why"]}</div><img loading=lazy src="../dataset/images/{html.escape(name)}">'
            f'<textarea rows={max(3, lines.count(chr(10)) + 2)} spellcheck=false>{html.escape(lines)}</textarea><div class=err></div></div>')
    page = (PAGE.replace('__COUNT__', str(len(doubtful))).replace('__CARDS__', '\n'.join(cards))
            .replace('__DRUMS__', ' '.join(f'<code>{d}</code>' for d in DRUMS))
            .replace('__DURATIONS__', ' '.join(f'<code>{d}</code>' for d in DUR_IDX))
            .replace('__DRUM_LIST__', json.dumps(DRUMS)).replace('__DUR_LIST__', json.dumps(list(DUR_IDX))))
    output.write_text(page)
    print(f'{len(doubtful)} of {len(rows)} bars to check → {output.relative_to(ROOT)}')


def apply(changes_file):
    changes = json.loads(changes_file.read_text())
    for target in changes['corrections'].values():
        decode_text(target)                        # refuse anything the training text cannot hold
    listed = {line.strip() for line in EXCLUDED.read_text().splitlines()}
    new = [name for name in changes['remove'] if name not in listed]
    if new:
        with EXCLUDED.open('a') as out:
            out.write('# Removed in the label review:\n' + '\n'.join(new) + '\n')
    corrections = json.loads(CORRECTIONS.read_text()) if CORRECTIONS.is_file() else {}
    corrections.update(changes['corrections'])
    CORRECTIONS.write_text(json.dumps(corrections, indent=1, ensure_ascii=False) + '\n')
    print(f"{len(new)} bars added to {EXCLUDED.name}; {len(changes['corrections'])} labels corrected "
          f"({len(corrections)} in total). Now run ml/omr/prepare_finetune.py.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', type=Path, help='The label_review_changes.json downloaded from the page.')
    parser.add_argument('--output', type=Path, default=ROOT / 'ml/data/finetune/label_review.html')
    args = parser.parse_args()
    apply(args.apply) if args.apply else write_page(args.output)
