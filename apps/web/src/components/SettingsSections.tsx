import { useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  Archive,
  ArrowUp,
  Cloud,
  CloudOff,
  ExternalLink,
  GripVertical,
  Plus,
  Sparkles,
  Trash2,
  Upload,
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
import { importLocalData } from '@/lib/importData';
import { useVersionUpdate } from '@/lib/swRegistration';
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
  isDriveConnected,
} from '@/lib/sync/driveAuth';
import {
  applyRemoteBundle,
  fetchRemoteBundle,
  runManualPush,
} from '@/lib/sync/syncController';
import {
  deleteHistoryEntry,
  downloadBundleById,
  getRemoteMeta,
  getRemoteSummary,
  listHistory,
  type HistoryEntry,
  type RemoteMeta,
} from '@/lib/sync/driveBackend';
import {
  getBootSyncChoice,
  getDeviceLabel,
  getDirtyCount,
  getLastPulledSnapshotId,
  setBootSyncChoice,
  setDeviceLabel,
  type BootSyncChoice,
} from '@/lib/sync/identity';
import { syncStore, useSyncStatus } from '@/lib/sync/syncStore';
import { downloadBundleAs } from '@/lib/exportData';

// ============ Appearance ============

export function AppearanceSection() {
  const [theme, setThemeState] = useState<ThemePref>(() => getThemePref());
  const setTheme = (next: ThemePref) => {
    setThemeState(next);
    applyTheme(next);
  };
  const [lang, setLang] = useState<'auto' | 'zh-CN' | 'en'>('zh-CN');

  return (
    <SettingsSectionShell
      overline="Appearance"
      title="外观"
      description="主题与语言。跨设备同步前，这些选项存在本设备（device-local，见 §7.2.1）。"
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
        description="首次启动读 navigator.language；此处覆盖。AI 输出语言在「高级」里独立设置。"
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
    </SettingsSectionShell>
  );
}

// ============ Sync ============

