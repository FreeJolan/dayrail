import { describe, expect, it, vi } from 'vitest';
import {
  attachStagingPersistence,
  createStagingStore,
  type StagingPersistence,
  type StagingProposal,
} from '../stagingStore';
import type { IntentSpec } from '../intentStaging';

const INTENT: IntentSpec = {
  title: '冥想',
  frequency: 'daily',
  times: [{ startMinutes: 7 * 60 }],
};

describe('staging store · CRUD', () => {
  it('adds a proposal with a minted id + defaults', () => {
    const store = createStagingStore();
    const id = store.getState().addProposal({ intent: INTENT, shape: 'habit' });
    const p = store.getState().proposals[id];
    expect(p).toMatchObject({ shape: 'habit', source: 'manual' });
    expect(p?.intent.title).toBe('冥想');
    expect(typeof p?.createdAt).toBe('number');
  });

  it('honors a caller-supplied id + source (MCP idempotency)', () => {
    const store = createStagingStore();
    const id = store
      .getState()
      .addProposal({ intent: INTENT, shape: 'task', id: 'prop-x', source: 'mcp', createdAt: 5 });
    expect(id).toBe('prop-x');
    expect(store.getState().proposals['prop-x']).toMatchObject({ source: 'mcp', createdAt: 5 });
  });

  it('switches shape without touching intent (shape switch)', () => {
    const store = createStagingStore();
    const id = store.getState().addProposal({ intent: INTENT, shape: 'habit' });
    store.getState().updateProposal(id, { shape: 'task' });
    expect(store.getState().proposals[id]?.shape).toBe('task');
    expect(store.getState().proposals[id]?.intent).toBe(INTENT);
  });

  it('edits intent (re-projection is derived by the UI, not stored)', () => {
    const store = createStagingStore();
    const id = store.getState().addProposal({ intent: INTENT, shape: 'habit' });
    const edited: IntentSpec = { ...INTENT, times: [{ startMinutes: 6 * 60 }] };
    store.getState().updateProposal(id, { intent: edited });
    expect(store.getState().proposals[id]?.intent.times[0]?.startMinutes).toBe(360);
  });

  it('updateProposal on a missing id is a no-op', () => {
    const store = createStagingStore();
    store.getState().updateProposal('nope', { shape: 'task' });
    expect(store.getState().proposals).toEqual({});
  });

  it('discards a proposal', () => {
    const store = createStagingStore();
    const id = store.getState().addProposal({ intent: INTENT, shape: 'habit' });
    store.getState().discardProposal(id);
    expect(store.getState().proposals[id]).toBeUndefined();
  });

  it('clear empties the tray', () => {
    const store = createStagingStore();
    store.getState().addProposal({ intent: INTENT, shape: 'habit' });
    store.getState().addProposal({ intent: INTENT, shape: 'task' });
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
  intent: INTENT,
  shape: 'habit',
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

  it('does not save during the initial hydrate — only on later changes', async () => {
    const store = createStagingStore();
    const mem = memPersistence({ 'prop-1': seedProposal });
    await attachStagingPersistence(mem.persistence, store);
    expect(mem.save).not.toHaveBeenCalled();
  });

  it('persists on every change after attach', async () => {
    const store = createStagingStore();
    const mem = memPersistence();
    await attachStagingPersistence(mem.persistence, store);
    const id = store.getState().addProposal({ intent: INTENT, shape: 'habit' });
    await Promise.resolve();
    expect(mem.save).toHaveBeenCalled();
    expect(mem.saved?.[id]).toBeDefined();
  });

  it('unsubscribe stops further persists', async () => {
    const store = createStagingStore();
    const mem = memPersistence();
    const unsub = await attachStagingPersistence(mem.persistence, store);
    unsub();
    store.getState().addProposal({ intent: INTENT, shape: 'habit' });
    await Promise.resolve();
    expect(mem.save).not.toHaveBeenCalled();
  });
});
