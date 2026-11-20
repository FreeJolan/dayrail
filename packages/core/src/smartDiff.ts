// Smart diff for sync conflict classification (ERD §7.8 · v1.0 sync
// redesign · P2). Pure algorithm: takes three Y.Doc snapshots
// (base, local, remote), produces a Classification describing how
// the two sides have diverged. P3 wires the classifier into the
// runPush path; this module is intentionally storage-free and
// side-effect-free so it can be exhaustively unit-tested.
//
// Three classification branches per §7.8 design table:
//
//   same-direction  · localDiff ⊆ remoteDiff (deep-equal field-final
//                     values). Local has no information not already
//                     reflected in remote. Caller takes remote as the
//                     final state — no UI, no extra work.
//
//   orthogonal      · localDiff and remoteDiff touch non-overlapping
//                     fields. The merged snapshot is base + remote +
//                     local applied in order; remote wins at the
//                     entity level for ambiguous cases like "remote
//                     added id X, local also added id X" (this case
//                     actually decomposes into field-level conflicts
//                     anyway). Caller pushes the merged snapshot.
//
//   true-conflict   · One or more fields differ between localDiff and
//                     remoteDiff at the same (storeKey, entityId,
//                     fieldName). Caller surfaces a conflict UX so
//                     the user can pick a winner per field.
//
// What this module is NOT:
//   - It does NOT touch live Y.Docs. classify() reads three Y.Docs
//     via toJSON() and works on plain object snapshots from there.
//   - It does NOT produce a Y.Doc result for orthogonal — it returns
//     `merged: SnapshotJson`. P3 decides how to materialize that
//     into a Y.Doc (likely: encode + apply on the remoteDoc, then
//     re-set the local-only fields).
//   - It does NOT support array-aware merging for array *fields*
//     inside Y.Map entities. An array field touched on both sides
//     with different final values is a conflict, even if the changes
//     are non-overlapping (e.g., A appended "x" while B appended "y"
//     to the same tags array). The conservative-but-correct call.
//     Future refinement.
//
// Array-valued *entities* are the exception: the revision stores
// (railRevisions etc., ERD §10.5) hold Y.Array<revision> per entity
// id. Diffing those positionally would misread "both devices
// appended a revision" as a conflict at index N, so they are
// compared semantically instead — revisions align by `id` (falling
// back to `effectiveFrom`), duplicates resolve by latest
// `authoredAt` exactly like the read path's dedupRevisions, and
// `authoredAt` itself is treated as metadata (two same-id revisions
// with equal content but different authoring timestamps are the
// same revision). Merged output keeps these entities as arrays,
// sorted ASC by `effectiveFrom` (the invariant pickActive relies
// on).

import * as Y from 'yjs';

/** Plain-object snapshot of a Y.Doc, keyed by top-level store name
 *  then by entity id. Each entity is itself a plain object whose
 *  values may be primitives, arrays, or nested objects (the result
 *  of recursive Y.Map/Y.Array unwrap via toJSON). */
export type SnapshotJson = Record<string, Record<string, unknown>>;

/** A single divergence between two snapshots at the entity level. */
export interface EntityDiff {
  storeKey: string;
  entityId: string;
  kind: 'added' | 'removed' | 'modified';
  /** Present when `kind === 'modified'`. Map of field name → before/after.
   *  For array-valued entities (revision stores) the "field names" are
   *  revision keys (`id`, falling back to `effectiveFrom`) and the
   *  values are whole revision objects (`undefined` = absent). */
  fields?: Record<string, { base: unknown; next: unknown }>;
  /** True when the entity is array-valued (a revision list). Tells the
   *  merge/conflict passes to treat `fields` as revision-keyed and to
   *  materialize the entity back as a sorted array, not an object. */
  arrayEntity?: boolean;
  /** Present when `kind === 'added'` (the new entity) or `'removed'`
   *  (the entity as it existed at base). */
  entitySnapshot?: Record<string, unknown>;
}

export interface SnapshotDiff {
  changes: EntityDiff[];
}

/** Sentinel `field` value used when the conflict is at the entity
 *  level (delete vs modify / add-different on same id), not at any
 *  individual scalar field. */
export const ENTITY_LEVEL_CONFLICT_FIELD = '__entity__';

