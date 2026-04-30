// .dryj container codec — DayRail Yjs binary snapshot format.
//
// Wire layout (ERD §7.7):
//   [ 4 bytes ] magic    — ASCII "DRYJ"
//   [ 2 bytes ] version  — uint16 BE, container version (starts at 1).
//                          Distinct from the data-layer schemaVersion
//                          inside meta. Bump when the container layout
//                          itself changes (e.g. adding compression).
//   [ 4 bytes ] metaLen  — uint32 BE, byte length of meta JSON.
//   [ N bytes ] meta JSON — UTF-8.
//   [ rest    ] yjs update — raw output of Y.encodeStateAsUpdate(doc).
//
// Why a custom container instead of a JSON-with-base64 envelope: the
// envelope adds ~33% size overhead for no functional gain. A 20-line
// dependency-free framer is "file framing", not "custom algorithm",
// and matches the user preference for the most compact single-file
// representation.

export const DRYJ_MAGIC = new Uint8Array([0x44, 0x52, 0x59, 0x4a]); // "DRYJ"
export const CURRENT_CONTAINER_VERSION = 1;

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
  const totalLen = 4 + 2 + 4 + metaBytes.length + update.length;
  const out = new Uint8Array(totalLen);
  out.set(DRYJ_MAGIC, 0);
  // version (uint16 BE)
  out[4] = (CURRENT_CONTAINER_VERSION >>> 8) & 0xff;
  out[5] = CURRENT_CONTAINER_VERSION & 0xff;
  // metaLen (uint32 BE)
  const metaLen = metaBytes.length;
  out[6] = (metaLen >>> 24) & 0xff;
  out[7] = (metaLen >>> 16) & 0xff;
  out[8] = (metaLen >>> 8) & 0xff;
  out[9] = metaLen & 0xff;
  out.set(metaBytes, 10);
  out.set(update, 10 + metaBytes.length);
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
  if (containerVersion !== CURRENT_CONTAINER_VERSION) {
    throw new Error(
      `.dryj: unsupported container version ${containerVersion} (this build understands ${CURRENT_CONTAINER_VERSION}); upgrade DayRail to read it`,
    );
  }
  const metaLen =
    (bytes[6]! << 24) | (bytes[7]! << 16) | (bytes[8]! << 8) | bytes[9]!;
  if (metaLen < 0 || metaLen > bytes.length - 10) {
    throw new Error(`.dryj: meta length ${metaLen} out of range`);
  }
  const metaBytes = bytes.subarray(10, 10 + metaLen);
  let meta: DryjMeta;
  try {
    meta = JSON.parse(new TextDecoder().decode(metaBytes)) as DryjMeta;
  } catch (err) {
    throw new Error(`.dryj: meta JSON parse failed: ${(err as Error).message}`);
  }
  const update = bytes.subarray(10 + metaLen);
  return { containerVersion, meta, update };
}
