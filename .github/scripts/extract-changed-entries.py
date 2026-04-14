"""
Compares typedoc/en/i18n-translatable.json at two git SHAs and writes
only the added/modified entries to /tmp/gh-aw/agent/changed-entries.json.

Environment variables (set by the workflow step):
  BEFORE  - the "before" commit SHA from github.event.before
  AFTER   - the "after"  commit SHA from github.event.after
"""
import json
import os
import subprocess
import sys

EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
TARGET_FILE = "typedoc/en/i18n-translatable.json"
OUTPUT_FILE = "/tmp/gh-aw/agent/changed-entries.json"

before_sha = os.environ["BEFORE"]
after_sha  = os.environ["AFTER"]

if before_sha == "0" * 40:
    before_sha = EMPTY_TREE


def get_file_at(sha, path):
    try:
        result = subprocess.run(
            ["git", "show", f"{sha}:{path}"],
            capture_output=True,
            text=True,
            check=True,
        )
        return json.loads(result.stdout)
    except Exception as exc:
        print(f"Warning: could not read {path} at {sha}: {exc}", file=sys.stderr)
        return {"totalItems": 0, "items": {}}


before_data = get_file_at(before_sha, TARGET_FILE)
after_data  = get_file_at(after_sha,  TARGET_FILE)

before_items = before_data.get("items", {})
after_items  = after_data.get("items", {})

changed = {
    k: v
    for k, v in after_items.items()
    if k not in before_items or before_items[k] != v
}

print(f"Found {len(changed)} changed item(s)", file=sys.stderr)

os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
output = {"totalItems": len(changed), "items": changed}
with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(output, f, indent="\t", ensure_ascii=False)
