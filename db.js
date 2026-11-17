'use strict';

const crypto = require('node:crypto');
const { getDatabase } = require('@netlify/database');

let cachedDb = null;

function database() {
  if (!cachedDb) {
    const connectionString = process.env.DATABASE_URL || process.env.NETLIFY_DB_URL || '';
    cachedDb = getDatabase(connectionString ? { connectionString } : undefined);
  }
  return cachedDb;
}

async function query(text, params = []) {
  return database().pool.query(text, params);
}

async function close() {
  if (cachedDb) {
    const current = cachedDb;
    cachedDb = null;
    await current.pool.end();
  }
}

async function withTransaction(fn) {
  const client = await database().pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

function nowISO() {
  return new Date().toISOString();
}

function uid() {
  return Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
}

const DEFAULT_CATEGORIES = [
  { name: 'Salário', type: 'income', color: '#16a34a', icon: 'briefcase' },
  { name: 'Freelance', type: 'income', color: '#0ea5e9', icon: 'plane' },
  { name: 'Outras receitas', type: 'income', color: '#8b5cf6', icon: 'wallet' },
  { name: 'Moradia', type: 'expense', color: '#f97316', icon: 'home' },
  { name: 'Alimentação', type: 'expense', color: '#ef4444', icon: 'food' },
  { name: 'Transporte', type: 'expense', color: '#06b6d4', icon: 'car' },
  { name: 'Saúde', type: 'expense', color: '#10b981', icon: 'pulse' },
  { name: 'Lazer', type: 'expense', color: '#f43f5e', icon: 'gift' },
  { name: 'Educação', type: 'expense', color: '#6366f1', icon: 'school' },
  { name: 'Compras', type: 'expense', color: '#eab308', icon: 'cart' },
  { name: 'Assinaturas', type: 'expense', color: '#8b5cf6', icon: 'phone' },
  { name: 'Outros', type: 'expense', color: '#78716c', icon: 'tags' }
];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function plain(row) {
  return row ? Object.assign({}, row) : null;
}

function mapCategory(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    color: row.color,
    icon: row.icon
  };
}

function mapTransaction(row) {
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    amount: Number(row.amount) || 0,
    date: row.date,
    dueDate: row.due_date || row.date,
    status: row.status,
    categoryId: row.category_id || null,
    accountId: row.account_id || null
  };
}

function mapWallet(row) {
  return {
    id: row.id,
    name: row.name,
    initialBalance: Number(row.initial_balance) || 0
  };
}

async function ping() {
  const result = await query('SELECT 1 AS ok');
  return result.rows[0];
}

async function findUserByEmail(email) {
  const result = await query('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
  return plain(result.rows[0]);
}

async function findUserById(id) {
  const result = await query('SELECT * FROM users WHERE id = $1', [id]);
  return plain(result.rows[0]);
}

async function createUser(email, passwordHash, name) {
  return withTransaction(async (client) => {
    const normalized = normalizeEmail(email);
    const userId = uid();
    await client.query(
      'INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
      [userId, normalized, name || null, passwordHash, nowISO()]
    );

    await client.query(
      'INSERT INTO accounts (id, user_id, name, initial_balance, is_wallet, created_at) VALUES ($1, $2, $3, $4, TRUE, $5)',
      [uid(), userId, 'Carteira', 0, nowISO()]
    );

    for (const c of DEFAULT_CATEGORIES) {
      await client.query(
        'INSERT INTO categories (id, user_id, name, type, color, icon, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [uid(), userId, c.name, c.type, c.color, c.icon, nowISO()]
      );
    }

    const result = await client.query('SELECT * FROM users WHERE id = $1', [userId]);
    return plain(result.rows[0]);
  });
}

async function updatePassword(userId, passwordHash) {
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
}

async function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await query('DELETE FROM sessions WHERE expires_at <= now()');
  await query(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)',
    [token, userId, expires, nowISO()]
  );
  return token;
}

