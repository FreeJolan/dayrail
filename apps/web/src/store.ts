import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  DEFAULT_RAILS_BY_TEMPLATE,
  DEFAULT_TEMPLATES,
  type Cycle,
  type CycleDay,
  type Rail,
  type RailInstance,
  type RailInstanceStatus,
  type Shift,
  type ShiftType,
  type Slot,
  type Template,
  type TemplateKey,
  type Track,
} from '@dayrail/core';

// In-memory + localStorage store for the v0.1-pre vertical slice.
// SQLite + event log land in v0.2 — see ERD §9.2 / §12.

const TEMPLATES_KEY = 'dayrail.templates.v1';
const RAILS_KEY = 'dayrail.rails.v1';
const CYCLES_KEY = 'dayrail.cycles.v1';
const ACTIVE_CYCLE_KEY = 'dayrail.activeCycle.v1';

const todayISO = () => new Date().toISOString().slice(0, 10);
const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const minutesToIso = (date: string, minutes: number) => {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0);
  dt.setMinutes(minutes);
  return dt.toISOString();
};

const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// Mon-Fri → workday; Sat-Sun → restday. User can override per day.
const defaultTemplateKeyForDate = (date: string): TemplateKey => {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(y!, (m ?? 1) - 1, d ?? 1).getDay(); // 0 = Sun
  return dow === 0 || dow === 6 ? 'restday' : 'workday';
};

const sundayOnOrAfter = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const dow = dt.getDay();
  const diff = dow === 0 ? 0 : 7 - dow;
  dt.setDate(dt.getDate() + diff);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

// Cascade rule (ERD §5.2 note): the next cycle starts the day after the
// previous one ends, and snaps its end to the next Sunday on or after its
// start. So extending the current cycle by N days "eats into" the next
// cycle's week — the next cycle just becomes shorter, ending on the natural
// Sunday boundary.
const defaultNextCycleRange = (prevEnd: string): { startDate: string; endDate: string } => {
  const start = addDays(prevEnd, 1);
  return { startDate: start, endDate: sundayOnOrAfter(start) };
};

const mondayOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  const dow = dt.getDay();
  const diff = dow === 0 ? -6 : 1 - dow; // back to Monday
  dt.setDate(dt.getDate() + diff);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

const safeParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const loadTemplates = (): Record<TemplateKey, Template> => {
  if (typeof localStorage === 'undefined') return DEFAULT_TEMPLATES;
  const stored = safeParse<Record<TemplateKey, Template> | null>(
    localStorage.getItem(TEMPLATES_KEY),
    null
  );
  return stored ?? DEFAULT_TEMPLATES;
};

const loadRails = (): Record<TemplateKey, Rail[]> => {
  if (typeof localStorage === 'undefined') return DEFAULT_RAILS_BY_TEMPLATE;
  const stored = safeParse<Record<TemplateKey, Rail[]> | Rail[] | null>(
    localStorage.getItem(RAILS_KEY),
    null
  );
  if (!stored) return DEFAULT_RAILS_BY_TEMPLATE;
  // Migration: older version stored a flat Rail[] (single template).
  if (Array.isArray(stored)) {
    return { workday: stored, restday: DEFAULT_RAILS_BY_TEMPLATE.restday };
  }
  return stored;
};

const loadCycles = (): Cycle[] => {
  if (typeof localStorage === 'undefined') return [];
  return safeParse<Cycle[]>(localStorage.getItem(CYCLES_KEY), []);
};

const loadActiveCycleId = (): string | null => {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(ACTIVE_CYCLE_KEY);
};

const save = (key: string, value: unknown) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota / private mode — drop silently; SQLite will be the real store
  }
};

const makeCycle = (startDate: string, endDate: string): Cycle => {
  const days: CycleDay[] = [];
  let cursor = startDate;
  while (cursor <= endDate) {
    days.push({ date: cursor, templateKey: defaultTemplateKeyForDate(cursor), slots: [] });
    cursor = addDays(cursor, 1);
  }
  return { id: uid('cyc'), startDate, endDate, days };
};

