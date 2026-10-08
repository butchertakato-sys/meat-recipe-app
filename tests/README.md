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
ambiguous saved recipes, explicit zero counts/loss, sync-error clearance, and
protected application functions against SHA-256 snapshots of `e75009e`.

Recovery policy:

- Group by LOT or linked cloud identity, merge individual present fields.
- A later complete synced snapshot preserves intentional edits, including zeros.
- Otherwise use archived/local facts before sparse failed IndexedDB defaults;
  missing preparation data can be filled only from a uniquely matching saved
  recipe. Allocations supply explicit quantities; normal products never acquire
  synthetic herb fields.
- Counts of zero remain valid. Infer only absent ordinary counts when completed
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
