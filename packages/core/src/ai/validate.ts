// ERD §6.6.2 v0.8.2 — lenient validator for the citation-bound output
// schema. The strict shape is `{ headline, observations: [{ claim,
// from_data }], questions_to_sit_with }`, but real models drift in
// predictable ways:
//
//   - Code-tuned models (Claude / OpenAI code variants) bleed in
//     "finding + severity + priority" lint-style schemas. We map
//     `finding` → `claim` and drop the rest.
//   - Some models prefer `quote` / `evidence` over `from_data`.
//   - Some models forget the headline entirely, or substitute
//     `summary` / `takeaway`.
//   - Some models omit empty arrays.
//
// Substance > syntax: when the AI gives us correctly-grounded
// observations under wrong field names, we accept the substance and
// move on. We still throw `parse-error` when the response isn't even
// approximately the right thing (e.g. plain prose, completely wrong
// keys, no observations field at all).

import { AiClientError } from './client';
import type { AiObservationItem, AiObservationJson } from '../types';

/** Common alias keys mapped to canonical schema names. Order matters
 *  for `headline` synthesis fallback: we try these in declaration
 *  order before giving up. */
const HEADLINE_ALIASES = ['headline', 'summary', 'takeaway', 'title'] as const;
const CLAIM_ALIASES = ['claim', 'finding', 'observation', 'point'] as const;
const FROM_DATA_ALIASES = ['from_data', 'evidence', 'quote', 'source'] as const;
const QUESTIONS_ALIASES = [
  'questions_to_sit_with',
  'questions',
  'open_questions',
  'reflection_prompts',
] as const;

/** Validate the parsed JSON against the v0.8.2 citation-bound schema.
 *
 *  Lenient by design: aliases common drifts, ignores extra fields, and
 *  synthesizes `headline` from the first observation if the model
 *  forgot it. Throws `AiClientError('parse-error')` only when the
 *  response is unrecognizable (no observations, no headline candidate,
 *  not even an object). */
export function validateObservationJson(raw: unknown): AiObservationJson {
  if (!raw || typeof raw !== 'object') {
    throw new AiClientError(
      'parse-error',
      'AI response was not a JSON object.',
    );
  }
  const obj = raw as Record<string, unknown>;

  // ---- observations ----
  const rawObs = pickAlias(obj, [
    'observations',
    'findings',
    'notes',
    'points',
  ]);
  let observations: AiObservationItem[] = [];
  if (rawObs !== undefined && rawObs !== null) {
    if (!Array.isArray(rawObs)) {
      throw new AiClientError(
        'parse-error',
        'AI response field "observations" must be an array.',
      );
    }
    observations = rawObs.flatMap((item, idx) => {
      const norm = normalizeObservationItem(item, idx);
      return norm ? [norm] : [];
    });
  }

  // ---- headline (with synthesis fallback) ----
  let headline = pickStringAlias(obj, HEADLINE_ALIASES);
  if (!headline) {
    if (observations.length > 0 && observations[0]) {
      headline = synthesizeHeadline(observations[0].claim);
    }
  }
  if (!headline) {
    throw new AiClientError(
      'parse-error',
      'AI response has neither a headline-style field nor any usable observations.',
    );
  }

  // ---- questions_to_sit_with ----
  const rawQ = pickAlias(obj, QUESTIONS_ALIASES);
  let questions_to_sit_with: string[] = [];
  if (rawQ !== undefined && rawQ !== null) {
    if (!Array.isArray(rawQ)) {
      throw new AiClientError(
        'parse-error',
        'AI response field "questions_to_sit_with" must be an array of strings.',
      );
    }
    questions_to_sit_with = rawQ.flatMap((q) =>
      typeof q === 'string' && q.trim().length > 0 ? [q] : [],
    );
  }

  return { headline, observations, questions_to_sit_with };
}

/** Pull the first non-empty string value out of `obj` keyed by any of
 *  the alias names. Used for headline-style fields. */
function pickStringAlias(
  obj: Record<string, unknown>,
  aliases: readonly string[],
): string | undefined {
  for (const key of aliases) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/** Pull the first present (defined and non-null) value out of `obj`
 *  keyed by any of the alias names. Used for arrays and other
 *  non-string fields where presence matters more than truthiness. */
function pickAlias(
  obj: Record<string, unknown>,
  aliases: readonly string[],
): unknown {
  for (const key of aliases) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

/** Normalize one observation item. Returns null when the item is
 *  unsalvageable so the caller can flatMap it out. */
function normalizeObservationItem(
  item: unknown,
  idx: number,
): AiObservationItem | null {
  if (item === null || item === undefined) return null;
  if (typeof item === 'string') {
    // Bare string entries can appear when the model abandons the
    // object structure for the inner array. Keep the string as the
    // claim, leave from_data empty (renderer marks it).
    return item.trim().length > 0 ? { claim: item, from_data: '' } : null;
  }
  if (typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const claim = pickStringAlias(o, CLAIM_ALIASES);
  if (!claim) {
    // No claim-shaped field; this entry is unreadable. Drop it
    // silently rather than failing the whole call.
    void idx; // index kept for potential future logging hook
    return null;
  }
  const from_data = pickStringAlias(o, FROM_DATA_ALIASES) ?? '';
  return { claim, from_data };
}

/** Build a one-line headline from a claim when the model forgot to
 *  produce one. Trims to ~60 visible chars. */
function synthesizeHeadline(claim: string): string {
  const trimmed = claim.trim();
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 59)}…`;
}
