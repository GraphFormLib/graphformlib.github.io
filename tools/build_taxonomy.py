"""Copy canonical definitions into the reviewer guide, without changing the library."""
import argparse
import hashlib
import json
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('--library',type=Path,required=True);args=p.parse_args()
source=json.loads(args.library.read_text());site=Path(__file__).resolve().parents[1]
value=dict(library_version=source['library_version'],source_sha256=hashlib.sha256(args.library.read_bytes()).hexdigest(),
           directions=source['directions'],decision_types=source['decision_types'],
           families=[{k:f[k] for k in ('objective_family_id','name','definition','direction_semantics')} for f in source['families']])
(site/'dist/review/taxonomy.js').write_text('// Verbatim definitions from the frozen objective library. Generated; see tools/build_taxonomy.py.\nexport const taxonomy = Object.freeze('+json.dumps(value,indent=2,ensure_ascii=False)+');\n')
