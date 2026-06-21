import Database from 'better-sqlite3';
import { deriveBaseName } from '../../../../src/services/overmind/parent-session-resolver.ts';

const dbPath = 'data/agjassist.db';
console.log('Using DB:', dbPath);
console.log('Using deriveBaseName imported via tsx from src/services/overmind/parent-session-resolver.ts (exact logic, no replication)');

const db = new Database(dbPath);

const select = db.prepare('SELECT id, slug, parent_session FROM overmind_projects ORDER BY slug');
let rows = select.all();

console.log('\n=== BEFORE ===');
console.table(rows.map(r => ({ slug: r.slug, parent_session: r.parent_session })));

const update = db.prepare("UPDATE overmind_projects SET parent_session = ?, updated_at = datetime('now') WHERE id = ?");

let updated = 0;
for (const row of rows) {
  const base = deriveBaseName(row.parent_session || '');
  if (base && base !== row.parent_session) {
    update.run(base, row.id);
    updated++;
    console.log(`  UPDATE: ${row.slug}  ${row.parent_session} -> ${base}`);
  }
}

rows = select.all();
console.log('\n=== AFTER ===');
console.table(rows.map(r => ({ slug: r.slug, parent_session: r.parent_session })));

console.log(`\nUpdates: ${updated}`);
console.log('Script complete. Idempotent: re-running produces 0 updates and identical AFTER.');

db.close();
