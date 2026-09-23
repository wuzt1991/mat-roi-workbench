"""Transport complete synthetic JSON reports through bounded public CI annotations."""
import base64, hashlib, json, sys, zlib
from pathlib import Path
root = Path(sys.argv[1])
reports = {str(p.relative_to(root)).replace('\\', '/'): json.loads(p.read_text(encoding='utf-8-sig')) for p in sorted(root.rglob('*.json')) if not p.name.startswith('package')}
data = json.dumps(reports, ensure_ascii=False, separators=(',', ':')).encode()
encoded = base64.b64encode(zlib.compress(data, 9)).decode()
chunks = [encoded[n:n+2800] for n in range(0, len(encoded), 2800)]
assert len(chunks) <= 40, 'Evidence exceeds annotation budget; retain the artifact'
for n, chunk in enumerate(chunks, 1):
    print(f'::notice::MAT_EVIDENCE {sys.argv[2]} {n}/{len(chunks)} {hashlib.sha256(data).hexdigest()} {chunk}')
