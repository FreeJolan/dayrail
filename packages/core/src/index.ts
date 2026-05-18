// @dayrail/core — domain logic + Yjs-backed Zustand store (v0.7).
//
// v0.7 (ERD §7.7) replaced the v0.6 event-sourced model (events +
// snapshots + HLC + session SQL tables) with a Y.Doc-backed store
// persisted to OPFS as a `.dryj` binary. Sessions live in zustand
// only; their undo history is tracked by per-session Y.UndoManager.

export * from './store';
export * from './today';
export * from './types';
export * from './autoTask';
export * from './reschedule';
export * from './unschedule';
export * from './revisions';
export * from './externalEvents';
export * from './ai';
export * from './smartDiff';
export * from './identityPin';
export * from './syncStatus';
export * from './modeRegression';
