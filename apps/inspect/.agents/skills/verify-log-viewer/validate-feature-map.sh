#!/bin/bash

set -euo pipefail

skill_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
features_dir="$skill_dir/features"
index="$features_dir/README.md"
repo_root="$(git -C "$skill_dir" rev-parse --show-toplevel)"
failed=0
feature_count=0

required_headings=(
  "## Sub-features"
  "## How to get to it (user POV)"
  "## Driving it with Playwright"
  "## Code landmarks"
  "## Gotchas"
)

fail() {
  echo "FAIL  $*"
  failed=1
}

for feature_file in "$features_dir"/*.md; do
  name="$(basename "$feature_file")"
  if [[ "$name" == "README.md" ]]; then
    continue
  fi
  feature_count=$((feature_count + 1))

  for heading in "${required_headings[@]}"; do
    if ! grep -Fqx "$heading" "$feature_file"; then
      fail "$name missing heading: $heading"
    fi
  done

  if ! grep -Fq "(./$name)" "$index"; then
    fail "$name is not linked from features/README.md"
  fi
done

while IFS= read -r link; do
  target="${link#(./}"
  target="${target%)}"
  if [[ ! -f "$features_dir/$target" ]]; then
    fail "features/README.md has broken link: $target"
  fi
done < <(grep -Eo '\(\./[a-z0-9-]+\.md\)' "$index" | sort -u)

while IFS= read -r landmark; do
  path="${landmark#\`}"
  path="${path%\`}"
  if [[ "$path" == *"*"* ]]; then
    continue
  fi
  if [[ ! -e "$repo_root/$path" ]]; then
    fail "code landmark does not exist: $path"
  fi
done < <(grep -Eho "\`(apps|packages)/[^\`]+\`" "$features_dir"/*.md | sort -u)

while IFS= read -r landmark; do
  path="${landmark#\`}"
  path="${path%\`}"
  if [[ "$path" == apps/* || "$path" == packages/* || "$path" == *"*"* ]]; then
    continue
  fi
  filename="${path##*/}"
  if ! git -C "$repo_root" ls-files -- apps packages |
    awk -F/ -v filename="$filename" '$NF == filename { found = 1 } END { exit !found }'; then
    fail "bare code landmark does not exist under apps/ or packages/: $path"
  fi
done < <(
  grep -Eho "\`[^\`]+\.(ts|tsx|js|jsx|css|scss)\`" "$features_dir"/*.md | sort -u
)

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "ok    feature map: $feature_count files, headings/links/landmarks valid"
