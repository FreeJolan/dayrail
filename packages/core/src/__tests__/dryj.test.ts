// Tests for the .dryj container codec (packages/db/src/dryj.ts).
//
// The codec ships in @dayrail/db but is exported via the `./dryj`
// subpath — testing it from @dayrail/core's vitest harness rather
// than spinning up a separate vitest config in @dayrail/db.

import { describe, expect, it } from 'vitest';
import {
  CURRENT_CONTAINER_VERSION,
  DRYJ_MAGIC,
  crc32,
  decodeDryj,
  encodeDryj,
  type DryjMeta,
} from '@dayrail/db/dryj';

const sampleMeta: DryjMeta = {
  snapshotId: '11111111-2222-3333-4444-555555555555',
  parentSnapshotId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  deviceId: 'device-abc',
  deviceLabel: 'Test Mac',
  createdAt: '2026-04-30T12:00:00.000Z',
  schemaVersion: 2,
};

const sampleUpdate = new Uint8Array([0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]);

describe('dryj codec', () => {
  it('round-trips meta + update bytes', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    const decoded = decodeDryj(bytes);
    expect(decoded.containerVersion).toBe(CURRENT_CONTAINER_VERSION);
    expect(decoded.meta).toEqual(sampleMeta);
    // update is a subarray view; compare contents not identity
    expect(Array.from(decoded.update)).toEqual(Array.from(sampleUpdate));
  });

  it('writes the DRYJ magic at the start', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    for (let i = 0; i < 4; i++) {
      expect(bytes[i]).toBe(DRYJ_MAGIC[i]);
    }
  });

  it('rejects bad magic', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    bytes[0] = 0x00;
    expect(() => decodeDryj(bytes)).toThrow(/bad magic/);
  });

  it('rejects unknown container version', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    // Bump version to 99 (unknown) — uint16 BE at offset 4-5.
    bytes[4] = 0;
    bytes[5] = 99;
    expect(() => decodeDryj(bytes)).toThrow(/container version 99/);
  });

  it('rejects too-short input', () => {
    const tiny = new Uint8Array([0x44, 0x52, 0x59]); // "DRY" — 3 bytes
    expect(() => decodeDryj(tiny)).toThrow(/too short/);
  });

  it('rejects metaLen out of range', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    // metaLen at offset 6-9 (uint32 BE). Bump to a huge value.
    bytes[6] = 0xff;
    bytes[7] = 0xff;
    bytes[8] = 0xff;
    bytes[9] = 0xff;
    expect(() => decodeDryj(bytes)).toThrow(/meta length/);
  });

  it('handles empty update bytes', () => {
    const empty = new Uint8Array(0);
    const bytes = encodeDryj(sampleMeta, empty);
    const decoded = decodeDryj(bytes);
    expect(decoded.update.length).toBe(0);
    expect(decoded.meta).toEqual(sampleMeta);
  });

  it('handles meta without parentSnapshotId', () => {
    const noParent: DryjMeta = { ...sampleMeta };
    delete noParent.parentSnapshotId;
    const bytes = encodeDryj(noParent, sampleUpdate);
    const decoded = decodeDryj(bytes);
    expect(decoded.meta).toEqual(noParent);
    expect(decoded.meta.parentSnapshotId).toBeUndefined();
  });

  it('survives a 100KB update payload', () => {
    const big = new Uint8Array(100_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 37) & 0xff;
    const bytes = encodeDryj(sampleMeta, big);
    const decoded = decodeDryj(bytes);
    expect(decoded.update.length).toBe(big.length);
    // Spot-check at three positions
    expect(decoded.update[0]).toBe(big[0]);
    expect(decoded.update[50_000]).toBe(big[50_000]);
    expect(decoded.update[99_999]).toBe(big[99_999]);
  });

  it('rejects malformed meta JSON', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    // Corrupt the meta JSON region (offset 10 onward, length is in
    // bytes 6-9). Easiest: overwrite a byte inside the JSON span
    // with something that breaks parse.
    bytes[10] = 0x00; // null byte — not a valid JSON start char
    expect(() => decodeDryj(bytes)).toThrow(/meta JSON parse failed/);
  });
});

