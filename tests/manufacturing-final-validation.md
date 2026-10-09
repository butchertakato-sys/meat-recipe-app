# Manufacturing final validation (2026-10-09)

## Recovery investigation

Base: `d17302671436df50ec682c1091b9601471266d79`.
The attached worktree was clean, with no stash, alternate worktree, surviving
patch/backup, unreachable Git object or remote branch containing the reported
uncommitted corrections. All remote branches were fetched and inspected. The
available session tools do not expose the previous Codex task's uncommitted
filesystem. The confirmed specification was therefore reimplemented on
`fix/manufacturing-final-validation`, with checkpoint commits and remote backup.

## Verification

Run `npm test` (Chromium at `/usr/bin/chromium`, or `CHROMIUM_PATH`).
All browser contexts are disposable `app.test` origins. Every request is routed
to an in-memory `supabase.test` mock; unexpected destinations fail assertions.
The managed shell sandbox blocked Chromium's crashpad `setsockopt`. Running the
same isolated tests with the required execution permission resolves the startup
failure without changing application/browser test assertions.

| Requirement | Browser evidence in record-observation-integration.cjs |
| --- | --- |
| 1. Tap shows loading only | Actual history-button click; immediate app text equals loading message and contains no row buttons |
| 2. No intermediate list | Delayed cloud GET; render counter stays at zero |
| 3. One final list | Counter becomes one after the gate releases and remains one |
| 4. Stable same-day order | Date descending, LOT/ID ascending, including two different IDs with the same LOT; repeated load and updatedAt change |
| 5. Offline list | No cloud requests; one local list |
| 6. Communication failure list | Failed network and hung GET abort; one local list |
| 7. No stale navigation render | Leave for home while GET is delayed; home HTML and zero render count preserved |
| 8. Deleted absent from list | Local/IndexedDB/cloud tombstones and old archive |
| 9. Deleted absent from analysis | Analysis row IDs/count exclude tombstones |
| 10. No duplicate new save | Two synchronous clicks plus an input event during save; one send; subsequent save also blocked |
| 11. Failed draft keeps ID | Persistence failure after reservation, reload and draft restoration, exact original ID/LOT reused |
| 12. Multiple same-day events | Separate new forms produce different IDs/LOTs; both retained |
| 13. Delete retry retains ID | Failed delete retried as deleted with identical ID/LOT and no reservation |
| 14. Archive cannot revive delete | Complementary archive, unrelated local save, pending active against remote deleted; no active republish |
| 15. 65g new / 70g historical | Real 7000+3000 recipe fixture; 10530/12300×100; old 70g preserved through display and edit |

Deletion messages are separately tested: cloud success, local success with cloud
pending, and failed local persistence. A failed local persistence fixture verifies
unchanged business stores and no cloud send. Different active/deleted IDs sharing
a LOT are kept independently. Local stale active writes and stale active cloud
responses are rejected against a cached tombstone.

## Audit and scope

The application keeps IndexedDB deleted rows until canonical identity merging,
then filters them for display/analysis. Same-ID tombstones are retained in
localStorage writes. Migration neither links by LOT nor invents a UUID for an
unknown historical ID. Pending bundles are sent by syncPending using their
existing ID/LOT and the canonical deletion status.

The history view uses one generation token and one final render, with existing
15-second per-request AbortController deadlines. It does not race a separate
screen timer against synchronization or launch a second cache refresh. This is a
per-request deadline, not a fixed deadline for the whole multi-request sync.
The timeout browser fixture shortens only these timers in its disposable context.

New saves confirm the formal packaging master before collecting the snapshot;
new defaults/fallback use 65g. Explicit/inferred historical unit weights and saved
finished-weight/yield snapshots are retained. The recipe and yield formulas,
SQL, auth, CSV, GoodNotes, other product masters and visible form layout remain
unchanged. Same-ID LOT mismatches between the device and cloud are deferred; neither side
is automatically renamed. ID-less historical rows and tombstones are preserved
without assigning synthetic replacement IDs.

New local LOT candidates use the maximum known suffix (including tombstones),
rather than an active-record count that could reuse a suffix. Edit LOT regeneration and its unused helpers, migration LOT-equivalence
helpers/readback, diagnostic comparison output and historical test source
comparison code are removed.

Diagnostic output remains read-only for the unresolved July 28 -02 identity and
creation timeline. It retains target local/IndexedDB/cloud rows, allocations,
linked saved-recipe evidence and typed values/timestamps. It omits complete
history dumps, old processing comparison, master/reservation reads, and tokens.
Browser assertions verify GET-only transport, unchanged localStorage/IndexedDB,
no absent DB creation and no auth refresh.

No production Supabase requests, SQL, record edits, deletion or actual data
repairs were performed. Tests use synthetic UUIDs, not the protected actual July
28 / August 5 record IDs.

## Remaining limits

- July 28 -02's historical ID and creation circumstances are unconfirmed.
- Cloud GET and POST are non-atomic. A deletion/update between comparison and
  send remains possible across devices.
- Database-side concurrent update protection is not implemented. Local guards,
  UI locks and mock regression tests do not guarantee complete conflict safety
  in production.
- Historical entries with unresolved IDs remain visible separately and are not
  automatically republished. Their identity requires read-only investigation.
