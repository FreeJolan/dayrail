import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  TOP_LEVEL_MAPS,
  readFlatStateFromDoc,
  createYDoc,
} from '@dayrail/db/yjs';
import { decodeDryj } from '@dayrail/db/dryj';
import * as Y from 'yjs';
import { createAgentDispatcher, type AgentResponse } from '../agent';
import { flushPersistence, getYDoc, useStore } from '../store';
import { INBOX_LINE_ID } from '../types';

const disk = vi.hoisted(() => ({
  bytes: null as Uint8Array | null,
  fail: false,
}));
vi.mock('@dayrail/db/yjsPersistence', () => ({
  loadYDocBytes: async () => null,
  saveYDocBytes: async (bytes: Uint8Array) => {
    if (disk.fail) throw new Error('Disk full');
    disk.bytes = bytes;
  },
}));
const dispatchers: ReturnType<typeof createAgentDispatcher>[] = [];
const today = '2026-11-03';
function client(options: Parameters<typeof createAgentDispatcher>[0] = {}) {
  const d = createAgentDispatcher(options);
  dispatchers.push(d);
  return {
    ...d,
    call: (method: string, params = {}, extra = {}) =>
      d.dispatch({ id: crypto.randomUUID(), method, params, ...extra }),
  };
}
function result<T = Record<string, unknown>>(r: AgentResponse): T {
  expect(r.ok, JSON.stringify(r.error)).toBe(true);
  return r.result as T;
}
beforeAll(async () => {
  await useStore.getState().hydrate();
});
beforeEach(async () => {
  disk.fail = false;
  const doc = getYDoc();
  doc.transact(() =>
    TOP_LEVEL_MAPS.forEach((name) => doc.getMap(name).clear()),
  );
  useStore.setState({ sessions: {} });
  await useStore.getState().createLine({
    id: INBOX_LINE_ID,
    name: 'Inbox',
    kind: 'project',
    status: 'active',
    isDefault: true,
    createdAt: 1,
  });
  await useStore
    .getState()
    .upsertTemplate(
      { key: 'workday', name: 'Work', isDefault: true },
      undefined,
      '1970-01-01',
    );
  await useStore.getState().createRail(
    {
      id: 'am',
      templateKey: 'workday',
      name: 'Morning',
      startMinutes: 540,
      durationMinutes: 60,
      color: 'sand',
      showInCheckin: false,
    },
    undefined,
    '1970-01-01',
  );
});
afterEach(async () => {
  disk.fail = false;
  await flushPersistence();
  dispatchers.splice(0).forEach((d) => d.dispose());
});