export interface FieldConflict {
  storeKey: string;
  entityId: string;
  /** Top-level field name, or `ENTITY_LEVEL_CONFLICT_FIELD` for
   *  entity-shape conflicts (one side deleted, other modified). */
  field: string;
  baseValue: unknown;
  localValue: unknown;
  remoteValue: unknown;
}

export type Classification =
  | { type: 'same-direction' }
  | { type: 'orthogonal'; merged: SnapshotJson }
  | { type: 'true-conflict'; conflicts: FieldConflict[] };

/** Convert a Y.Doc to a plain-object snapshot. Takes an explicit
 *  list of top-level Y.Map keys to walk — `Y.Doc.share` populates
 *  lazily (only after `getMap(key)` is called), so a freshly
 *  `applyUpdate`d doc has an empty `share` even though the data is
 *  there. The caller (classify · tests) is responsible for passing
 *  the union of top-level keys across all docs being compared.
 *
 *  Recursively unwraps nested Y.Map / Y.Array via toJSON. Keys that
 *  don't resolve to Y.Map at the top level are skipped (none
 *  expected in DayRail; ERD §10 mandates Y.Map shape at root). */
export function toSnapshotJson(doc: Y.Doc, topLevelKeys: string[]): SnapshotJson {
  const out: SnapshotJson = {};
  for (const key of topLevelKeys) {
    const top = doc.getMap(key);
    const entities: Record<string, unknown> = {};
    top.forEach((entityValue, entityId) => {
      if (
        entityValue instanceof Y.Map ||
        entityValue instanceof Y.Array
      ) {
        entities[entityId] = entityValue.toJSON();
      } else {
        entities[entityId] = entityValue;
      }
    });
    out[key] = entities;
  }
  return out;
}

/** Collect the union of top-level shared-type keys across the given
 *  docs. Used by classify() to materialize toSnapshotJson without
 *  needing the caller to enumerate every DayRail store name. Works
 *  even when some docs haven't had their top-level types accessed
 *  yet — at least one of the docs in a classify() call (the local
 *  doc, the working one) is always fully-registered, and the others
 *  inherit its key set. */
export function unionTopLevelKeys(docs: Y.Doc[]): string[] {
  const set = new Set<string>();
  for (const d of docs) {
    d.share.forEach((_v, k) => set.add(k));
  }
  return [...set];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const aKeys = Object.keys(ao);
    const bKeys = Object.keys(bo);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

function fieldDiff(
  base: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, { base: unknown; next: unknown }> | null {
  const allKeys = new Set<string>([
    ...Object.keys(base ?? {}),
    ...Object.keys(next ?? {}),
  ]);
  const fields: Record<string, { base: unknown; next: unknown }> = {};
  for (const k of allKeys) {
    const bv = base?.[k];
    const nv = next?.[k];
    if (!deepEqual(bv, nv)) {
      fields[k] = { base: bv, next: nv };
    }
  }
  return Object.keys(fields).length === 0 ? null : fields;
}

// ── revision-array entities (ERD §10.5) ───────────────────────────
//
// See module header: array-valued entities are revision lists and
// get semantic (per-revision) comparison instead of positional.

/** Alignment key for one revision: `id` when present, else
 *  `effectiveFrom`, else its index (defensive — real revisions
 *  always carry an id). */
function revisionKey(rev: unknown, index: number): string {
  if (rev && typeof rev === 'object') {
    const obj = rev as Record<string, unknown>;
    if (typeof obj.id === 'string') return obj.id;
    if (typeof obj.effectiveFrom === 'string') return `ef:${obj.effectiveFrom}`;
  }
  return `#${index}`;
}

/** Resolve a revision array into a key → revision map, mirroring the
 *  read path's dedupRevisions: duplicate keys keep the entry with
 *  the latest `authoredAt`. Insertion order of first appearance is
 *  preserved (Map semantics). */
function revisionsByKey(arr: unknown[]): Map<string, unknown> {
  const byKey = new Map<string, unknown>();
  const authored = new Map<string, number>();
  for (let i = 0; i < arr.length; i++) {
    const rev = arr[i];
    const key = revisionKey(rev, i);
    const at =
      rev && typeof rev === 'object' &&
      typeof (rev as Record<string, unknown>).authoredAt === 'number'
        ? ((rev as Record<string, unknown>).authoredAt as number)
        : 0;
    if (!byKey.has(key) || at > (authored.get(key) ?? 0)) {
      byKey.set(key, rev);
      authored.set(key, at);
    }
  }
  return byKey;
}

/** Deep-equal ignoring a revision's top-level `authoredAt` — a
 *  device-local authoring timestamp, not content. Two devices making
 *  the identical edit necessarily differ there (the read path's
 *  dedup resolves it by LWW); that must not count as divergence. */
function revisionContentEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    !a || !b ||
    typeof a !== 'object' || typeof b !== 'object' ||
    Array.isArray(a) || Array.isArray(b)
  ) {
    return deepEqual(a, b);
  }
  const sa = { ...(a as Record<string, unknown>) };
  const sb = { ...(b as Record<string, unknown>) };
  delete sa.authoredAt;
  delete sb.authoredAt;
  return deepEqual(sa, sb);
}

