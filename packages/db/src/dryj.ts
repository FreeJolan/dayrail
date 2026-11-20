// .dryj container codec — DayRail Yjs binary snapshot format.
//
// Wire layout (ERD §7.7):
//   [ 4 bytes ] magic    — ASCII "DRYJ"
//   [ 2 bytes ] version  — uint16 BE, container version.
//                          Distinct from the data-layer schemaVersion
//                          inside meta. Bump when the container layout
//                          itself changes (e.g. adding compression).
//   [ 4 bytes ] metaLen  — uint32 BE, byte length of meta JSON.
//   [ N bytes ] meta JSON — UTF-8.
//
// v1 payload (legacy — read-only support):
//   [ rest    ] yjs update — raw output of Y.encodeStateAsUpdate(doc).
//
// v2 payload (current — what encodeDryj writes):
//   [ 4 bytes ] updateLen — uint32 BE, byte length of the yjs update.
//   [ 4 bytes ] crc32     — uint32 BE, CRC-32 (IEEE) of the update bytes.
//   [ N bytes ] yjs update.
//
// Why v2 exists: v1's "update = whatever bytes remain" meant a file
// truncated inside the update segment (power loss mid-write, disk
// error) decoded "successfully" at the container layer; the damage
// only surfaced — or worse, half-applied — inside Y.applyUpdate, and
// the mangled doc was then persisted back as the new truth. v2 makes
// truncation and bit-rot detectable BEFORE any bytes reach Yjs: the
// length field catches short/long payloads, the checksum catches
// in-place corruption. Readers accept both versions; writers emit v2.
// Older clients reading a v2 file fail with the explicit
// "unsupported container version … upgrade DayRail" error — per
// ROADMAP, an old reader refusing a newer container is the intended
// behavior (never a silent misparse).
//
// Why a custom container instead of a JSON-with-base64 envelope: the
// envelope adds ~33% size overhead for no functional gain. A 40-line
// dependency-free framer is "file framing", not "custom algorithm",
// and matches the user preference for the most compact single-file
// representation.

export const DRYJ_MAGIC = new Uint8Array([0x44, 0x52, 0x59, 0x4a]); // "DRYJ"
export const CURRENT_CONTAINER_VERSION = 2;
/** Lowest container version decodeDryj still reads. */
export const MIN_SUPPORTED_CONTAINER_VERSION = 1;

