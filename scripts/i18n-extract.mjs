/**
 * i18n-extract.mjs
 *
 * Walks the typedoc EN JSON and produces a flat id → translation-unit map.
 * All comment parts (text + inline code) are merged into a single string per
 * field so that translation agents receive plain prose, not a fragmented array.
 *
 * Output format (single file):
 * {
 *   "totalItems": 1234,
 *   "items": {
 *     "27444": { "summary": "Defines the possible positions…" },
 *     "27500": {
 *       "summary": "Gets or sets the `value`.",
 *       "blockTags": [
 *         { "tag": "@param", "name": "value", "text": "The value to set." },
 *         { "tag": "@returns", "text": "The resolved value." }
 *       ]
 *     }
 *   }
 * }
 *
 * Usage:
 *   node i18n-extract.mjs
 *   node i18n-extract.mjs --input=i18nRepo/typedoc/en/igniteui-angular.json
 *   node i18n-extract.mjs --output=i18n-translatable.json
 *   node i18n-extract.mjs --chunk-size=50   (items per chunk file, 0 = single file)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

const EN_PATH    = args.input       ?? resolve(__dirname, './typedoc/en/igniteui-angular.json');
const OUT_PATH   = args.output      ?? resolve(__dirname, './typedoc/en/i18n-translatable.json');
const CHUNK_SIZE = parseInt(args['chunk-size'] ?? '0', 10); // 0 = no splitting
const CHUNKS_DIR = args['chunks-dir'] ?? resolve(__dirname, 'i18n-chunks');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Merges all parts of a typedoc content array into a single string.
 * Code parts (inline `backtick` snippets) are included verbatim so the
 * translator sees them as natural markdown prose.
 */
function mergeContent(parts) {
    return (parts ?? []).map(p => p.text ?? '').join('').trim();
}

/** Returns true when a comment has anything worth translating. */
function hasTranslatableContent(comment) {
    if (!comment) return false;
    const hasSummary   = !!mergeContent(comment.summary);
    const hasBlockTags = comment.blockTags?.some(tag => !!mergeContent(tag.content));
    return hasSummary || hasBlockTags;
}

/**
 * Converts a typedoc comment into a flat translation unit:
 * { summary?: string, blockTags?: Array<{ tag, name?, text }> }
 */
function toTranslationUnit(comment) {
    const unit = {};

    const summaryText = mergeContent(comment.summary);
    if (summaryText) unit.summary = summaryText;

    if (comment.blockTags?.length) {
        const tags = comment.blockTags
            .map(tag => {
                const text = mergeContent(tag.content);
                if (!text) return null;
                const entry = { tag: tag.tag, text };
                if (tag.name) entry.name = tag.name;
                return entry;
            })
            .filter(Boolean);
        if (tags.length) unit.blockTags = tags;
    }

    return unit;
}

/**
 * Recursive generator — yields every node with translatable content.
 */
function* walkNodes(node) {
    if (hasTranslatableContent(node.comment)) {
        yield { id: node.id, unit: toTranslationUnit(node.comment) };
    }

    for (const sig of node.signatures ?? []) {
        if (hasTranslatableContent(sig.comment)) {
            yield { id: sig.id, unit: toTranslationUnit(sig.comment) };
        }
        for (const param of sig.parameters ?? []) {
            if (hasTranslatableContent(param.comment)) {
                yield { id: param.id, unit: toTranslationUnit(param.comment) };
            }
        }
    }

    if (node.getSignature && hasTranslatableContent(node.getSignature.comment)) {
        yield { id: node.getSignature.id, unit: toTranslationUnit(node.getSignature.comment) };
    }

    for (const child of node.children ?? []) {
        yield* walkNodes(child);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`Reading ${EN_PATH} …`);
const root = JSON.parse(readFileSync(EN_PATH, 'utf8'));

// Flat id → unit map (preserves insertion order = tree order)
const items = {};
for (const topLevel of root.children ?? []) {
    for (const { id, unit } of walkNodes(topLevel)) {
        items[id] = unit;
    }
}

const totalItems = Object.keys(items).length;

if (CHUNK_SIZE > 0) {
    mkdirSync(CHUNKS_DIR, { recursive: true });
    const entries = Object.entries(items);
    let chunkIndex = 0;

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
        const slice = Object.fromEntries(entries.slice(i, i + CHUNK_SIZE));
        const filePath = resolve(CHUNKS_DIR, `chunk-${String(chunkIndex).padStart(4, '0')}.json`);
        writeFileSync(filePath, JSON.stringify({ items: slice }, null, '\t'), 'utf8');
        console.log(`  → chunk-${chunkIndex} (${Object.keys(slice).length} items)`);
        chunkIndex++;
    }

    console.log(`\nExtracted ${totalItems} items → ${chunkIndex} chunk files in ${CHUNKS_DIR}/`);
} else {
    writeFileSync(OUT_PATH, JSON.stringify({ totalItems, items }, null, '\t'), 'utf8');
    console.log(`\nExtracted ${totalItems} items → ${OUT_PATH}`);
}
