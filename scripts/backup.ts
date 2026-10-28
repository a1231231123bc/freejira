import { DatabaseSync, backup } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
const source = resolve(process.env.DATA_DIR || 'data', 'freejira.sqlite');
if (!existsSync(source)) throw new Error(`Database not found: ${source}`);
const destination = resolve(
  process.argv[2] || `backups/freejira-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
);
if (existsSync(destination))
  throw new Error('Refusing to overwrite an existing backup. Choose a new path.');
mkdirSync(dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
await backup(db, destination);
db.close();
console.log(`Backup saved: ${destination}`);
