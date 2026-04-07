#!/usr/bin/env bash
# Fix AI Elements component imports after shadcn add
# Run after any `shadcn add` from the Elements registry

set -euo pipefail

TARGET_DIR="src/frontend/components/ai-elements"
UI_DIR="src/frontend/components/ui"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: $TARGET_DIR not found"
  exit 1
fi

# Fix registry-style imports (@repo/shadcn-ui/...) in AI Elements files
find "$TARGET_DIR" -name '*.tsx' -o -name '*.ts' | while read -r file; do
  sed -i '' \
    -e 's|@repo/shadcn-ui/components/ui/|@/frontend/components/ui/|g' \
    -e 's|@repo/shadcn-ui/lib/utils|@/frontend/lib/utils|g' \
    "$file"
done

# Fix casing: shadcn uses lowercase, project uses PascalCase for these ui components.
# Apply to both ai-elements and new shadcn-created ui files.
ALL_FILES=$(find "$TARGET_DIR" "$UI_DIR" -name '*.tsx' -o -name '*.ts')

for file in $ALL_FILES; do
  sed -i '' \
    -e 's|@/frontend/components/ui/button"|@/frontend/components/ui/Button"|g' \
    -e "s|@/frontend/components/ui/button'|@/frontend/components/ui/Button'|g" \
    -e 's|@/frontend/components/ui/badge"|@/frontend/components/ui/Badge"|g' \
    -e "s|@/frontend/components/ui/badge'|@/frontend/components/ui/Badge'|g" \
    -e 's|@/frontend/components/ui/separator"|@/frontend/components/ui/Separator"|g' \
    -e "s|@/frontend/components/ui/separator'|@/frontend/components/ui/Separator'|g" \
    -e 's|@/frontend/components/ui/tooltip"|@/frontend/components/ui/Tooltip"|g' \
    -e "s|@/frontend/components/ui/tooltip'|@/frontend/components/ui/Tooltip'|g" \
    -e 's|@/frontend/components/ui/input"|@/frontend/components/ui/Input"|g' \
    -e "s|@/frontend/components/ui/input'|@/frontend/components/ui/Input'|g" \
    -e 's|@/frontend/components/ui/textarea"|@/frontend/components/ui/Textarea"|g' \
    -e "s|@/frontend/components/ui/textarea'|@/frontend/components/ui/Textarea'|g" \
    -e 's|@/frontend/components/ui/dialog"|@/frontend/components/ui/Dialog"|g' \
    -e "s|@/frontend/components/ui/dialog'|@/frontend/components/ui/Dialog'|g" \
    "$file"
done

echo "Fixed imports in $(echo "$ALL_FILES" | wc -l | tr -d ' ') files"