// ---- v2 container framing (update length + CRC-32) ----
//
// Audit #47: the v1 container had no length / checksum over the
// update segment, so a file truncated inside the update decoded
// "successfully" and the damage only surfaced (or half-applied)
// inside Y.applyUpdate — after which the mangled doc was persisted
// back as the new truth. v2 must catch truncation and bit-rot at the
// container layer, before any byte reaches Yjs.
describe('dryj v2 framing', () => {
  /** Hand-rolled v1 container (legacy layout: no length/checksum —
   *  update is "whatever bytes remain"). */
  function encodeV1(meta: DryjMeta, update: Uint8Array): Uint8Array {
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta));
    const out = new Uint8Array(10 + metaBytes.length + update.length);
    out.set(DRYJ_MAGIC, 0);
    out[4] = 0;
    out[5] = 1; // container version 1
    const metaLen = metaBytes.length;
    out[6] = (metaLen >>> 24) & 0xff;
    out[7] = (metaLen >>> 16) & 0xff;
    out[8] = (metaLen >>> 8) & 0xff;
    out[9] = metaLen & 0xff;
    out.set(metaBytes, 10);
    out.set(update, 10 + metaBytes.length);
    return out;
  }

  it('writes container version 2', () => {
    expect(CURRENT_CONTAINER_VERSION).toBe(2);
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    expect((bytes[4]! << 8) | bytes[5]!).toBe(2);
  });

  it('still decodes a legacy v1 container', () => {
    const v1 = encodeV1(sampleMeta, sampleUpdate);
    const decoded = decodeDryj(v1);
    expect(decoded.containerVersion).toBe(1);
    expect(decoded.meta).toEqual(sampleMeta);
    expect(Array.from(decoded.update)).toEqual(Array.from(sampleUpdate));
  });

  it('decodes a legacy v1 container with an empty update', () => {
    const v1 = encodeV1(sampleMeta, new Uint8Array(0));
    expect(decodeDryj(v1).update.length).toBe(0);
  });

  it('detects truncation inside the update payload', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    const truncated = bytes.subarray(0, bytes.length - 3);
    expect(() => decodeDryj(truncated)).toThrow(/payload truncated/);
  });

  it('detects truncation that cuts into the payload header', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    // Keep meta intact but lose part of the [len][crc] header.
    const headerCut = bytes.subarray(0, bytes.length - sampleUpdate.length - 5);
    expect(() => decodeDryj(headerCut)).toThrow(/truncated container/);
  });

  it('detects a single flipped bit in the update payload', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0x01;
    expect(() => decodeDryj(bytes)).toThrow(/checksum mismatch/);
  });

  it('detects trailing garbage appended after the payload', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    const padded = new Uint8Array(bytes.length + 4);
    padded.set(bytes, 0);
    expect(() => decodeDryj(padded)).toThrow(/length mismatch/);
  });

  it('round-trips a large payload through the v2 framing', () => {
    const big = new Uint8Array(100_000);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
    const decoded = decodeDryj(encodeDryj(sampleMeta, big));
    expect(decoded.containerVersion).toBe(2);
    expect(decoded.update.length).toBe(big.length);
    expect(decoded.update[99_999]).toBe(big[99_999]);
  });

  it('crc32 matches the IEEE reference vector', () => {
    // CRC-32("123456789") = 0xCBF43926 — the classic check value.
    const bytes = new TextEncoder().encode('123456789');
    expect(crc32(bytes)).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('tells old readers to upgrade on a future container version', () => {
    const bytes = encodeDryj(sampleMeta, sampleUpdate);
    bytes[4] = 0;
    bytes[5] = 3;
    expect(() => decodeDryj(bytes)).toThrow(/upgrade DayRail/);
  });
});
