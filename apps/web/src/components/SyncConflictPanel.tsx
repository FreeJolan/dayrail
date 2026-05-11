// Sync conflict panel (ERD §7.8 P3).
//
// Mounts when `syncStore.pendingConflict !== null`, i.e. when the
// smart-diff classifier returned 'true-conflict' during a push
// preflight. The user picks a side per field (本地 / 远端), then
// hits "应用并推送" — the resolver writes the chosen values into
// the local Y.Doc and re-triggers the push. Cancel leaves the
// pending state alone for now (next push trigger re-evaluates;
// most likely re-surfaces the same conflict).
//
// Minimal but functional UX. Field-level rows · per-row radio ·
// global "全用本地 / 全用远端" shortcuts · default selection is
// remote (the safe-and-already-canonical side). Polish (grouping
// by entity, value diff highlighting, etc.) is a follow-up.

import { useMemo, useState } from 'react';
import { ENTITY_LEVEL_CONFLICT_FIELD, type FieldConflict } from '@dayrail/core';
import { useSyncStatus, syncStore } from '@/lib/sync/syncStore';
import {
  conflictKey,
  resolveConflictsAndPush,
  type ConflictChoice,
  type ResolutionMap,
} from '@/lib/sync/conflictResolver';

export function SyncConflictPanel() {
  const { pendingConflict } = useSyncStatus();
  if (!pendingConflict) return null;
  return <Panel key={pendingConflict.detectedAt} />;
}

