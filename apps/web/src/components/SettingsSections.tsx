import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  Archive,
  ArrowUp,
  Cloud,
  CloudOff,
  ExternalLink,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  KeyValue,
  Row,
  Segmented,
  SettingsSectionShell,
  TextField,
  Toggle,
} from './SettingsPrimitives';
import { resetLocalData } from '@/lib/resetLocalData';
import { exportLocalData } from '@/lib/exportData';
import { importLocalData, importLocalDataFromBytes } from '@/lib/importData';
import type { BackupEntry } from '@/lib/sync/backupController';
import { useVersionUpdate } from '@/lib/swRegistration';
import { isTauriRuntime } from '@/lib/versionUpdateContext';
import { applyTheme, getThemePref, type ThemePref } from '@/lib/theme';
import { useUpgradeFlow } from '@/lib/useUpgradeFlow';
import {
  getUpgradePref,
  setUpgradePref,
  subscribeUpgradePref,
  type UpgradePref,
} from '@/lib/upgradePref';
import {
  connectDrive,
  disconnectDrive,
} from '@/lib/sync/driveAuth';
import {
  applyRemoteDryj,
  replaceLocalFromRemote,
  runForcePush,
  runManualSync,
  runReconcileAtBoot,
  verifyIdentityAfterConnect,
} from '@/lib/sync/syncController';
import {
  deleteHistoryEntry,
  deleteHeartbeat,
  downloadDryjById,
  getRemoteMeta,
  getRemoteSummary,
  listHeartbeats,
  listHistory,
  type DeviceHeartbeat,
  type HistoryEntry,
  type RemoteMeta,
} from '@/lib/sync/driveBackend';
import {
  clearLocalIsSamplesOnly,
  getBootSyncChoice,
  getDeviceId,
  getDeviceLabel,
  getDeviceLabelOverride,
  getDirtyCount,
  getLastPulledSnapshotId,
  isLocalSamplesOnly,
  setBootSyncChoice,
  setDeviceLabel,
  type BootSyncChoice,
} from '@/lib/sync/identity';
import { syncStore, useSyncStatus } from '@/lib/sync/syncStore';
import {
  applyImportedUpdate,
  classify,
  exportYDocAsUpdate,
  getHolidayDatasetDisplayName,
  getYDoc,
  listHolidayRegions,
  replaceFromRemote,
  resolveEnabledHolidayRegions,
  snapshotDiff,
  unionTopLevelKeys,
  useStore,
} from '@dayrail/core';
import * as Y from 'yjs';
import { decodeDryj } from '@dayrail/db/dryj';
import { exportDryjSnapshot } from '@/lib/exportData';
import {
  AiClientError,
  callChatCompletion,
  listModels,
} from '@dayrail/core';
import {
  getAiApiKey,
  setAiApiKey,
  subscribeAiApiKey,
} from '@/lib/aiApiKey';
import { MarkdownField } from './MarkdownField';

// ============ Appearance ============

export function AppearanceSection() {
  const [theme, setThemeState] = useState<ThemePref>(() => getThemePref());
  const setTheme = (next: ThemePref) => {
    setThemeState(next);
    applyTheme(next);
  };
  const [lang, setLang] = useState<'auto' | 'zh-CN' | 'en'>('zh-CN');
  const [timeFormat, setTimeFormat] = useState<'auto' | '24h' | 'ampm'>('auto');

  return (
    <SettingsSectionShell
      overline="Appearance"
      title="外观"
      description="主题、语言、显示偏好。跨设备同步前，这些选项存在本设备（device-local，见 §7.2.1）。"
    >
      <Row
        label="主题"
        description="跟随系统时随 OS prefers-color-scheme 实时切换。"
        control={
          <Segmented
            value={theme}
            onChange={setTheme}
            options={[
              { key: 'system', label: '跟随系统' },
              { key: 'light', label: '总是浅色' },
              { key: 'dark', label: '总是深色' },
            ]}
          />
        }
      />
      <Row
        label="界面语言"
        description="首次启动读 navigator.language；此处覆盖。AI 输出语言在「AI 辅助」里独立设置。"
        control={
          <Segmented
            value={lang}
            onChange={setLang}
            options={[
              { key: 'auto', label: '跟随系统' },
              { key: 'zh-CN', label: '简体中文' },
              { key: 'en', label: 'English' },
            ]}
          />
        }
      />
      <Row
        label="时间制"
        description="应用内所有 HH:MM 的显示格式。跟随 locale 时 zh-CN 默认 24 小时，en-US 默认 AM/PM。"
        control={
          <Segmented
            value={timeFormat}
            onChange={setTimeFormat}
            options={[
              { key: 'auto', label: '跟随 locale' },
              { key: '24h', label: '24 小时' },
              { key: 'ampm', label: 'AM/PM' },
            ]}
          />
        }
      />
      <HolidayRegionRow />
    </SettingsSectionShell>
  );
}

// ERD §14.2 — region multi-select that drives which bundled holiday
// datasets show up on Cycle View / Calendar / Today Track. Empty list
// means "no holidays rendered". The `userProfile.enabledHolidayRegions`
// field is part of the Y.Doc sync stream so a second device picks up
// the same selection automatically.
function HolidayRegionRow() {
  const userProfile = useStore((s) => s.userProfile);
  const setEnabled = useStore((s) => s.setEnabledHolidayRegions);
  const enabled = resolveEnabledHolidayRegions(userProfile);
  const allRegions = listHolidayRegions();
  const toggle = (region: string) => {
    const next = enabled.includes(region)
      ? enabled.filter((r) => r !== region)
      : [...enabled, region];
    void setEnabled(next);
  };
  const matchSystem = () => {
    const sys = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().locale;
      } catch {
        return 'en-US';
      }
    })();
    // Best-effort match: exact code first, then language-prefix.
    const exact = allRegions.find((r) => r === sys);
    if (exact) {
      void setEnabled([exact]);
      return;
    }
    const lang = sys.split('-')[0];
    const partial = allRegions.find((r) => r.startsWith(lang + '-'));
    if (partial) {
      void setEnabled([partial]);
    } else {
      window.alert(
        `未识别系统 region "${sys}"，请手选。当前可选：${allRegions.join(' · ')}`,
      );
    }
  };
  return (
    <Row
      label="节假日"
      description="勾选后，Cycle View / Calendar / Today Track 上会显示对应区域的节假日 chip。数据 bundle 在仓库里，每年 12 月由 PR 更新次年；详见 ERD §14.2。"
      control={
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {allRegions.map((r) => {
              const checked = enabled.includes(r);
              const label =
                getHolidayDatasetDisplayName(r, 'zh-CN') ?? r;
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => toggle(r)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition',
                    checked
                      ? 'bg-ink-primary text-surface-0 hover:bg-ink-primary/90'
                      : 'bg-surface-2 text-ink-secondary hover:bg-surface-3 hover:text-ink-primary',
                  )}
                >
                  <span
                    aria-hidden
                    className={clsx(
                      'h-1.5 w-1.5 rounded-full',
                      checked ? 'bg-surface-0' : 'bg-ink-tertiary/50',
                    )}
                  />
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void setEnabled([])}
              disabled={enabled.length === 0}
              className="rounded-sm px-2 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink-tertiary"
            >
              关闭全部
            </button>
            <button
              type="button"
              onClick={matchSystem}
              className="rounded-sm px-2 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-2 hover:text-ink-primary"
            >
              跟随系统 region
            </button>
          </div>
        </div>
      }
    />
  );
}

// ============ Sync ============

// Settings → 同步 sub-tabs (ERD §5.9 · v0.12.x).
//
// SyncSection used to be a single tall page (~15 rows after v0.12)
// where sub-groups split only by a `hairline-t` divider + a small
// uppercase overline label. Hard to scan; requires scrolling to find
// anything. This refactor splits it into five tabs by user intent
// (what am I here to do), each tab a focused workspace.
//
// Tabs:
//   overview — status at a glance + 立即同步 + 安全退出 (+ dev demo)
//   connect  — first-time connect / device-level config (label, boot
//              choice, autostart, disconnect)
//   devices  — peer device list (ERD §7.10.1 P5 panel)
//   backup   — local .dryj snapshot in/out + Drive history
//   export   — human-readable export (md / csv / ical)
//
// Deep-link via `?tab=...` query param so banners / boot reconcile /
// etc. can drop the user on the right tab. Default 'overview'.
type SyncTabKey = 'overview' | 'connect' | 'devices' | 'backup' | 'export';

const SYNC_TAB_KEYS: SyncTabKey[] = [
  'overview',
  'connect',
  'devices',
  'backup',
  'export',
];

const SYNC_TAB_LABELS: Record<SyncTabKey, string> = {
  overview: '概览',
  connect: '连接',
  devices: '设备',
  backup: '备份',
  export: '导出',
};

function isSyncTabKey(s: string | null): s is SyncTabKey {
  return s !== null && (SYNC_TAB_KEYS as string[]).includes(s);
}

export function SyncSection() {
  const status = useSyncStatus();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: SyncTabKey = isSyncTabKey(tabParam) ? tabParam : 'overview';

  const setTab = useCallback(
    (next: SyncTabKey) => {
      const newParams = new URLSearchParams(params);
      if (next === 'overview') newParams.delete('tab');
      else newParams.set('tab', next);
      setParams(newParams, { replace: true });
    },
    [params, setParams],
  );

  return (
    <SettingsSectionShell
      overline="Sync"
      title="同步"
      description="DayRail 无账号。Google Drive 同步把整份数据放到你自己 Google 账号下的隐藏空间（appdata），其它应用看不到；详见 ERD §7.6。"
    >
      <div className="pb-4">
        <Segmented
          value={tab}
          onChange={setTab}
          options={SYNC_TAB_KEYS.map((k) => ({
            key: k,
            label: SYNC_TAB_LABELS[k],
          }))}
        />
      </div>

      {tab === 'overview' && <SyncOverviewTab connected={status.connected} />}
      {tab === 'connect' && <SyncConnectTab connected={status.connected} />}
      {tab === 'devices' && <SyncDevicesTab connected={status.connected} />}
      {tab === 'backup' && <SyncBackupTab connected={status.connected} />}
      {tab === 'export' && <SyncExportTab />}
    </SettingsSectionShell>
  );
}

function SyncOverviewTab({ connected }: { connected: boolean }) {
  return (
    <div className="flex flex-col">
      <SyncStatusCard connected={connected} />
      {connected ? (
        <div className="flex flex-col pt-4">
          <RemoteStatePanel />
          <SyncNowRow />
          <SafeQuitRow />
        </div>
      ) : (
        <p className="pt-4 text-xs leading-relaxed text-ink-tertiary">
          还没连接 Drive。去「连接」tab 完成首次授权，数据就会自动同步到你 Google
          账号下的隐藏 appdata 空间。
        </p>
      )}
      <ConflictDemoSection />
    </div>
  );
}

