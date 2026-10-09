# History recovery tests

Run `npm ci` and `npm test`. The integration suite uses Chromium at
`/usr/bin/chromium`; set `CHROMIUM_PATH` for another installation.

All browser storage belongs to disposable contexts at `http://app.test`.
Supabase requests are intercepted at `https://supabase.test` and handled by
in-memory fixtures. No production requests, production test rows, storage
clears, schema changes, or legacy-key removals are performed.

The suite covers the requested TEST 1–10 using pure canonical/adapter tests,
actual browser IndexedDB, mocked RPC and direct REST fallback, and a second
isolated browser device. It also checks duplicate LOT identities, missing and
ambiguous saved recipes, explicit zero counts/loss, sync-error clearance, already-synced zero corruption (TEST A–G), and
protected application functions against SHA-256 snapshots. Only the explicitly authorized form, 65g fallback, new-LOT candidate and edit-LOT changes update their fingerprints.

Recovery policy:

- Group only by established record identity. Different IDs on the same LOT remain separate. Same-ID tombstones always beat active copies. Unresolved legacy identities are retained for diagnosis, never assigned a replacement UUID.
- A later logically consistent synced snapshot preserves intentional edits, including zeros. Zero ordinary quantities with positive completed weight or yield are recovery candidates; herb/gibier quantities are assessed as a pair.
- Otherwise use archived/local facts before sparse failed IndexedDB defaults;
  missing preparation data can be filled only from a uniquely matching saved
  recipe. Allocations supply explicit quantities; normal products never acquire
  synthetic herb fields.
- Consistent counts of zero remain valid. Infer only absent or contradictory zero ordinary counts, after explicit historical counts are merged, when completed
  weight / saved unit weight differs from an integer by at most 0.01 units.
  No count is inferred from yield percent alone.
- Retry refreshes masters and gathers old/current localStorage, IndexedDB,
  available cloud columns/allocations and saved recipe snapshots. It rebuilds
  the record and allocations with the existing ID and LOT before sending.
- Different IDs remain separate; an unmatched upload colliding with an existing LOT is deferred without renumbering or overwriting. Known-ID edits/deletions keep their LOT. Healthy synced bundles are not retried.

Real Windows/iPad browser data and authenticated production Supabase were not
accessible for these tests. The regression demonstrates the recovery path and
data preservation; it does not claim that particular production records have
already been synchronized.

## Sync orchestration and cleanup regression

`npm test` records current request counts for startup, record-top navigation,
explicit history refresh, retry, new save and offline-to-online delivery.
Historical Git source comparisons have been removed.

The normal empty-cloud fixtures use two record GETs at startup, refresh and retry
(migration comparison plus one final cache pull), zero at record-top, one for a
normal saved bundle's background pull, and two for online recovery. Migration
uploads suppress background pull and use the orchestrator's one final pull;
identity readback by LOT is unnecessary because the ID is retained. The
single-upload migration fixture therefore uses two GETs and one RPC.
Partial/conflicting integration still delivers pending IndexedDB tombstones;
those bundles are not also sent by migration.

Browser checks cover offline save with failed mock network, online-event
delivery, explicit retrieval on another device, fallback without CrossDeviceSync,
actual CHORIZO 37 / ARABIKI 11 / HERB 0/161 quantities, normal entry UI,
history/detail/edit/GoodNotes, LOT conflict protection and RPC/REST fallback.
Cleanup tests enforce absence of temporary production references and LOT-specific
exceptions. See `cleanup-audit.md` for the completed source/history audit.


## Final manufacturing validation

See [manufacturing-final-validation.md](manufacturing-final-validation.md) for the
final 15-point browser coverage, data protection boundary and remaining limits.
`record-observation-integration.cjs` covers the loading-only first frame, zero
interim list renders, one final sorted list, offline/network/deadline failures,
stale navigation, deletion result A/B/C, archive tombstones and same-ID retry,
independent same-LOT IDs, unknown legacy IDs, duplicate-save guard, restored draft
identity, same-day multiple manufacturing, and 65g/70g snapshots.

The 65g fixture calls the unchanged production recipe calculation with 7000g
deer and 3000g pork: water 2000g, salt 192g, spice 60g, Heravin 36g and Pelvinal
12g, giving 12300g theoretical weight. 162 pieces at 65g finish at 10530g and
85.60975609756098% yield.
