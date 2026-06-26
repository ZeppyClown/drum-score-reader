"""
parse_gp7.py — Extract drum notes from Guitar Pro 7 (.gp) files.

GP7 files are ZIP archives containing Content/score.gpif (XML).
Output format matches parse_gp5.py exactly.

Output: labels/<safe_name>_bar001.json
"""

import json
import os
import zipfile
import xml.etree.ElementTree as ET
from fractions import Fraction

GP7_DIR = "/Volumes/T9/drum score reader/songsterr/guitar_pro"
OUT_DIR  = "/Volumes/T9/drum score reader/labels"

NOTE_VALUES: dict[str, Fraction] = {
    "Long":        Fraction(4, 1),
    "DoubleWhole": Fraction(2, 1),
    "Whole":       Fraction(1, 1),
    "Half":        Fraction(1, 2),
    "Quarter":     Fraction(1, 4),
    "Eighth":      Fraction(1, 8),
    "16th":        Fraction(1, 16),
    "32nd":        Fraction(1, 32),
    "64th":        Fraction(1, 64),
    "128th":       Fraction(1, 128),
}

NOTE_VALUE_NAMES: dict[str, str] = {
    "Whole":   "whole",
    "Half":    "half",
    "Quarter": "quarter",
    "Eighth":  "eighth",
    "16th":    "sixteenth",
    "32nd":    "thirty_second",
    "64th":    "sixty_fourth",
}

TUPLET_NAMES: dict[int, str] = {
    3: "triplet",
    5: "quintuplet",
    6: "sextuplet",
    7: "septuplet",
}

# Identical to parse_gp5.py
DRUM_MAP: dict[int, str] = {
    35: "kick",
    36: "kick",
    37: "snare_rim",
    38: "snare",
    39: "clap",
    40: "snare",
    41: "floor_tom_2",
    42: "hi_hat_closed",
    43: "floor_tom_1",
    44: "hi_hat_pedal",
    45: "tom_mid",
    46: "hi_hat_open_half",
    47: "tom_mid",
    48: "tom_hi",
    49: "crash",
    50: "tom_hi",
    51: "ride",
    52: "china",
    53: "ride_bell",
    55: "splash",
    56: "cowbell",
    57: "crash",
    59: "ride",
    91: "snare_rimshot",
    92: "hi_hat_open_full",
    96: "choked_crash",
    97: "choked_crash",
    98: "choked_crash",
    93: "ride_tie",
    31: "sticks",
    54: "crash",
}


def beat_position(offset: Fraction) -> str:
    """Convert fractional bar offset (in whole notes) to beat string like '1', '1.5', '2.25'."""
    beat = float(1 + offset * 4)
    beat = round(beat * 8) / 8  # round to nearest 32nd note
    if beat == int(beat):
        return str(int(beat))
    return str(beat)


def duration_name(note_value: str, is_dotted: bool, tuplet_num: int, tuplet_den: int) -> str:
    base = NOTE_VALUE_NAMES.get(note_value, note_value.lower())
    parts = []
    if is_dotted:
        parts.append("dotted")
    if tuplet_num != tuplet_den:
        parts.append(TUPLET_NAMES.get(tuplet_num, f"{tuplet_num}tuplet"))
    parts.append(base)
    return "_".join(parts)


def beat_duration(note_value: str, is_dotted: bool, tuplet_num: int, tuplet_den: int) -> Fraction:
    dur = NOTE_VALUES.get(note_value, Fraction(1, 4))
    if is_dotted:
        dur = dur * Fraction(3, 2)
    if tuplet_num != tuplet_den:
        dur = dur * Fraction(tuplet_den, tuplet_num)
    return dur