/** Per-revision diff of two revision arrays, keyed by revisionKey.
 *  Returns null when semantically unchanged. */
function revisionArrayDiff(
  base: unknown[],
  next: unknown[],
): Record<string, { base: unknown; next: unknown }> | null {
  const bm = revisionsByKey(base);
  const nm = revisionsByKey(next);
  const allKeys = new Set<string>([...bm.keys(), ...nm.keys()]);
  const fields: Record<string, { base: unknown; next: unknown }> = {};
  for (const k of allKeys) {
    const bv = bm.get(k);
    const nv = nm.get(k);
    if (!revisionContentEqual(bv, nv)) {
      fields[k] = { base: bv, next: nv };
    }
  }
  return Object.keys(fields).length === 0 ? null : fields;
}

/** Stable ASC sort by `effectiveFrom` — the invariant `pickActive`
 *  (revisions.ts) relies on; mirrors the read path's ordering. */
function sortRevisionsAsc(revs: unknown[]): unknown[] {
  const ef = (r: unknown): string => {
    if (r && typeof r === 'object') {
      const v = (r as Record<string, unknown>).effectiveFrom;
      if (typeof v === 'string') return v;
    }
    return '';
  };
  return [...revs].sort((a, b) => {
    const ea = ef(a);
    const eb = ef(b);
    return ea < eb ? -1 : ea > eb ? 1 : 0;
  });
}

/** Compute the diff between two doc snapshots. Pure function.
 *  Exported so P3 / tests / debugging surfaces can inspect diffs
 *  directly. `topLevelKeys` enumerates all stores to compare — pass
 *  the union from both docs (use `unionTopLevelKeys`). */
export function snapshotDiff(
  baseDoc: Y.Doc,
  nextDoc: Y.Doc,
  topLevelKeys: string[],
): SnapshotDiff {
  const base = toSnapshotJson(baseDoc, topLevelKeys);
  const next = toSnapshotJson(nextDoc, topLevelKeys);
  const changes: EntityDiff[] = [];
  const allStores = new Set<string>([
    ...Object.keys(base),
    ...Object.keys(next),
  ]);
  for (const storeKey of allStores) {
    const baseEntities = (base[storeKey] ?? {}) as Record<string, unknown>;
    const nextEntities = (next[storeKey] ?? {}) as Record<string, unknown>;
    const allIds = new Set<string>([
      ...Object.keys(baseEntities),
      ...Object.keys(nextEntities),
    ]);
    for (const entityId of allIds) {
      const baseEntity = baseEntities[entityId] as
        | Record<string, unknown>
        | undefined;
      const nextEntity = nextEntities[entityId] as
        | Record<string, unknown>
        | undefined;
      if (baseEntity === undefined && nextEntity !== undefined) {
        changes.push({
          storeKey,
          entityId,
          kind: 'added',
          entitySnapshot: nextEntity,
        });
      } else if (baseEntity !== undefined && nextEntity === undefined) {
        changes.push({
          storeKey,
          entityId,
          kind: 'removed',
          entitySnapshot: baseEntity,
        });
      } else if (baseEntity && nextEntity) {
        // Revision-array entities diff per revision (aligned by id),
        // not per index — see module header.
        const bothArrays =
          Array.isArray(baseEntity) && Array.isArray(nextEntity);
        const fields = bothArrays
          ? revisionArrayDiff(
              baseEntity as unknown[],
              nextEntity as unknown[],
            )
          : fieldDiff(baseEntity, nextEntity);
        if (fields) {
          changes.push({
            storeKey,
            entityId,
            kind: 'modified',
            fields,
            ...(bothArrays && { arrayEntity: true }),
            // Snapshot of the entity as it stands after the change —
            // useful for entity-level conflict surfaces ("local
            // deleted, remote modified → here's what remote looks
            // like now").
            entitySnapshot: nextEntity,
          });
        }
      }
    }
  }
  return { changes };
}