const buildInstancesFor = (
  date: string,
  rails: Rail[],
  cycle: Cycle | undefined
): RailInstance[] => {
  const day = cycle?.days.find((d) => d.date === date);
  const slotMap = new Map<string, Slot>();
  if (day) for (const s of day.slots) slotMap.set(s.railId, s);

  return rails
    .slice()
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((rail) => {
      const slot = slotMap.get(rail.id);
      return {
        id: uid('ri'),
        railId: rail.id,
        date,
        plannedStart: minutesToIso(date, rail.startMinutes),
        plannedEnd: minutesToIso(date, rail.startMinutes + rail.durationMinutes),
        status: 'pending' as RailInstanceStatus,
        overrides: slot?.taskName ? { name: slot.taskName } : undefined,
      };
    });
};

const ensureActiveCycleForToday = (
  cycles: Cycle[],
  activeId: string | null
): { cycles: Cycle[]; activeId: string } => {
  const today = todayISO();
  let active = cycles.find((c) => c.id === activeId);
  if (active && today >= active.startDate && today <= active.endDate) {
    return { cycles, activeId: active.id };
  }
  // Find any cycle covering today
  active = cycles.find((c) => today >= c.startDate && today <= c.endDate);
  if (active) return { cycles, activeId: active.id };
  // Otherwise create a new Mon-Sun cycle containing today
  const start = mondayOf(today);
  const end = addDays(start, 6);
  const fresh = makeCycle(start, end);
  return { cycles: [...cycles, fresh], activeId: fresh.id };
};

const rebuildInstances = (
  date: string,
  rails: Rail[],
  cycle: Cycle | undefined,
  prev: RailInstance[]
): RailInstance[] => {
  const preserved = new Map<string, RailInstance>();
  for (const inst of prev) {
    if (inst.status === 'done' || inst.status === 'skipped') {
      preserved.set(inst.railId, inst);
    }
  }
  const day = cycle?.days.find((d) => d.date === date);
  const slotMap = new Map<string, Slot>();
  if (day) for (const s of day.slots) slotMap.set(s.railId, s);

  return rails
    .slice()
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((rail) => {
      const kept = preserved.get(rail.id);
      if (kept) {
        const slot = slotMap.get(rail.id);
        return slot?.taskName
          ? { ...kept, overrides: { ...kept.overrides, name: slot.taskName } }
          : kept;
      }
      const slot = slotMap.get(rail.id);
      return {
        id: uid('ri'),
        railId: rail.id,
        date,
        plannedStart: minutesToIso(date, rail.startMinutes),
        plannedEnd: minutesToIso(date, rail.startMinutes + rail.durationMinutes),
        status: 'pending' as RailInstanceStatus,
        overrides: slot?.taskName ? { name: slot.taskName } : undefined,
      };
    });
};

type State = {
  templates: Record<TemplateKey, Template>;
  railsByTemplate: Record<TemplateKey, Rail[]>;
  cycles: Cycle[];
  activeCycleId: string;
  track: Track;
  instances: RailInstance[];
  shifts: Shift[];
  now: number;
};

type RailDraft = {
  name: string;
  startMinutes: number;
  durationMinutes: number;
  color: string;
};

type Actions = {
  tick: () => void;
  recordShift: (instanceId: string, type: ShiftType, payload?: Record<string, unknown>) => void;
  setStatus: (instanceId: string, status: RailInstanceStatus) => void;
  markDone: (instanceId: string) => void;
  skip: (instanceId: string) => void;
  postpone: (instanceId: string, minutes: number) => void;
  addRail: (templateKey: TemplateKey, draft: RailDraft) => void;
  updateRail: (templateKey: TemplateKey, id: string, patch: Partial<RailDraft>) => void;
  deleteRail: (templateKey: TemplateKey, id: string) => void;
  resetRails: (templateKey: TemplateKey) => void;
  setCycleDayTemplate: (cycleId: string, date: string, templateKey: TemplateKey) => void;
  setSlot: (cycleId: string, date: string, railId: string, patch: Partial<Slot>) => void;
  createCycle: (startDate: string, endDate: string) => void;
  setActiveCycle: (cycleId: string) => void;
  updateCycleRange: (cycleId: string, startDate: string, endDate: string) => void;
  navigateCycle: (direction: 'prev' | 'next' | 'today') => void;
};

const today = todayISO();

