import { describe, expect, it, vi } from 'vitest';
import {
  attachStagingPersistence,
  createStagingStore,
  type StagingPersistence,
  type StagingProposal,
} from '../stagingStore';
import type { ProposalDraft } from '../intentStaging';

const DRAFT: ProposalDraft = { kind: 'task', title: '冥想', lineId: 'line-inbox', steps: [] };

describe('staging store · CRUD', () => {
  it('adds a proposal with a minted id + defaults', () => {
    const store = createStagingStore();
    const id = store.getState().addProposal({ draft: DRAFT });
    const p = store.getState().proposals[id];
    expect(p).toMatchObject({ source: 'manual' });
    expect(p?.draft.kind).toBe('task');
    expect(typeof p?.createdAt).toBe('number');
  });

  it('honors a caller-supplied id + source (MCP idempotency)', () => {
    const store = createStagingStore();
    const id = store
      .getState()
      .addProposal({ draft: DRAFT, id: 'prop-x', source: 'mcp', createdAt: 5 });
    expect(id).toBe('prop-x');
    expect(store.getState().proposals['prop-x']).toMatchObject({ source: 'mcp', createdAt: 5 });
  });

  it('updateProposal replaces the draft (e.g. shape switch)', () => {
    const store = createStagingStore();
    const id = store.getState().addProposal({ draft: DRAFT });
    const next: ProposalDraft = { kind: 'habit', name: '冥想', slots: [] };
    store.getState().updateProposal(id, next);
    expect(store.getState().proposals[id]?.draft.kind).toBe('habit');
  });

  it('updateProposal on a missing id is a no-op', () => {
    const store = createStagingStore();
    store.getState().updateProposal('nope', DRAFT);
    expect(store.getState().proposals).toEqual({});
  });

  it('discards a proposal', () => {
    const store = createStagingStore();
    const id = store.getState().addProposal({ draft: DRAFT });
    store.getState().discardProposal(id);
    expect(store.getState().proposals[id]).toBeUndefined();
  });

  it('clear empties the tray', () => {
    const store = createStagingStore();
    store.getState().addProposal({ draft: DRAFT });
    store.getState().addProposal({ draft: DRAFT });
    store.getState().clear();
    expect(Object.keys(store.getState().proposals)).toHaveLength(0);
  });
});

function memPersistence(seed?: Record<string, StagingProposal>) {
  let saved: Record<string, StagingProposal> | null = seed ?? null;
  const save = vi.fn(async (p: Record<string, StagingProposal>) => {
    saved = p;
  });
  const persistence: StagingPersistence = { load: async () => saved, save };
  return {
    persistence,
    save,
    get saved() {
      return saved;
    },
  };
}

const seedProposal: StagingProposal = {
  id: 'prop-1',
  draft: DRAFT,
  source: 'mcp',
  createdAt: 1,
};

describe('staging store · persistence seam', () => {
  it('hydrates the tray from persistence on attach', async () => {
    const store = createStagingStore();
    const mem = memPersistence({ 'prop-1': seedProposal });
    await attachStagingPersistence(mem.persistence, store);
    expect(store.getState().proposals['prop-1']).toMatchObject({ source: 'mcp' });
  });

  it('does not save during the initial hydrate', async () => {
    const store = createStagingStore();
    const mem = memPersistence({ 'prop-1': seedProposal });
    await attachStagingPersistence(mem.persistence, store);
    expect(mem.save).not.toHaveBeenCalled();
  });

  it('persists on every change after attach', async () => {
    const store = createStagingStore();
    const mem = memPersistence();
    await attachStagingPersistence(mem.persistence, store);
    const id = store.getState().addProposal({ draft: DRAFT });
    await Promise.resolve();
    expect(mem.save).toHaveBeenCalled();
    expect(mem.saved?.[id]).toBeDefined();
  });

  it('unsubscribe stops further persists', async () => {
    const store = createStagingStore();
    const mem = memPersistence();
    const unsub = await attachStagingPersistence(mem.persistence, store);
    unsub();
    store.getState().addProposal({ draft: DRAFT });
    await Promise.resolve();
    expect(mem.save).not.toHaveBeenCalled();
  });
});