class GpifParser:
    def __init__(self, root: ET.Element):
        self.root = root
        self._bars    = {b.get("id"): b for b in root.findall(".//Bar")}
        self._voices  = {v.get("id"): v for v in root.findall(".//Voice")}
        self._beats   = {b.get("id"): b for b in root.findall(".//Beat")}
        self._notes   = {n.get("id"): n for n in root.findall(".//Note")}
        self._rhythms = {r.get("id"): r for r in root.findall(".//Rhythm")}
        self._master_bars = root.findall(".//MasterBar")

    def _parse_rhythm(self, rhythm_id: str) -> tuple[str, bool, int, int]:
        """Returns (note_value, is_dotted, tuplet_num, tuplet_den)."""
        r = self._rhythms.get(rhythm_id)
        if r is None:
            return "Quarter", False, 1, 1
        note_value = r.findtext("NoteValue", "Quarter")
        is_dotted  = r.find("AugmentationDot") is not None
        tuplet = r.find("PrimaryTuplet")
        if tuplet is not None:
            tuplet_num = int(tuplet.get("num", "1"))
            tuplet_den = int(tuplet.get("den", "1"))
        else:
            tuplet_num = tuplet_den = 1
        return note_value, is_dotted, tuplet_num, tuplet_den

    def _note_midi(self, note_id: str) -> tuple[int, bool] | None:
        """Returns (midi_pitch, is_ghost) or None if not found."""
        note = self._notes.get(note_id)
        if note is None:
            return None
        midi = None
        for prop in note.findall("Properties/Property"):
            if prop.get("name") == "Midi":
                num = prop.findtext("Number")
                if num is not None:
                    midi = int(num)
        if midi is None:
            return None
        is_ghost = note.find("AntiAccent") is not None
        return midi, is_ghost

    def find_drum_track_index(self) -> int | None:
        """Find the track index whose bars use a Neutral (percussion) clef."""
        for mb in self._master_bars:
            bar_ids = mb.findtext("Bars", "").split()
            for idx, bid in enumerate(bar_ids):
                if bid == "-1":
                    continue
                bar = self._bars.get(bid)
                if bar is not None and bar.findtext("Clef") == "Neutral":
                    return idx
        return None

    def parse_bar(self, drum_track_idx: int, master_bar_idx: int, song_name: str) -> dict:
        mb = self._master_bars[master_bar_idx]
        time_sig = mb.findtext("Time", "4/4")
        bar_number = master_bar_idx + 1

        bar_ids = mb.findtext("Bars", "").split()
        empty = {"song": song_name, "bar": bar_number, "time_signature": time_sig, "beats": []}

        if drum_track_idx >= len(bar_ids):
            return empty

        bar_id = bar_ids[drum_track_idx]
        if bar_id == "-1":
            return empty

        bar = self._bars.get(bar_id)
        if bar is None:
            return empty

        # Merge events from all voices, keyed by bar offset (Fraction of whole note)
        events: dict[Fraction, dict] = {}

        for vid in bar.findtext("Voices", "").split():
            if vid == "-1":
                continue
            voice = self._voices.get(vid)
            if voice is None:
                continue

            offset = Fraction(0)
            for bid in voice.findtext("Beats", "").split():
                beat = self._beats.get(bid)
                if beat is None:
                    continue

                r_elem = beat.find("Rhythm")
                if r_elem is None:
                    continue
                rhythm_ref = r_elem.get("ref")

                note_value, is_dotted, tuplet_num, tuplet_den = self._parse_rhythm(rhythm_ref)
                dur = beat_duration(note_value, is_dotted, tuplet_num, tuplet_den)

                note_ids_str = beat.findtext("Notes", "").strip()
                pitches: set[tuple[int, bool]] = set()
                for nid in (note_ids_str.split() if note_ids_str else []):
                    result = self._note_midi(nid)
                    if result is not None:
                        pitches.add(result)

                if pitches:
                    if offset not in events:
                        events[offset] = {
                            "note_value": note_value,
                            "is_dotted":  is_dotted,
                            "tuplet_num": tuplet_num,
                            "tuplet_den": tuplet_den,
                            "pitches":    set(),
                            "is_rest":    False,
                        }
                    events[offset]["pitches"].update(pitches)
                    events[offset]["is_rest"] = False
                    # Keep the shortest (most specific) duration at this offset
                    existing = NOTE_VALUES.get(events[offset]["note_value"], Fraction(1, 4))
                    incoming = NOTE_VALUES.get(note_value, Fraction(1, 4))
                    if incoming < existing:
                        events[offset].update({
                            "note_value": note_value,
                            "is_dotted":  is_dotted,
                            "tuplet_num": tuplet_num,
                            "tuplet_den": tuplet_den,
                        })
                else:
                    if offset not in events:
                        events[offset] = {
                            "note_value": note_value,
                            "is_dotted":  is_dotted,
                            "tuplet_num": tuplet_num,
                            "tuplet_den": tuplet_den,
                            "pitches":    set(),
                            "is_rest":    True,
                        }

                offset += dur

        beats_list = []
        for offset in sorted(events):
            ev = events[offset]
            drums = sorted({
                DRUM_MAP.get(midi, f"midi{midi}") + ("_ghost" if is_ghost else "")
                for midi, is_ghost in ev["pitches"]
            })
            for d in drums:
                if d.startswith('midi'):
                    print(f"Warning: unmapped Midi {d[4:]} in {song_name} bar {bar_number}")
            entry = {
                "beat":     beat_position(offset),
                "duration": duration_name(ev["note_value"], ev["is_dotted"], ev["tuplet_num"], ev["tuplet_den"]),
                "drums":    drums,
            }
            if ev.get("is_rest", False) and not drums:
                entry["rest"] = True
            beats_list.append(entry)

        return {
            "song":           song_name,
            "bar":            bar_number,
            "time_signature": time_sig,
            "beats":          beats_list,
        }


def process_file(gp_path: str, out_dir: str) -> int:
    song_name = os.path.splitext(os.path.basename(gp_path))[0]

    try:
        with zipfile.ZipFile(gp_path) as zf:
            with zf.open("Content/score.gpif") as f:
                tree = ET.parse(f)
    except Exception as e:
        print(f"  ERROR reading: {e}")
        return 0

    parser = GpifParser(tree.getroot())
    drum_idx = parser.find_drum_track_index()
    if drum_idx is None:
        print("  no drum track found, skipping")
        return 0

    written = 0
    for mb_idx in range(len(parser._master_bars)):
        bar_number = mb_idx + 1
        out_path = os.path.join(out_dir, f"{song_name}_bar{bar_number:03d}.json")
        label = parser.parse_bar(drum_idx, mb_idx, song_name)
        with open(out_path, "w") as f:
            json.dump(label, f, indent=2)
        written += 1

    return written


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    files = sorted(f for f in os.listdir(GP7_DIR) if f.endswith(".gp"))
    if not files:
        print(f"No .gp files found in {GP7_DIR}")
        return
    total = 0
    for i, fname in enumerate(files, 1):
        path = os.path.join(GP7_DIR, fname)
        print(f"[{i}/{len(files)}] {fname}")
        n = process_file(path, OUT_DIR)
        print(f"  {n} bars written")
        total += n
    print(f"\nDone. {total} label files written.")


if __name__ == "__main__":
    main()
