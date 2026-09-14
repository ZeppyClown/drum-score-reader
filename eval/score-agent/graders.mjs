// Graders for one Ask DrumHub answer against its question-bank expectations.
// Deterministic checks only. A model judge (e.g. Gemini on synthetic data) may be added
// only after its agreement with teachers is measured (plan §4 I3).
import { unsupportedClaims } from '../../js/agent-contract.js';

const covers = (ref, [from, to]) => ref.fromBar <= from && ref.toBar >= to;
const overlaps = (ref, [from, to]) => ref.fromBar <= to && ref.toBar >= from;
const regex = pattern => new RegExp(pattern, 'i');

// A sentence is grounded when every bar number it names is inside the shared bars and
// inside one of the answer's references (or the answer abstained).
export function groundedSentences(answer, snapshot) {
  const sentences = answer.answer.split(/(?<=[.!?])\s+/).filter(Boolean);
  const results = sentences.map(sentence => {
    const numbers = [...sentence.matchAll(/\bbars?\s+(\d+)(?:\s*[–-]\s*(\d+))?/gi)]
      .flatMap(m => (m[2] ? [Number(m[1]), Number(m[2])] : [Number(m[1])]));
    const grounded = numbers.every(n => n >= snapshot.range.fromBar && n <= snapshot.range.toBar &&
      answer.references.some(r => n >= r.fromBar && n <= r.toBar));
    return { sentence, numbers, grounded: numbers.length === 0 || grounded || answer.abstained };
  });
  return { total: results.length, grounded: results.filter(r => r.grounded).length, ungrounded: results.filter(r => !r.grounded).map(r => r.sentence) };
}

// Returns { checks: { name: true|false|null }, failures: [text] }. null = not applicable.
export function gradeAnswer(answer, snapshot, expect = {}) {
  const checks = {};
  const failures = [];
  const record = (name, passed, message) => {
    checks[name] = passed;
    if (passed === false) failures.push(message);
  };

  const invalidRefs = answer.references.filter(r => !(Number.isInteger(r.fromBar) && Number.isInteger(r.toBar) &&
    r.fromBar >= snapshot.range.fromBar && r.toBar <= snapshot.range.toBar && r.fromBar <= r.toBar &&
    snapshot.bars.some(b => b.barId === r.fromBarId && b.barNumber === r.fromBar) &&
    snapshot.bars.some(b => b.barId === r.toBarId && b.barNumber === r.toBar)));
  record('citationsValid', invalidRefs.length === 0, `invalid references: ${JSON.stringify(invalidRefs)}`);

  const missing = (expect.mustReference ?? []).filter(range => !answer.references.some(r => covers(r, range)));
  record('requiredReferences', expect.mustReference ? missing.length === 0 : null, `missing references to ${JSON.stringify(missing)}`);

  const forbidden = (expect.mustNotReference ?? []).filter(range => answer.references.some(r => overlaps(r, range)));
  record('forbiddenReferences', expect.mustNotReference ? forbidden.length === 0 : null, `references bars that should not be cited: ${JSON.stringify(forbidden)}`);

  const unmentioned = (expect.mustMention ?? []).filter(p => !regex(p).test(answer.answer));
  record('facts', expect.mustMention ? unmentioned.length === 0 : null, `answer does not mention ${unmentioned.join(', ')}`);

  const said = (expect.mustNotMention ?? []).filter(p => regex(p).test(answer.answer));
  record('forbiddenText', expect.mustNotMention ? said.length === 0 : null, `answer mentions ${said.join(', ')}`);

  record('abstention', typeof expect.abstain === 'boolean' ? answer.abstained === expect.abstain : null,
    `abstained was ${answer.abstained}, expected ${expect.abstain}`);

  const discloses = answer.caveats.some(c => /imported and not checked yet/.test(c));
  record('unreviewedDisclosure', expect.disclosesUnreviewed === true ? discloses : null, 'did not warn about unchecked imported bars');

  const caveatMissing = (expect.caveatMentions ?? []).filter(text => !answer.caveats.some(c => c.includes(text)));
  record('caveats', expect.caveatMentions ? caveatMissing.length === 0 : null, `missing caveat: ${caveatMissing.join(', ')}`);

  const claims = unsupportedClaims(answer.answer);
  record('noUnsupportedClaims', claims.length === 0, `unsupported claims: ${claims.join(' | ')}`);

  const grounding = groundedSentences(answer, snapshot);
  checks.groundedSentences = grounding;
  if (grounding.ungrounded.length) failures.push(`ungrounded: ${grounding.ungrounded.join(' | ')}`);

  return { checks, failures };
}
