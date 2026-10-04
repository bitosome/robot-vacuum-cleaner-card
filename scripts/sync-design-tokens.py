"""Vendor exact canonical tokens at an explicitly chosen Space Hub commit."""
import argparse
import base64
import json
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--ref", required=True, help="Full 40-character Space Hub commit SHA")
args = parser.parse_args()
if not re.fullmatch(r"[0-9a-f]{40}", args.ref):
    parser.error("Use a full commit SHA so updates are reproducible.")
result = json.loads(subprocess.check_output([
    "gh", "api", f"repos/bitosome/space-hub-card/contents/src/shared/design-tokens.ts?ref={args.ref}"
]))
root = Path(__file__).resolve().parents[1]
(root / "src/shared/design-tokens.ts").write_bytes(base64.b64decode(result["content"]))
print(f"Vendored Space Hub tokens at {args.ref}. Review the diff, update PROVENANCE.md, and run npm run check.")
