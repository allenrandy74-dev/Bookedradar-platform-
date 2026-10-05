# JSON store safety boundary

JsonStateStore, CallHistoryStore and RecoveryStore use `json-file-transaction.js` for public operations. Each operation obtains an exclusive atomic-mkdir lock, resolves the parent directory to its canonical local path, reloads the current file under that lock, operates on an isolated view, and commits once if changed. The commit writes a uniquely named mode-0600 temporary file, fsyncs it, renames it over the destination, then fsyncs the parent directory. Data-file symlinks and non-regular files are rejected. Directory aliases resolve to one lock identity.

All cooperating processes must run this protocol on a local filesystem supporting atomic mkdir/rename and file/directory fsync. Network filesystems, old writers that ignore the lock, changing filesystem paths concurrently, malicious filesystem manipulation and hardware durability guarantees beyond successful fsync are unsupported. This is not distributed consensus or a general database replacement. Reads also take the lock; heavy contention may return a lock error after five seconds rather than acknowledge unsafe work. Multi-file transactions are not provided.

A lock remaining after its holder dies is never guessed stale from age or PID. Operations fail closed. An operator must stop/quiesce all writers, establish the crashed owner cannot resume, inspect the persisted file and possible uncertain external actions, and only then remove the orphan lock. Never automatically delete it on a timer. A failure after rename but before successful directory fsync can have an uncertain commit; callers must not treat an exception as proof no write occurred.

The stores return detached snapshots. Direct snapshot edits are not a mutation API. Legacy explicit `load` / local edit / `persist` uses compare-and-swap against its baseline and rejects a stale snapshot. Use public mutation methods or `store.transaction(async view => ...)` for durable changes. Never perform provider I/O inside a file transaction. `useJsonMemoryView` is solely for an already-owned database transaction or an explicit synthetic in-memory test fixture; applying it to a live JSON store bypasses the file protocol and is unsupported.

Recovery engine ordinary ingestion commits receipts, contacts, opportunities and actions together. An exception before commit leaves the event retryable. STOP suppression has a separate engine-controlled safety-first stage so a later cancellation failure does not erase suppression. Event keys encode tenant identity and raw source identity, while older receipts infer missing tenant from an unambiguous owned opportunity, sourceEventId-linked opportunity or persisted contact. Conflicting owners fail closed; an unresolved legacy receipt cannot be replayed under a newly supplied tenant. Existing call, contact, opportunity, action and attribution ownership is immutable. Dispatch claims are checked before durable `dispatching` intent; dispatching actions are never automatically reclaimed for a new send.

Transfer/SMS attempt claims retain tenant, call, target, kind and fingerprint identity plus a random claim token. Same-key replays cannot create another claim, and finishing requires that token and all five identity fields. Terminal records are immutable; attempts have no automatic TTL pruning. Storage growth and manual reconciliation are deliberate costs of avoiding automatic duplicate external actions.

## Reproducible synthetic evidence

From the repository root:

```
node --import ./test/helpers/deny-network.mjs --test --test-isolation=none test/json-file-safety.test.js
bash scripts/harness-json-multiprocess.sh
```

The outer-shell harness starts four independent guarded Node processes with minimal environments and synchronized start, verifies all 180 acknowledged records and single shared receipt winners, then SIGKILLs a synthetic transaction owner before commit. It verifies neither receipt nor opportunity was committed and that the orphan lock refuses automatic takeover. Cleanup is restricted to the fresh harness-owned temporary directory. No provider is contacted; Node subprocess APIs remain blocked inside each process.

The regression tests assert explicit ownership rejection and atomic rollback/retry semantics. A crash before commit must not leave a surviving duplicate receipt.
