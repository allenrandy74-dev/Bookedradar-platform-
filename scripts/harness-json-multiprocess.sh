#!/usr/bin/env bash
# Bounded synthetic outer-shell harness. Every Node child has the strict guard;
# no subprocess API is enabled inside a test or runtime code. All fixture state
# and manual abandoned-lock cleanup stay in this harness-owned temp directory.
set -euo pipefail
cd "$(dirname "$0")/.."
dir=$(mktemp -d /tmp/br-multiprocess-XXXXXX)
pids=()
cleanup() { for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done; rm -rf -- "$dir"; }
trap cleanup EXIT
run() { env -i PATH="$PATH" HOME="$dir" node --import ./test/helpers/deny-network.mjs test/fixtures/json-multiprocess-worker.mjs "$@"; }
for i in 0 1 2 3; do run writer "$dir" "$i" >"$dir/writer-$i.log" 2>&1 & pids+=("$!"); done
for attempt in $(seq 1 500); do
  count=$(find "$dir" -name 'ready-*' | wc -l)
  if [ "$count" -eq 4 ]; then break; fi
  sleep 0.02
done
[ "$(find "$dir" -name 'ready-*' | wc -l)" -eq 4 ]
touch "$dir/go"
for pid in "${pids[@]}"; do wait "$pid"; done
pids=()
cat "$dir"/writer-*.log
run verify "$dir"
# Launch Node directly so the stored PID is exactly the lock-owning process.
env -i PATH="$PATH" HOME="$dir" node --import ./test/helpers/deny-network.mjs test/fixtures/json-multiprocess-worker.mjs crash "$dir" >"$dir/crash.log" 2>&1 &
crash_pid=$!; pids+=("$crash_pid")
for attempt in $(seq 1 500); do [ -f "$dir/crash-ready" ] && break; sleep 0.02; done
[ -f "$dir/crash-ready" ]
kill -KILL "$crash_pid"
wait "$crash_pid" 2>/dev/null || true
pids=()
run verify-crash "$dir"
