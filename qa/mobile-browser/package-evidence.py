import hashlib
import json
import os
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent
evidence = root / 'evidence'
out = root / 'mobile-proof.zip'
cap = 25 * 1024 * 1024
outer_reserve = 65536
files = sorted(p for p in evidence.rglob('*') if p.is_file() and p.suffix in {'.json', '.png', '.tap', '.txt'})
mapping = []
seen = set()
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for file in files:
        content = file.read_bytes()
        digest = hashlib.sha256(content).hexdigest()
        name = 'content/' + digest + file.suffix
        mapping.append({'path': str(file.relative_to(evidence)), 'content': name, 'sha256': digest, 'bytes': len(content)})
        if name not in seen:
            archive.writestr(name, content)
            seen.add(name)
    archive.writestr('manifest.json', json.dumps({'files': mapping, 'deduplication': 'Identical bytes stored once; no image resizing or recompression.', 'maximumArtifactBytes': cap, 'outerContainerReserve': outer_reserve}, indent=2))
size = out.stat().st_size
ready = bool(mapping) and size + outer_reserve <= cap
print(json.dumps({'ready': ready, 'zipBytes': size, 'reserveBytes': outer_reserve, 'capBytes': cap, 'files': len(mapping), 'uniqueFiles': len(seen)}))
if 'GITHUB_OUTPUT' in os.environ:
    with open(os.environ['GITHUB_OUTPUT'], 'a') as f:
        f.write('ready=' + str(ready).lower() + '\n')
if not ready:
    raise SystemExit('Evidence does not fit the single-upload allowance; no upload is permitted.')
