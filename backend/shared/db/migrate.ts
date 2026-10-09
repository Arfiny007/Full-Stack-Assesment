import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool, transaction } from './index.js';
export async function migrate() {
  const dir=new URL('./migrations/',import.meta.url);
  await transaction(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(741920)');
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()) {
      if ((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])).rowCount) continue;
      await db.query(await readFile(new URL(name,dir),'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
    }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  migrate().then(()=>console.log('Migrations applied')).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pool.end());
}