function SyncConnectTab({ connected }: { connected: boolean }) {
  if (!connected) {
    return (
      <div className="flex flex-col">
        <ConnectDrivePanel />
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <DeviceLabelRow />
      <BootSyncChoiceRow />
      <DisconnectRow />
    </div>
  );
}

function SyncDevicesTab({ connected }: { connected: boolean }) {
  if (!connected) {
    return (
      <p className="text-xs leading-relaxed text-ink-tertiary">
        还没连接 Drive。先去「连接」tab 完成首次授权，之后这里会列出所有同步过的设备
        —— 包括这台。
      </p>
    );
  }
  return <ConnectedDevicesPanel />;
}

function SyncBackupTab({ connected }: { connected: boolean }) {
  return (
    <div className="flex flex-col">
      <p className="pb-3 text-2xs leading-relaxed text-ink-tertiary">
        本地 `.dryj` 快照是完整无损的二进制 round-trip 格式。下载 / 导入都是纯本机操作 ——
        不依赖 Drive，即使云端坏了也能用。Drive 备份历史（下方）在连接 Drive 时显示，每次成功
        push 自动滚一份，保留最近 14 条。
      </p>
      <DownloadSnapshotRow />
      <ImportSnapshotRow />
      {isTauriRuntime() && <AutoBackupListRow />}
      {connected && (
        <div className="hairline-t mt-6 flex flex-col pt-4">
          <span className="pb-2 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Drive 历史
          </span>
          <BackupHistoryRow />
        </div>
      )}
    </div>
  );
}

function SyncExportTab() {
  return (
    <div className="flex flex-col">
      <p className="pb-3 text-2xs leading-relaxed text-ink-tertiary">
        把数据导出成其它软件能直接吃的格式 ——「作者跑路了我也能继续用我的数据」心智的真正闭环。
        有损导出（DayRail 的模板 / Rail / 节奏概念其它工具不认），但反思 / 任务 /
        已排期项的核心信息都带得出去。完整无损 round-trip 仍走「下载本地快照」(.dryj)。
      </p>
      <ExportReflectionsRow />
      <ExportTasksRow />
      <ExportScheduleRow />
    </div>
  );
}

// Dev-only · "试看冲突 UI" entry. Unconditional on Drive connection
// (the demo button synthesizes fake data into syncStore directly —
// no Drive API touched). Gated on `import.meta.env.DEV` so vite
// tree-shakes it out of prod bundles.
function ConflictDemoSection() {
  if (!import.meta.env.DEV) return null;
  return (
    <div className="hairline-t mt-6 flex flex-col pt-4">
      <span className="pb-2 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        Dev tools
      </span>
      <ConflictDemoRow />
    </div>
  );
}

function ExportReflectionsRow() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      const { formatReflectionsAsMarkdown, snapshotState, saveTextToUserPath } =
        await import('@/lib/exportReadable');
      const content = formatReflectionsAsMarkdown(snapshotState());
      const today = new Date().toISOString().slice(0, 10);
      const ok = await saveTextToUserPath(
        content,
        `dayrail-reflections-${today}.md`,
        'Markdown',
        'md',
      );
      if (ok) setHint('已导出');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      label="反思 → Markdown"
      description="所有 DailyReflection 按日期倒序拼成单个 .md 文件。Obsidian / Logseq / 任意笔记软件都能开。"
      control={
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => void onClick()}
            disabled={busy}
            className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50"
          >
            {busy ? '生成中…' : '导出 .md'}
          </button>
          {hint && (
            <span className="font-mono text-2xs text-ink-tertiary">{hint}</span>
          )}
          {err && (
            <span className="font-mono text-2xs text-warn">{err}</span>
          )}
        </div>
      }
    />
  );
}

function ExportTasksRow() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      const { formatTasksAsCsv, snapshotState, saveTextToUserPath } =
        await import('@/lib/exportReadable');
      const content = formatTasksAsCsv(snapshotState());
      const today = new Date().toISOString().slice(0, 10);
      const ok = await saveTextToUserPath(
        content,
        `dayrail-tasks-${today}.csv`,
        'CSV',
        'csv',
      );
      if (ok) setHint('已导出');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      label="任务 → CSV"
      description="所有任务一行一条 · 列：date / line / title / status / priority / note / done_at 等。Excel / Google Sheets / 数据分析。"
      control={
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => void onClick()}
            disabled={busy}
            className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50"
          >
            {busy ? '生成中…' : '导出 .csv'}
          </button>
          {hint && (
            <span className="font-mono text-2xs text-ink-tertiary">{hint}</span>
          )}
          {err && (
            <span className="font-mono text-2xs text-warn">{err}</span>
          )}
        </div>
      }
    />
  );
}

function ExportScheduleRow() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      const { formatScheduleAsIcal, snapshotState, saveTextToUserPath } =
        await import('@/lib/exportReadable');
      const content = formatScheduleAsIcal(snapshotState());
      const today = new Date().toISOString().slice(0, 10);
      const ok = await saveTextToUserPath(
        content,
        `dayrail-schedule-${today}.ics`,
        'iCalendar',
        'ics',
      );
      if (ok) setHint('已导出');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      label="日程 → iCal"
      description="已绑 Rail 的任务（Mode A）每条变成一个 VEVENT，按 Rail 时间窗口生成 DTSTART / DTEND。macOS Calendar / Google Calendar 直接 import。Mode B 自由时间 + 未排期任务不在内。"
      control={
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => void onClick()}
            disabled={busy}
            className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50"
          >
            {busy ? '生成中…' : '导出 .ics'}
          </button>
          {hint && (
            <span className="font-mono text-2xs text-ink-tertiary">{hint}</span>
          )}
          {err && (
            <span className="font-mono text-2xs text-warn">{err}</span>
          )}
        </div>
      }
    />
  );
}

