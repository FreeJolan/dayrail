// Domain types — matches ERD §10. Discussion baseline; will iterate.
// Internal entity names stay English (see ERD §9.7 conventions).

export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekdays' } // Mon–Fri
  | { kind: 'custom'; weekdays: number[] }; // 0 = Sunday

export type Rail = {
  id: string;
  name: string;
  startMinutes: number; // 0–1439, minutes from 00:00 local
  durationMinutes: number;
  color: string; // Radix scale name (e.g. "sand", "teal")
  icon?: string;
  recurrence: Recurrence;
  signal: { enabled: boolean; leadMinutes?: number };
  templateId: string;
  lineId?: string;
};

export type Template = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type Track = {
  id: string;
  date: string; // YYYY-MM-DD in tz below
  tz: string;   // IANA tz pinned at day start
  templateId?: string;
};

export type CalendarRule = {
  id: string;
  kind: 'weekday' | 'cycle' | 'date-range' | 'single-date';
  value: unknown;
  priority: number;
};

export type RailInstanceStatus = 'pending' | 'active' | 'done' | 'skipped';

export type RailInstance = {
  id: string;
  railId: string;
  date: string;
  plannedStart: string; // ISO
  plannedEnd: string;
  actualStart?: string;
  actualEnd?: string;
  status: RailInstanceStatus;
  overrides?: Partial<Pick<Rail, 'name' | 'color' | 'icon' | 'durationMinutes'>>;
  sessionId?: string; // groups overrides from one Week-View planning session
};

export type ShiftType = 'postpone' | 'swap' | 'skip' | 'resize' | 'replace';

export type Shift = {
  id: string;
  railInstanceId: string;
  type: ShiftType;
  at: string;
  payload: Record<string, unknown>;
  tags?: string[];
};

export type Signal = {
  id: string;
  railInstanceId: string;
  triggeredAt: string;
  response: 'continue' | 'adjust' | 'skip' | 'timeout';
};

export type PhaseTransition = {
  id: string;
  lineId: string;
  fromPhaseId: string | null;
  toPhaseId: string;
  at: string;
  reason: 'days' | 'completions' | 'manual';
};

export type Phase = {
  id: string;
  name: string;
  targetRailIds?: string[];
  railOverrides: Partial<Rail>;
  advanceRule:
    | { type: 'days'; days: number }
    | { type: 'completions'; count: number }
    | { type: 'manual' };
};

export type Milestone = {
  id: string;
  name: string;
  weight: number; // 0–1, Σ=1
  targetRailIds?: string[];
  railOverrides: Partial<Rail>;
  doneAt?: string;
};

export type Line = {
  id: string;
  name: string;
  color?: string;
  createdAt: string;
  status: 'active' | 'archived';
  phases?: Phase[];
  currentPhaseId?: string;
  milestones?: Milestone[];
  dueDate?: string;
};

export type AdhocEvent = {
  id: string;
  date: string;
  startMinutes: number;
  durationMinutes: number;
  name: string;
  color?: string;
  lineId?: string;
};

// ========= Cycle planning =========

export type TemplateKey = 'workday' | 'restday';

export type Slot = {
  railId: string;
  taskName: string;
  progress: number; // 0–100
};

export type CycleDay = {
  date: string; // YYYY-MM-DD
  templateKey: TemplateKey;
  slots: Slot[];
};

export type Cycle = {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  days: CycleDay[];
};

// ========= Settings =========
// No account entity. Settings split into device-local (never synced)
// and synced (rides the same encrypted event log as user data).

export type SyncBackend = 'google-drive' | 'icloud' | 'webdav';
export type SyncScope = 'data' | 'settings' | 'all';

export type DeviceSettings = {
  deviceId: string;
  syncBackend?: SyncBackend | null;
  syncCredentials?: unknown; // OAuth / WebDAV creds — device-local ONLY
  passphraseCached?: boolean;
  uiLocale?: string;
  syncScope?: SyncScope; // user-facing three-mode toggle (§7.2.1)
  updatedAt: string;
};

export type SyncedSettings = {
  theme?: string;
  openrouterKeyCiphertext?: string;
  fallbackChain?: Array<{ model: string; paid: boolean }>;
  encryptionEnabled: boolean;
  aiOutputLocale?: string;
  notificationPrefs?: Record<string, unknown>;
  signalDefaults?: Record<string, unknown>;
  updatedAt: string;
};