export function SyncSection() {
  const status = useSyncStatus();
  return (
    <SettingsSectionShell
      overline="Sync"
      title="同步"
      description="DayRail 无账号。Google Drive 同步把整份数据放到你自己 Google 账号下的隐藏空间（appdata），其它应用看不到；详见 ERD §7.6。"
    >
      <SyncStatusCard connected={status.connected} />
      {!status.connected && <ConnectDrivePanel />}
      {status.connected && <ConnectedSyncControls />}
    </SettingsSectionShell>
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

function ConnectDrivePanel() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const onConnect = async () => {
    setBusy(true);
    setErr(null);
    try {
      await connectDrive();
      syncStore.setConnected(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 pt-4">
      <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
        连接后端
      </span>
      <button
        type="button"
        onClick={onConnect}
        disabled={busy}
        className="flex items-start gap-3 self-start rounded-md border border-dashed border-ink-tertiary/40 px-4 py-3 text-left transition hover:border-ink-secondary hover:bg-surface-1 disabled:opacity-50"
      >
        <Cloud className="mt-0.5 h-4 w-4 text-ink-secondary" strokeWidth={1.6} />
        <div className="flex flex-col">
          <span className="text-sm font-medium text-ink-primary">
            {busy ? '正在打开 Google 同意页…' : '连接 Google Drive'}
          </span>
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
    </div>
  );
}

function ConnectedSyncControls() {
  return (
    <div className="flex flex-col pt-4">
      <RemoteStatePanel />
      <DeviceLabelRow />
      <BootSyncChoiceRow />
      <SyncNowRow />
      <DisconnectRow />
      <BackupHistoryRow />
    </div>
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
              <KvLine k="文件" v="dayrail-snapshot.json" mono />
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
  | { kind: 'remote-ahead'; remoteDevice: string }
  | { kind: 'diverged'; remoteDevice: string }
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
  if (!equal && localDirty === 0)
    return { kind: 'remote-ahead', remoteDevice: remote.deviceLabel ?? '另一台设备' };
  return { kind: 'diverged', remoteDevice: remote.deviceLabel ?? '另一台设备' };
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
      case 'remote-ahead':
        return {
          tone: 'pending',
          dot: 'bg-warn/70',
          text: `远端较新 · 来自 ${verdict.remoteDevice} · 下次启动会拉取`,
        };
      case 'diverged':
        return {
          tone: 'warn',
          dot: 'bg-warn',
          text: `⚠ 已分叉 · 本地有未推送改动，且远端来自 ${verdict.remoteDevice} · 下次启动会弹冲突卡片`,
        };
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
  const [label, setLabel] = useState(() => getDeviceLabel());
  const persist = (next: string) => {
    setLabel(next);
    setDeviceLabel(next);
    syncStore.setDeviceLabel(next || getDeviceLabel());
  };
  return (
    <Row
      label="设备名"
      description="显示给其它设备看的标签（默认按 UA 推断）。"
      control={
        <TextField
          value={label}
          onChange={persist}
          placeholder={getDeviceLabel()}
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
  const onClick = async () => {
    setBusy(true);
    setErr(null);
    try {
      await runManualPush();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Row
      label="立即同步"
      description="手动触发一次 push（在 60s debounce 之外）。"
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

function BackupHistoryRow() {
  const [open, setOpen] = useState(false);
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
    if (open && items === null) void refresh();
  }, [open, items]);
  return (
    <div className="flex flex-col">
      <Row
        label="备份历史"
        description={`Drive 上滚动保留最近 14 份历史快照（按设备 + 时间命名）。`}
        control={
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink-secondary transition hover:bg-surface-2 hover:text-ink-primary"
          >
            {open ? '收起' : '展开'}
          </button>
        }
      />
      {open && (
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
      )}
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
  const [busy, setBusy] = useState<null | 'restore' | 'download' | 'delete'>(null);
  const [err, setErr] = useState<string | null>(null);
  const onRestore = async () => {
    if (
      !window.confirm(
        `从这份历史快照恢复？\n\n会覆盖本地当前数据（建议先点"下载"留底）。`,
      )
    )
      return;
    setBusy('restore');
    setErr(null);
    try {
      const bundle = await downloadBundleById(entry.fileId);
      await applyRemoteBundle(bundle);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };
  const onDownload = async () => {
    setBusy('download');
    setErr(null);
    try {
      const bundle = await downloadBundleById(entry.fileId);
      downloadBundleAs(bundle, entry.filename);
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
            onClick={onRestore}
            disabled={busy !== null}
            className="rounded-sm bg-surface-2 px-2 py-1 text-2xs font-medium text-ink-secondary hover:bg-surface-3 hover:text-ink-primary disabled:opacity-50"
          >
            恢复
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
      {err && (
        <p className="font-mono text-2xs text-warn">{err}</p>
      )}
    </li>
  );
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

// (Re-export to keep one source of truth for SyncSection consumers; the
// real driveAuth check still gates connection.)
void isDriveConnected;
void fetchRemoteBundle; // referenced by the conflict-card path

// ============ AI ============

export function AISection() {
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [chain, setChain] = useState<Array<{ id: string; model: string; paid: boolean }>>([
    { id: 'm1', model: 'claude-3.5-sonnet:free', paid: false },
    { id: 'm2', model: 'gpt-4o-mini:free', paid: false },
  ]);

  return (
    <SettingsSectionShell
      overline="AI · OpenRouter"
      title="AI 辅助"
      description="DayRail 不自建推理，所有 AI 功能走 OpenRouter 网关。默认关闭；自备 API Key 零花费可用免费模型。详见 §6。"
    >
      <Row
        label="启用 AI 辅助"
        description="关闭时，Review / Projects 的 AI 卡片完全不渲染；Decompose 入口隐藏。"
        control={<Toggle checked={enabled} onChange={setEnabled} label="AI" />}
      />

      {enabled && (
        <>
          <Row
            label="OpenRouter API Key"
            description={
              <>
                仅本设备存储，永不上传。去{' '}
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-ink-primary underline underline-offset-2 hover:text-ink-secondary"
                >
                  openrouter.ai/keys <ExternalLink className="inline h-3 w-3" strokeWidth={1.8} />
                </a>{' '}
                获取。
              </>
            }
            control={
              <TextField
                type="password"
                value={apiKey}
                onChange={setApiKey}
                placeholder="sk-or-v1-..."
                mono
                className="w-[260px]"
              />
            }
          />
          <Row
            label="Fallback 链"
            description="按顺序尝试；任一模型失败（限流 / 报错 / 超时）自动切到下一个。拖拽重排。"
            control={<span className="text-xs text-ink-tertiary">右侧展开 →</span>}
          />
          <div className="hairline-t flex flex-col gap-2 py-4">
            <ul className="flex flex-col gap-2">
              {chain.map((m, idx) => (
                <FallbackPill
                  key={m.id}
                  idx={idx}
                  model={m.model}
                  paid={m.paid}
                  onRemove={() => setChain((prev) => prev.filter((x) => x.id !== m.id))}
                />
              ))}
            </ul>
            <button
              type="button"
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-dashed border-ink-tertiary/40 px-2.5 py-1 text-xs text-ink-tertiary transition hover:border-ink-secondary hover:text-ink-secondary"
            >
              <Plus className="h-3 w-3" strokeWidth={1.8} />
              从免费清单追加 · 或插入付费模型
            </button>
            <p className="pt-1 text-2xs text-ink-tertiary/80">
              免费清单是远端 JSON（CDN 托管），应用启动时拉取 + 本地兜底；你可以在任意位置插入付费模型。
            </p>
          </div>
        </>
      )}
    </SettingsSectionShell>
  );
}

function FallbackPill({
  idx,
  model,
  paid,
  onRemove,
}: {
  idx: number;
  model: string;
  paid: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-md bg-surface-1 px-2 py-1.5">
      <GripVertical
        className="h-3.5 w-3.5 cursor-grab text-ink-tertiary"
        strokeWidth={1.8}
      />
      <span className="w-5 font-mono text-2xs tabular-nums text-ink-tertiary">
        {idx + 1}
      </span>
      <span className="flex-1 truncate font-mono text-xs tabular-nums text-ink-primary">
        {model}
      </span>
      <span
        className={clsx(
          'rounded-sm px-1.5 py-0.5 font-mono text-2xs uppercase tracking-widest',
          paid
            ? 'bg-warn-soft text-warn'
            : 'bg-surface-2 text-ink-tertiary',
        )}
      >
        {paid ? '付费' : '免费'}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove"
        className="rounded-sm p-0.5 text-ink-tertiary transition hover:bg-surface-3 hover:text-ink-primary"
      >
        <X className="h-3 w-3" strokeWidth={1.8} />
      </button>
    </li>
  );
}

// ============ Advanced ============

export function AdvancedSection() {
  const [ignoreThreshold, setIgnoreThreshold] = useState('7');
  const [archivedInStats, setArchivedInStats] = useState(true);
  const [timeFormat, setTimeFormat] = useState<'auto' | '24h' | 'ampm'>('auto');
  const [aiLocale, setAiLocale] = useState<'ui' | 'zh-CN' | 'en'>('ui');

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
      <BackupSection />
      <DangerZone />
    </SettingsSectionShell>
  );
}

function BackupSection() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    // Reset the input so the same file can be picked twice in a row.
    e.target.value = '';
    if (!file) return;
    const ok = window.confirm(
      `导入会覆盖当前本地数据（不可撤销）。\n\n文件：${file.name}\n\n继续?`,
    );
    if (!ok) return;
    setImporting(true);
    try {
      await importLocalData(file);
      // importLocalData triggers a page reload; control won't return
      // here in the happy path. If it does, something failed silently.
    } catch (err) {
      setImporting(false);
      window.alert(
        `导入失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div className="hairline-t mt-1 pt-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-2xs uppercase tracking-widest text-ink-tertiary">
            Backup
          </span>
          <h3 className="text-sm text-ink-primary">导出 / 导入全部数据</h3>
          <p className="text-xs text-ink-tertiary">
            数据只在本地浏览器的 OPFS 里 —— 清缓存、换设备、浏览器崩溃都会
            丢失。定期导出 JSON 到本地文件是唯一保险。导入会整体覆盖当前
            数据（不是合并），适合"从备份恢复"或"把数据从一个浏览器搬到
            另一个"。
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
          <button
            type="button"
            onClick={handleImportClick}
            disabled={importing}
            className="inline-flex items-center gap-1.5 rounded-md border border-hairline/60 px-3 py-1.5 text-xs text-ink-secondary transition hover:border-ink-secondary hover:bg-surface-2 hover:text-ink-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.6} />
            {importing ? '导入中…' : '导入 JSON'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void handleFileChosen(e)}
          />
        </div>
      </div>
    </div>
  );
}

function DangerZone() {
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    const msg =
      '重置本地数据会清空 OPFS 里的所有事件 / 快照 / 缓存，页面刷新后按初始种子重新跑。\n\n这个操作不可撤销 —— 继续？';
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
            清空 OPFS 里的事件日志、快照、缓存；刷新后 `boot()` 会按
            sample templates / rails 重新 seed。schema 升级或排查坏状态
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
          <KeyValue label="许可证" value="MIT" />
          <KeyValue label="维护者" value="FreeJolan" />
          <StorageStatusRow storage={storage} />
          {storage.usage && (
            <KeyValue label="存储用量" value={storage.usage} mono />
          )}
        </div>

        <UpdateCheckRow />
        <UpgradeBackupPrefRow />

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
