const TOKEN_KEY = 'mc_token_v1';
const EMAIL_KEY = 'mc_email_v1';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (_) { return ''; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
}

export function getEmail() {
  try { return localStorage.getItem(EMAIL_KEY) || ''; } catch (_) { return ''; }
}

export function setEmail(email) {
  try {
    if (email) localStorage.setItem(EMAIL_KEY, email);
  } catch (_) {}
}

async function request(path, options = {}) {
  const { method = 'GET', body, auth = true } = options;
  const headers = {};
  const cfg = { method, headers };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    cfg.body = JSON.stringify(body);
  }

  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(path, cfg);
  } catch (_) {
    throw new Error('Sem conexão com o servidor. Verifique se ele está rodando.');
  }

  let data = {};
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    if (res.status === 401 && auth && token) setToken('');
    const err = new Error(data.erro || 'Não foi possível concluir a operação.');
    err.status = res.status;
    err.code = data.code || null;
    throw err;
  }

  return data;
}

export const api = {
  login(email, senha, novo) {
    return request('/api/login', { method: 'POST', body: { email, senha, novo }, auth: false });
  },
  logout() {
    return request('/api/logout', { method: 'POST' }).catch(() => ({}));
  },
  getSnapshot() {
    return request('/api/dados');
  },
  saveSnapshot(dados) {
    return request('/api/dados', { method: 'PUT', body: { dados } });
  },
  createTransaction(payload) {
    return request('/api/transactions', { method: 'POST', body: payload });
  },
  updateTransaction(id, payload) {
    return request('/api/transactions/' + encodeURIComponent(id), { method: 'PUT', body: payload });
  },
  setTransactionStatus(id, status) {
    return request('/api/transactions/' + encodeURIComponent(id) + '/status', {
      method: 'PATCH',
      body: { status }
    });
  },
  deleteTransaction(id) {
    return request('/api/transactions/' + encodeURIComponent(id), { method: 'DELETE' });
  },
  createCategory(payload) {
    return request('/api/categories', { method: 'POST', body: payload });
  },
  updateCategory(id, payload) {
    return request('/api/categories/' + encodeURIComponent(id), { method: 'PUT', body: payload });
  },
  deleteCategory(id) {
    return request('/api/categories/' + encodeURIComponent(id), { method: 'DELETE' });
  },
  updateWallet(payload) {
    return request('/api/carteira', { method: 'PUT', body: payload });
  },
  changePassword(atual, nova) {
    return request('/api/senha', { method: 'POST', body: { atual, nova } });
  }
};
