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
protected application functions against SHA-256 snapshots of `e75009e`.

Recovery policy:

- Group by LOT or linked cloud identity, merge individual present fields.
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
- Different cloud identities on one LOT are surfaced as conflicts, never
  renumbered or overwritten. Healthy synced bundles are not retried.

Real Windows/iPad browser data and authenticated production Supabase were not
accessible for these tests. The regression demonstrates the recovery path and
data preservation; it does not claim that particular production records have
already been synchronized.

The temporary **過去データ診断** button at the bottom of manufacturing history
captures raw values for the three 2026-10-08 LOTs before recovery. It reads both
localStorage generations, raw IndexedDB records and allocations, targeted cloud
records and allocations, and linked saved recipe snapshots. Exact storage keys
and null / empty / zero / absent values are included in the copyable report.

Diagnostic quantity recovery accepts only a single explicit positive quantity
per product field. Different positives or multiple cloud identities are reported
as conflicts. Failed reads are reported as incomplete, never as confirmed absence.
An integer inverse is displayed only as a candidate; the diagnostic does not use
`inferCount`. Its dedicated IndexedDB/REST upsert path neither deletes allocations
nor invokes the normal replacement RPC. Recovery is reported as successful only
after both IndexedDB and cloud readback verification. The source snapshot in the
report remains the pre-recovery snapshot, and v1 data stays unchanged.

While the diagnostic is installed, automatic weight-based inference is disabled
for its three target LOTs even during ordinary background history refreshes. This
prevents the older recovery path from storing an inverse candidate before the
raw diagnostic can establish whether an explicit quantity exists. Explicit
historical quantities still recover normally; other LOTs keep their existing
recovery behavior.