function entityKey(c: EntityDiff): string {
  return `${c.storeKey}/${c.entityId}`;
}

function indexByEntity(diff: SnapshotDiff): Map<string, EntityDiff> {
  const idx = new Map<string, EntityDiff>();
  for (const c of diff.changes) idx.set(entityKey(c), c);
  return idx;
}

function collectConflicts(
  localDiff: SnapshotDiff,
  remoteIdx: Map<string, EntityDiff>,
): FieldConflict[] {
  const conflicts: FieldConflict[] = [];
  for (const local of localDiff.changes) {
    const remote = remoteIdx.get(entityKey(local));
    if (!remote) continue;

    // Both touched same entity. Decide by (localKind, remoteKind).
    if (local.kind === 'removed' && remote.kind === 'removed') {
      // Both deleted — same direction, no conflict.
      continue;
    }
    if (local.kind === 'removed' || remote.kind === 'removed') {
      // One deleted, other modified/added → entity-level conflict.
      conflicts.push({
        storeKey: local.storeKey,
        entityId: local.entityId,
        field: ENTITY_LEVEL_CONFLICT_FIELD,
        baseValue: undefined,
        localValue:
          local.kind === 'removed' ? null : local.entitySnapshot,
        remoteValue:
          remote.kind === 'removed' ? null : remote.entitySnapshot,
      });
      continue;
    }
    if (local.kind === 'added' && remote.kind === 'added') {
      const lf = local.entitySnapshot ?? {};
      const rf = remote.entitySnapshot ?? {};
      if (Array.isArray(lf) && Array.isArray(rf)) {
        // Both added the same revision-array entity. A revision key
        // present on only one side is an append (the Y.Array merge
        // keeps both — no conflict); a key present on both sides
        // with different content is a genuine conflict.
        const lm = revisionsByKey(lf as unknown[]);
        const rm = revisionsByKey(rf as unknown[]);
        for (const [k, lv] of lm) {
          if (!rm.has(k)) continue;
          const rv = rm.get(k);
          if (!revisionContentEqual(lv, rv)) {
            conflicts.push({
              storeKey: local.storeKey,
              entityId: local.entityId,
              field: k,
              baseValue: undefined,
              localValue: lv,
              remoteValue: rv,
            });
          }
        }
        continue;
      }
      // Decompose into per-field comparison so the conflict UX can
      // offer field-level pickers.
      const allFields = new Set<string>([
        ...Object.keys(lf),
        ...Object.keys(rf),
      ]);
      for (const f of allFields) {
        if (!deepEqual(lf[f], rf[f])) {
          conflicts.push({
            storeKey: local.storeKey,
            entityId: local.entityId,
            field: f,
            baseValue: undefined,
            localValue: lf[f],
            remoteValue: rf[f],
          });
        }
      }
      continue;
    }
    if (local.kind === 'added' || remote.kind === 'added') {
      // Add vs modify on same id — base didn't have this entity,
      // one side added with one set of fields, the other modified
      // an entity it expected to exist. Treat as entity-level
      // conflict — these shouldn't happen in normal flow (lineage
      // tracking should prevent it) but classify defensively.
      conflicts.push({
        storeKey: local.storeKey,
        entityId: local.entityId,
        field: ENTITY_LEVEL_CONFLICT_FIELD,
        baseValue: undefined,
        localValue:
          local.kind === 'added' ? local.entitySnapshot : null,
        remoteValue:
          remote.kind === 'added' ? remote.entitySnapshot : null,
      });
      continue;
    }
    // Both modified — compare per-field overlap. For revision-array
    // entities the "fields" are revision keys and the values whole
    // revisions, so equality ignores the authoredAt metadata.
    const lf = local.fields ?? {};
    const rf = remote.fields ?? {};
    const eq =
      local.arrayEntity && remote.arrayEntity
        ? revisionContentEqual
        : deepEqual;
    for (const f of Object.keys(lf)) {
      if (!(f in rf)) continue;
      if (!eq(lf[f]!.next, rf[f]!.next)) {
        conflicts.push({
          storeKey: local.storeKey,
          entityId: local.entityId,
          field: f,
          baseValue: lf[f]!.base,
          localValue: lf[f]!.next,
          remoteValue: rf[f]!.next,
        });
      }
    }
  }
  return conflicts;
}

