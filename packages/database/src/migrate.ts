import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, closePool } from './index.js';

export async function runMigrations() {
  const pool = getPool();
  console.log('Running database migrations...');
  
  // Resolve schema.sql path whether running via tsx or dist
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  
  let schemaPath = path.join(currentDir, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.join(currentDir, '../src/schema.sql');
  }
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.resolve(process.cwd(), 'packages/database/src/schema.sql');
  }

  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Cannot locate schema.sql at ${schemaPath}`);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('Database migrations completed successfully.');
}

if (process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  runMigrations()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Migration failed:', err);
      await closePool();
      process.exit(1);
    });
}