export const useStore = create<State & Actions>()(
  immer((set) => {
    const templates = loadTemplates();
    const railsByTemplate = loadRails();
    const storedCycles = loadCycles();
    const { cycles, activeId } = ensureActiveCycleForToday(storedCycles, loadActiveCycleId());
    save(CYCLES_KEY, cycles);
    save(ACTIVE_CYCLE_KEY, activeId);

    const activeCycle = cycles.find((c) => c.id === activeId)!;
    const todayDay = activeCycle.days.find((d) => d.date === today);
    const templateKey: TemplateKey = todayDay?.templateKey ?? defaultTemplateKeyForDate(today);
    const rails = railsByTemplate[templateKey];

    return {
      templates,
      railsByTemplate,
      cycles,
      activeCycleId: activeId,
      track: { id: uid('trk'), date: today, tz: localTz(), templateId: templates[templateKey].id },
      instances: buildInstancesFor(today, rails, activeCycle),
      shifts: [],
      now: Date.now(),

      tick: () =>
        set((s) => {
          s.now = Date.now();
        }),

      recordShift: (instanceId, type, payload = {}) =>
        set((s) => {
          s.shifts.push({
            id: uid('sh'),
            railInstanceId: instanceId,
            type,
            at: new Date(s.now).toISOString(),
            payload,
          });
        }),

      setStatus: (instanceId, status) =>
        set((s) => {
          const inst = s.instances.find((i) => i.id === instanceId);
          if (inst) inst.status = status;
        }),

      markDone: (instanceId) =>
        set((s) => {
          const inst = s.instances.find((i) => i.id === instanceId);
          if (!inst) return;
          inst.status = 'done';
          inst.actualEnd = new Date(s.now).toISOString();
        }),

      skip: (instanceId) =>
        set((s) => {
          const inst = s.instances.find((i) => i.id === instanceId);
          if (!inst) return;
          inst.status = 'skipped';
          s.shifts.push({
            id: uid('sh'),
            railInstanceId: instanceId,
            type: 'skip',
            at: new Date(s.now).toISOString(),
            payload: {},
          });
        }),

      postpone: (instanceId, minutes) =>
        set((s) => {
          const inst = s.instances.find((i) => i.id === instanceId);
          if (!inst) return;
          const start = new Date(inst.plannedStart).getTime() + minutes * 60_000;
          const end = new Date(inst.plannedEnd).getTime() + minutes * 60_000;
          inst.plannedStart = new Date(start).toISOString();
          inst.plannedEnd = new Date(end).toISOString();
          s.shifts.push({
            id: uid('sh'),
            railInstanceId: instanceId,
            type: 'postpone',
            at: new Date(s.now).toISOString(),
            payload: { minutes },
          });
        }),

      addRail: (templateKey, draft) =>
        set((s) => {
          const rail: Rail = {
            id: uid('rail'),
            name: draft.name,
            startMinutes: draft.startMinutes,
            durationMinutes: draft.durationMinutes,
            color: draft.color,
            recurrence:
              templateKey === 'workday'
                ? { kind: 'weekdays' }
                : { kind: 'custom', weekdays: [0, 6] },
            signal: { enabled: false },
            templateId: s.templates[templateKey].id,
          };
          s.railsByTemplate[templateKey] = [...s.railsByTemplate[templateKey], rail];
          save(RAILS_KEY, s.railsByTemplate);
          refreshInstancesForToday(s);
        }),

      updateRail: (templateKey, id, patch) =>
        set((s) => {
          const list = s.railsByTemplate[templateKey];
          const rail = list.find((r) => r.id === id);
          if (!rail) return;
          if (patch.name !== undefined) rail.name = patch.name;
          if (patch.startMinutes !== undefined) rail.startMinutes = patch.startMinutes;
          if (patch.durationMinutes !== undefined) rail.durationMinutes = patch.durationMinutes;
          if (patch.color !== undefined) rail.color = patch.color;
          save(RAILS_KEY, s.railsByTemplate);
          refreshInstancesForToday(s);
        }),

      deleteRail: (templateKey, id) =>
        set((s) => {
          s.railsByTemplate[templateKey] = s.railsByTemplate[templateKey].filter(
            (r) => r.id !== id
          );
          for (const cycle of s.cycles) {
            for (const day of cycle.days) {
              day.slots = day.slots.filter((slot) => slot.railId !== id);
            }
          }
          save(RAILS_KEY, s.railsByTemplate);
          save(CYCLES_KEY, s.cycles);
          refreshInstancesForToday(s);
        }),

      resetRails: (templateKey) =>
        set((s) => {
          s.railsByTemplate[templateKey] = DEFAULT_RAILS_BY_TEMPLATE[templateKey];
          save(RAILS_KEY, s.railsByTemplate);
          refreshInstancesForToday(s);
        }),

      setCycleDayTemplate: (cycleId, date, templateKey) =>
        set((s) => {
          const cycle = s.cycles.find((c) => c.id === cycleId);
          if (!cycle) return;
          const day = cycle.days.find((d) => d.date === date);
          if (!day) return;
          day.templateKey = templateKey;
          day.slots = []; // different template means different rails; wipe stale slots
          save(CYCLES_KEY, s.cycles);
          refreshInstancesForToday(s);
        }),

      setSlot: (cycleId, date, railId, patch) =>
        set((s) => {
          const cycle = s.cycles.find((c) => c.id === cycleId);
          if (!cycle) return;
          const day = cycle.days.find((d) => d.date === date);
          if (!day) return;
          let slot = day.slots.find((x) => x.railId === railId);
          if (!slot) {
            slot = { railId, taskName: '', progress: 0 };
            day.slots.push(slot);
          }
          if (patch.taskName !== undefined) slot.taskName = patch.taskName;
          if (patch.progress !== undefined) slot.progress = patch.progress;
          save(CYCLES_KEY, s.cycles);
          if (date === s.track.date) refreshInstancesForToday(s);
        }),

      createCycle: (startDate, endDate) =>
        set((s) => {
          const cycle = makeCycle(startDate, endDate);
          s.cycles.push(cycle);
          s.activeCycleId = cycle.id;
          save(CYCLES_KEY, s.cycles);
          save(ACTIVE_CYCLE_KEY, cycle.id);
          refreshInstancesForToday(s);
        }),

      setActiveCycle: (cycleId) =>
        set((s) => {
          s.activeCycleId = cycleId;
          save(ACTIVE_CYCLE_KEY, cycleId);
          refreshInstancesForToday(s);
        }),

      updateCycleRange: (cycleId, startDate, endDate) =>
        set((s) => {
          if (startDate > endDate) return;
          s.cycles.sort((a, b) => a.startDate.localeCompare(b.startDate));
          const idx = s.cycles.findIndex((c) => c.id === cycleId);
          if (idx === -1) return;
          const cycle = s.cycles[idx]!;

          // Clamp start so it doesn't overlap the previous cycle
          const prev = s.cycles[idx - 1];
          const clampedStart = prev && startDate <= prev.endDate ? addDays(prev.endDate, 1) : startDate;
          if (clampedStart > endDate) return;

          // Preserve existing day data keyed by date
          const prior = new Map<string, CycleDay>();
          for (const d of cycle.days) prior.set(d.date, d);

          const newDays: CycleDay[] = [];
          let cursor = clampedStart;
          while (cursor <= endDate) {
            const existing = prior.get(cursor);
            if (existing) {
              newDays.push(existing);
            } else {
              newDays.push({
                date: cursor,
                templateKey: defaultTemplateKeyForDate(cursor),
                slots: [],
              });
            }
            cursor = addDays(cursor, 1);
          }
          cycle.startDate = clampedStart;
          cycle.endDate = endDate;
          cycle.days = newDays;

          // Drop all cycles that start after this one — they'll be regenerated
          // on demand per the cascade rule when the user navigates forward.
          const droppedIds = new Set(s.cycles.slice(idx + 1).map((c) => c.id));
          s.cycles = s.cycles.slice(0, idx + 1);
          if (droppedIds.has(s.activeCycleId)) s.activeCycleId = cycle.id;

          save(CYCLES_KEY, s.cycles);
          save(ACTIVE_CYCLE_KEY, s.activeCycleId);
          refreshInstancesForToday(s);
        }),

      navigateCycle: (direction) =>
        set((s) => {
          s.cycles.sort((a, b) => a.startDate.localeCompare(b.startDate));
          if (direction === 'today') {
            const today = todayISO();
            let hit = s.cycles.find((c) => today >= c.startDate && today <= c.endDate);
            if (!hit) {
              // No cycle covers today; create a fresh Mon-Sun one containing today
              const start = mondayOf(today);
              const end = addDays(start, 6);
              hit = makeCycle(start, end);
              s.cycles.push(hit);
              s.cycles.sort((a, b) => a.startDate.localeCompare(b.startDate));
            }
            s.activeCycleId = hit.id;
          } else if (direction === 'prev') {
            const idx = s.cycles.findIndex((c) => c.id === s.activeCycleId);
            if (idx > 0) s.activeCycleId = s.cycles[idx - 1]!.id;
          } else if (direction === 'next') {
            const idx = s.cycles.findIndex((c) => c.id === s.activeCycleId);
            if (idx === -1) return;
            let next = s.cycles[idx + 1];
            if (!next) {
              const current = s.cycles[idx]!;
              const range = defaultNextCycleRange(current.endDate);
              next = makeCycle(range.startDate, range.endDate);
              s.cycles.push(next);
            }
            s.activeCycleId = next.id;
          }
          save(CYCLES_KEY, s.cycles);
          save(ACTIVE_CYCLE_KEY, s.activeCycleId);
          refreshInstancesForToday(s);
        }),
    };
  })
);

