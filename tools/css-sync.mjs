#!/usr/bin/env node
// Write (or --check) the stylesheets this kit ships beside index.js, from the
// exported constants they must equal byte for byte. A consumer vendors them
// with `jfs-news-kit-vendor --format css --asset <file>` (vendor-cli 0.24.0)
// and links the copy from its own origin — the one way to style the river and
// the source menu on an engine without constructable stylesheets under a CSP
// with no 'unsafe-inline' (FAM-7). The constants stay the source of truth.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEWS_RIVER_CSS, SOURCE_MENU_CSS } from '../index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CSS_FILES = { 'river.css': NEWS_RIVER_CSS, 'source-menu.css': SOURCE_MENU_CSS };

const check = process.argv.includes('--check');
let drift = 0;
for (const [name, css] of Object.entries(CSS_FILES)) {
  const path = join(ROOT, name);
  if (check) {
    let current = null;
    try { current = readFileSync(path, 'utf8'); } catch { /* missing reads as drift */ }
    if (current !== css) { console.error(`css-sync: ${name} differs from its constant — run npm run css:sync`); drift++; }
  } else {
    writeFileSync(path, css);
    console.log(`css-sync: wrote ${name}`);
  }
}
if (drift) process.exit(1);
if (check) console.log('css-sync: river.css and source-menu.css match their constants.');
