// ── Import review ─────────────────────────────────────────────────────────────
// Which imported bars still need a person to check them. Pure, tested in Node.
// A bar is only ever marked reviewed by markReviewedCommand (an explicit action);
// editing an imported bar does not review it.

export const needsReview = bar => bar.provenance?.reviewed === false;

export function reviewSummary(bars) {
  const indices = bars.flatMap((bar, i) => (needsReview(bar) ? [i] : []));
  return {
    count: indices.length,
    total: bars.length,
    indices,
    warnings: indices.reduce((sum, i) => sum + bars[i].provenance.warnings.length, 0),
  };
}

// The next unreviewed bar after fromIndex, wrapping to the start; fromIndex itself only
// when it is the sole unreviewed bar. -1 when everything is reviewed.
export function nextUnreviewed(bars, fromIndex) {
  for (let step = 1; step <= bars.length; step++) {
    const i = (fromIndex + step) % bars.length;
    if (needsReview(bars[i])) return i;
  }
  return -1;
}