function SyncStatusCard({ connected }: { connected: boolean }) {
  const status = useSyncStatus();
  const lastText = (() => {
    if (status.phase.kind === 'syncing') return '正在同步…';
    if (status.phase.kind === 'error') return `同步失败：${status.phase.message}`;
    if (status.phase.kind === 'offline') return status.phase.message;
    if (status.dirtyCount > 0) return `本地有 ${status.dirtyCount} 处改动尚未推送`;
    if (status.lastSync) {
      return `最近一次同步 · ${fmtRelativeMs(Date.now() - status.lastSync.at)} · ${status.lastSync.label}`;
    }
    if (connected) return '已连接，等待第一次同步';
    return 'DayRail 目前只存在本设备。';
  })();
  return (
    <div
      className={clsx(
        'flex items-center gap-4 rounded-md bg-surface-1 px-4 py-4',
        connected && 'bg-surface-2',
      )}
    >
      <span
        className={clsx(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
          connected
            ? 'bg-ink-primary text-surface-0'
            : 'bg-surface-2 text-ink-tertiary',
        )}
      >
        {connected ? (
          <Cloud className="h-4 w-4" strokeWidth={1.6} />
        ) : (
          <CloudOff className="h-4 w-4" strokeWidth={1.6} />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium text-ink-primary">
          {connected ? 'Google Drive · appdata' : '未连接'}
        </span>
        <span className="text-xs text-ink-tertiary">{lastText}</span>
      </div>
    </div>
  );
}

type ConnectPhase =
  | { kind: 'idle' }
  | { kind: 'authorizing' }
  | { kind: 'probing' }
  | { kind: 'remote-exists'; remote: RemoteMeta }
  | { kind: 'pulling' }
  | { kind: 'pushing' }
  | { kind: 'pushing-initial' };

function ConnectDrivePanel() {
  const [phase, setPhase] = useState<ConnectPhase>({ kind: 'idle' });
  const [err, setErr] = useState<string | null>(null);

  const onConnect = async () => {
    setErr(null);
    setPhase({ kind: 'authorizing' });
    try {
      await connectDrive();
      syncStore.setConnected(true);
      // Identity pin check (ERD §7.10.2). Fire-and-forget — a
      // mismatch sets `pendingIdentityMismatch` on the store which
      // mounts the modal in parallel with the probe below.
      void verifyIdentityAfterConnect();
      setPhase({ kind: 'probing' });
      const remote = await getRemoteMeta();
      if (!remote) {
        // No canonical on Drive — first device. Push current local
        // state as the initial snapshot. With Yjs every push is just
        // an upload of the local doc; no special "force" primitive
        // needed.
        setPhase({ kind: 'pushing-initial' });
        await runManualSync();
        // Belt-and-suspenders: regardless of what runManualSync did
        // internally, the user has now connected Drive and committed
        // their state — local is no longer samples-only. (runPush
        // success also clears the flag, but if any inner path
        // skipped or short-circuited, this catches it.)
        clearLocalIsSamplesOnly();
        setPhase({ kind: 'idle' });
        return;
      }
      setPhase({ kind: 'remote-exists', remote });
    } catch (e) {
      setErr((e as Error).message);
      setPhase({ kind: 'idle' });
    }
  };

  const onPullRemote = async () => {
    if (phase.kind !== 'remote-exists') return;
    const remote = phase.remote;
    setPhase({ kind: 'pulling' });
    setErr(null);
    try {
      // Replace-vs-merge gate. The previous heuristic
      // (lastPulledSnapshotId === null) destroyed migrated data: a
      // user who ran tools/migrate + Settings → "Import from
      // snapshot" lands here with null lastPulled but real data in
      // local. Now: only replace when local IS actually
      // sample-seeded (set by boot.ts.seedFromSamples, cleared by
      // any user-authored write or by importLocalData). The
      // migration import path correctly clears the flag, so it
      // takes the merge branch and preserves the imported data.
      if (isLocalSamplesOnly()) {
        await replaceLocalFromRemote(remote);
      } else {
        await applyRemoteDryj(remote);
      }
      // Belt-and-suspenders: replaceLocalFromRemote clears the flag
      // on success and applyRemoteDryj's path is only reached when
      // the flag was already false, so this is redundant — but
      // keeping it makes the user-visible "I clicked Pull and Drive
      // is now my source of truth" intent durable against any inner
      // path bug.
      clearLocalIsSamplesOnly();
      setPhase({ kind: 'idle' });
    } catch (e) {
      setErr((e as Error).message);
      setPhase({ kind: 'remote-exists', remote });
    }
  };

  const onOverwriteRemote = async () => {
    if (phase.kind !== 'remote-exists') return;
    setErr(null);
    setPhase({ kind: 'pushing' });
    try {
      // v0.7: runForcePush bypasses the runPush preflight pull-merge,
      // so Drive's canonical becomes whatever this device has. The
      // CRDT layer in remote devices will still preserve any LOCAL
      // ops they had, but Drive's snapshot stops "remembering" the
      // ops it carried before this push — useful as a §7.7 rollback
      // escape hatch (user authored a snapshot via Settings → "Import
      // from snapshot" or via the migration script and wants Drive
      // to mirror it exactly).
      await runForcePush();
      // Belt-and-suspenders, same shape as onPullRemote.
      clearLocalIsSamplesOnly();
      setPhase({ kind: 'idle' });
    } catch (e) {
      setErr((e as Error).message);
      setPhase({ kind: 'idle' });
    }
  };

  const onCancel = async () => {
    setErr(null);
    try {
      await disconnectDrive();
      syncStore.setConnected(false);
    } finally {
      setPhase({ kind: 'idle' });
    }
  };

  const busy =
    phase.kind === 'authorizing' ||
    phase.kind === 'probing' ||
    phase.kind === 'pulling' ||
    phase.kind === 'pushing' ||
    phase.kind === 'pushing-initial';

  const buttonLabel = (() => {
    switch (phase.kind) {
      case 'authorizing':
        return '正在打开 Google 同意页…';
      case 'probing':
        return '正在检查云端…';
      case 'pushing-initial':
        return '正在创建初始快照…';
      default:
        return '连接 Google Drive';
    }
  })();

  return (
    <div className="flex flex-col gap-3 pt-4">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        连接后端
      </span>
      <button
        type="button"
        onClick={onConnect}
        disabled={busy || phase.kind === 'remote-exists'}
        className="flex items-start gap-3 self-start rounded-md border border-dashed border-ink-tertiary/40 px-4 py-3 text-left transition hover:border-ink-secondary hover:bg-surface-1 disabled:opacity-50"
      >
        <Cloud className="mt-0.5 h-4 w-4 text-ink-secondary" strokeWidth={1.6} />
        <div className="flex flex-col">
          <span className="text-sm font-medium text-ink-primary">{buttonLabel}</span>
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            OAuth · 一次同意 · 之后静默续期
          </span>
        </div>
      </button>
      {err && (
        <p className="rounded-sm bg-surface-1 px-3 py-2 text-2xs text-warn">
          {err}
        </p>
      )}
      <p className="text-2xs text-ink-tertiary">
        其它后端（iCloud / WebDAV）尚未支持，见 ERD §7.6 停车列表。
      </p>

      {phase.kind === 'remote-exists' && (
        <ConnectChoiceModal
          remote={phase.remote}
          onPull={onPullRemote}
          onOverwrite={onOverwriteRemote}
          onCancel={onCancel}
        />
      )}
      {(phase.kind === 'pulling' || phase.kind === 'pushing') && (
        <ConnectStatusModal
          text={
            phase.kind === 'pulling'
              ? '正在拉取云端数据…'
              : '正在覆盖远端…'
          }
        />
      )}
    </div>
  );
}

function ConnectChoiceModal({
  remote,
  onPull,
  onOverwrite,
  onCancel,
}: {
  remote: RemoteMeta;
  onPull: () => void;
  onOverwrite: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-primary/40 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-md bg-surface-0 px-5 py-5 shadow-xl">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            云端已有 DayRail 数据
          </span>
          <p className="text-sm text-ink-primary">
            来自{' '}
            <span className="text-ink-secondary">{remote.deviceLabel ?? '另一台设备'}</span>
            ，最近编辑：
            <span className="text-ink-secondary"> {fmtAbsoluteIso(remote.modifiedTime)}</span>
            。
          </p>
          <p className="text-2xs text-ink-tertiary">
            选择如何处理。在做出选择前 DayRail 不会动你的本地数据。
          </p>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onPull}
            autoFocus
            className="rounded-md bg-ink-primary px-3 py-2 text-xs font-medium text-surface-0 transition hover:brightness-95"
          >
            拉取云端（推荐 · 把云端数据当本地）
          </button>
          <button
            type="button"
            onClick={onOverwrite}
            className="rounded-md bg-surface-2 px-3 py-2 text-xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
          >
            用本地覆盖云端（先把云端下载留底）
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-2 text-xs font-medium text-ink-tertiary transition hover:text-ink-secondary"
          >
            取消连接
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectStatusModal({ text }: { text: string }) {
  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-[200] flex items-center justify-center bg-ink-primary/40 px-6 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-md bg-surface-0 px-5 py-5 shadow-xl">
        <span
          aria-hidden
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink-tertiary border-t-transparent"
        />
        <span className="text-sm text-ink-secondary">{text}</span>
      </div>
    </div>
  );
}

// Settings → 同步 → 安全退出 (ERD §7.10.3 · v0.12 P6).
// Opens the DepartureGateModal so the user can verify their recent
// edits are on Drive before closing the window. The modal handles
// the push + retry + "leave anyway" branches.
function SafeQuitRow() {
  const status = useSyncStatus();
  const onSafeQuit = () => {
    syncStore.setShowDepartureGate(true);
  };
  return (
    <Row
      label="安全退出"
      description={
        status.dirtyCount > 0
          ? `点一下确认你最近的 ${status.dirtyCount} 个改动都已经传到 Drive · 之后再关窗口`
          : '点一下确认你最近的改动都已经传到 Drive · 之后再关窗口'
      }
      control={
        <button
          type="button"
          onClick={onSafeQuit}
          className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          检查再退出
        </button>
      }
    />
  );
}

// Settings → 同步 → 已连接设备 (ERD §7.10.1 + §7.10.4 · v0.12 P5).
// Lists every device that has written a heartbeat to Drive · self
// + peers. Each peer row carries a "移除这台" affordance that
// deletes the heartbeat file from Drive (the peer's local data is
// untouched; if the peer reopens DayRail later it'll write a fresh
// heartbeat and reappear here).
function ConnectedDevicesPanel() {
  const [heartbeats, setHeartbeats] = useState<DeviceHeartbeat[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const selfId = getDeviceId();
  const selfLabel = getDeviceLabel();

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const hbs = await listHeartbeats();
      setHeartbeats(hbs);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onRemove = async (deviceId: string) => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        '把这台设备从同步列表里移除？\n它本地的数据不会动 · 如果之后它再打开 DayRail，会自己重新出现。',
      )
    ) {
      return;
    }
    setRemovingId(deviceId);
    try {
      await deleteHeartbeat(deviceId);
      await refresh();
      // Re-run boot reconcile so mode + banner update immediately ·
      // P5 mode inference reads the fresh peer count.
      await runReconcileAtBoot();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRemovingId(null);
    }
  };

  const peers = heartbeats.filter((hb) => hb.deviceId !== selfId);
  const selfHb = heartbeats.find((hb) => hb.deviceId === selfId);

  return (
    <div className="flex flex-col gap-3 border-b border-surface-2 px-1 pb-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            已连接设备
          </span>
          <span className="text-2xs text-ink-tertiary">
            {peers.length === 0
              ? '只有这台设备在同步'
              : `这台 + 另 ${peers.length} 台设备`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-md bg-surface-1 px-2.5 py-1 text-2xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50"
        >
          {loading ? '查询中…' : '刷新'}
        </button>
      </div>
      {err ? <p className="text-xs text-warn">{err}</p> : null}
      <ul className="flex flex-col gap-2">
        <li className="flex items-baseline justify-between gap-3 rounded-md bg-surface-1 px-3 py-2">
          <div className="flex min-w-0 flex-col">
            <span className="text-sm text-ink-primary">
              {selfLabel}{' '}
              <span className="text-2xs text-ink-tertiary">· 这台</span>
            </span>
            {selfHb ? (
              <span className="text-2xs text-ink-tertiary">
                上次活动 {selfHb.lastActivityAt} · 上次传 {selfHb.lastPushedAt}
              </span>
            ) : (
              <span className="text-2xs text-ink-tertiary">
                还没传过 · 第一次成功 push 后这里会显示
              </span>
            )}
          </div>
        </li>
        {peers.map((hb) => (
          <li
            key={hb.deviceId}
            className="flex items-baseline justify-between gap-3 rounded-md bg-surface-1 px-3 py-2"
          >
            <div className="flex min-w-0 flex-col">
              <span className="text-sm text-ink-primary">{hb.deviceName}</span>
              <span className="text-2xs text-ink-tertiary">
                上次活动 {hb.lastActivityAt} · 上次传 {hb.lastPushedAt}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void onRemove(hb.deviceId)}
              disabled={removingId === hb.deviceId}
              className="shrink-0 rounded-md px-2.5 py-1 text-2xs text-ink-tertiary transition hover:text-warn disabled:opacity-50"
            >
              {removingId === hb.deviceId ? '正在移除…' : '移除这台'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Synthesizes fake FieldConflicts against invented entity IDs and
// pushes them through `syncStore.setPendingConflict({ demo: true,
// ... })`. The panel mounts, lets the user click around (radios /
// 全用本地·云端 / 应用并推送 / 取消), but "应用并推送" is a
// no-op when demo=true (see SyncConflictPanel.onApply). Lets the
// user verify the UI without ever triggering a real Drive push or
// corrupting lastPulled state. Caller (ConflictDemoSection) gates
// on `import.meta.env.DEV` so the prod bundle drops this entirely.
function ConflictDemoRow() {
  const onTrigger = () => {
    // Empty remote bytes = valid Y.Doc serialization with no top-
    // level types. Carried for shape consistency only; the Apply
    // path bails before touching them.
    const emptyDoc = new Y.Doc();
    const emptyBytes = Y.encodeStateAsUpdate(emptyDoc);
    syncStore.setPendingConflict({
      demo: true,
      detectedAt: Date.now(),
      remoteBytes: emptyBytes,
      remoteSnapshotId: 'demo-fake-snapshot',
      conflicts: [
        {
          storeKey: 'tasks',
          entityId: 'demo-task-001',
          field: 'title',
          baseValue: '完成季度计划',
          localValue: '完成 v1.0 sync 重审',
          remoteValue: '完成季度计划 (rev)',
        },
        {
          storeKey: 'tasks',
          entityId: 'demo-task-001',
          field: 'priority',
          baseValue: 'P1',
          localValue: 'P0',
          remoteValue: 'P2',
        },
        {
          storeKey: 'tasks',
          entityId: 'demo-task-002',
          field: '__entity__',
          baseValue: undefined,
          localValue: null, // null = "本地已删除"
          remoteValue: { id: 'demo-task-002', title: '远端编辑过的任务' },
        },
        {
          storeKey: 'reflections',
          entityId: 'demo-reflection-2026-05-10',
          field: 'body',
          baseValue: '原本的反思内容',
          localValue: '我改写的本地反思内容，比较长一点试试看截断效果 lorem ipsum dolor sit amet…',
          remoteValue: '另一台设备改的远端反思内容',
        },
        {
          storeKey: 'lines',
          entityId: 'demo-line-inbox',
          field: 'tags',
          baseValue: ['work'],
          localValue: ['work', 'urgent'],
          remoteValue: ['work', 'review'],
        },
      ],
    });
  };
  return (
    <Row
      label="试看冲突 UI（dev only）"
      description="合成假冲突触发 SyncConflictPanel · 用来验证 UX · 应用并推送会短路掉，不写本地不动 Drive。"
      control={
        <button
          type="button"
          onClick={onTrigger}
          className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
        >
          打开演示
        </button>
      }
    />
  );
}

// Settings → 同步 → 远端状态. Side-by-side comparison of "what
// Drive actually holds" vs "what this device thinks Drive holds",
// plus a derived verdict line that names the next sync action.
// Reads Drive metadata (no body fetch) on mount + on manual refresh
// + after every successful sync (via syncStore subscription).
function RemoteStatePanel() {
  const status = useSyncStatus();
  const [remote, setRemote] = useState<RemoteMeta | null>(null);
  const [summary, setSummary] = useState<{
    canonicalPresent: boolean;
    historyCount: number;
    totalSizeBytes: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [m, s] = await Promise.all([getRemoteMeta(), getRemoteSummary()]);
      setRemote(m);
      setSummary(s);
      setLastFetchAt(Date.now());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Auto-refresh after a successful round-trip — `lastSync.at`
  // changes only when sync just completed.
  const lastSyncAt = status.lastSync?.at ?? 0;
  useEffect(() => {
    if (lastSyncAt > 0) void fetchAll();
  }, [lastSyncAt, fetchAll]);

  const localLastPulled = getLastPulledSnapshotId();
  const localDirty = status.dirtyCount;
  const verdict = deriveVerdict(remote, localLastPulled, localDirty);

  return (
    <div className="flex flex-col gap-3 border-b border-surface-2 px-1 pb-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            远端状态
          </span>
          <span className="text-2xs text-ink-tertiary">
            {lastFetchAt
              ? `读取于 ${fmtRelativeMs(Date.now() - lastFetchAt)}`
              : '尚未读取'}
            {loading && ' · 读取中…'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void fetchAll()}
          disabled={loading}
          className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50"
        >
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>

      {err && (
        <p className="rounded-sm bg-surface-1 px-3 py-2 text-2xs text-warn">
          读取失败：{err}
        </p>
      )}

      <VerdictBanner verdict={verdict} />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <KvBlock title="远端 · canonical">
          {!remote ? (
            <KvLine k="状态" v="远端尚无主文件（首次推送后出现）" />
          ) : (
            <>
              <KvLine k="文件" v="dayrail-snapshot.dryj" mono />
              <KvLine k="修改时间" v={fmtAbsoluteIso(remote.modifiedTime)} />
              <KvLine k="snapshotId" v={shortId(remote.snapshotId)} mono title={remote.snapshotId} />
              {remote.parentSnapshotId && (
                <KvLine
                  k="parent"
                  v={shortId(remote.parentSnapshotId)}
                  mono
                  title={remote.parentSnapshotId}
                />
              )}
              <KvLine k="写入设备" v={remote.deviceLabel ?? '未知'} />
              <KvLine
                k="大小"
                v={remote.sizeBytes !== undefined ? fmtBytes(remote.sizeBytes) : '—'}
              />
            </>
          )}
        </KvBlock>
        <KvBlock title="本地 · lineage">
          <KvLine
            k="lastPulledSnapshotId"
            v={localLastPulled ? shortId(localLastPulled) : '—'}
            mono
            title={localLastPulled ?? undefined}
          />
          <KvLine k="未推送改动" v={`${localDirty} 处`} />
          <KvLine
            k="最近同步"
            v={
              status.lastSync
                ? `${fmtRelativeMs(Date.now() - status.lastSync.at)} · ${status.lastSync.label}`
                : '尚未同步'
            }
          />
          <KvLine k="本机设备名" v={status.deviceLabel} />
        </KvBlock>
      </div>

      {summary && (
        <div className="flex items-center justify-between rounded-sm bg-surface-1 px-3 py-2 text-2xs text-ink-secondary">
          <span>
            历史快照：<span className="font-mono">{summary.historyCount} / 14</span>
            {!summary.canonicalPresent && ' · 主文件缺失'}
          </span>
          <span>
            合计大小：<span className="font-mono">{fmtBytes(summary.totalSizeBytes)}</span>
          </span>
        </div>
      )}
    </div>
  );
}

type Verdict =
  | { kind: 'no-remote' }
  | { kind: 'in-sync' }
  | { kind: 'local-ahead'; n: number }
  | { kind: 'remote-ahead'; remoteDevice: string; localPending: number }
  | { kind: 'unknown' };

function deriveVerdict(
  remote: RemoteMeta | null,
  localLastPulled: string | null,
  localDirty: number,
): Verdict {
  if (!remote) return { kind: 'no-remote' };
  if (!remote.snapshotId) return { kind: 'unknown' };
  const equal = remote.snapshotId === localLastPulled;
  if (equal && localDirty === 0) return { kind: 'in-sync' };
  if (equal && localDirty > 0) return { kind: 'local-ahead', n: localDirty };
  // v0.7: when both sides have changes, Yjs CRDT merges deterministically
  // on pull — no diverged surface needed.
  return {
    kind: 'remote-ahead',
    remoteDevice: remote.deviceLabel ?? '另一台设备',
    localPending: localDirty,
  };
}

function VerdictBanner({ verdict }: { verdict: Verdict }) {
  const { tone, dot, text } = (() => {
    switch (verdict.kind) {
      case 'no-remote':
        return {
          tone: 'idle',
          dot: 'bg-ink-tertiary',
          text: '远端尚无主文件 · 第一次推送后会创建',
        };
      case 'in-sync':
        return { tone: 'ok', dot: 'bg-ink-secondary', text: '✓ 本地与远端一致' };
      case 'local-ahead':
        return {
          tone: 'pending',
          dot: 'bg-warn/70',
          text: `本地领先 ${verdict.n} 处 · 下次同步会推送`,
        };
      case 'remote-ahead': {
        const localNote =
          verdict.localPending > 0
            ? `本地还有 ${verdict.localPending} 处未推送（CRDT 自动合并，不会丢）`
            : '下次启动会拉取';
        return {
          tone: 'pending',
          dot: 'bg-warn/70',
          text: `远端较新 · 来自 ${verdict.remoteDevice} · ${localNote}`,
        };
      }
      case 'unknown':
        return {
          tone: 'idle',
          dot: 'bg-ink-tertiary',
          text: '远端文件存在但缺 lineage 元数据（可能是旧版本写的，下次推送后会自动修正）',
        };
    }
  })();
  return (
    <div
      className={clsx(
        'flex items-center gap-2 rounded-sm px-3 py-2 text-xs',
        tone === 'ok' && 'bg-surface-1 text-ink-primary',
        tone === 'pending' && 'bg-surface-1 text-ink-secondary',
        tone === 'warn' && 'bg-warn/10 text-ink-primary',
        tone === 'idle' && 'bg-surface-1 text-ink-tertiary',
      )}
    >
      <span aria-hidden className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', dot)} />
      <span>{text}</span>
    </div>
  );
}

function KvBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-sm bg-surface-1 px-3 py-2.5">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        {title}
      </span>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function KvLine({
  k,
  v,
  mono,
  title,
}: {
  k: string;
  v: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-2xs text-ink-tertiary">{k}</span>
      <span
        className={clsx(
          'truncate text-right text-xs',
          mono ? 'font-mono text-ink-secondary' : 'text-ink-primary',
        )}
        title={title}
      >
        {v}
      </span>
    </div>
  );
}

function shortId(id: string): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function DeviceLabelRow() {
  // Track the user override separately from the resolved display
  // value. Empty override input → fall back through autoDetected →
  // UA-derived. This way clearing the input restores the default
  // visibly via the placeholder; filling it back overrides again.
  const [override, setOverride] = useState<string>(() =>
    getDeviceLabelOverride(),
  );
  const persist = (next: string) => {
    setOverride(next);
    setDeviceLabel(next); // empty string clears the override key
    syncStore.setDeviceLabel(next || getDeviceLabel());
  };
  return (
    <Row
      label="本设备名"
      description="显示给其他设备看的标签。桌面端默认是机器主机名（如 FreeJolan-MBP）；PWA 默认是按 UA 推断。留空恢复默认。"
      control={
        <TextField
          value={override}
          onChange={persist}
          placeholder={getDeviceLabel()}
        />
      }
    />
  );
}

/** ERD §15.8 — autostart at login toggle. Tauri only; PWA hides the
 *  wrapper section. The state lives in the OS-side autostart entry,
 *  not in Y.Doc / localStorage: it's per-device and per-OS-user. */
function AutostartRow() {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hydrate from the OS-side autostart registration on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@tauri-apps/plugin-autostart');
        const isOn = await mod.isEnabled();
        if (!cancelled) setEnabled(isOn);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // Plugin enable/disable are idempotent at the OS layer, so a stray
  // double-click during the in-flight window is harmless — no
  // disabled flag needed on the toggle.
  const persist = async (next: boolean) => {
    setError(null);
    try {
      const mod = await import('@tauri-apps/plugin-autostart');
      if (next) await mod.enable();
      else await mod.disable();
      setEnabled(next);
    } catch (err) {
      setError((err as Error).message);
      // Re-sync the toggle UI to the true OS state on failure.
      try {
        const mod = await import('@tauri-apps/plugin-autostart');
        setEnabled(await mod.isEnabled());
      } catch {
        /* best-effort */
      }
    }
  };
  return (
    <Row
      label="开机自启动"
      description={
        <>
          登录系统时自动启动 DayRail，<strong>在后台启动</strong>（dock
          / menubar 显示图标，主窗口不弹）。点击 dock 图标才显示窗口。
          {error && (
            <span className="block text-warn"> · 操作失败: {error}</span>
          )}
        </>
      }
      control={
        <Toggle
          checked={enabled}
          onChange={(next) => void persist(next)}
        />
      }
    />
  );
}

function BootSyncChoiceRow() {
  const [choice, setChoice] = useState<BootSyncChoice>(() => getBootSyncChoice());
  const persist = (next: BootSyncChoice) => {
    setChoice(next);
    setBootSyncChoice(next);
  };
  return (
    <Row
      label="启动时同步"
      description="冷启动时如果云端较新（且本地无未同步改动）的处理方式。本地有未同步改动时永远会显式弹冲突卡片。"
      control={
        <Segmented
          value={choice}
          onChange={persist}
          options={[
            { key: 'auto-pull', label: '自动拉取最新' },
            { key: 'ask', label: '每次问我' },
          ]}
        />
      }
    />
  );
}

function SyncNowRow() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const onClick = async () => {
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      const outcome = await runManualSync();
      if (outcome.kind === 'offline') {
        setErr('当前离线或 Drive 不可达');
      } else if (outcome.kind === 'noop') {
        setHint('已是最新');
      } else if (outcome.kind === 'pulled') {
        setHint('已合并云端改动');
      }
      // 'pushed' falls through silently — the topbar status row +
      // last-sync timestamp already reflect the result.
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      label="立即同步"
      description="手动触发一次双向同步：先探测远端，远端有更新则拉取（必要时弹冲突卡），否则推送本地改动。"
      control={
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={onClick}
            disabled={busy}
            className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50"
          >
            {busy ? '同步中…' : '立即同步'}
          </button>
          {hint && (
            <span className="font-mono text-2xs text-ink-tertiary">{hint}</span>
          )}
          {err && (
            <span className="font-mono text-2xs text-warn">{err}</span>
          )}
        </div>
      }
    />
  );
}

function DisconnectRow() {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (!window.confirm('断开 Google Drive 连接？\n\n本地数据不受影响。')) return;
    setBusy(true);
    try {
      await disconnectDrive();
      syncStore.setConnected(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      label="断开连接"
      description="撤销 OAuth 授权。本地数据保留；下次同步前需要重新授权。"
      control={
        <button
          type="button"
          onClick={onClick}
          disabled={busy}
          className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50"
        >
          {busy ? '断开中…' : '断开'}
        </button>
      }
    />
  );
}

// v0.7 (ERD §7.7) safety net · download the live Y.Doc as a `.dryj`
// container. Round-trips cleanly through `<ImportSnapshotRow />`,
// the migration script's output, and the Drive history list. Useful
// before risky operations (mass deletes, schema upgrades) or as a
// pre-flight backup separate from Drive's rolling 14-snapshot history.
function DownloadSnapshotRow() {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Tauri path uses native save dialog so the user picks the
  // destination explicitly (no more silent dump into Downloads).
  // PWA path keeps the legacy <a download> behaviour because
  // browsers don't expose a save-picker we can reliably hook into.
  const onClick = async () => {
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      if (isTauriRuntime()) {
        const { exportLocalSnapshotToUserPath } = await import(
          '@/lib/sync/backupController'
        );
        const ok = await exportLocalSnapshotToUserPath();
        if (ok) setHint('已导出');
      } else {
        const filename = exportDryjSnapshot(getDeviceId(), getDeviceLabel());
        setHint(`已下载 ${filename}`);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      label="下载本地快照"
      description="把当前本地 Y.Doc 导出成 .dryj 二进制文件留底。桌面端会让你选保存位置；可通过下方「从快照导入」原样恢复。"
      control={
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => void onClick()}
            disabled={busy}
            className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50"
          >
            {busy ? '生成中…' : '下载 .dryj'}
          </button>
          {hint && (
            <span className="font-mono text-2xs text-ink-tertiary">{hint}</span>
          )}
          {err && (
            <span className="font-mono text-2xs text-warn">{err}</span>
          )}
        </div>
      }
    />
  );
}

// v0.7 (ERD §7.7) safety net · replace local Y.Doc from a `.dryj`
// the user supplies. Three roles:
//   1. v0.6 → v0.7 one-shot migration (after running the migration
//      script in tools/migrate/).
//   2. Manual recovery from a Drive history entry the user previously
//      downloaded.
//   3. Last-ditch rollback if Yjs ever produces a surprising merge
//      (CRDT shouldn't, but this is the escape hatch the file-header
//      "safety net" comment refers to).
//
// Importing replaces the local OPFS file and reloads the page so the
// boot path picks up the new state cleanly. The previous local state
// is gone after import — use "Download snapshot" first if you want a
// fallback.
// Single source of truth for the import-confirm copy. Tauri and PWA
// paths both land here so a phrasing change (e.g. wording softening,
// translation pass) only needs editing once.
const importConfirmMessage = (filename: string): string =>
  `用 "${filename}" 替换本地数据？\n\n会先把当前本地清空再载入快照，然后页面会自动刷新。建议先点「下载本地快照」留底。`;

function ImportSnapshotRow() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Tauri WKWebView's HTML5 `<input type="file">` returns a File whose
  // `arrayBuffer()` reads as empty for binary content (encountered
  // during the v0.9.0→v0.9.1 incident recovery). On Tauri we route
  // through the native dialog plugin instead, which returns a path
  // we read via the fs plugin. PWA stays on the HTML5 input — works
  // everywhere we've tested it.
  const onPick = async () => {
    setErr(null);
    if (isTauriRuntime()) {
      setBusy(true);
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const path = await open({
          multiple: false,
          filters: [
            { name: 'DayRail snapshot', extensions: ['dryj'] },
          ],
        });
        if (!path) {
          setBusy(false);
          return;
        }
        const filename = String(path).split('/').pop() ?? 'snapshot.dryj';
        if (!window.confirm(importConfirmMessage(filename))) {
          setBusy(false);
          return;
        }
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const bytes = await readFile(String(path));
        await importLocalDataFromBytes(bytes, { sourceLabel: filename });
      } catch (e2) {
        setErr((e2 as Error).message);
        setBusy(false);
      }
      return;
    }
    inputRef.current?.click();
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    if (!window.confirm(importConfirmMessage(file.name))) {
      return;
    }
    setBusy(true);
    try {
      // importLocalData stashes bytes, wipes OPFS, then reloads.
      // Returns only when something fails before the reload kicks in.
      await importLocalData(file);
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };
  return (
    <Row
      label="从快照导入"
      description="选一个 .dryj 文件（迁移脚本产物 / 历史快照下载 / 上方刚下载的留底），覆盖本地数据。"
      control={
        <div className="flex flex-col items-end gap-1">
          <input
            ref={inputRef}
            type="file"
            accept=".dryj,application/octet-stream"
            onChange={onFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => void onPick()}
            disabled={busy}
            className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary disabled:opacity-50"
          >
            {busy ? '导入中…' : '选择 .dryj'}
          </button>
          {err && (
            <span className="font-mono text-2xs text-warn">{err}</span>
          )}
        </div>
      }
    />
  );
}

// Settings → 同步 → 本地数据 → 自动备份列表.
//
// Tauri-only. Lists `.dryj` backups under `app_data_dir()/backups/`
// written automatically before high-risk actions (pre-update,
// pre-import, pre-force-push). Each row offers Restore (re-imports
// the backup as if user picked it), Export (native save dialog →
// copy to user-chosen path), and Delete. Auto-refreshes on
// expand and after destructive ops.
//
// Why this exists: v0.9.0→v0.9.1 incident showed we had no last-
// line-of-defense backup before destructive ops. The user happened
// to have done a manual `.dryj` download earlier that day, which
// was the only thing that saved the data. This component makes
// that safety net automatic instead of "user remembered to back up".
function AutoBackupListRow() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<BackupEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyOp, setBusyOp] = useState<string | null>(null);

  const refresh = async () => {
    setErr(null);
    try {
      const { listBackups } = await import('@/lib/sync/backupController');
      setItems(await listBackups());
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const restore = async (entry: BackupEntry) => {
    if (
      !window.confirm(
        `用 "${entry.filename}" 替换本地数据？\n\n会先把当前本地清空再载入这份备份，然后页面会自动刷新。当前本地数据会先被自动备份一份（pre-import），所以这步可以反悔。`,
      )
    ) {
      return;
    }
    setBusyOp(`restore-${entry.filename}`);
    try {
      const { readBackup } = await import('@/lib/sync/backupController');
      const { importLocalDataFromBytes } = await import('@/lib/importData');
      const bytes = await readBackup(entry.filename);
      await importLocalDataFromBytes(bytes, { sourceLabel: entry.filename });
      // importLocalDataFromBytes triggers reload — control never
      // returns here on success.
    } catch (e) {
      setErr((e as Error).message);
      setBusyOp(null);
    }
  };

  const exportTo = async (entry: BackupEntry) => {
    setBusyOp(`export-${entry.filename}`);
    try {
      const { exportBackupToUserPath } = await import(
        '@/lib/sync/backupController'
      );
      await exportBackupToUserPath(entry);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyOp(null);
    }
  };

  const remove = async (entry: BackupEntry) => {
    if (
      !window.confirm(
        `删除自动备份 "${entry.filename}"？这个操作不可撤销。`,
      )
    ) {
      return;
    }
    setBusyOp(`delete-${entry.filename}`);
    try {
      const { deleteBackup } = await import('@/lib/sync/backupController');
      await deleteBackup(entry.filename);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyOp(null);
    }
  };

  return (
    <Row
      label="自动备份"
      description="升级前 / 导入快照前 / 强制推送前会自动留一份本地备份。最多保留 10 份；旧的自动 GC。位于系统应用数据目录，不在 Downloads。"
      control={
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            {open ? '收起' : '查看 / 管理'}
          </button>
          {open && (
            <div className="mt-2 flex w-[420px] flex-col gap-2 rounded-md bg-surface-1 p-3">
              {items === null && (
                <span className="font-mono text-2xs text-ink-tertiary">
                  读取中…
                </span>
              )}
              {items !== null && items.length === 0 && (
                <span className="text-xs text-ink-tertiary">
                  暂无自动备份。下次升级 / 导入 / 强制推送时会自动生成。
                </span>
              )}
              {items !== null && items.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {items.map((it) => (
                    <li
                      key={it.filename}
                      className="flex flex-col gap-1 rounded-sm bg-surface-0 px-3 py-2"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-2xs text-ink-secondary">
                          {fmtAbsoluteIso(it.created_at)}
                        </span>
                        <span className="font-mono text-2xs text-ink-tertiary">
                          {it.reason} · {fmtBytes(it.size_bytes)}
                        </span>
                      </div>
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => void restore(it)}
                          disabled={busyOp !== null}
                          className="rounded-sm bg-surface-2 px-2 py-0.5 text-2xs text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary disabled:opacity-50"
                        >
                          {busyOp === `restore-${it.filename}` ? '…' : '恢复'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void exportTo(it)}
                          disabled={busyOp !== null}
                          className="rounded-sm bg-surface-2 px-2 py-0.5 text-2xs text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary disabled:opacity-50"
                        >
                          {busyOp === `export-${it.filename}` ? '…' : '导出'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(it)}
                          disabled={busyOp !== null}
                          className="rounded-sm bg-surface-2 px-2 py-0.5 text-2xs text-ink-tertiary transition hover:bg-surface-3 hover:text-warn disabled:opacity-50"
                        >
                          {busyOp === `delete-${it.filename}` ? '…' : '删除'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {err && (
                <span className="font-mono text-2xs text-warn">{err}</span>
              )}
            </div>
          )}
        </div>
      }
    />
  );
}

function BackupHistoryRow() {
  // ERD §7.8 P5 · default-open. v1.0 promotes backup history from
  // a hidden subview to first-class — it's the user's rollback
  // surface when smart-diff's silent same-direction / orthogonal /
  // conflict-resolved merge produces a state they want to undo.
  const [items, setItems] = useState<HistoryEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = async () => {
    setErr(null);
    try {
      const list = await listHistory();
      setItems(list);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  useEffect(() => {
    if (items === null) void refresh();
  }, [items]);
  return (
    <div className="flex flex-col">
      <Row
        label="备份历史"
        description={`Drive 上滚动保留最近 14 份历史快照（按设备 + 时间命名）。点「预览」看会变什么；「回滚到此」前自动备份当前到 Downloads。`}
        control={
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            刷新
          </button>
        }
      />
      <div className="flex flex-col gap-2 px-1 pb-3">
        {err && (
          <p className="rounded-sm bg-surface-1 px-3 py-2 text-2xs text-warn">{err}</p>
        )}
        {items === null && (
          <p className="text-2xs text-ink-tertiary">读取中…</p>
        )}
        {items && items.length === 0 && (
          <p className="text-2xs text-ink-tertiary">暂无历史。第一次推送后会出现。</p>
        )}
        {items && items.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {items.map((it) => (
              <BackupHistoryItem key={it.fileId} entry={it} onMutated={refresh} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BackupHistoryItem({
  entry,
  onMutated,
}: {
  entry: HistoryEntry;
  onMutated: () => void;
}) {
  const [busy, setBusy] = useState<
    null | 'preview' | 'rollback' | 'download' | 'delete'
  >(null);
  const [err, setErr] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<Uint8Array | null>(null);
  const onPreview = async () => {
    setBusy('preview');
    setErr(null);
    try {
      const bytes = await downloadDryjById(entry.fileId);
      decodeDryj(bytes); // validate
      setPreviewing(bytes);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const onRollback = async () => {
    // Auto-backup gate: dump current local to Downloads BEFORE
    // replacing it, so the user can always recover whatever they
    // had before this rollback. ERD §7.8 P5 ("回滚 + 反悔" gate).
    if (
      !window.confirm(
        `回滚到这份历史快照？\n\n- 当前本地数据会先自动备份到 Downloads / 下载（dryj 文件 · 之后可以再导回）\n- 然后本地被替换为这份快照的内容\n- 自动推送到 Drive · 替换云端 canonical\n\n继续？`,
      )
    )
      return;
    setBusy('rollback');
    setErr(null);
    try {
      // (1) Auto-backup current local first.
      exportDryjSnapshot(getDeviceId(), getDeviceLabel());
      // (2) Download the history bytes and replace local.
      const bytes = await downloadDryjById(entry.fileId);
      decodeDryj(bytes); // validate
      replaceFromRemote(bytes);
      // (3) Force-push so Drive's canonical mirrors the rollback
      // immediately (other devices' next sync will smart-diff
      // against this new canonical).
      await runForcePush();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const onDownload = async () => {
    setBusy('download');
    setErr(null);
    try {
      const bytes = await downloadDryjById(entry.fileId);
      if (isTauriRuntime()) {
        // Match the v0.9.7 desktop convention: native save dialog
        // instead of silently dumping into Downloads. Consistent with
        // 「下载本地快照」 + 「自动备份 → 导出」.
        const { save } = await import('@tauri-apps/plugin-dialog');
        const dest = await save({
          title: '导出 Drive 历史快照',
          defaultPath: entry.filename,
          filters: [{ name: 'DayRail snapshot', extensions: ['dryj'] }],
        });
        if (dest) {
          const { writeFile } = await import('@tauri-apps/plugin-fs');
          await writeFile(String(dest), bytes);
        }
      } else {
        // PWA path keeps the legacy `<a download>` flow — browsers
        // don't expose a save-picker we can hook into reliably.
        const blob = new Blob([bytes as BlobPart], {
          type: 'application/octet-stream',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = entry.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const onDelete = async () => {
    if (!window.confirm(`删除这份历史快照？\n\n不会影响主文件。`)) return;
    setBusy('delete');
    setErr(null);
    try {
      await deleteHistoryEntry(entry.fileId);
      onMutated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="flex flex-col gap-1 rounded-sm bg-surface-1 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-ink-primary">
            {entry.deviceLabel || '设备'} · {fmtAbsoluteIso(entry.modifiedTime)}
          </span>
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            {entry.filename}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onPreview}
            disabled={busy !== null}
            className="rounded-sm bg-surface-2 px-2 py-1 text-2xs font-medium text-ink-secondary hover:bg-surface-3 hover:text-ink-primary disabled:opacity-50"
          >
            {busy === 'preview' ? '加载…' : '预览'}
          </button>
          <button
            type="button"
            onClick={onRollback}
            disabled={busy !== null}
            className="rounded-sm bg-surface-2 px-2 py-1 text-2xs font-medium text-ink-secondary hover:bg-warn hover:text-surface-0 disabled:opacity-50"
          >
            {busy === 'rollback' ? '回滚中…' : '回滚到此'}
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={busy !== null}
            className="rounded-sm bg-surface-2 px-2 py-1 text-2xs font-medium text-ink-secondary hover:bg-surface-3 hover:text-ink-primary disabled:opacity-50"
          >
            下载
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy !== null}
            className="rounded-sm bg-surface-2 px-2 py-1 text-2xs font-medium text-ink-secondary hover:bg-warn hover:text-surface-0 disabled:opacity-50"
          >
            删除
          </button>
        </div>
      </div>
      {err && <p className="font-mono text-2xs text-warn">{err}</p>}
      {previewing && (
        <RollbackPreviewModal
          historyBytes={previewing}
          entry={entry}
          onClose={() => setPreviewing(null)}
          onConfirmRollback={async () => {
            setPreviewing(null);
            await onRollback();
          }}
        />
      )}
    </li>
  );
}

// Rollback preview · summarizes the snapshotDiff between the live
// local Y.Doc and the chosen history snapshot. Counts only (added /
// removed / modified entities) — gives the user a sense of blast
// radius without committing to a full diff viewer in P5's "low (纯
// UI)" scope. Per-store breakdown is the meaningful axis ("4 tasks
// will reappear, 12 reflections will be lost"); per-entity sample
// listing is left for follow-up if needed.
function RollbackPreviewModal({
  historyBytes,
  entry,
  onClose,
  onConfirmRollback,
}: {
  historyBytes: Uint8Array;
  entry: HistoryEntry;
  onClose: () => void;
  onConfirmRollback: () => Promise<void>;
}) {
  const stats = useMemo(() => computeRollbackStats(historyBytes), [historyBytes]);
  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-[210] flex items-center justify-center bg-ink-primary/40 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl rounded-md bg-surface-0 shadow-xl">
        <div className="flex flex-col gap-4 px-5 py-5">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              回滚预览
            </span>
            <p className="text-sm text-ink-primary">
              快照来源：
              <span className="text-ink-secondary">
                {' '}
                {entry.deviceLabel || '设备'} · {fmtAbsoluteIso(entry.modifiedTime)}
              </span>
            </p>
            <p className="text-2xs text-ink-tertiary">
              如果回滚，下列变化会立即生效（并自动推送到 Drive 替换云端 canonical）：
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Stat
              label="将恢复"
              value={stats.added}
              hint="历史里有 · 当前没有"
            />
            <Stat
              label="将删除"
              value={stats.removed}
              hint="当前有 · 历史里没有"
              warn
            />
            <Stat
              label="将变更"
              value={stats.modified}
              hint="entity 字段不一样"
            />
          </div>

          {stats.byStore.length > 0 && (
            <div className="rounded-md border border-surface-3 px-3 py-2">
              <div className="mb-1 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
                按 store 拆分
              </div>
              <ul className="flex flex-col gap-0.5 font-mono text-2xs text-ink-secondary">
                {stats.byStore.map(
                  (s: RollbackStats['byStore'][number]) => (
                    <li key={s.storeKey}>
                      {s.storeKey} · +{s.added} / -{s.removed} / ~{s.modified}
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}

          <p className="rounded-md bg-surface-1 px-3 py-2 text-2xs text-ink-tertiary">
            提示：点「回滚到此」前会先把<strong>当前本地</strong>自动备份成 .dryj
            文件到 Downloads；如果回滚后想反悔，把那个文件再 import 回来即可。
          </p>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-3 hover:text-ink-primary"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void onConfirmRollback()}
              className="rounded-md bg-warn px-3 py-1.5 text-xs font-medium text-surface-0 transition hover:brightness-95"
            >
              回滚到此
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  warn,
}: {
  label: string;
  value: number;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div
      className={
        warn
          ? 'rounded-md border border-warn/40 bg-warn/5 px-3 py-2'
          : 'rounded-md border border-surface-3 bg-surface-1 px-3 py-2'
      }
    >
      <div className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        {label}
      </div>
      <div
        className={
          warn
            ? 'mt-0.5 text-lg font-semibold text-warn'
            : 'mt-0.5 text-lg font-semibold text-ink-primary'
        }
      >
        {value}
      </div>
      <div className="font-mono text-[10px] text-ink-tertiary">{hint}</div>
    </div>
  );
}

interface RollbackStats {
  added: number;
  removed: number;
  modified: number;
  byStore: Array<{
    storeKey: string;
    added: number;
    removed: number;
    modified: number;
  }>;
}

function computeRollbackStats(historyBytes: Uint8Array): RollbackStats {
  // Clone the live Y.Doc so snapshotDiff doesn't read mid-mutation.
  const currentBytes = exportYDocAsUpdate();
  const currentDoc = new Y.Doc();
  Y.applyUpdate(currentDoc, currentBytes);
  const historyDoc = new Y.Doc();
  Y.applyUpdate(historyDoc, decodeDryj(historyBytes).update);
  const keys = unionTopLevelKeys([currentDoc, historyDoc]);
  // Direction: current → history. So `added` = in history but not
  // current (would be restored on rollback); `removed` = in current
  // but not history (would be lost). `classify` itself isn't needed
  // here — we just want the raw diff counts.
  const diff = snapshotDiff(currentDoc, historyDoc, keys);
  const byStoreMap = new Map<
    string,
    { added: number; removed: number; modified: number }
  >();
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const c of diff.changes) {
    if (c.kind === 'added') added++;
    else if (c.kind === 'removed') removed++;
    else if (c.kind === 'modified') modified++;
    const bucket =
      byStoreMap.get(c.storeKey) ?? { added: 0, removed: 0, modified: 0 };
    if (c.kind === 'added') bucket.added++;
    else if (c.kind === 'removed') bucket.removed++;
    else bucket.modified++;
    byStoreMap.set(c.storeKey, bucket);
  }
  // Bridge the classify import so the prod bundle keeps the symbol —
  // future P5.x preview can show classification (same-direction /
  // orthogonal / conflict) too.
  void classify;
  void applyImportedUpdate;
  return {
    added,
    removed,
    modified,
    byStore: [...byStoreMap.entries()]
      .map(([storeKey, v]) => ({ storeKey, ...v }))
      .sort(
        (a, b) =>
          b.added + b.removed + b.modified - (a.added + a.removed + a.modified),
      ),
  };
}

function fmtRelativeMs(ms: number): string {
  if (ms < 60_000) return '刚才';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  return `${day} 天前`;
}

function fmtAbsoluteIso(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}


// ============ AI ============
//
// ERD §6.6 v0.8.2 — OpenAI-compatible generic client.
//
// Three Y.Doc-synced fields (Base URL / Model / Background / aiEnabled)
// plus one local-only field (API key, in browser localStorage). The
// dichotomy follows §6.6 "userProfile field-split policy": settings
// inside the channel sync; the credential opening the channel does not.

const AI_BASE_URL_DEFAULT = 'https://openrouter.ai/api/v1';
const AI_MODEL_DEFAULT = 'meta-llama/llama-3.1-8b-instruct:free';

type TestConnectionState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string; bodyExcerpt?: string };

type ModelListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; models: string[] }
  | { kind: 'error'; message: string; bodyExcerpt?: string };

const MODEL_DATALIST_ID = 'ai-model-list';

/** Map any error from the AI client into the shared `{ kind: 'error',
 *  message, bodyExcerpt? }` UI state. Carries through `bodyExcerpt`
 *  when present so the bridge / provider's own error body is visible
 *  in-place — without it, "[provider-error] Provider returned 503"
 *  is opaque. */
function toErrorState(
  err: unknown,
): { kind: 'error'; message: string; bodyExcerpt?: string } {
  if (err instanceof AiClientError) {
    return {
      kind: 'error',
      message: `[${err.kind}] ${err.message}`,
      ...(err.bodyExcerpt && err.bodyExcerpt.trim().length > 0
        ? { bodyExcerpt: err.bodyExcerpt }
        : {}),
    };
  }
  return {
    kind: 'error',
    message: (err as Error).message ?? String(err),
  };
}

export function AISection() {
  const userProfile = useStore((s) => s.userProfile);
  const setAiEnabled = useStore((s) => s.setAiEnabled);
  const setAiBaseUrl = useStore((s) => s.setAiBaseUrl);
  const setAiModel = useStore((s) => s.setAiModel);
  const setUserBackground = useStore((s) => s.setUserBackground);

  const aiEnabled = userProfile?.aiEnabled === true;
  const baseUrl = userProfile?.aiBaseUrl ?? '';
  const model = userProfile?.aiModel ?? '';
  const background = userProfile?.background ?? '';

  const [apiKey, setApiKeyLocal] = useState<string>(() => getAiApiKey());
  const [aiLocale, setAiLocale] = useState<'ui' | 'zh-CN' | 'en'>('ui');
  useEffect(() => {
    const unsub = subscribeAiApiKey(setApiKeyLocal);
    return unsub;
  }, []);
  const handleApiKeyChange = useCallback((next: string) => {
    setAiApiKey(next);
    setApiKeyLocal(next);
  }, []);

  const [testState, setTestState] = useState<TestConnectionState>({ kind: 'idle' });
  const [modelListState, setModelListState] = useState<ModelListState>({ kind: 'idle' });
  const handleBackgroundCommit = useCallback(
    (next: string | undefined) => {
      void setUserBackground(next ?? '');
    },
    [setUserBackground],
  );
  const handleTestConnection = useCallback(async () => {
    setTestState({ kind: 'loading' });
    try {
      const out = await callChatCompletion({
        baseUrl: (baseUrl || AI_BASE_URL_DEFAULT).trim(),
        apiKey,
        model: (model || AI_MODEL_DEFAULT).trim(),
        messages: [
          { role: 'system', content: 'Reply with the single word OK and nothing else.' },
          { role: 'user', content: 'ping' },
        ],
      });
      if (out.trim().length === 0) {
        setTestState({
          kind: 'error',
          message: '调通了，但返回为空。模型可能出于流式 / 配置问题没回内容。',
        });
        return;
      }
      setTestState({ kind: 'ok' });
    } catch (err) {
      setTestState(toErrorState(err));
    }
  }, [apiKey, baseUrl, model]);
  const handleListModels = useCallback(async () => {
    setModelListState({ kind: 'loading' });
    try {
      const out = await listModels({
        baseUrl: (baseUrl || AI_BASE_URL_DEFAULT).trim(),
        apiKey,
      });
      const ids = out
        .map((m) => m.id)
        .filter((id, i, arr) => id.length > 0 && arr.indexOf(id) === i)
        .sort();
      setModelListState({ kind: 'ok', models: ids });
    } catch (err) {
      setModelListState(toErrorState(err));
    }
  }, [apiKey, baseUrl]);

  return (
    <SettingsSectionShell
      overline="AI · OpenAI 兼容协议"
      title="AI 辅助"
      description="DayRail 不自建推理；所有 AI 功能走任何 OpenAI 兼容端点。默认关闭。Base URL / Model / 我的背景 跨设备同步；API key 仅本机存储不上传。详见 ERD §6.6。"
    >
      <Row
        label="启用 AI 辅助"
        description="关闭时，Today Track / Review 的『让 AI 帮我看看』按钮整段不渲染。"
        control={
          <Toggle
            checked={aiEnabled}
            onChange={(next) => void setAiEnabled(next)}
            label="AI"
          />
        }
      />

      {aiEnabled && (
        <>
          <Row
            label="Base URL"
            description={
              <>
                任何兼容 OpenAI <code className="font-mono text-2xs">/chat/completions</code>{' '}
                的端点都可以填；默认 OpenRouter。本地 CLI 桥接（claude-code-router /
                Ollama 等）请确认对 PWA origin 开了 CORS。
              </>
            }
            control={
              <TextField
                value={baseUrl}
                onChange={(next) => void setAiBaseUrl(next)}
                placeholder={AI_BASE_URL_DEFAULT}
                mono
                className="w-[300px]"
              />
            }
          />

          <Row
            label="API key"
            description={
              <>
                <strong className="text-ink-secondary">仅本设备保存，不随同步流上传</strong>
                （ERD §6.6 字段分流原则 · 凭证心智）。OpenRouter key 去{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-primary underline underline-offset-2 hover:text-ink-secondary"
                >
                  openrouter.ai/keys <ExternalLink className="inline h-3 w-3" strokeWidth={1.8} />
                </a>{' '}
                获取；CLI 桥接 / 本地 LLM 通常用占位 key 即可。
              </>
            }
            control={
              <TextField
                type="password"
                value={apiKey}
                onChange={handleApiKeyChange}
                placeholder="sk-or-v1-..."
                mono
                className="w-[260px]"
              />
            }
          />

          <Row
            label="Model"
            description={
              <>
                自由文本 —— 各 provider 模型 ID 命名空间不同。
                也可点右侧「刷新可选模型」让 provider 自己报一份（走 OpenAI-compat{' '}
                <code className="font-mono text-2xs">/v1/models</code>）。
              </>
            }
            control={
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  list={
                    modelListState.kind === 'ok' &&
                    modelListState.models.length > 0
                      ? MODEL_DATALIST_ID
                      : undefined
                  }
                  value={model}
                  onChange={(e) => void setAiModel(e.target.value)}
                  placeholder={AI_MODEL_DEFAULT}
                  className={clsx(
                    'rounded-md bg-surface-1 px-3 py-1.5 text-sm text-ink-primary outline-none transition focus:bg-surface-2',
                    'placeholder:text-ink-tertiary/70',
                    'font-mono tabular-nums',
                    'w-[300px]',
                  )}
                />
                {modelListState.kind === 'ok' &&
                  modelListState.models.length > 0 && (
                    <datalist id={MODEL_DATALIST_ID}>
                      {modelListState.models.map((id) => (
                        <option key={id} value={id} />
                      ))}
                    </datalist>
                  )}
                <button
                  type="button"
                  onClick={() => void handleListModels()}
                  disabled={modelListState.kind === 'loading'}
                  title="GET /v1/models · 把 provider 当前可用模型 ID 拉到下拉里"
                  className={clsx(
                    'rounded-md border px-2.5 py-1.5 text-xs transition',
                    modelListState.kind === 'loading'
                      ? 'cursor-wait border-ink-tertiary/40 text-ink-tertiary'
                      : 'border-ink-tertiary/60 text-ink-primary hover:bg-surface-2',
                  )}
                >
                  {modelListState.kind === 'loading'
                    ? '获取中…'
                    : '刷新可选模型'}
                </button>
              </div>
            }
          />
          {modelListState.kind === 'ok' && (
            <p className="text-xs text-ink-tertiary">
              {modelListState.models.length > 0
                ? `✓ 拉到 ${modelListState.models.length} 个模型 · 在 Model 输入框内出现下拉提示，或继续手动输入`
                : '✓ 端点回了空清单 · 该 provider 没暴露模型 ID，手动填即可'}
            </p>
          )}
          {modelListState.kind === 'error' && (
            <ErrorPanel state={modelListState} />
          )}

          <Row
            label="测试连接"
            description="按一下打一次 minimal completion，确认 URL / key / model 三件事都通。"
            control={
              <button
                type="button"
                onClick={() => void handleTestConnection()}
                disabled={testState.kind === 'loading'}
                className={clsx(
                  'rounded-md border px-3 py-1.5 text-xs transition',
                  testState.kind === 'loading'
                    ? 'cursor-wait border-ink-tertiary/40 text-ink-tertiary'
                    : 'border-ink-tertiary/60 text-ink-primary hover:bg-surface-2',
                )}
              >
                {testState.kind === 'loading' ? '调用中…' : '测试'}
              </button>
            }
          />
          {testState.kind === 'ok' && (
            <p className="text-xs text-ok">✓ 调通了。</p>
          )}
          {testState.kind === 'error' && <ErrorPanel state={testState} />}

          <Row
            label="AI 输出语言"
            description="和界面语言解耦。界面用中文 + AI 用英文（或反之）是合法组合。"
            control={
              <Segmented
                value={aiLocale}
                onChange={setAiLocale}
                options={[
                  { key: 'ui', label: '跟随界面' },
                  { key: 'zh-CN', label: '简体中文' },
                  { key: 'en', label: 'English' },
                ]}
              />
            }
          />

          <div className="hairline-t flex flex-col gap-2 py-4">
            <header className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-ink-primary">我的背景</h3>
              <p className="text-xs text-ink-tertiary">
                单 Markdown blob，AI 调用前 prepend 到 system prompt；心智对标 Claude Code{' '}
                <code className="font-mono text-2xs">CLAUDE.md</code>。说说你的角色 / 习惯
                / 在意的事 —— AI 给的反馈会贴近这些上下文。详见 ERD §6.6.1。
              </p>
            </header>
            <MarkdownField
              value={background}
              onCommit={handleBackgroundCommit}
              placeholder="+ 添加背景 · Markdown · 例如『研究生 · 周末跑步 · 在备考 GRE』"
              dialogTitle="我的背景 · userProfile.background"
              ariaLabel="AI 背景 Markdown"
            />
          </div>
        </>
      )}
    </SettingsSectionShell>
  );
}

/** Display a classified AI error with optional body-excerpt drawer.
 *  Used by both 「测试连接」 and 「刷新可选模型」 paths so the bridge /
 *  provider's own error body is surfaced — without it we'd just show
 *  `[provider-error] Provider returned 503` and the user has no way
 *  to see what the upstream actually said. */
function ErrorPanel({
  state,
}: {
  state: { kind: 'error'; message: string; bodyExcerpt?: string };
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <p className="text-warn">✗ {state.message}</p>
      {state.bodyExcerpt && (
        <details className="text-2xs text-ink-tertiary">
          <summary className="cursor-pointer hover:text-ink-secondary">
            provider 回的 body（前 500 字）
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-words rounded-sm bg-surface-1 p-2 font-mono text-ink-secondary">
            {state.bodyExcerpt}
          </pre>
        </details>
      )}
    </div>
  );
}

// ============ Advanced ============

export function AdvancedSection() {
  const [ignoreThreshold, setIgnoreThreshold] = useState('7');
  const [archivedInStats, setArchivedInStats] = useState(true);

  return (
    <SettingsSectionShell
      overline="Advanced"
      title="高级"
      description="低频但真实存在的覆盖。99% 用户不需要调整；这里集中放，避免散落在各个视图里。"
    >
      <Row
        label="Pending 队列 · 批量忽略阈值"
        description="点「忽略超过 N 天的事项」时的 N（默认 7）。只影响按钮的作用范围，不会自动处理；用户仍需主动点。"
        control={
          <div className="flex items-center gap-2">
            <TextField
              type="number"
              value={ignoreThreshold}
              onChange={setIgnoreThreshold}
              mono
              className="w-[80px]"
            />
            <span className="text-sm text-ink-tertiary">天</span>
          </div>
        }
      />
      <Row
        label="归档 Line 计入长期统计"
        description="Review 页的节奏热力图 / 标签频次是否包含已归档 Line 的历史数据。默认开（看得见过去的努力）。"
        control={
          <Toggle
            checked={archivedInStats}
            onChange={setArchivedInStats}
            label="archived-in-stats"
          />
        }
      />
      <Row
        label="日期格式表"
        description="各视图当前采用的日期格式。只读；后续版本开放自定义。"
        control={
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            ↓ 下方展开
          </span>
        }
      />
      <div className="hairline-t mt-1 flex flex-col gap-0.5 py-4">
        <KeyValue label="Today Track 头" value="Fri · 17 Apr 2026" mono />
        <KeyValue label="Cycle pager" value="C1 · Apr 13 – Apr 19" mono />
        <KeyValue label="Cycle 内 day 单元格" value="Mon 13" mono />
        <KeyValue label="Review period" value="C1 · Apr 13 – Apr 19" mono />
        <KeyValue label="Pending 日期组" value="04.16 · THU · 1 天前" mono />
      </div>
      <UpgradeBackupPrefRow />
      {isTauriRuntime() && (
        <div className="hairline-t mt-6 flex flex-col pt-4">
          <span className="pb-2 font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            桌面端
          </span>
          <AutostartRow />
        </div>
      )}
      <BackupSection />
      <DangerZone />
    </SettingsSectionShell>
  );
}

function BackupSection() {
  // v0.7: JSON download stays as a human-readable inspection format
  // (and v0.6 export-format compatibility for users still on v0.6).
  // Round-trip restore uses .dryj instead — see Settings → 同步 →
  // 「下载本地快照」/「从快照导入」for the binary path. v0.6 JSON
  // backups must be converted via tools/migrate/migrate-json-to-yjs.ts
  // before they can be re-imported into v0.7.
  return (
    <div className="hairline-t mt-1 pt-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Backup
          </span>
          <h3 className="text-sm text-ink-primary">导出 JSON（仅人读）</h3>
          <p className="text-xs text-ink-tertiary">
            v0.7 用 Yjs CRDT 后,带历史合并语义的"完整备份"走 .dryj 二进制
            (Settings → 同步 → 「下载本地快照」/「从快照导入」)。这里的
            JSON 仅用于用编辑器扫一眼数据结构,**无法**通过 v0.7 直接导入
            还原 —— 想从 v0.6 JSON 恢复需要先跑 tools/migrate/migrate-
            json-to-yjs.ts 转成 .dryj。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportLocalData()}
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline/60 px-3 py-1.5 text-xs text-ink-secondary transition hover:border-ink-secondary hover:bg-surface-2 hover:text-ink-primary"
          >
            <Archive className="h-3.5 w-3.5" strokeWidth={1.6} />
            下载 JSON
          </button>
        </div>
      </div>
    </div>
  );
}

function DangerZone() {
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    const msg =
      '重置本地数据会清空 OPFS 里的所有事件 / 快照 / 缓存，页面刷新后启动到空状态（连了 Drive 的话会优先从远端拉取已有快照）。\n\n这个操作不可撤销 —— 继续？';
    if (!window.confirm(msg)) return;
    setResetting(true);
    try {
      await resetLocalData();
    } catch (err) {
      setResetting(false);
      window.alert(
        `重置失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div className="hairline-t mt-1 pt-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Danger zone
          </span>
          <h3 className="text-sm text-ink-primary">重置本地数据</h3>
          <p className="text-xs text-ink-tertiary">
            清空 OPFS 里的事件日志、快照、缓存；刷新后启动到空状态。连了
            Drive 会优先从远端拉取已有快照恢复。schema 升级或排查坏状态
            时用。
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          disabled={resetting}
          className="inline-flex items-center gap-1.5 self-start rounded-md border border-hairline/60 px-3 py-1.5 text-xs text-ink-secondary transition hover:border-red-500/60 hover:bg-red-500/5 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.6} />
          {resetting ? '正在清空…' : '清空并重载'}
        </button>
      </div>
    </div>
  );
}

// ============ About ============

interface StorageStatus {
  label: string;
  persisted: boolean | null; // null = unsupported / unknown
  usage?: string; // human-readable "12.3 MB / 2.1 GB"
  refresh: () => Promise<void>;
  request: () => Promise<void>;
}

/** Reads back whether OPFS is persistent. Boot already calls
 *  `navigator.storage.persist()` once, but localhost + fresh installs
 *  are often denied — Chrome uses a "site engagement" heuristic. The
 *  `request()` call below re-tries on a user gesture, which carries
 *  more weight than the boot-time auto-call. */
function useStorageStatus(): StorageStatus {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string | undefined>(undefined);

  const refresh = async () => {
    if (typeof navigator === 'undefined' || !('storage' in navigator)) {
      setPersisted(null);
      return;
    }
    const s = navigator.storage;
    try {
      const ok = typeof s.persisted === 'function' ? await s.persisted() : null;
      setPersisted(ok);
    } catch {
      setPersisted(null);
    }
    try {
      if (typeof s.estimate === 'function') {
        const est = await s.estimate();
        if (est.usage != null && est.quota != null) {
          setUsage(`${formatBytes(est.usage)} / ${formatBytes(est.quota)}`);
        }
      }
    } catch {
      // no-op — estimate() is a nice-to-have
    }
  };

  const request = async () => {
    if (typeof navigator === 'undefined' || !('storage' in navigator)) return;
    const s = navigator.storage;
    if (typeof s.persist !== 'function') return;
    try {
      await s.persist();
    } catch {
      // swallow — we'll just re-check below
    }
    await refresh();
  };

  useEffect(() => {
    void refresh();
  }, []);

  const label =
    persisted === true
      ? '已启用（OPFS 受保护）'
      : persisted === false
        ? '未启用（可能被回收）'
        : persisted === null
          ? '不支持'
          : '未知';

  return { label, persisted, usage, refresh, request };
}

function StorageStatusRow({ storage }: { storage: StorageStatus }) {
  const [requesting, setRequesting] = useState(false);
  const handleRequest = async () => {
    setRequesting(true);
    try {
      await storage.request();
    } finally {
      setRequesting(false);
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-sm text-ink-tertiary">存储持久化</span>
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            'text-sm',
            storage.persisted === true
              ? 'text-ink-primary'
              : storage.persisted === false
                ? 'text-warn'
                : 'text-ink-secondary',
          )}
        >
          {storage.label}
        </span>
        {storage.persisted === false && (
          <button
            type="button"
            onClick={() => void handleRequest()}
            disabled={requesting}
            title="显式请求浏览器持久化 · 用户手势下成功率更高"
            className="rounded-sm border border-hairline/60 px-2 py-0.5 text-xs text-ink-secondary transition hover:border-ink-secondary hover:bg-surface-2 hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {requesting ? '申请中…' : '申请'}
          </button>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function AboutSection() {
  const storage = useStorageStatus();
  return (
    <SettingsSectionShell overline="About" title="关于 DayRail">
      <div className="flex flex-col items-start gap-6 pt-2">
        <div className="flex items-center gap-4">
          <DayRailMarkLarge />
          <div className="flex flex-col">
            <span className="text-xl font-medium text-ink-primary">DayRail</span>
            <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
              Stay on the Rail
            </span>
          </div>
        </div>

        <div className="hairline-t flex w-full flex-col gap-0.5 py-4">
          <KeyValue label="版本" value={`v${__APP_VERSION__}`} mono />
          <KeyValue
            label="构建"
            value={`${__APP_BUILD_DATE__} · ${__APP_GIT_SHA__}`}
            mono
          />
          <KeyValue
            label="环境"
            value={import.meta.env.DEV ? 'DEV (本地开发)' : 'PROD'}
            mono
          />
          <KeyValue label="许可证" value="MIT" />
          <KeyValue label="维护者" value="FreeJolan" />
          {/* PWA-only · the persistence indicator advertises a real
              browser eviction risk that doesn't apply to Tauri (per-app
              isolated WebKit storage, no shared quota). Showing
              "未启用（可能被回收）" on desktop is misleading — it
              reports a state that has no equivalent risk. Storage usage
              still renders in both runtimes since byte-count info is
              independently useful. */}
          {!isTauriRuntime() && <StorageStatusRow storage={storage} />}
          {storage.usage && (
            <KeyValue label="存储用量" value={storage.usage} mono />
          )}
        </div>

        <UpdateCheckRow />

        <div className="flex flex-col gap-1">
          <a
            href="https://github.com/FreeJolan/dayrail"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-ink-primary underline underline-offset-4 hover:text-ink-secondary"
          >
            源码仓库
            <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
          </a>
          <a
            href="https://github.com/FreeJolan/dayrail/issues"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-ink-secondary underline underline-offset-4 hover:text-ink-primary"
          >
            贡献 · 开 issue / 提 PR
            <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
          </a>
        </div>

        <p className="max-w-xl text-xs text-ink-tertiary">
          DayRail 是 local-first、无账号的个人规划工具。你的数据在你自己的设备上；同步由你挑的云盘承担（Google Drive / iCloud / WebDAV）。
        </p>

        <p className="text-xs text-ink-tertiary/80">
          <Sparkles className="mr-1 inline h-3 w-3" strokeWidth={1.8} />
          Powered by Inter + JetBrains Mono + Noto Sans SC + Radix Colors.
        </p>
      </div>
    </SettingsSectionShell>
  );
}

function DayRailMarkLarge() {
  return (
    <svg
      width={56}
      height={56}
      viewBox="0 0 28 28"
      aria-label="DayRail"
      className="shrink-0 text-ink-primary"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <path d="M4 18 C 10 10, 18 10, 24 18" />
      <path d="M8 18 C 12 12, 16 12, 20 18" />
      <line x1="3" y1="18" x2="25" y2="18" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}

// ------------------------------------------------------------------
// Manual update check row — hosts "检查更新" + last-check-at + an
// inline "已是最新版本" flash for the no-op branch. When an update
// is waiting, an inline "升级" CTA appears alongside (mirroring the
// global UpdateBanner so users who live in Settings have a direct
// path). Both routes funnel through `useUpgradeFlow` (ERD §13.5 /
// §13.8).
// ------------------------------------------------------------------

function UpdateCheckRow() {
  const { checkNow, lastCheckedAt, status } = useVersionUpdate();
  const { requestUpgrade, surface: upgradeSurface } = useUpgradeFlow();
  const [flash, setFlash] = useState<'up-to-date' | null>(null);
  const [relative, setRelative] = useState<string>(() =>
    formatRelativeCheck(lastCheckedAt),
  );
  useEffect(() => {
    setRelative(formatRelativeCheck(lastCheckedAt));
    // Tick every 30s so the "N 分钟前" label doesn't freeze while the
    // user is parked on the About page.
    const id = window.setInterval(() => {
      setRelative(formatRelativeCheck(lastCheckedAt));
    }, 30_000);
    return () => window.clearInterval(id);
  }, [lastCheckedAt]);

  const handleClick = async () => {
    setFlash(null);
    const outcome = await checkNow();
    if (outcome === 'up-to-date') {
      setFlash('up-to-date');
      window.setTimeout(() => setFlash(null), 2500);
    }
    // 'needs-update' surfaces the inline 升级 button below + the
    // global UpdateBanner; both lead to the same useUpgradeFlow.
  };

  const busy = status === 'checking';
  const updateReady = status === 'needs-update';
  return (
    <div className="flex w-full flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-hairline/60 bg-surface-0 px-3 py-1.5 text-xs text-ink-primary transition hover:border-ink-tertiary hover:bg-surface-1 disabled:opacity-60"
      >
        {busy ? '检查中…' : '检查更新'}
      </button>
      {updateReady && (
        <button
          type="button"
          onClick={requestUpgrade}
          className="inline-flex items-center gap-1.5 rounded-md bg-cta px-3 py-1.5 text-xs font-medium text-cta-foreground transition hover:bg-cta-hover"
        >
          <ArrowUp className="h-3 w-3" strokeWidth={2} />
          升级
        </button>
      )}
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        {flash === 'up-to-date' ? '已是最新版本' : relative}
      </span>
      {upgradeSurface}
    </div>
  );
}

// ------------------------------------------------------------------
// Backup-before-upgrade preference. Three-way segmented control
// bound to localStorage via `lib/upgradePref`. Manually flipping
// this back to "询问" overrides whatever the dialog's "Remember my
// choice" checkbox previously wrote — this row is the single source
// of truth for the preference. ERD §13.8.
// ------------------------------------------------------------------

function UpgradeBackupPrefRow() {
  const [pref, setPrefState] = useState<UpgradePref>(() => getUpgradePref());
  useEffect(() => subscribeUpgradePref((next) => setPrefState(next)), []);
  const handleChange = (next: UpgradePref) => {
    setPrefState(next);
    setUpgradePref(next);
  };
  return (
    <div className="hairline-t flex w-full items-start justify-between gap-6 py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-medium text-ink-primary">
          升级前备份
        </span>
        <p className="text-xs text-ink-tertiary">
          升级前是否先把当前数据导出一份到本地。「询问」时每次升级前弹窗确认。
        </p>
      </div>
      <Segmented<UpgradePref>
        value={pref}
        onChange={handleChange}
        options={[
          { key: 'ask', label: '询问' },
          { key: 'always', label: '总是' },
          { key: 'never', label: '从不' },
        ]}
      />
    </div>
  );
}

function formatRelativeCheck(ts: number | null): string {
  if (ts == null) return '未检查';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return '刚刚';
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  return `${day} 天前`;
}
