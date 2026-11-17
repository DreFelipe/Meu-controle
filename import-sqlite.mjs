import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { getDatabase } from '@netlify/database';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function arg(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const connectionString = arg(
  '--connection-string',
  process.env.NETLIFY_DB_URL || process.env.DATABASE_URL || ''
);
const dbPath = path.resolve(projectRoot, arg('--db', 'data/app.db'));

if (!connectionString) {
  console.error(
    'Informe a connection string com --connection-string "postgres://..." ou defina NETLIFY_DB_URL.'
  );
  process.exit(1);
}

const sqlite = new DatabaseSync(dbPath);

function selectAll(table) {
  try {
    return sqlite.prepare(`SELECT * FROM ${table}`).all();
  } catch (_) {
    return [];
  }
}

const users = selectAll('users');
const accounts = selectAll('accounts');
const categories = selectAll('categories');
const transactions = selectAll('transactions');
sqlite.close();

const db = getDatabase({ connectionString });
const client = await db.pool.connect();
const inserted = { users: 0, accounts: 0, categories: 0, transactions: 0 };

try {
  await client.query('BEGIN');

  for (const row of users) {
    const result = await client.query(
      `INSERT INTO users (id, email, name, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [row.id, row.email, row.name, row.password_hash, row.created_at]
    );
    inserted.users += result.rowCount;
  }

  for (const row of accounts) {
    const result = await client.query(
      `INSERT INTO accounts (id, user_id, name, initial_balance, is_wallet, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
      [row.id, row.user_id, row.name, row.initial_balance, !!row.is_wallet, row.created_at]
    );
    inserted.accounts += result.rowCount;
  }

  for (const row of categories) {
    const result = await client.query(
      `INSERT INTO categories (id, user_id, name, type, color, icon, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [row.id, row.user_id, row.name, row.type, row.color, row.icon, row.created_at]
    );
    inserted.categories += result.rowCount;
  }

  for (const row of transactions) {
    const result = await client.query(
      `INSERT INTO transactions
       (id, user_id, account_id, category_id, type, description, amount, date, due_date, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT DO NOTHING`,
      [
        row.id,
        row.user_id,
        row.account_id,
        row.category_id,
        row.type,
        row.description,
        row.amount,
        row.date,
        row.due_date,
        row.status,
        row.created_at,
        row.updated_at
      ]
    );
    inserted.transactions += result.rowCount;
  }

  await client.query('COMMIT');
} catch (err) {
  try { await client.query('ROLLBACK'); } catch (_) {}
  throw err;
} finally {
  client.release();
  await db.pool.end();
}

console.log(`SQLite: ${dbPath}`);
console.log(
  `Importados: ${inserted.users} usuários, ${inserted.accounts} contas, ` +
    `${inserted.categories} categorias, ${inserted.transactions} lançamentos.`
);
