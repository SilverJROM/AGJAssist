// Stamp a content hash into the built index.html so the browser fetches fresh
// app.js / style.css whenever they change. Replaces the __ASSET_VERSION__
// placeholder with a short hash of the two assets. Without this the cache-buster
// was a hardcoded string that never changed, so mobile/Telegram WebViews served
// a stale bundle forever (see memory: agjasst-tunnel-no-websocket for the class
// of "it works locally but not on the phone" bugs this prevents).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const dir = join(process.cwd(), 'dist', 'web', 'public');
const indexPath = join(dir, 'index.html');

if (!existsSync(indexPath)) {
  console.error('[stamp-assets] dist index.html not found — did the build copy run?');
  process.exit(1);
}

const hash = createHash('sha256');
// Hash every runtime module app.js imports (not just app.js/style.css) so the
// stamped version changes whenever ANY of them change — otherwise an edit to
// e.g. terminal-chat-state.js would not bump the cache-buster.
for (const asset of ['app.js', 'style.css', 'terminal-chat-state.js']) {
  const p = join(dir, asset);
  if (existsSync(p)) hash.update(readFileSync(p));
}
const version = hash.digest('hex').slice(0, 12);

let html = readFileSync(indexPath, 'utf8');
if (!html.includes('__ASSET_VERSION__')) {
  console.warn('[stamp-assets] no __ASSET_VERSION__ placeholder found — leaving index.html unchanged');
} else {
  html = html.replaceAll('__ASSET_VERSION__', version);
  writeFileSync(indexPath, html);
  console.log(`[stamp-assets] stamped asset version ${version}`);
}
