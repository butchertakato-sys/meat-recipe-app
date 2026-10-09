# Final incident cleanup audit

Baseline: `b070188bcd3a8366912d4ec6293941eacd0339d2`.

Reviewed `git log`, commit diffs for `b8f2f999`, `bb61201a`, `8f125e2b`,
`332ca834`, `b070188b`, and line provenance/call sites in the affected sources.

## A — Required for production, retained

- `history-recovery`: bundle/LEGACY_META decoding, field-level canonical merge,
  healthy-versus-corrupt zero discrimination, unique saved-recipe restoration,
  general integer-tolerance inference and history grouping. These protect old
  formats and current records; no per-LOT exceptions remain.
- Adapter master resolution, quantity allocations and LEGACY_META: necessary
  for ordinary writes, old records and cross-device roundtrips.
- Application recovery sources, canonical display and pending bundle rebuild:
  these prevent sparse stale cache rows from suppressing source data and resolve
  current UUIDs before retries. Identity/product conflicts remain protected.
- `manufacturingRecoveryScore`: still called when choosing saved-recipe snapshots.
- `healthyRecord` test seam: used to verify legitimate zero data protection.
  `corruptedZero` remains internal; its unused export was removed.
- Identity-based herb classifier: unchanged.
- Unified startup/refresh/retry orchestration and absent-module fallback: retained.
- Operational warnings/errors about failed master load, unavailable RPC or LOT
  reservation: actionable failure reporting, not temporary debug output.

## B — Temporary, removed completely

- Diagnostic module, script, view/state, button/copy UI, snapshot/recovery functions,
  listeners and view-specific refresh guards.
- Dedicated diagnostic upsert and unused idle-wait API, their exports,
  diagnostic-only `putBundle` preservation option and targeted cloud query option.
- Targeted three-LOT inference guard.
- Diagnostic-only unit suite (15 tests), browser fixtures/copy/delete monitoring,
  diagnostic documentation. Ordinary 25/31 recovery fixtures remain necessary
  and were not removed.

## C — Obsolete or duplicate, removed

- Uncalled `cloudLegacyMetaPayload` and `recoveryDataScore` in cross-device sync:
  field-level `shouldRepublishRecovery` replaced their old score comparison.
- Migration save's scheduled cache pull: the integration already refreshes its
  cache. A browser baseline confirmed two pull calls; now there is one.
  Successful uploads in partial/conflict/error integration still receive the
  final cache refresh; failed items are not independently retried in that branch.

## Final call-path audit

- Startup: IndexedDB initialization, masters, integration, one cache refresh.
- Record top: pending count and existing status only; no cloud requests.
- History: immediate local rendering; one integration refresh and IndexedDB read.
- Explicit refresh: integration result reused; fallback only if no cache result.
- Retry: integration once, then pending count/status/message.
- New save: original offline-first save, one background cache pull.
- Migration save: original save/UUID/LOT behavior, final orchestrator pull only.
- Online event: pending rebuild/send then one cache pull; unchanged delivery path.
- Pending refresh preparation reads cloud for identity/conflict reconciliation;
  the subsequent history pull serves cache retrieval, not duplicate migration.
- Existing in-flight promise guards remain; no new standalone startup sync.

Source searches found no temporary diagnostic references, idle API, per-target
LOT strings, unused diagnostic options, or console log/debug output in production.
Named function references and changed exports were inspected; retained normal
compatibility/validation branches have distinct responsibilities. Protected
calculation, UI, LOT, CSV, GoodNotes and authentication snapshots still pass.

## Verification

39 retained ordinary unit tests plus 2 cleanup assertions: 41/41 PASS.
Complete browser integration PASS, including actual 37/11/0-161 quantities,
new form saves, IndexedDB, mock cloud, second device, offline delivery, normal
history/list/detail/edit, genuine herb 0/0, identity conflicts and legacy data
preservation. Production data/schema/storage were not modified by this work.

| Operation | record GET before/after | record POST | allocation POST | RPC before/after |
|---|---:|---:|---:|---:|
| Startup | 2/2 | 0/0 | 0/0 | 0/0 |
| Record top | 0/0 | 0/0 | 0/0 | 0/0 |
| Refresh | 2/2 | 0/0 | 0/0 | 0/0 |
| Retry | 2/2 | 0/0 | 0/0 | 0/0 |
| New save | 1/1 | 0/0 | 0/0 | 1/1 |
| Offline → online | 2/2 | 0/0 | 0/0 | 1/1 |
| Single migration upload | 3/3 | 0/0 | 0/0 | 1/1 |

Migration cache-pull invocations: 2 → 1 (the earlier promise guard coalesced
concurrent pulls, so the measured GET count already stayed at three).

| Source bytes | Before | After |
|---|---:|---:|
| index.html | 241362 | 232422 |
| supabase/*.js total | 95990 | 80558 |
| Production JS (inline scripts + supabase/*.js) | 324629 | 300315 |

Classification A: incident-related temporary, unnecessary and duplicate code
cleanup is complete. No additional cleanup work remains for this incident.
