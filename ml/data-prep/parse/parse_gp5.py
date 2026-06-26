"""
parse_gp5.py — Extract drum note data from GP5 files and save one JSON label per bar.

Output: labels/<safe_name>_bar001.json
Format:
{
  "song": "Alwin_Alwin Homework 6 June",
  "bar": 1,
  "time_signature": "4/4",
  "beats": [
    { "beat": "1",   "duration": "quarter", "drums": ["hi_hat_closed", "kick"] },
    { "beat": "1.5", "duration": "eighth",  "drums": ["hi_hat_closed"] },
    ...
  ]
}
"""

import os
import json
import guitarpro

GP5_DIR  = "/Volumes/T9/drum score reader/reflow_gp5"
OUT_DIR  = "/Volumes/T9/drum score reader/labels"

TICKS_PER_QUARTER = 960

# GP5 duration value → name
DURATION_NAMES = {
    1:  "whole",
    2:  "half",
    4:  "quarter",
    8:  "eighth",
    16: "sixteenth",
    32: "thirty_second",
}

TUPLET_NAMES = {
    3: "triplet",
    5: "quintuplet",
    6: "sextuplet",
    7: "septuplet",
}


def duration_name(dur_value: int, is_dotted: bool, tuplet_enters: int, tuplet_times: int) -> str:
    base = DURATION_NAMES.get(dur_value, str(dur_value))
    is_tuplet = tuplet_enters != tuplet_times
    parts = []
    if is_dotted:
        parts.append("dotted")
    if is_tuplet:
        parts.append(TUPLET_NAMES.get(tuplet_enters, f"{tuplet_enters}tuplet"))
    parts.append(base)
    return "_".join(parts)

# MIDI pitch → drum name
DRUM_MAP = {
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


def beat_position(tick_offset: int, ticks_per_quarter: int) -> str:
    """Convert tick offset within a bar to a beat string like '1', '1.5', '2.25'."""
    beat = 1 + tick_offset / ticks_per_quarter
    # Round to nearest 1/8 beat (32nd note precision)
    beat = round(beat * 8) / 8
    if beat == int(beat):
        return str(int(beat))
    return str(beat)


def parse_measure(measure, bar_number: int, song_name: str) -> dict:
    ts = measure.timeSignature
    events: dict[int, dict] = {}
    measure_start = measure.start

    for voice in measure.voices:
        for beat in voice.beats:
            if beat.status == guitarpro.BeatStatus.empty:
                continue

            offset = beat.start - measure_start
            dur_val   = beat.duration.value
            is_dotted = beat.duration.isDotted
            tuplet    = beat.duration.tuplet
            tuplet_enters = tuplet.enters if tuplet else 1
            tuplet_times  = tuplet.times  if tuplet else 1
            is_rest   = beat.status == guitarpro.BeatStatus.rest or not beat.notes
            has_flam  = getattr(beat.effect, 'grace', None) is not None
            pitches   = [n.value for n in beat.notes] if not is_rest else []

            if offset not in events:
                events[offset] = {
                    "duration":      dur_val,
                    "is_dotted":     is_dotted,
                    "tuplet_enters": tuplet_enters,
                    "tuplet_times":  tuplet_times,
                    "is_rest":       is_rest,
                    "has_flam":      has_flam,
                    "pitches":       set(),
                }
            events[offset]["pitches"].update(pitches)
            if has_flam:
                events[offset]["has_flam"] = True
            # A note beat beats a rest beat at the same offset
            if not is_rest:
                events[offset]["is_rest"] = False
            # Keep the shortest duration for this tick (most informative)
            if dur_val > events[offset]["duration"]:
                events[offset]["duration"]      = dur_val
                events[offset]["is_dotted"]     = is_dotted
                events[offset]["tuplet_enters"] = tuplet_enters
                events[offset]["tuplet_times"]  = tuplet_times

    beats_list = []
    for offset in sorted(events):
        ev = events[offset]
        entry: dict = {
            "beat": beat_position(offset, TICKS_PER_QUARTER),
            "duration": duration_name(
                ev["duration"], ev["is_dotted"],
                ev["tuplet_enters"], ev["tuplet_times"],
            ),
            "drums": [] if ev["is_rest"] else sorted({DRUM_MAP.get(p, f"midi{p}") for p in ev["pitches"]}),
        }
        if ev["is_rest"]:
            entry["rest"] = True
        if ev["has_flam"]:
            entry["flam"] = True
        beats_list.append(entry)

    # Simile bar: GP5 stores one-bar-repeat as a measure with no note content at all
    has_notes = any(not ev["is_rest"] for ev in events.values())
    is_simile = not has_notes and not beats_list or (
        not has_notes and all(ev["is_rest"] for ev in events.values())
        and len({ev["duration"] for ev in events.values()}) == 1
        and list(events.values())[0]["duration"] == 1  # single whole-note rest = likely simile
    )

    result: dict = {
        "song": song_name,
        "bar": bar_number,
        "time_signature": f"{ts.numerator}/{ts.denominator.value}",
        "beats": beats_list,
    }
    if is_simile:
        result["simile"] = True
    return result


def process_file(gp5_path: str, out_dir: str) -> tuple[int, int]:
    """Parse one GP5 file. Returns (bars_written, bars_skipped)."""
    song_name = os.path.splitext(os.path.basename(gp5_path))[0]
    written = skipped = 0

    try:
        song = guitarpro.parse(gp5_path)
    except Exception as e:
        print(f"  ERROR parsing: {e}")
        return 0, 0

    drum_track = next((t for t in song.tracks if t.isPercussionTrack), None)
    if drum_track is None:
        print("  no drum track, skipping")
        return 0, 0

    for bar_idx, measure in enumerate(drum_track.measures):
        bar_number = bar_idx + 1
        out_path = os.path.join(out_dir, f"{song_name}_bar{bar_number:03d}.json")

        label = parse_measure(measure, bar_number, song_name)
        if not label["beats"]:
            # Empty bar — still save it so image pairing stays aligned
            pass

        with open(out_path, "w") as f:
            json.dump(label, f, indent=2)
        written += 1

    return written, 0


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    files = sorted(f for f in os.listdir(GP5_DIR) if f.endswith(".gp5"))
    total_written = total_skipped = 0

    for i, fname in enumerate(files, 1):
        path = os.path.join(GP5_DIR, fname)
        print(f"[{i}/{len(files)}] {fname}")
        written, skipped = process_file(path, OUT_DIR)
        print(f"  {written} bars written, {skipped} skipped")
        total_written += written
        total_skipped += skipped

    print(f"\nDone. {total_written} label files written, {total_skipped} already existed.")


if __name__ == "__main__":
    main()