async function userByToken(token) {
  if (!token) return null;
  const result = await query(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  return plain(result.rows[0]);
}

async function deleteSession(token) {
  if (token) await query('DELETE FROM sessions WHERE token = $1', [token]);
}

async function ensureWallet(userId) {
  return withTransaction(async (client) => {
    let result = await client.query(
      'SELECT * FROM accounts WHERE user_id = $1 AND is_wallet = TRUE LIMIT 1 FOR UPDATE',
      [userId]
    );
    let wallet = result.rows[0];

    if (!wallet) {
      const id = uid();
      await client.query(
        'INSERT INTO accounts (id, user_id, name, initial_balance, is_wallet, created_at) VALUES ($1, $2, $3, 0, TRUE, $4)',
        [id, userId, 'Carteira', nowISO()]
      );
      result = await client.query('SELECT * FROM accounts WHERE id = $1', [id]);
      wallet = result.rows[0];
    }

    const extras = await client.query(
      'SELECT * FROM accounts WHERE user_id = $1 AND is_wallet = FALSE',
      [userId]
    );

    if (extras.rows.length) {
      let extraBalance = 0;
      for (const acc of extras.rows) {
        extraBalance += Number(acc.initial_balance) || 0;
        await client.query('UPDATE transactions SET account_id = $1 WHERE account_id = $2', [
          wallet.id,
          acc.id
        ]);
        await client.query('DELETE FROM accounts WHERE id = $1', [acc.id]);
      }
      await client.query(
        'UPDATE accounts SET initial_balance = initial_balance + $1 WHERE id = $2',
        [extraBalance, wallet.id]
      );
      wallet.initial_balance = (Number(wallet.initial_balance) || 0) + extraBalance;
    }

    return wallet;
  });
}

async function getWallet(userId) {
  return mapWallet(await ensureWallet(userId));
}

async function updateWallet(userId, fields) {
  const wallet = await ensureWallet(userId);
  const name =
    typeof fields.name === 'string' && fields.name.trim()
      ? fields.name.trim().slice(0, 60)
      : wallet.name;
  let initial = Number(fields.initialBalance);
  if (!Number.isFinite(initial)) initial = Number(wallet.initial_balance) || 0;
  await query('UPDATE accounts SET name = $1, initial_balance = $2 WHERE id = $3', [
    name,
    initial,
    wallet.id
  ]);
  return getWallet(userId);
}

async function listCategories(userId) {
  const result = await query(
    'SELECT * FROM categories WHERE user_id = $1 ORDER BY type, name',
    [userId]
  );
  return result.rows.map(mapCategory);
}

async function findCategory(userId, id) {
  const result = await query('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [
    id,
    userId
  ]);
  return plain(result.rows[0]);
}

async function createCategory(userId, data) {
  const cat = {
    id: uid(),
    name: String(data.name || '').trim().slice(0, 60),
    type: data.type === 'income' ? 'income' : 'expense',
    color: validColor(data.color),
    icon: String(data.icon || 'tags')
  };
  if (!cat.name) throw httpError(400, 'Informe o nome da categoria.');
  await query(
    'INSERT INTO categories (id, user_id, name, type, color, icon, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [cat.id, userId, cat.name, cat.type, cat.color, cat.icon, nowISO()]
  );
  return mapCategory(await findCategory(userId, cat.id));
}

async function updateCategory(userId, id, data) {
  const existing = await findCategory(userId, id);
  if (!existing) throw httpError(404, 'Categoria não encontrada.');
  const name = String(data.name || '').trim().slice(0, 60);
  if (!name) throw httpError(400, 'Informe o nome da categoria.');
  const type = data.type === 'income' ? 'income' : 'expense';
  await query(
    'UPDATE categories SET name = $1, type = $2, color = $3, icon = $4 WHERE id = $5 AND user_id = $6',
    [name, type, validColor(data.color), String(data.icon || 'tags'), id, userId]
  );
  return mapCategory(await findCategory(userId, id));
}

