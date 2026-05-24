// Local staging tray for AI intent proposals (ERD §6.7.3).
//
// Holds "pending proposals" between arrival (paste / MCP / manual) and
// commit-or-discard. Deliberately NOT in the Y.Doc sync stream (§6.7.3):
// it's a deal-with-it-now queue with low cross-device value, and a
// proposal is self-contained — it goes in and out whole, heeding the
// §7.9 metadata-vs-data lifecycle lesson (don't split one logical thing
// across two media with different lifecycles).
//
// The store holds only `{ intent, shape }`; the projected plan / preview
// is DERIVED on demand via `projectIntent` and never stored — so editing
// the intent or switching the shape is just a field mutation and the UI
// re-projects (§6.7.2, "shape switch = deterministic re-projection").
//
// Persistence is an injected seam (`StagingPersistence`) so this module
// stays unit-testable without OPFS; the web app wires an OPFS-backed
// implementation (`OpfsJsonStore` in @dayrail/db) at boot.

import { create } from 'zustand';
import type { IntentSpec, ProposalShape } from './intentStaging';

/** Where a proposal entered the tray from — for the review-surface label. */
export type ProposalSource = 'paste' | 'mcp' | 'manual';

/** A pending proposal awaiting review (§6.7.3). */
export interface StagingProposal {
  id: string;
  intent: IntentSpec;
  shape: ProposalShape;
  source: ProposalSource;
  /** epoch ms. */
  createdAt: number;
}

export interface StagingState {
  proposals: Record<string, StagingProposal>;
}

export interface AddProposalInput {
  intent: IntentSpec;
  shape: ProposalShape;
  source?: ProposalSource;
  /** Caller-supplied id (e.g. MCP idempotency); minted when absent. */
  id?: string;
  createdAt?: number;
}

export interface StagingActions {
  /** Add a fresh proposal; returns its id. */
  addProposal(input: AddProposalInput): string;
  /** Edit a proposal's intent and/or shape (inline edits + shape switch). */
  updateProposal(id: string, patch: { intent?: IntentSpec; shape?: ProposalShape }): void;
  /** Remove a proposal — on commit (consumed) or discard. */
  discardProposal(id: string): void;
  /** Replace the whole tray (used when hydrating from persistence). */
  setProposals(proposals: Record<string, StagingProposal>): void;
  /** Empty the tray. */
  clear(): void;
}

export type StagingStore = StagingState & StagingActions;

function proposalId(): string {
  return `prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createStagingStore() {
  return create<StagingStore>()((set) => ({
    proposals: {},
    addProposal: (input) => {
      const id = input.id ?? proposalId();
      const proposal: StagingProposal = {
        id,
        intent: input.intent,
        shape: input.shape,
        source: input.source ?? 'manual',
        createdAt: input.createdAt ?? Date.now(),
      };
      set((s) => ({ proposals: { ...s.proposals, [id]: proposal } }));
      return id;
    },
    updateProposal: (id, patch) => {
      set((s) => {
        const cur = s.proposals[id];
        if (!cur) return s;
        const next: StagingProposal = {
          ...cur,
          ...(patch.intent ? { intent: patch.intent } : {}),
          ...(patch.shape ? { shape: patch.shape } : {}),
        };
        return { proposals: { ...s.proposals, [id]: next } };
      });
    },
    discardProposal: (id) => {
      set((s) => {
        if (!(id in s.proposals)) return s;
        const next = { ...s.proposals };
        delete next[id];
        return { proposals: next };
      });
    },
    setProposals: (proposals) => set({ proposals }),
    clear: () => set({ proposals: {} }),
  }));
}

/** App singleton. Tests use `createStagingStore()` for isolation. */
export const useStagingStore = createStagingStore();

export type StagingStoreApi = ReturnType<typeof createStagingStore>;

/** Persistence seam (§6.7.3). The OPFS-backed implementation lives in
 *  @dayrail/db (`OpfsJsonStore`); tests pass an in-memory stub. */
export interface StagingPersistence {
  load(): Promise<Record<string, StagingProposal> | null>;
  save(proposals: Record<string, StagingProposal>): Promise<void>;
}

/** Hydrate the tray from `persistence`, then persist on every change.
 *  Returns an unsubscribe fn. Subscribing happens AFTER hydrate, so the
 *  initial load doesn't trigger a redundant save. Save errors are
 *  swallowed (best-effort, same posture as the Drive heartbeat) so a
 *  write failure never breaks the review surface. */
export async function attachStagingPersistence(
  persistence: StagingPersistence,
  store: StagingStoreApi = useStagingStore,
): Promise<() => void> {
  const loaded = await persistence.load();
  if (loaded) store.getState().setProposals(loaded);
  return store.subscribe((state) => {
    void persistence.save(state.proposals).catch(() => undefined);
  });
}
