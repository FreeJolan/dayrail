// Drive REST against the `appdata` space (v0.7). Only this app sees
// these files (per OAuth scope drive.appdata). All calls go through
// ensureAccessToken which transparently handles silent refresh.
//
// Files we manage in `appdata`:
//   dayrail-snapshot.dryj          — canonical "latest", overwritten on every push
//   dayrail-snapshot-{ts}-{label}.dryj — rolling history, 14 most recent kept
//
// The `.dryj` container (see @dayrail/db/dryj) wraps a Yjs update-bytes
// payload with a small JSON metadata header (snapshotId,
// parentSnapshotId, deviceId, deviceLabel, createdAt, schemaVersion).
// The same fields are mirrored into Drive `appProperties` so the boot
// probe can read lineage without downloading the body.

import { ensureAccessToken, invalidateCachedToken } from './driveAuth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const APP_DATA_PARENT = 'appDataFolder';
const CANONICAL_FILENAME = 'dayrail-snapshot.dryj';
const HISTORY_PREFIX = 'dayrail-snapshot-';
const HISTORY_RETENTION = 14;

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
    throw new Error(
      `Drive ${res.status} ${res.statusText}${txt ? ' · ' + txt.slice(0, 200) : ''}`,
    );
  }
  return (await res.json()) as T;
}

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

/** Read canonical lineage metadata (no body download). Returns null
 *  when the remote has never been written. */
export async function getRemoteMeta(): Promise<RemoteMeta | null> {
  const all = await listAll();
  const canonical = all.find((f) => f.name === CANONICAL_FILENAME);
  if (!canonical) return null;
  const ap = canonical.appProperties ?? {};
  const sizeBytes = canonical.size ? Number(canonical.size) : undefined;
  if (!ap.snapshotId) {
    // v0.7 always writes appProperties on upload. A canonical without
    // snapshotId is either a bare manual upload (rare) or corruption;
    // surface as a fresh remote and let the next push re-seed.
    return null;
  }
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

/** Download the raw `.dryj` bytes by Drive file id. */
export async function downloadDryjById(id: string): Promise<Uint8Array> {
  const url = `${DRIVE_API}/files/${id}?alt=media`;
  const res = await authedFetch(url);
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(
      `Drive ${res.status} ${res.statusText}${txt ? ' · ' + txt.slice(0, 200) : ''}`,
    );
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

interface UploadResult {
  fileId: string;
}

async function multipartUploadDryj(
  bytes: Uint8Array,
  filename: string,
  existingFileId: string | null,
  appProperties: Record<string, string>,
): Promise<UploadResult> {
  const boundary = `dayrailsync${Math.random().toString(36).slice(2)}`;
  const meta = existingFileId
    ? { name: filename, appProperties }
    : {
        name: filename,
        parents: [APP_DATA_PARENT],
        mimeType: 'application/octet-stream',
        appProperties,
      };

  // Multipart body: JSON metadata part + binary content part.
  // Drive accepts the full request body as a Blob; we assemble one
  // by concatenating the parts.
  const enc = new TextEncoder();
  const metaPart = enc.encode(
    `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(meta) +
      '\r\n' +
      `--${boundary}\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n',
  );
  const tailPart = enc.encode(`\r\n--${boundary}--`);
  const body = new Blob([
    metaPart as BlobPart,
    bytes as BlobPart,
    tailPart as BlobPart,
  ]);

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
    throw new Error(
      `Drive upload ${res.status}${txt ? ' · ' + txt.slice(0, 200) : ''}`,
    );
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error('Drive upload returned no file id');
  return { fileId: json.id };
}

async function deleteFile(id: string): Promise<void> {
  const res = await authedFetch(`${DRIVE_API}/files/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text().catch(() => '');
    throw new Error(
      `Drive delete ${res.status}${txt ? ' · ' + txt.slice(0, 200) : ''}`,
    );
  }
}

function safeFilenameFragment(s: string): string {
  return s.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 40);
}

function timestampFragment(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-');
}

export interface UploadAppProperties {
  snapshotId: string;
  parentSnapshotId?: string;
  deviceId: string;
  deviceLabel: string;
}

interface UploadOpts {
  skipHistory?: boolean;
}

/** Push: overwrite `dayrail-snapshot.dryj` AND drop a stamped copy in
 *  history. The bytes are the full `.dryj` container (already wrapped
 *  by encodeDryj before this call). */
export async function uploadDryj(
  bytes: Uint8Array,
  meta: UploadAppProperties,
  opts: UploadOpts = {},
): Promise<{ canonicalFileId: string; historyFileId: string | null }> {
  const appProperties: Record<string, string> = {
    snapshotId: meta.snapshotId,
    deviceId: meta.deviceId,
    deviceLabel: meta.deviceLabel,
    ...(meta.parentSnapshotId && { parentSnapshotId: meta.parentSnapshotId }),
  };

  const all = await listAll();
  const canonical = all.find((f) => f.name === CANONICAL_FILENAME) ?? null;
  const canonicalUpload = await multipartUploadDryj(
    bytes,
    CANONICAL_FILENAME,
    canonical?.id ?? null,
    appProperties,
  );
  let historyFileId: string | null = null;
  if (!opts.skipHistory) {
    const historyName = `${HISTORY_PREFIX}${timestampFragment()}-${safeFilenameFragment(meta.deviceLabel)}.dryj`;
    const historyUpload = await multipartUploadDryj(
      bytes,
      historyName,
      null,
      appProperties,
    );
    historyFileId = historyUpload.fileId;
    await pruneHistory();
  }
  return { canonicalFileId: canonicalUpload.fileId, historyFileId };
}

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
      /* best-effort */
    }
  }
}

export interface HistoryEntry {
  fileId: string;
  filename: string;
  modifiedTime: string;
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
  // dayrail-snapshot-YYYYMMDD-HHMMSS-{label}.dryj
  const m = name.match(/^dayrail-snapshot-\d{8}-\d{6}-(.+)\.dryj$/);
  return m?.[1] ?? '';
}

export async function deleteHistoryEntry(fileId: string): Promise<void> {
  await deleteFile(fileId);
}
