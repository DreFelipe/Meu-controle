import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NetlifyDB } from '@netlify/database-dev';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrations = path.join(projectRoot, 'netlify', 'database', 'migrations');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const localDb = new NetlifyDB();
const connectionString = await localDb.start();

try {
  const applied = await localDb.applyMigrations(migrations);
  console.log('Migrações aplicadas:', applied.join(', ') || '(nenhuma)');

  process.env.NETLIFY_DB_URL = connectionString;
  const apiModule = await import('../api.js');
  const handle = apiModule.default.handle;

  async function call(method, pathname, options = {}) {
    const headers = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const request = new Request('http://localhost' + pathname, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const response = await handle(request);
    let data = {};
    try { data = await response.json(); } catch (_) {}
    return { status: response.status, data };
  }

  const email = `smoke-${Date.now()}@example.com`;
  let result = await call('POST', '/api/login', {
    body: { email, senha: '1234', novo: true }
  });
  assert(result.status === 201, 'criar conta deveria retornar 201');
  const token = result.data.token;
  assert(result.data.dados.categories.length === 12, 'deveria criar 12 categorias padrão');
  assert(result.data.dados.wallet.initialBalance === 0, 'carteira deveria começar em 0');

  result = await call('PUT', '/api/carteira', {
    token,
    body: { name: 'Carteira', initialBalance: 100 }
  });
  assert(result.status === 200 && result.data.carteira.initialBalance === 100, 'atualizar carteira');

  const categoriesResult = await call('GET', '/api/categories', { token });
  const expenseCategory = categoriesResult.data.items.find((item) => item.type === 'expense');
  assert(expenseCategory, 'deveria existir categoria de despesa');

  result = await call('POST', '/api/transactions', {
    token,
    body: {
      type: 'expense',
      description: 'Mercado',
      amount: 25.5,
      date: '2026-11-16',
      categoryId: expenseCategory.id,
      status: 'pending'
    }
  });
  assert(result.status === 201, 'criar lançamento deveria retornar 201');
  const transactionId = result.data.item.id;
  assert(result.data.item.status === 'pending', 'lançamento deveria ser pendente');

  result = await call('PATCH', `/api/transactions/${transactionId}/status`, {
    token,
    body: { status: 'paid' }
  });
  assert(result.status === 200 && result.data.item.status === 'paid', 'marcar como pago');

  result = await call('PUT', '/api/dados', {
    token,
    body: {
      dados: {
        wallet: { name: 'Principal', initialBalance: 250 },
        categories: [{ id: 'c1', name: 'Casa', type: 'expense', color: '#ef4444', icon: 'home' }],
        transactions: [
          {
            type: 'expense',
            description: 'Aluguel',
            amount: 90,
            date: '2026-11-01',
            categoryId: 'c1',
            status: 'paid'
          }
        ]
      }
    }
  });
  assert(result.status === 200, 'importar snapshot deveria retornar 200');
  assert(result.data.importado.imported === 1, 'snapshot deveria importar 1 lançamento');
  assert(result.data.dados.wallet.initialBalance === 250, 'saldo do snapshot');
  assert(result.data.dados.transactions.length === 1, 'snapshot deveria substituir lançamentos');

  result = await call('DELETE', `/api/transactions/${result.data.dados.transactions[0].id}`, {
    token
  });
  assert(result.status === 200, 'excluir lançamento');

  result = await call('POST', '/api/senha', {
    token,
    body: { atual: '1234', nova: '9876' }
  });
  assert(result.status === 200, 'alterar senha');

  result = await call('POST', '/api/login', {
    body: { email, senha: '9876', novo: false }
  });
  assert(result.status === 200, 'login com a nova senha');
  const newToken = result.data.token;

  result = await call('POST', '/api/logout', { token: newToken });
  assert(result.status === 200, 'logout');

  result = await call('GET', '/api/dados', { token: newToken });
  assert(result.status === 401, 'sessão encerrada deveria retornar 401');

  const importOutput = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['scripts/import-sqlite.mjs', '--connection-string', connectionString, '--db', 'data/app.db'],
      { cwd: projectRoot }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `importação saiu com código ${code}`));
    });
  });
  console.log(importOutput.trim());

  const store = await import('../db.js');
  await store.default.close();
  console.log('Smoke test OK');
} finally {
  await localDb.stop();
}