function isLocalSubsetOfRemote(
  localDiff: SnapshotDiff,
  remoteIdx: Map<string, EntityDiff>,
): boolean {
  // Every local change must have a matching remote change with the
  // same final value. An empty localDiff is vacuously a subset.
  for (const local of localDiff.changes) {
    const remote = remoteIdx.get(entityKey(local));
    if (!remote) return false;
    if (local.kind === 'removed' && remote.kind === 'removed') continue;
    if (local.kind !== remote.kind) return false;
    if (local.kind === 'added' && remote.kind === 'added') {
      const ls = local.entitySnapshot;
      const rs = remote.entitySnapshot;
      if (Array.isArray(ls) && Array.isArray(rs)) {
        // Revision-array entity: every local revision must exist in
        // remote with the same content (authoredAt is metadata).
        const lm = revisionsByKey(ls as unknown[]);
        const rm = revisionsByKey(rs as unknown[]);
        for (const [k, lv] of lm) {
          if (!rm.has(k)) return false;
          if (!revisionContentEqual(lv, rm.get(k))) return false;
        }
        continue;
      }
      if (!deepEqual(ls, rs)) {
        return false;
      }
      continue;
    }
    // Both modified
    const lf = local.fields ?? {};
    const rf = remote.fields ?? {};
    const eq =
      local.arrayEntity && remote.arrayEntity
        ? revisionContentEqual
        : deepEqual;
    for (const f of Object.keys(lf)) {
      if (!(f in rf)) return false;
      if (!eq(lf[f]!.next, rf[f]!.next)) return false;
    }
  }
  return true;
}

function applyDiffToSnapshot(
  target: SnapshotJson,
  diff: SnapshotDiff,
): void {
  for (const c of diff.changes) {
    if (!target[c.storeKey]) target[c.storeKey] = {};
    if (c.kind === 'added' && c.entitySnapshot) {
      target[c.storeKey]![c.entityId] = c.entitySnapshot;
    } else if (c.kind === 'removed') {
      delete target[c.storeKey]![c.entityId];
    } else if (c.kind === 'modified' && c.fields) {
      const cur = target[c.storeKey]![c.entityId];
      if (c.arrayEntity) {
        // Revision-array entity: apply per-revision changes and
        // materialize back as a sorted array — spreading an array
        // into an object would turn the revision list into
        // {"0":…} index keys and the read path would drop it.
        const byKey = revisionsByKey(Array.isArray(cur) ? cur : []);
        for (const k of Object.keys(c.fields)) {
          const next = c.fields[k]!.next;
          if (next === undefined) byKey.delete(k);
          else byKey.set(k, next);
        }
        target[c.storeKey]![c.entityId] = sortRevisionsAsc([
          ...byKey.values(),
        ]);
        continue;
      }
      const merged: Record<string, unknown> = {
        ...((cur as Record<string, unknown> | undefined) ?? {}),
      };
      for (const f of Object.keys(c.fields)) {
        const next = c.fields[f]!.next;
        // `next === undefined` means the field was removed — delete
        // it rather than writing an explicit `undefined` key, so the
        // merged snapshot round-trips (diff → apply ≡ identity).
        if (next === undefined) delete merged[f];
        else merged[f] = next;
      }
      target[c.storeKey]![c.entityId] = merged;
    }
  }
}

