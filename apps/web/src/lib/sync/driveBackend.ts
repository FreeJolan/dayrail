// Drive REST against the `appdata` space. Only this app sees these
// files (per OAuth scope drive.appdata). All calls go through
// ensureAccessToken which transparently handles silent refresh.
//
// Files we manage in `appdata`:
//   dayrail-snapshot.json         — canonical "latest", overwritten on every push
//   dayrail-snapshot-{ts}-{label}.json   — rolling history, 14 most recent kept
//
// Note: `appdata` does NOT support folders the way the user-visible
// Drive does — files there have implicit parent `appDataFolder`.
// We disambiguate history entries by filename prefix.

import type { ExportBundle } from '../exportData';
import { ensureAccessToken, invalidateCachedToken } from './driveAuth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const APP_DATA_PARENT = 'appDataFolder';
const CANONICAL_FILENAME = 'dayrail-snapshot.json';
const HISTORY_PREFIX = 'dayrail-snapshot-';
const HISTORY_RETENTION = 14;

/** What we need to know about the canonical remote file before we
 *  decide what to do at boot. Sourced from Drive `appProperties` (set
 *  during upload) so we don't have to download the body to compare
 *  lineage. Legacy uploads from before this commit fall back to a
 *  body fetch — that path still works, just slower. */
export interface RemoteMeta {
  fileId: string;
  modifiedTime: string; // ISO
  snapshotId: string;
  parentSnapshotId?: string;
  deviceLabel?: string;
  /** Bytes, parsed from Drive `size` (which is a string). */
  sizeBytes?: number;
}

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
  size?: string;
  appProperties?: Record<string, string>;
}

interface DriveFileList {
  files: DriveFile[];
  nextPageToken?: string;
}

async function authedFetch(
  url: string,
  init: RequestInit & { _retried?: boolean } = {},
): Promise<Response> {
  const token = await ensureAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401 && !init._retried) {
    invalidateCachedToken();
    return authedFetch(url, { ...init, _retried: true });
  }
  return res;
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Drive ${res.status} ${res.statusText}${txt ? ' · ' + txt.slice(0, 200) : ''}`);
  }
  return (await res.json()) as T;
}

/** List all DayRail files in appdata. Names + ids + modifiedTime +
 *  appProperties (so we can read snapshot lineage without fetching
 *  bodies). Bodies are fetched separately when actually needed. */
async function listAll(): Promise<DriveFile[]> {
  const acc: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`${DRIVE_API}/files`);
    url.searchParams.set('spaces', 'appDataFolder');
    url.searchParams.set(
      'fields',
      'files(id,name,modifiedTime,size,appProperties),nextPageToken',
    );
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await authedFetch(url.toString());
    const json = await readJson<DriveFileList>(res);
    acc.push(...json.files);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return acc;
}

/** Get the canonical "latest" remote bundle's lineage metadata.
 *  Returns null if the remote has never been written (fresh user).
 *
 *  Fast path: read snapshotId + parent + deviceLabel from Drive
 *  `appProperties` (set during upload) — no body download.
 *
 *  Fallback path: legacy uploads from before appProperties landed
 *  don't carry it; we download the bundle body to extract the same
 *  fields. After one push from the new code, this fallback never
 *  fires again. */
export async function getRemoteMeta(): Promise<RemoteMeta | null> {
  const all = await listAll();
  const canonical = all.find((f) => f.name === CANONICAL_FILENAME);
  if (!canonical) return null;
  const ap = canonical.appProperties ?? {};
  const sizeBytes = canonical.size ? Number(canonical.size) : undefined;
  if (ap.snapshotId) {
    return {
      fileId: canonical.id,
      modifiedTime: canonical.modifiedTime ?? '',
      snapshotId: ap.snapshotId,
      ...(ap.parentSnapshotId && { parentSnapshotId: ap.parentSnapshotId }),
      ...(ap.deviceLabel && { deviceLabel: ap.deviceLabel }),
      ...(sizeBytes !== undefined &&
        Number.isFinite(sizeBytes) && { sizeBytes }),
    };
  }
  const bundle = await downloadBundleById(canonical.id);
  return {
    fileId: canonical.id,
    modifiedTime: canonical.modifiedTime ?? '',
    snapshotId: bundle.snapshotId ?? '',
    ...(bundle.parentSnapshotId && { parentSnapshotId: bundle.parentSnapshotId }),
    ...(bundle.deviceLabel && { deviceLabel: bundle.deviceLabel }),
    ...(sizeBytes !== undefined &&
      Number.isFinite(sizeBytes) && { sizeBytes }),
  };
}

/** Total count of files we manage in appdata (canonical + history).
 *  Cheap meta-only call; use for the Settings → 同步 panel. */
export async function getRemoteSummary(): Promise<{
  canonicalPresent: boolean;
  historyCount: number;
  totalSizeBytes: number;
}> {
  const all = await listAll();
  let canonicalPresent = false;
  let historyCount = 0;
  let totalSizeBytes = 0;
  for (const f of all) {
    if (f.name === CANONICAL_FILENAME) canonicalPresent = true;
    if (f.name.startsWith(HISTORY_PREFIX)) historyCount++;
    if (f.size) {
      const n = Number(f.size);
      if (Number.isFinite(n)) totalSizeBytes += n;
    }
  }
  return { canonicalPresent, historyCount, totalSizeBytes };
}

/** Download a bundle by Drive file id. */
export async function downloadBundleById(id: string): Promise<ExportBundle> {
  const url = `${DRIVE_API}/files/${id}?alt=media`;
  const res = await authedFetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Drive ${res.status} ${res.statusText}${txt ? ' · ' + txt.slice(0, 200) : ''}`);
  }
  return (await res.json()) as ExportBundle;
}

