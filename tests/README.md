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

## Sync orchestration and cleanup regression

`npm test` records request counts for startup, record-top navigation, explicit
history refresh, retry, new save and offline-to-online delivery. Run
`SYNC_BASELINE=1 node tests/sync-integration.cjs` to measure the same scenarios
against `b070188bcd3a8366912d4ec6293941eacd0339d2`. Only served production sources
are read from Git; the worktree stays unchanged. `SYNC_BASELINE_REF` can select
another reference for historical comparison.

Before/after record GET counts are startup 2/2, top 0/0, refresh 2/2, retry 2/2,
new save 1/1, and online recovery 2/2. All record/allocation POST counts are zero
in these RPC-enabled fixtures. New save and online recovery each use one RPC;
other measured scenarios use none. The two ordinary integration GETs are the
existing migration comparison and one cache pull. Online recovery requires a
cloud comparison to rebuild pending bundles and then the cache pull.

Migration uploads previously invoked cache pull twice (background save plus
orchestrator). They now suppress the background save pull and refresh once at
the end. The single-upload migration benchmark stays at three GETs (initial
comparison, identity readback, cache pull), and one RPC; invocation count falls
from two to one. A partial integration still refreshes after successful uploads
without separately retrying deferred records. Normal saves retain background
refresh, offline-first writes and the original data format.

Browser checks cover offline save with failed mock network, online-event
delivery, explicit retrieval on another device, fallback without CrossDeviceSync,
actual CHORIZO 37 / ARABIKI 11 / HERB 0/161 quantities, normal entry UI,
history/detail/edit/GoodNotes, LOT conflict protection and RPC/REST fallback.
Cleanup tests enforce absence of temporary production references and LOT-specific
exceptions. See `cleanup-audit.md` for the completed source/history audit.
