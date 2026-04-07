/**
 * i18n-patch.mjs
 *
 * Reads a translated id-map JSON (produced by i18n-extract.mjs, then
 * translated) and patches the translated strings back into the target-language
 * typedoc JSON.
 *
 * Each translated comment.summary is written back as a single
 * [{ "kind": "text", "text": "<translated>" }] array — no attempt is made to
 * re-split it; use a separate script for that if the downstream pipeline needs
 * the original text/code part structure.
 *
 * blockTags are reconstructed the same way: one content part per tag entry.
 *
 * Usage:
 *   node i18n-patch.mjs
 *   node i18n-patch.mjs --input=i18n-translatable.json --lang=ja
 *   node i18n-patch.mjs --input=i18n-translatable.json --target=i18nRepo/typedoc/ja/igniteui-angular.json --output=out.json
 *
 * When patching from chunk files produced with --chunk-size:
 *   node i18n-patch.mjs --chunks-dir=i18n-chunks --lang=ja
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => { const [k, ...v] = a.slice(2).split('='); return [k, v.join('=')]; })
);

const LANG        = args.lang   ?? 'ja';
const CHUNKS_DIR  = args['chunks-dir'] ?? null;
const INPUT_PATH  = args.input  ?? resolve(__dirname, `./typedoc/${LANG}/i18n-translatable.json`);
const TARGET_PATH = args.target ?? resolve(__dirname, `./typedoc/${LANG}/igniteui-angular.json`);
const OUT_PATH    = args.output ?? TARGET_PATH;

// ── Build a Map<id, translationUnit> from translated input ────────────────────

// translationUnit: { summary?: string, blockTags?: [{ tag, name?, text }] }
const unitMap = new Map();

function loadItems(itemsObj) {
    for (const [id, unit] of Object.entries(itemsObj)) {
        unitMap.set(Number(id), unit);
    }
}

function loadFile(filePath) {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    // Single-file format: { totalItems, items: { "id": unit } }
    // Chunk-file format:  { items: { "id": unit } }
    if (data.items && !Array.isArray(data.items)) {
        loadItems(data.items);
    } else {
        console.warn(`Unrecognised format in ${filePath}, skipping.`);
    }
}

if (CHUNKS_DIR) {
    console.log(`Loading chunk files from ${CHUNKS_DIR} …`);
    const files = readdirSync(CHUNKS_DIR).filter(f => f.endsWith('.json')).sort();
    for (const file of files) loadFile(resolve(CHUNKS_DIR, file));
    console.log(`  Loaded ${unitMap.size} translated entries from ${files.length} chunk files.`);
} else {
    console.log(`Loading translated entries from ${INPUT_PATH} …`);
    loadFile(INPUT_PATH);
    console.log(`  Loaded ${unitMap.size} translated entries.`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Wraps a translated string into a single-part typedoc content array. */
const textPart = text => [{ kind: 'text', text }];

/**
 * Applies a translation unit onto a typedoc comment node.
 * Overwrites the summary text and merges blockTags with the translated
 * strings (updating matching tags, preserving unmatched existing ones, and
 * appending any additional translated tags).
 */
function applyUnit(node, unit) {
    if (!node.comment) node.comment = {};

    if (unit.summary !== undefined) {
        node.comment.summary = textPart(unit.summary);
    }

    if (unit.blockTags?.length) {
        const existing = node.comment.blockTags ?? [];

        // Group incoming tags by (tag, name) so we can apply them by occurrence order.
        const incomingByKey = new Map();
        for (const incoming of unit.blockTags) {
            const key = `${incoming.tag}:${incoming.name ?? ''}`;
            let list = incomingByKey.get(key);
            if (!list) {
                list = [];
                incomingByKey.set(key, list);
            }
            list.push(incoming);
        }

        const result = [];

        // First, walk existing tags and, for each occurrence of (tag, name),
        // consume at most one matching incoming translation (preserving duplicates).
        for (const existingTag of existing) {
            const key = `${existingTag.tag}:${existingTag.name ?? ''}`;
            const list = incomingByKey.get(key);
            if (list && list.length) {
                const incoming = list.shift();
                // Preserve all properties of the existing tag except content,
                // which we replace with the translated text.
                const updated = { ...existingTag, content: textPart(incoming.text) };
                result.push(updated);
            } else {
                // No incoming translation for this specific occurrence; keep as-is.
                result.push(existingTag);
            }
        }

        // Any remaining incoming tags did not have a matching existing occurrence.
        // Append them as new tags, in a stable order.
        for (const [, list] of incomingByKey) {
            for (const incoming of list) {
                const newTag = { tag: incoming.tag, content: textPart(incoming.text) };
                if (incoming.name) newTag.name = incoming.name;
                result.push(newTag);
            }
        }

        node.comment.blockTags = result;
    }
}

// ── Recursive patch walk ──────────────────────────────────────────────────────

let patched = 0;

function patchNode(node) {
    if (unitMap.has(node.id)) { applyUnit(node, unitMap.get(node.id)); patched++; }

    for (const sig of node.signatures ?? []) {
        if (unitMap.has(sig.id)) { applyUnit(sig, unitMap.get(sig.id)); patched++; }
        for (const param of sig.parameters ?? []) {
            if (unitMap.has(param.id)) { applyUnit(param, unitMap.get(param.id)); patched++; }
        }
    }

    if (node.getSignature && unitMap.has(node.getSignature.id)) {
        applyUnit(node.getSignature, unitMap.get(node.getSignature.id));
        patched++;
    }

    for (const child of node.children ?? []) patchNode(child);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log(`Reading target JSON from ${TARGET_PATH} …`);
const target = JSON.parse(readFileSync(TARGET_PATH, 'utf8'));

for (const child of target.children ?? []) patchNode(child);

console.log(`Writing ${OUT_PATH} …`);
writeFileSync(OUT_PATH, JSON.stringify(target, null, '\t'), 'utf8');
console.log(`Done. Patched ${patched} comment(s).`);
