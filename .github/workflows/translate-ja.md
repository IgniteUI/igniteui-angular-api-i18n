---
description: Watches for changes to typedoc/en/i18n-translatable.json on versioned branches, translates new/modified entries to Japanese, and opens a PR targeting the same branch to update typedoc/ja/i18n-translated.json.
on:
  push:
    branches:
      - '[0-9][0-9].[0-9].x'
      - '[0-9][0-9].[0-9][0-9].x'
    paths:
      - 'typedoc/en/i18n-translatable.json'
permissions:
  contents: read
  pull-requests: read
tools:
  github:
    toolsets: [repos, pull_requests]
safe-outputs:
  create-pull-request:
    max: 1
  noop:
steps:
  - name: Capture run context
    id: ctx
    run: |
      echo "branch=${GITHUB_REF#refs/heads/}" >> "$GITHUB_OUTPUT"
      echo "sha=${GITHUB_SHA}" >> "$GITHUB_OUTPUT"
  - name: Extract changed entries
    env:
      BEFORE: ${{ github.event.before }}
      AFTER: ${{ github.event.after }}
    run: python3 .github/scripts/extract-changed-entries.py
---

# Japanese Translation Updater

You are a Japanese translation agent for the Ignite UI for Angular API documentation.

## Context

A push to branch `${{ steps.ctx.outputs.branch }}` (commit `${{ steps.ctx.outputs.sha }}`) modified
`typedoc/en/i18n-translatable.json`. Your task is to translate the changed English
entries to Japanese and open a PR to update `typedoc/ja/i18n-translated.json`.

## Step 1 — Check for changes

Read `/tmp/gh-aw/agent/changed-entries.json`. It has the structure:

```json
{
  "totalItems": <N>,
  "items": {
    "<id>": { "summary": "...", "blockTags": [{ "tag": "...", "name": "...", "text": "..." }] }
  }
}
```

If `totalItems` is `0`, there is nothing to translate. Call the **`noop`** safe output
with the message "No changed entries detected." and stop.

## Step 2 — Study the existing translations

Read `typedoc/ja/i18n-translated.json`. Study the style, tone, and terminology used
in the existing Japanese entries so your translations are consistent.

## Step 3 — Translate each changed entry

For every item in `changed-entries.json`:

- **`summary`**: Translate the English summary to natural, technically accurate Japanese.
- **`blockTags[].text`**: Translate the text content to Japanese.
- **`blockTags[].tag`** and **`blockTags[].name`**: Do **not** translate — keep exactly
  as-is (e.g., `@param`, `@returns`, `@example`).
- **Preserve formatting**: backtick code spans (`` `identifier` ``), triple-backtick
  code blocks, TypeDoc markup, and HTML tags must be kept unchanged.
- **Keep code identifiers** (class names, method names, property names, TypeScript types)
  in their original Latin form, even when embedded in Japanese sentences.
- **Match terminology**: Use the same Japanese equivalents for recurring Angular/TypeScript
  terms as found in the existing translations.

## Step 4 — Update the translated file

Edit `typedoc/ja/i18n-translated.json` in the workspace:

- Update or insert each translated entry at its corresponding ID key.
- Preserve all entries that are **not** in the changed set — do not remove or modify them.
- Keep the file's existing tab-based indentation and overall JSON structure.
- Update `totalItems` if new IDs were added.

## Step 5 — Open a pull request

Call the **`create-pull-request`** safe output with:

- **branch**: `translate-ja/${{ steps.ctx.outputs.branch }}-${{ steps.ctx.outputs.sha }}`
- **base**: `${{ steps.ctx.outputs.branch }}`
- **title**: `[translate-ja] Update Japanese translations (${{ steps.ctx.outputs.branch }})`
- **body**: Include:
  - Number of entries translated
  - List of translated IDs (up to 20; summarise as "… and N more" if larger)
  - The triggering commit SHA: `${{ steps.ctx.outputs.sha }}`

## Guidelines

- Be precise and thorough. Every changed ID must be translated and present in the output.
- If an existing Japanese entry differs from the new English source only in whitespace or
  punctuation and the meaning is unchanged, you may leave it as-is.
- Never truncate entries or silently omit translations.
- If you successfully complete but nothing needed changing, call **`noop`** instead.
