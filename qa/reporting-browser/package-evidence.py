"""Package one lossless final proof within the aggregate owner-approved budget."""
import json
import os
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path("qa/reporting-browser/evidence")
output = Path("qa/reporting-browser/final-proof.zip")
cap = 25 * 1024 * 1024
prior_artifact_bytes = 10298576  # Preserved artifact 11257927301; never deleted here.
outer_zip_reserve = 65536
remaining = cap - prior_artifact_bytes
receipt = {
    "aggregate_cap_bytes": cap,
    "preserved_artifact_id": 11257927301,
    "preserved_artifact_bytes": prior_artifact_bytes,
    "remaining_bytes": remaining,
    "outer_zip_reserve_bytes": outer_zip_reserve,
    "retention_days": 1,
    "approved_incremental_storage_usd": 0.01,
    "authorized_run_number": 7,
    "authorized_run_attempt": 1,
}
root.mkdir(parents=True, exist_ok=True)
(root / "storage-budget.json").write_text(json.dumps(receipt, indent=2) + "\n")
files = sorted(path for path in root.rglob("*") if path.is_file())
if any(path.is_symlink() for path in files):
    raise RuntimeError("Do not package symlinks")
with ZipFile(output, "w", ZIP_DEFLATED, compresslevel=9) as archive:
    for path in files:
        archive.write(path, path.relative_to(root))
size = output.stat().st_size
print(json.dumps({**receipt, "final_proof_zip_bytes": size,
                  "aggregate_upper_bound_bytes": prior_artifact_bytes + size + outer_zip_reserve}))
if size + outer_zip_reserve > remaining:
    raise RuntimeError("Aggregate 25 MiB allowance exceeded; stop without uploading or reducing evidence")
with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf8") as stream:
    stream.write("ready=true\n")
