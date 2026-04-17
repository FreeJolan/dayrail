// @dayrail/core — domain logic + event bus + session registry.
//
// This package wraps @dayrail/db with the event-sourced model described
// in ERD §5.3.1 (Edit Sessions) and docs/v0.2-plan.md (HLC clock,
// snapshot cadence, session-level undo).

export * from './hlc';
export * from './event';
export * from './session';
export * from './snapshot';
export * from './store';
export * from './types';
