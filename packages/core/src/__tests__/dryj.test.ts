// Tests for the .dryj container codec (packages/db/src/dryj.ts).
//
// The codec ships in @dayrail/db but is exported via the `./dryj`
// subpath — testing it from @dayrail/core's vitest harness rather
// than spinning up a separate vitest config in @dayrail/db.

import { describe, expect, it } from 'vitest';
import {
  CURRENT_CONTAINER_VERSION,
  DRYJ_MAGIC,
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