// ---- CRC-32 (IEEE 802.3, the zlib/PNG polynomial) ----
let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** CRC-32 of `bytes` as an unsigned 32-bit integer. */
export function crc32(bytes: Uint8Array): number {
  const table = getCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = table[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeUint32BE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = (value >>> 24) & 0xff;
  out[offset + 1] = (value >>> 16) & 0xff;
  out[offset + 2] = (value >>> 8) & 0xff;
  out[offset + 3] = value & 0xff;
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

export interface DryjMeta {
  /** UUID generated at upload time — Yjs's internal Lamport clock is
   *  what governs merge order; this is for human/log identification
   *  and Drive history filenames. */
  snapshotId: string;
  /** snapshotId of the bundle this device pulled before writing.
   *  Optional because the very first push from a device has no
   *  parent. Yjs doesn't need it for merge, but it survives in meta
   *  for debug/forensics — "which device's lineage did this build
   *  from?" */
  parentSnapshotId?: string;
  deviceId: string;
  deviceLabel: string;
  /** ISO-8601. Just informational — Drive's modifiedTime is the
   *  authoritative timestamp for the canonical file. */
  createdAt: string;
  /** Data-layer schema version. v0.7 (Yjs-backed) starts at 2; v0.6
   *  ExportBundle was schemaVersion 1. */
  schemaVersion: number;
}

export interface DecodedDryj {
  containerVersion: number;
  meta: DryjMeta;
  /** Y.encodeStateAsUpdate output — feed to Y.applyUpdate. */
  update: Uint8Array;
}

export function encodeDryj(meta: DryjMeta, update: Uint8Array): Uint8Array {
  const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
  // v2: header + meta + [updateLen u32][crc32 u32] + update.
  const totalLen = 4 + 2 + 4 + metaBytes.length + 8 + update.length;
  const out = new Uint8Array(totalLen);
  out.set(DRYJ_MAGIC, 0);
  // version (uint16 BE)
  out[4] = (CURRENT_CONTAINER_VERSION >>> 8) & 0xff;
  out[5] = CURRENT_CONTAINER_VERSION & 0xff;
  // metaLen (uint32 BE)
  writeUint32BE(out, 6, metaBytes.length);
  out.set(metaBytes, 10);
  const payloadHeader = 10 + metaBytes.length;
  writeUint32BE(out, payloadHeader, update.length);
  writeUint32BE(out, payloadHeader + 4, crc32(update));
  out.set(update, payloadHeader + 8);
  return out;
}

export function decodeDryj(bytes: Uint8Array): DecodedDryj {
  if (bytes.length < 10) {
    throw new Error(`.dryj: too short (${bytes.length} bytes, expected ≥ 10)`);
  }
  for (let i = 0; i < 4; i++) {
    if (bytes[i]! !== DRYJ_MAGIC[i]!) {
      throw new Error('.dryj: bad magic (not a DRYJ container)');
    }
  }
  const containerVersion = (bytes[4]! << 8) | bytes[5]!;
  if (
    containerVersion < MIN_SUPPORTED_CONTAINER_VERSION ||
    containerVersion > CURRENT_CONTAINER_VERSION
  ) {
    throw new Error(
      `.dryj: unsupported container version ${containerVersion} (this build understands up to ${CURRENT_CONTAINER_VERSION}); upgrade DayRail to read it`,
    );
  }
  const metaLen = readUint32BE(bytes, 6);
  if (metaLen > bytes.length - 10) {
    throw new Error(`.dryj: meta length ${metaLen} out of range`);
  }
  const metaBytes = bytes.subarray(10, 10 + metaLen);
  let meta: DryjMeta;
  try {
    meta = JSON.parse(new TextDecoder().decode(metaBytes)) as DryjMeta;
  } catch (err) {
    throw new Error(`.dryj: meta JSON parse failed: ${(err as Error).message}`);
  }
  const metaEnd = 10 + metaLen;
  if (containerVersion === 1) {
    // Legacy v1 — no length/checksum framing; the update is whatever
    // bytes remain. Kept so pre-v2 state files, Drive snapshots and
    // backups stay readable.
    const update = bytes.subarray(metaEnd);
    return { containerVersion, meta, update };
  }
  // v2 — length + checksum framing.
  if (bytes.length < metaEnd + 8) {
    throw new Error(
      `.dryj: truncated container (payload header missing — have ${bytes.length} bytes, need ≥ ${metaEnd + 8})`,
    );
  }
  const updateLen = readUint32BE(bytes, metaEnd);
  const expectedCrc = readUint32BE(bytes, metaEnd + 4);
  const payloadStart = metaEnd + 8;
  const got = bytes.length - payloadStart;
  if (got < updateLen) {
    throw new Error(
      `.dryj: payload truncated (expected ${updateLen} bytes, got ${got})`,
    );
  }
  if (got > updateLen) {
    throw new Error(
      `.dryj: payload length mismatch (expected ${updateLen} bytes, found ${got} — trailing bytes)`,
    );
  }
  const update = bytes.subarray(payloadStart, payloadStart + updateLen);
  const actualCrc = crc32(update);
  if (actualCrc !== expectedCrc) {
    throw new Error(
      `.dryj: payload checksum mismatch (expected ${expectedCrc.toString(16)}, got ${actualCrc.toString(16)}) — file is corrupt`,
    );
  }
  return { containerVersion, meta, update };
}