async function deleteCategory(userId, id) {
  const used = await query(
    'SELECT COUNT(*)::int AS n FROM transactions WHERE user_id = $1 AND category_id = $2',
    [userId, id]
  );
  if (used.rows[0] && used.rows[0].n > 0) {
    throw httpError(409, 'Não é possível excluir: há lançamentos usando esta categoria.');
  }
  const result = await query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [
    id,
    userId
  ]);
  if (!result.rowCount) throw httpError(404, 'Categoria não encontrada.');
}

function validColor(color) {
  const value = String(color || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#78716c';
}

async function listTransactions(userId) {
  const result = await query(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY date DESC, created_at DESC',
    [userId]
  );
  return result.rows.map(mapTransaction);
}

async function findTransaction(userId, id) {
  const result = await query('SELECT * FROM transactions WHERE id = $1 AND user_id = $2', [
    id,
    userId
  ]);
  return plain(result.rows[0]);
}

async function sanitizeTransaction(userId, data, existing) {
  const type = data.type === 'income' ? 'income' : 'expense';
  const description = String(data.description || '').trim().slice(0, 140);
  const amount = Number(data.amount);
  const date = normalizeDate(data.date);

  if (!description) throw httpError(400, 'Informe uma descrição.');
  if (!(amount > 0)) throw httpError(400, 'Informe um valor válido.');
  if (!date) throw httpError(400, 'Informe uma data válida.');

  let categoryId = data.categoryId ? String(data.categoryId) : null;
  if (categoryId) {
    const cat = await findCategory(userId, categoryId);
    if (!cat) categoryId = null;
    else if (cat.type !== type) {
      throw httpError(400, 'A categoria não corresponde ao tipo do lançamento.');
    }
  }

  let dueDate = normalizeDate(data.dueDate);
  let status = data.status === 'pending' ? 'pending' : 'paid';

  if (type === 'income') {
    status = 'paid';
    dueDate = dueDate || date;
  } else {
    dueDate = dueDate || (existing && existing.due_date) || date;
  }

  return { type, description, amount, date, dueDate, status, categoryId };
}

async function createTransaction(userId, data) {
  const wallet = await ensureWallet(userId);
  const payload = await sanitizeTransaction(userId, data, null);
  const id = data.id ? String(data.id) : uid();
  if (await findTransaction(userId, id)) throw httpError(409, 'Lançamento já existe.');
  const now = nowISO();
  await query(
    `INSERT INTO transactions
     (id, user_id, account_id, category_id, type, description, amount, date, due_date, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      id,
      userId,
      wallet.id,
      payload.categoryId,
      payload.type,
      payload.description,
      payload.amount,
      payload.date,
      payload.dueDate,
      payload.status,
      now,
      now
    ]
  );
  return mapTransaction(await findTransaction(userId, id));
}

async function updateTransaction(userId, id, data) {
  const existing = await findTransaction(userId, id);
  if (!existing) throw httpError(404, 'Lançamento não encontrado.');
  const wallet = await ensureWallet(userId);
  const payload = await sanitizeTransaction(userId, data, existing);
  await query(
    `UPDATE transactions
     SET account_id = $1, category_id = $2, type = $3, description = $4, amount = $5,
         date = $6, due_date = $7, status = $8, updated_at = $9
     WHERE id = $10 AND user_id = $11`,
    [
      wallet.id,
      payload.categoryId,
      payload.type,
      payload.description,
      payload.amount,
      payload.date,
      payload.dueDate,
      payload.status,
      nowISO(),
      id,
      userId
    ]
  );
  return mapTransaction(await findTransaction(userId, id));
}

async function setTransactionStatus(userId, id, status) {
  const existing = await findTransaction(userId, id);
  if (!existing) throw httpError(404, 'Lançamento não encontrado.');
  const next =
    existing.type === 'income' ? 'paid' : status === 'pending' ? 'pending' : 'paid';
  await query(
    'UPDATE transactions SET status = $1, updated_at = $2 WHERE id = $3 AND user_id = $4',
    [next, nowISO(), id, userId]
  );
  return mapTransaction(await findTransaction(userId, id));
}

async function deleteTransaction(userId, id) {
  const result = await query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [
    id,
    userId
  ]);
  if (!result.rowCount) throw httpError(404, 'Lançamento não encontrado.');
}

async function getSnapshot(userId) {
  const [user, wallet, categories, transactions] = await Promise.all([
    findUserById(userId),
    getWallet(userId),
    listCategories(userId),
    listTransactions(userId)
  ]);
  return {
    version: 3,
    userName: user ? user.name || null : null,
    email: user ? user.email : null,
    wallet,
    categories,
    transactions
  };
}

async function saveSnapshot(userId, dados) {
  if (!dados || typeof dados !== 'object') throw httpError(400, 'Dados inválidos.');
  const categories = Array.isArray(dados.categories) ? dados.categories : [];
  const transactions = Array.isArray(dados.transactions) ? dados.transactions : [];

  let initialBalance = 0;
  if (dados.wallet && Number.isFinite(Number(dados.wallet.initialBalance))) {
    initialBalance = Number(dados.wallet.initialBalance);
  } else if (Array.isArray(dados.accounts)) {
    initialBalance = dados.accounts.reduce(
      (sum, acc) => sum + (Number.isFinite(Number(acc.initialBalance)) ? Number(acc.initialBalance) : 0),
      0
    );
  }
  const walletName =
    dados.wallet && typeof dados.wallet.name === 'string' && dados.wallet.name.trim()
      ? dados.wallet.name.trim().slice(0, 60)
      : 'Carteira';

  const wallet = await ensureWallet(userId);

  return withTransaction(async (client) => {
    await client.query('UPDATE accounts SET name = $1, initial_balance = $2 WHERE id = $3', [
      walletName,
      initialBalance,
      wallet.id
    ]);

    await client.query('DELETE FROM transactions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM categories WHERE user_id = $1', [userId]);

    const catIds = new Set();
    const catIdMap = new Map();
    for (const c of categories) {
      const name = String(c.name || '').trim().slice(0, 60);
      if (!name) continue;
      const oldId = c.id ? String(c.id) : null;
      if (oldId && catIdMap.has(oldId)) continue;
      const id = uid();
      const type = c.type === 'income' ? 'income' : 'expense';
      await client.query(
        'INSERT INTO categories (id, user_id, name, type, color, icon, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, userId, name, type, validColor(c.color), String(c.icon || 'tags'), nowISO()]
      );
      catIds.add(id);
      if (oldId) catIdMap.set(oldId, id);
    }

    const now = nowISO();
    let imported = 0;

    for (const t of transactions) {
      if (!t) continue;
      const description = String(t.description || '').trim().slice(0, 140);
      const amount = Number(t.amount);
      const date = normalizeDate(t.date);
      const type = t.type === 'income' ? 'income' : 'expense';
      if (!description || !(amount > 0) || !date) continue;
      const id = uid();
      const oldCatId = t.categoryId ? String(t.categoryId) : null;
      const categoryId = oldCatId && catIdMap.has(oldCatId) ? catIdMap.get(oldCatId) : null;
      const dueDate = normalizeDate(t.dueDate) || date;
      const status = type === 'income' ? 'paid' : t.status === 'pending' ? 'pending' : 'paid';
      await client.query(
        `INSERT INTO transactions
         (id, user_id, account_id, category_id, type, description, amount, date, due_date, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id,
          userId,
          wallet.id,
          categoryId,
          type,
          description,
          amount,
          date,
          dueDate,
          status,
          now,
          now
        ]
      );
      imported++;
    }

    return { imported, categories: catIds.size };
  });
}

function normalizeDate(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const month = Number(m[2]);
    const day = Number(m[1]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

function httpError(status, message, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

module.exports = {
  uid,
  normalizeEmail,
  httpError,
  ping,
  close,
  findUserByEmail,
  findUserById,
  createUser,
  updatePassword,
  createSession,
  userByToken,
  deleteSession,
  getWallet,
  updateWallet,
  ensureWallet,
  listCategories,
  findCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  listTransactions,
  createTransaction,
  updateTransaction,
  setTransactionStatus,
  deleteTransaction,
  getSnapshot,
  saveSnapshot,
  normalizeDate
};