function applyLocalNonConflictingToSnapshot(
  target: SnapshotJson,
  localDiff: SnapshotDiff,
  remoteDiff: SnapshotDiff,
): void {
  // Index of entity-keys remote touched, and per-field set of
  // (entity-key, field-name) remote touched.
  const remoteTouchedEntity = new Set<string>();
  const remoteTouchedField = new Set<string>();
  for (const c of remoteDiff.changes) {
    remoteTouchedEntity.add(entityKey(c));
    if (c.kind === 'modified' && c.fields) {
      for (const f of Object.keys(c.fields)) {
        remoteTouchedField.add(`${entityKey(c)}/${f}`);
      }
    }
  }
  for (const c of localDiff.changes) {
    const k = entityKey(c);
    if (c.kind === 'added' || c.kind === 'removed') {
      if (remoteTouchedEntity.has(k)) continue; // remote already wrote this entity
      if (!target[c.storeKey]) target[c.storeKey] = {};
      if (c.kind === 'added' && c.entitySnapshot) {
        target[c.storeKey]![c.entityId] = c.entitySnapshot;
      } else if (c.kind === 'removed') {
        delete target[c.storeKey]![c.entityId];
      }
      continue;
    }
    // Modified: apply only fields remote didn't touch.
    const cur = target[c.storeKey]?.[c.entityId];
    if (c.arrayEntity) {
      // Revision-array entity — per-revision apply, array output
      // (sorted ASC by effectiveFrom). See applyDiffToSnapshot.
      const byKey = revisionsByKey(Array.isArray(cur) ? cur : []);
      let mutated = false;
      if (c.fields) {
        for (const f of Object.keys(c.fields)) {
          if (remoteTouchedField.has(`${k}/${f}`)) continue;
          const next = c.fields[f]!.next;
          if (next === undefined) byKey.delete(f);
          else byKey.set(f, next);
          mutated = true;
        }
      }
      if (mutated) {
        if (!target[c.storeKey]) target[c.storeKey] = {};
        target[c.storeKey]![c.entityId] = sortRevisionsAsc([
          ...byKey.values(),
        ]);
      }
      continue;
    }
    const merged: Record<string, unknown> = {
      ...((cur as Record<string, unknown> | undefined) ?? {}),
    };
    let mutated = false;
    if (c.fields) {
      for (const f of Object.keys(c.fields)) {
        if (remoteTouchedField.has(`${k}/${f}`)) continue;
        const next = c.fields[f]!.next;
        if (next === undefined) delete merged[f];
        else merged[f] = next;
        mutated = true;
      }
    }
    if (mutated) {
      if (!target[c.storeKey]) target[c.storeKey] = {};
      target[c.storeKey]![c.entityId] = merged;
    }
  }
}

/**
 * Classify how `localDoc` and `remoteDoc` have diverged from
 * `baseDoc` (the snapshot both sides last agreed on, i.e. local's
 * `lastPulledSnapshotId`-encoded state).
 *
 * Returns one of three branches — see module-level doc for the
 * semantics + how the caller should react. Pure function: no
 * mutation of input docs, no side effects.
 */
export function classify(
  baseDoc: Y.Doc,
  localDoc: Y.Doc,
  remoteDoc: Y.Doc,
): Classification {
  // Union of top-level keys across all three docs. localDoc is
  // typically fully-registered (active local Y.Doc); base + remote
  // may have empty share maps if just decoded via applyUpdate — the
  // union covers all keys we care about.
  const topLevelKeys = unionTopLevelKeys([baseDoc, localDoc, remoteDoc]);
  const localDiff = snapshotDiff(baseDoc, localDoc, topLevelKeys);
  const remoteDiff = snapshotDiff(baseDoc, remoteDoc, topLevelKeys);
  const remoteIdx = indexByEntity(remoteDiff);

  // 1) True conflicts take precedence over the same-direction check
  //    — if a field truly diverges, calling it "same direction" because
  //    of OTHER entities aligned would be wrong.
  const conflicts = collectConflicts(localDiff, remoteIdx);
  if (conflicts.length > 0) {
    return { type: 'true-conflict', conflicts };
  }

  // 2) Same-direction: every local change is reflected in remote.
  //    Empty localDiff (no local changes) is vacuously same-direction
  //    and lets the caller cleanly pull-replace.
  if (isLocalSubsetOfRemote(localDiff, remoteIdx)) {
    return { type: 'same-direction' };
  }

  // 3) Orthogonal: no field-level conflicts. Compute merged snapshot
  //    as base + remoteDiff + (localDiff for fields/entities remote
  //    didn't touch). Remote wins on whole-entity overlap (added/
  //    removed) by virtue of being applied first.
  const merged = toSnapshotJson(baseDoc, topLevelKeys);
  applyDiffToSnapshot(merged, remoteDiff);
  applyLocalNonConflictingToSnapshot(merged, localDiff, remoteDiff);
  return { type: 'orthogonal', merged };
}