// Helper used from within `set` callbacks to keep today's instances aligned
// with the template + slots of the cycle that actually contains today.
function refreshInstancesForToday(s: State) {
  const today = s.track.date;
  const cycle =
    s.cycles.find((c) => today >= c.startDate && today <= c.endDate) ??
    s.cycles.find((c) => c.id === s.activeCycleId);
  const day = cycle?.days.find((d) => d.date === today);
  const templateKey: TemplateKey = day?.templateKey ?? defaultTemplateKeyForDate(today);
  const rails = s.railsByTemplate[templateKey];
  s.track.templateId = s.templates[templateKey].id;
  s.instances = rebuildInstances(today, rails, cycle, s.instances);
}

export const selectRailById = (id: string) => (s: State) => {
  for (const key of Object.keys(s.railsByTemplate) as TemplateKey[]) {
    const hit = s.railsByTemplate[key].find((r) => r.id === id);
    if (hit) return hit;
  }
  return undefined;
};

export const selectTodayCycle = (s: State): Cycle | undefined =>
  s.cycles.find((c) => s.track.date >= c.startDate && s.track.date <= c.endDate);

export const selectTodayTemplateKey = (s: State): TemplateKey => {
  const cycle = selectTodayCycle(s);
  const day = cycle?.days.find((d) => d.date === s.track.date);
  return day?.templateKey ?? defaultTemplateKeyForDate(s.track.date);
};

