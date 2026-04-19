// Static sample for the Template Editor mockup. Shape matches the
// subset of ERD §10 Rail / Template types that the editor touches.
import type { RailColor } from './sample';

/** Widened from the original closed union so Cycle-View code can feed
 *  store-held templates (whose keys are user-defined strings) into the
 *  same prop shapes. The sample defaults (`workday` / `restday` /
 *  `deep` / `travel`) still work as-is. */
export type TemplateKey = string;

export interface SampleTemplate {
  key: TemplateKey;
  label: string;
  /** Template.color — tab under-strip + Cycle View column tint etc. */
  color: RailColor;
  builtIn: boolean;
}

export interface EditableRail {
  id: string;
  name: string;
  subtitle?: string;
  /** Minutes from 00:00. Authoritative ordering key. */
  startMin: number;
  endMin: number;
  color: RailColor;
  /** ERD §5.6 — does this Rail surface on the check-in strip? */
  showInCheckin: boolean;
}

// First-run seed. Minimal by design: the two built-in templates
// (workday + restday) with zero rails. Users build their own
// schedule in Template Editor rather than deleting demo data they
// don't want. Color contrast (indigo / amber) kept for Calendar
// month-grid legibility.
export const SAMPLE_TEMPLATES: SampleTemplate[] = [
  { key: 'workday', label: 'Workday', color: 'indigo', builtIn: true },
  { key: 'restday', label: 'Restday', color: 'amber', builtIn: true },
];

export const SAMPLE_RAILS_BY_TEMPLATE: Record<TemplateKey, EditableRail[]> = {
  workday: [],
  restday: [],
};

// --- derived summary (the strip under the tab bar consumes this) ---

export interface TemplateSummary {
  railCount: number;
  totalMin: number;
  firstMin: number; // start of the earliest Rail
  lastMin: number; // end of the latest Rail
  gaps: Array<{ startMin: number; endMin: number }>;
  gapTotalMin: number;
}

export function computeSummary(rails: EditableRail[]): TemplateSummary {
  if (rails.length === 0) {
    return { railCount: 0, totalMin: 0, firstMin: 0, lastMin: 0, gaps: [], gapTotalMin: 0 };
  }
  const sorted = rails.slice().sort((a, b) => a.startMin - b.startMin);
  const firstMin = sorted[0]!.startMin;
  const lastMin = sorted[sorted.length - 1]!.endMin;
  const totalMin = sorted.reduce((sum, r) => sum + (r.endMin - r.startMin), 0);
  const gaps: TemplateSummary['gaps'] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1]!;
    if (next.startMin > cur.endMin) {
      gaps.push({ startMin: cur.endMin, endMin: next.startMin });
    }
  }
  const gapTotalMin = gaps.reduce((s, g) => s + (g.endMin - g.startMin), 0);
  return { railCount: rails.length, totalMin, firstMin, lastMin, gaps, gapTotalMin };
}

// --- formatting helpers ---

export const fmtHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const fmtDurationHours = (m: number) => {
  const h = m / 60;
  if (Number.isInteger(h)) return `${h}h`;
  return `${h.toFixed(1)}h`;
};

export const fmtDurationShort = (m: number) => {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `${h}h`;
  return `${h}h${rem}`;
};
