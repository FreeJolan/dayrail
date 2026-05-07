// ERD §6.6 v0.8.2 — AI MVP public surface for `@dayrail/core`.
//
// `client.ts` — OpenAI-compat fetch + SSE parser + JSON extraction.
// `prompts.ts` — Day / Cycle scenario builders + system prompt + token
//                estimate. Pure functions; UI hands in shaped data.

export * from './client';
export * from './prompts';
export * from './validate';