export const selectTodayRails = (s: State): Rail[] =>
  s.railsByTemplate[selectTodayTemplateKey(s)];

export const selectTodaySlotForRail = (railId: string) => (s: State): Slot | undefined => {
  const cycle = selectTodayCycle(s);
  const day = cycle?.days.find((d) => d.date === s.track.date);
  return day?.slots.find((x) => x.railId === railId);
};

export const selectActiveCycle = (s: State): Cycle | undefined =>
  s.cycles.find((c) => c.id === s.activeCycleId);

export const selectActiveCycleId = (s: State): string => s.activeCycleId;

export type CurrentSlice = {
  current: RailInstance | null;
  next: RailInstance | null;
};

export const selectCurrentAndNext = (s: State): CurrentSlice => {
  const now = s.now;
  const sorted = s.instances
    .slice()
    .sort((a, b) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime());

  let current: RailInstance | null = null;
  let next: RailInstance | null = null;

  for (const inst of sorted) {
    if (inst.status === 'done' || inst.status === 'skipped') continue;
    const start = new Date(inst.plannedStart).getTime();
    const end = new Date(inst.plannedEnd).getTime();
    if (now >= start && now < end) {
      current = inst;
    } else if (now < start) {
      if (current && !next) {
        next = inst;
        break;
      }
      if (!current) {
        current = inst;
      }
    }
  }
  if (current && !next) {
    const idx = sorted.indexOf(current);
    for (let i = idx + 1; i < sorted.length; i++) {
      const cand = sorted[i]!;
      if (cand.status === 'pending') {
        next = cand;
        break;
      }
    }
  }
  return { current, next };
};