interface UploadResult {
  fileId: string;
}

async function multipartUpload(
  bundle: ExportBundle,
  filename: string,
  existingFileId: string | null,
  appProperties?: Record<string, string>,
): Promise<UploadResult> {
  const boundary = `dayrailsync${Math.random().toString(36).slice(2)}`;
  const meta = existingFileId
    ? { name: filename, ...(appProperties && { appProperties }) }
    : {
        name: filename,
        parents: [APP_DATA_PARENT],
        mimeType: 'application/json',
        ...(appProperties && { appProperties }),
      };
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(meta) +
    '\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    JSON.stringify(bundle) +
    '\r\n' +
    `--${boundary}--`;

  const url = existingFileId
    ? `${DRIVE_UPLOAD}/files/${existingFileId}?uploadType=multipart`
    : `${DRIVE_UPLOAD}/files?uploadType=multipart`;
  const res = await authedFetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Drive upload ${res.status}${txt ? ' · ' + txt.slice(0, 200) : ''}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error('Drive upload returned no file id');
  return { fileId: json.id };
}

async function deleteFile(id: string): Promise<void> {
  const res = await authedFetch(`${DRIVE_API}/files/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Drive delete ${res.status}${txt ? ' · ' + txt.slice(0, 200) : ''}`);
  }
}

function safeFilenameFragment(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 40);
}

function timestampFragment(): string {
  // YYYYMMDD-HHMMSS in UTC for stable lex order.
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

interface UploadOpts {
  /** Skip writing a history copy (e.g., for a probe-only push). */
  skipHistory?: boolean;
}

/** Push a bundle: overwrite (or create) `dayrail-snapshot.json` AND
 *  drop a stamped copy into history. Caller must have stamped the
 *  bundle's sync metadata (snapshotId / parentSnapshotId / deviceId
 *  / deviceLabel) before calling. The same metadata is mirrored into
 *  Drive `appProperties` so other devices' boot probe + the Settings
 *  → 同步 panel can read lineage without downloading bodies. */
export async function uploadSnapshot(
  bundle: ExportBundle,
  opts: UploadOpts = {},
): Promise<{ canonicalFileId: string; historyFileId: string | null }> {
  const appProperties: Record<string, string> = {};
  if (bundle.snapshotId) appProperties.snapshotId = bundle.snapshotId;
  if (bundle.parentSnapshotId) appProperties.parentSnapshotId = bundle.parentSnapshotId;
  if (bundle.deviceLabel) appProperties.deviceLabel = bundle.deviceLabel;
  if (bundle.deviceId) appProperties.deviceId = bundle.deviceId;

  const all = await listAll();
  const canonical = all.find((f) => f.name === CANONICAL_FILENAME) ?? null;
  const canonicalUpload = await multipartUpload(
    bundle,
    CANONICAL_FILENAME,
    canonical?.id ?? null,
    appProperties,
  );
  let historyFileId: string | null = null;
  if (!opts.skipHistory) {
    const historyName = `${HISTORY_PREFIX}${timestampFragment()}-${safeFilenameFragment(
      bundle.deviceLabel ?? 'device',
    )}.json`;
    const historyUpload = await multipartUpload(
      bundle,
      historyName,
      null,
      appProperties,
    );
    historyFileId = historyUpload.fileId;
    await pruneHistory();
  }
  return { canonicalFileId: canonicalUpload.fileId, historyFileId };
}

/** Keep only the 14 most-recent history files (by modifiedTime). */
export async function pruneHistory(): Promise<void> {
  const all = await listAll();
  const history = all
    .filter((f) => f.name.startsWith(HISTORY_PREFIX))
    .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''));
  const drop = history.slice(HISTORY_RETENTION);
  for (const f of drop) {
    try {
      await deleteFile(f.id);
    } catch {
      // Best-effort prune — a stuck delete just leaves an extra file
      // around for next time, never breaks the upload.
    }
  }
}

export interface HistoryEntry {
  fileId: string;
  filename: string;
  modifiedTime: string;
  /** Parsed from filename — best-effort, may be empty. */
  deviceLabel: string;
}

export async function listHistory(): Promise<HistoryEntry[]> {
  const all = await listAll();
  return all
    .filter((f) => f.name.startsWith(HISTORY_PREFIX))
    .sort((a, b) => (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? ''))
    .map((f) => ({
      fileId: f.id,
      filename: f.name,
      modifiedTime: f.modifiedTime ?? '',
      deviceLabel: parseDeviceLabelFromFilename(f.name),
    }));
}

function parseDeviceLabelFromFilename(name: string): string {
  // dayrail-snapshot-YYYYMMDD-HHMMSS-{label}.json
  const m = name.match(/^dayrail-snapshot-\d{8}-\d{6}-(.+)\.json$/);
  return m?.[1] ?? '';
}

export async function deleteHistoryEntry(fileId: string): Promise<void> {
  await deleteFile(fileId);
}