function Panel() {
  const { pendingConflict } = useSyncStatus();
  // Resolutions state — per-conflict choice. Default 'remote'
  // (safer: remote is what Drive currently has, and "user chose
  // local" requires an explicit pick).
  const [choices, setChoices] = useState<ResolutionMap>(() => {
    const m: ResolutionMap = new Map();
    if (pendingConflict) {
      for (const c of pendingConflict.conflicts) m.set(conflictKey(c), 'remote');
    }
    return m;
  });
  const [applying, setApplying] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Local snapshot of the conflicts so the panel doesn't disappear
  // mid-resolution when we clear pendingConflict at the end.
  const conflicts = useMemo<FieldConflict[]>(
    () => pendingConflict?.conflicts ?? [],
    [pendingConflict],
  );
  const remoteBytes = pendingConflict?.remoteBytes ?? null;
  const remoteSnapshotId = pendingConflict?.remoteSnapshotId ?? null;

  if (!pendingConflict || !remoteBytes || !remoteSnapshotId) return null;

  const setChoice = (key: string, c: ConflictChoice) => {
    setChoices((prev) => {
      const next = new Map(prev);
      next.set(key, c);
      return next;
    });
  };
  const setAll = (c: ConflictChoice) => {
    setChoices(() => {
      const next: ResolutionMap = new Map();
      for (const conflict of conflicts) next.set(conflictKey(conflict), c);
      return next;
    });
  };

  const onApply = async () => {
    setApplying(true);
    setErrMsg(null);
    try {
      // Demo mode short-circuit: just close the panel without
      // touching Y.Doc / lastPulled / Drive. The dev-only test
      // button sets pendingConflict.demo=true · its fake conflicts
      // reference invented entity IDs that would no-op on real
      // Y.Doc lookups, but it would still corrupt lastPulledDocBytes
      // / lastPulledSnapshotId and trigger a real Drive push. Bail
      // before any of that.
      if (pendingConflict.demo) {
        syncStore.setPendingConflict(null);
        return;
      }
      // Clear pending FIRST so the panel unmounts; then run the
      // resolve-and-push pipeline. If the push surfaces a fresh
      // conflict (rare — would require yet another device pushing
      // in the gap), the new pendingConflict re-mounts a fresh
      // panel instance.
      syncStore.setPendingConflict(null);
      await resolveConflictsAndPush(
        remoteBytes,
        remoteSnapshotId,
        conflicts,
        choices,
      );
    } catch (e) {
      setErrMsg((e as Error).message ?? String(e));
      setApplying(false);
    }
  };

  const onCancel = () => {
    // Clear pending. Next push trigger will re-run classify and
    // surface the same (or evolved) conflict again — Drive's
    // canonical hasn't moved unless another device pushed.
    syncStore.setPendingConflict(null);
  };

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-[210] flex items-center justify-center bg-ink-primary/40 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl rounded-md bg-surface-0 shadow-xl">
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              {pendingConflict.demo
                ? '冲突 UI 预览（演示 · 不会触动真数据）'
                : '同步冲突 · v1.0 smart diff'}
            </span>
            <p className="text-sm text-ink-primary">
              {pendingConflict.demo ? (
                <>
                  这是 dev-only 测试入口合成的{' '}
                  <strong>{conflicts.length}</strong>{' '}
                  个假冲突，用来预览真冲突时的交互。
                </>
              ) : (
                <>
                  检测到 <strong>{conflicts.length}</strong>{' '}
                  个字段在本地和云端被同时改成了不同值。请逐项选择保留哪边。
                </>
              )}
            </p>
            <p className="text-2xs text-ink-tertiary">
              {pendingConflict.demo
                ? '点「应用并推送」会直接关掉这个面板 · 不写 Y.Doc · 不动 lastPulled · 不推 Drive。'
                : '默认保留云端（更安全）· 选完后点「应用并推送」会把你的选择合并到本地，并把合并结果推到 Drive。'}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAll('local')}
              className="rounded-md bg-surface-2 px-2.5 py-1 text-2xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
            >
              全部用本地
            </button>
            <button
              type="button"
              onClick={() => setAll('remote')}
              className="rounded-md bg-surface-2 px-2.5 py-1 text-2xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
            >
              全部用云端
            </button>
          </div>

          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-surface-3">
            <table className="w-full table-fixed text-2xs">
              <thead className="sticky top-0 bg-surface-1">
                <tr className="text-left text-ink-tertiary">
                  <th className="w-[28%] px-3 py-2 font-mono uppercase tracking-widest">
                    字段
                  </th>
                  <th className="w-[36%] px-3 py-2 font-mono uppercase tracking-widest">
                    本地值
                  </th>
                  <th className="w-[36%] px-3 py-2 font-mono uppercase tracking-widest">
                    云端值
                  </th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => {
                  const key = conflictKey(c);
                  const choice = choices.get(key) ?? 'remote';
                  return (
                    <tr
                      key={key}
                      className="border-t border-surface-3 align-top"
                    >
                      <td className="px-3 py-2 text-ink-primary">
                        <div className="font-mono text-2xs text-ink-tertiary">
                          {c.storeKey} · {c.entityId.slice(0, 8)}
                        </div>
                        <div className="font-mono text-xs">
                          {c.field === ENTITY_LEVEL_CONFLICT_FIELD
                            ? '（整体）'
                            : c.field}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <label className="flex cursor-pointer items-start gap-1.5">
                          <input
                            type="radio"
                            name={key}
                            checked={choice === 'local'}
                            onChange={() => setChoice(key, 'local')}
                            className="mt-0.5"
                          />
                          <ValueCell value={c.localValue} />
                        </label>
                      </td>
                      <td className="px-3 py-2">
                        <label className="flex cursor-pointer items-start gap-1.5">
                          <input
                            type="radio"
                            name={key}
                            checked={choice === 'remote'}
                            onChange={() => setChoice(key, 'remote')}
                            className="mt-0.5"
                          />
                          <ValueCell value={c.remoteValue} />
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {errMsg && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-2xs text-red-700">
              应用失败：{errMsg}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={applying}
              className="rounded-md bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={applying}
              autoFocus
              className="rounded-md bg-ink-primary px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:brightness-95 disabled:opacity-50"
            >
              {applying ? '应用中…' : '应用并推送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ValueCell({ value }: { value: unknown }) {
  return (
    <span className="break-words font-mono text-2xs text-ink-secondary">
      {renderValue(value)}
    </span>
  );
}

function renderValue(value: unknown): string {
  if (value === null) return '(已删除)';
  if (value === undefined) return '(未设置)';
  if (typeof value === 'string') return value.length > 80 ? value.slice(0, 77) + '…' : value;
  if (typeof value === 'boolean') return value ? '✓' : '✗';
  if (typeof value === 'number') return String(value);
  try {
    const s = JSON.stringify(value);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  } catch {
    return String(value);
  }
}