describe('live agent primitives', () => {
  it('updates the same UI subscription and durably saves before acknowledging scheduling', async () => {
    const c = client();
    const task = result(await c.call('task.create', { title: 'Write' }));
    const seen: unknown[] = [];
    const unsubscribe = useStore.subscribe((s) =>
      seen.push(s.tasks[String(task.id)]?.slot),
    );
    const response = await c.call('task.schedule', {
      id: task.id,
      railId: 'am',
      date: today,
    });
    result(response);
    unsubscribe();
    expect(seen).toContainEqual({
      date: today,
      railId: 'am',
      cycleId: 'cycle-2026-11-02',
    });
    const restored = createYDoc();
    Y.applyUpdate(restored, decodeDryj(disk.bytes!).update);
    expect(readFlatStateFromDoc(restored).tasks[String(task.id)]).toMatchObject(
      { slot: { date: today, railId: 'am' } },
    );
  });
  it('reads UI-authored changes immediately, without a disk reload', async () => {
    const c = client();
    const task = result(await c.call('task.create', { title: 'Before' }));
    const before = c.revision();
    await useStore.getState().updateTask(String(task.id), { title: 'After' });
    expect(result(await c.call('task.get', { id: task.id })).title).toBe(
      'After',
    );
    expect(c.revision()).not.toBe(before);
  });
  it('deduplicates concurrent writes and rejects request ID reuse with different arguments', async () => {
    const c = client();
    const request = {
      id: 'retry',
      method: 'task.create',
      params: { title: 'Once' },
    };
    const [a, b] = await Promise.all([
      c.dispatch(request),
      c.dispatch(request),
    ]);
    expect(a).toEqual(b);
    expect(Object.values(useStore.getState().tasks)).toHaveLength(1);
    expect(
      (await c.dispatch({ ...request, params: { title: 'Twice' } })).error
        ?.code,
    ).toBe('REQUEST_ID_CONFLICT');
  });
  it('rejects stale revisions including deletion-only edits', async () => {
    const c = client();
    const task = result(await c.call('task.create', { title: 'Write' }));
    const revision = c.revision();
    await useStore.getState().setReflection(today, 'note');
    await useStore.getState().setReflection(today, '');
    expect(
      (
        await c.call(
          'task.update',
          { id: task.id, patch: { title: 'Stale' } },
          { ifRevision: revision },
        )
      ).error?.code,
    ).toBe('REVISION_CONFLICT');
    expect(useStore.getState().tasks[String(task.id)]?.title).toBe('Write');
  });
  it('preserves existing scheduling on occurrence adoption and rejects parent scheduling', async () => {
    const c = client();
    const task = result(await c.call('task.create', { title: 'Write' }));
    result(
      await c.call('task.schedule', { id: task.id, railId: 'am', date: today }),
    );
    result(await c.call('occurrence.add', { taskId: task.id, label: 'Draft' }));
    expect(
      Object.values(useStore.getState().taskOccurrences)
        .filter((o) => o.taskId === task.id)
        .some((o) => o.slot?.date === today),
    ).toBe(true);
    expect(
      (
        await c.call('task.schedule', {
          id: task.id,
          railId: 'am',
          date: today,
        })
      ).ok,
    ).toBe(false);
  });
  it('completes a task and maintains completion evidence', async () => {
    const c = client();
    const task = result(await c.call('task.create', { title: 'Write' }));
    expect(result(await c.call('task.complete', { id: task.id })).status).toBe(
      'done',
    );
    expect(
      Object.values(useStore.getState().signals).some(
        (s) => s.taskId === task.id && s.response === 'done',
      ),
    ).toBe(true);
  });
  it('requires an in-app delete confirmation, then supports Trash restoration', async () => {
    const c = client();
    const task = result(await c.call('task.create', { title: 'Write' }));
    expect((await c.call('task.delete', { id: task.id })).error?.code).toBe(
      'CONFIRMATION_REQUIRED',
    );
    const confirmed = client({ confirmDelete: async () => true });
    expect(
      result(await confirmed.call('task.delete', { id: task.id })).status,
    ).toBe('deleted');
    expect(
      result(await confirmed.call('task.restore', { id: task.id })).status,
    ).toBe('pending');
  });
  it('does not delete when cancelled or changed during confirmation', async () => {
    const c = client({ confirmDelete: async () => false });
    const task = result(await c.call('task.create', { title: 'Write' }));
    expect((await c.call('task.delete', { id: task.id })).error?.code).toBe(
      'CANCELLED',
    );
    const other = client({
      confirmDelete: async () => {
        await useStore
          .getState()
          .updateTask(String(task.id), { title: 'Edited' });
        return true;
      },
    });
    expect((await other.call('task.delete', { id: task.id })).error?.code).toBe(
      'REVISION_CONFLICT',
    );
    expect(useStore.getState().tasks[String(task.id)]?.status).toBe('pending');
  });
  it('exports complete business collections and excludes provider settings and credentials', async () => {
    const c = client();
    await useStore.getState().setUserBackground('Engineer');
    await useStore.getState().setAiBaseUrl('https://private.example');
    await useStore.getState().setReflection(today, 'Reflection');
    result(await c.call('task.create', { title: 'Write' }));
    const exported = result<{ state: Record<string, unknown> }>(
      await c.call('data.export'),
    );
    expect(exported.state.reflections).toHaveProperty(today);
    expect(exported.state).toHaveProperty('taskOccurrences');
    expect(exported.state.userProfile).toMatchObject({
      background: 'Engineer',
    });
    expect(JSON.stringify(exported)).not.toContain('private.example');
  });
  it('does not reset unspecified Rail fields, and clears nullable task metadata', async () => {
    const c = client();
    result(
      await c.call('rail.update', {
        id: 'am',
        patch: { name: 'Focus' },
        effectiveFrom: today,
      }),
    );
    expect(useStore.getState().rails.am).toMatchObject({
      color: 'sand',
      showInCheckin: false,
    });
    const task = result(
      await c.call('task.create', {
        title: 'Write',
        note: 'note',
        priority: 'P1',
      }),
    );
    result(
      await c.call('task.update', {
        id: task.id,
        patch: { note: null, priority: null },
      }),
    );
    expect(useStore.getState().tasks[String(task.id)]?.note).toBeUndefined();
  });
  it('validates unknown fields, references, dates and immutable metadata before writing', async () => {
    const c = client();
    expect(
      (await c.call('task.create', { title: 'Write', lineId: 'missing' })).error
        ?.code,
    ).toBe('NOT_FOUND');
    expect(
      (await c.call('task.create', { title: 'Write', slot: {} })).error?.code,
    ).toBe('INVALID_INPUT');
    expect(
      (await c.call('rail.resolve', { date: '2026-02-30' })).error?.code,
    ).toBe('INVALID_INPUT');
    expect(
      (
        await c.call('line.update', {
          id: INBOX_LINE_ID,
          patch: { name: 'Oops' },
        })
      ).error?.code,
    ).toBe('INVALID_STATE');
    expect(Object.keys(useStore.getState().tasks)).toHaveLength(0);
  });
  it('reports memory-only changes when persistence fails and never blindly repeats the mutation', async () => {
    const c = client({
      persist: async () => {
        throw new Error('Disk full');
      },
    });
    const req = {
      id: 'disk-fail',
      method: 'task.create',
      params: { title: 'Write' },
    };
    expect((await c.dispatch(req)).error?.code).toBe('PERSIST_FAILED');
    expect((await c.dispatch(req)).error?.details).toMatchObject({
      applied: true,
    });
    expect(Object.keys(useStore.getState().tasks)).toHaveLength(1);
  });
  it('keeps paging explicit and calendar reads side-effect free', async () => {
    const c = client();
    result(await c.call('task.create', { title: 'A' }));
    result(await c.call('task.create', { title: 'B' }));
    expect(result(await c.call('task.list', { limit: 1 }))).toMatchObject({
      total: 2,
      nextOffset: 1,
    });
    const before = c.revision();
    const calendar = result(
      await c.call('calendar.list', { from: today, to: today }),
    );
    expect(calendar.days).toHaveLength(1);
    expect(c.revision()).toBe(before);
    result(await c.call('system.describe')); // Every schema must be serializable.
  });
  it('rejects expired and stopped-runtime writes', async () => {
    const c = client();
    expect(
      (await c.call('task.create', { title: 'A' }, { expiresAt: 1 })).error
        ?.code,
    ).toBe('EXPIRED');
    c.dispose();
    expect((await c.call('task.create', { title: 'B' })).error?.code).toBe(
      'NOT_READY',
    );
  });
  it('never applies a deletion confirmed after its deadline or after access stops', async () => {
    let finish!: (answer: boolean) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const c = client({
      confirmDelete: async () => {
        entered();
        return new Promise<boolean>((resolve) => {
          finish = resolve;
        });
      },
    });
    const task = result(await c.call('task.create', { title: 'Keep' }));
    const response = c.call('task.delete', { id: task.id });
    await waiting;
    c.dispose();
    finish(true);
    expect((await response).error?.code).toBe('NOT_READY');
    expect(useStore.getState().tasks[String(task.id)]?.status).toBe('pending');
    const late = client({
      confirmDelete: async () => {
        vi.spyOn(Date, 'now').mockReturnValueOnce(9999999999999);
        return true;
      },
    });
    expect(
      (
        await late.call(
          'task.delete',
          { id: task.id },
          { expiresAt: Date.now() + 10000 },
        )
      ).error?.code,
    ).toBe('EXPIRED');
    vi.restoreAllMocks();
    expect(useStore.getState().tasks[String(task.id)]?.status).toBe('pending');
  });
});
