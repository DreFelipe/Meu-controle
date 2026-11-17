import { api, getToken, setToken, getEmail, setEmail } from './api.js';
import { state, setDados } from './state.js';
import * as ui from './ui.js';
import { parseAmount, todayISO, brToISO, maskDate } from './util.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

/* ------------------------------ Utilidades ------------------------------ */

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function setBusy(button, busy, text) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = text || 'Aguarde...';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function handleApiError(err) {
  if (err && err.status === 401) {
    setToken('');
    setDados(null);
    ui.closeAllModals();
    ui.showLogin();
    prefillLogin();
    ui.toast('Sessão expirada. Entre novamente.', 'error');
    return;
  }
  ui.toast((err && err.message) || 'Não foi possível concluir a operação.', 'error');
}

function replaceTransaction(item) {
  if (!state.dados || !item) return;
  const list = state.dados.transactions || [];
  const index = list.findIndex((t) => t.id === item.id);
  if (index >= 0) list[index] = item;
  else list.push(item);
  state.dados.transactions = list;
}

function prefillLogin() {
  const email = getEmail();
  if (email) $('#login-email').value = email;
  ui.setLoginMode(false);
}

/* ------------------------------ Login ------------------------------ */

async function handleLogin(event) {
  event.preventDefault();
  const form = $('#login-form');
  const create = form.dataset.mode === 'create';
  const message = $('#login-msg');
  const email = normalizeEmail($('#login-email').value);
  const senha = $('#login-senha').value;
  const confirm = $('#login-confirma').value;

  message.textContent = '';

  if (!email) { message.textContent = 'Digite seu email.'; return; }
  if (!validEmail(email)) { message.textContent = 'Email inválido.'; return; }
  if (senha.length < 4) { message.textContent = 'A senha precisa ter pelo menos 4 caracteres.'; return; }
  if (create && senha !== confirm) { message.textContent = 'As senhas não conferem.'; return; }

  const button = $('#login-submit');
  setBusy(button, true, create ? 'Criando...' : 'Entrando...');

  try {
    const data = await api.login(email, senha, create);
    setToken(data.token);
    setEmail(email);
    setDados(data.dados || null);
    ui.enterApp();
    maybeMigrateLegacy(email);
  } catch (err) {
    if (err.code === 'NO_USER') {
      ui.setLoginMode(true);
      message.textContent = 'Conta não encontrada. Defina uma senha para criar seu acesso.';
    } else if (err.code === 'USER_EXISTS') {
      ui.setLoginMode(false);
      message.textContent = 'Essa conta já existe. Digite sua senha.';
    } else if (err.code === 'BAD_PASS') {
      ui.setLoginMode(false);
      message.textContent = 'Senha incorreta.';
    } else {
      message.textContent = err.message || 'Não foi possível entrar.';
    }
  } finally {
    setBusy(button, false);
    ui.setLoginMode(form.dataset.mode === 'create');
  }
}

async function handleLogout() {
  await api.logout();
  setToken('');
  setDados(null);
  ui.closeAllModals();
  ui.showLogin();
  prefillLogin();
}

/* --------------------------- Migração legada --------------------------- */

function legacyDataFor(email) {
  const keys = [];
  if (email) keys.push('mf_user_v2_' + encodeURIComponent(email));
  keys.push('mf_dados_v2');
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (data && data.version === 2) return data;
    } catch (_) {}
  }
  return null;
}

function legacyToSnapshot(data, email) {
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const initialBalance = accounts.reduce(
    (sum, acc) => sum + (Number(acc.initialBalance) || 0),
    0
  );

  const cats = Array.isArray(data.categories) ? data.categories : [];
  const txList = Array.isArray(data.transactions) ? data.transactions : [];

  return {
    version: 3,
    userName: data.userName || email.split('@')[0],
    wallet: { name: 'Carteira', initialBalance },
    categories: cats.filter((c) => c && c.name).map((c) => ({
      id: c.id || undefined,
      name: String(c.name).slice(0, 60),
      type: c.type === 'income' ? 'income' : 'expense',
      color: c.color || '#78716c',
      icon: c.icon || 'tags'
    })),
    transactions: txList
      .filter((t) => t && t.id && t.date && t.type && Number(t.amount) > 0)
      .map((t) => ({
        id: t.id,
        type: t.type === 'income' ? 'income' : 'expense',
        description: String(t.description || '').slice(0, 140),
        amount: Number(t.amount),
        date: String(t.date).slice(0, 10),
        dueDate: String(t.dueDate || t.date).slice(0, 10),
        status: t.type === 'income' ? 'paid' : (t.status === 'pending' ? 'pending' : 'paid'),
        categoryId: t.categoryId || null
      }))
  };
}

async function maybeMigrateLegacy(email) {
  if (!state.dados) return;
  if ((state.dados.transactions || []).length) return;
  if (sessionStorage.getItem('mc_legacy_asked') === '1') return;

  const legacy = legacyDataFor(email);
  if (!legacy) return;

  sessionStorage.setItem('mc_legacy_asked', '1');
  const ok = confirm(
    'Encontramos dados salvos da versão anterior neste navegador. Deseja importá-los para a sua Carteira?'
  );
  if (!ok) return;

  try {
    const snapshot = legacyToSnapshot(legacy, email);
    const data = await api.saveSnapshot(snapshot);
    setDados(data.dados);
    ui.renderCurrentView();
    ui.toast('Dados antigos importados com sucesso.', 'success');
  } catch (err) {
    handleApiError(err);
  }
}

/* ------------------------------ Lançamentos ------------------------------ */

async function saveTransaction() {
  const editId = $('#modal-tx').dataset.editId;
  const tipo = $('#tx-tipo-seg .seg-btn.active').dataset.tipo;
  const description = $('#tx-desc').value.trim();
  const amount = parseAmount($('#tx-val').value);
  const date = $('#tx-date').value;
  const dueDate = tipo === 'expense' ? brToISO($('#tx-due').value) : date;
  const status = tipo === 'expense'
    ? $('#tx-status-seg .seg-btn.active').dataset.status
    : 'paid';
  const categoryId = $('#tx-categoria').value || null;

  if (!description) { ui.toast('Informe uma descrição.', 'error'); return; }
  if (!(amount > 0)) { ui.toast('Informe um valor válido (ex: 150,75).', 'error'); return; }
  if (!date) { ui.toast('Informe a data.', 'error'); return; }
  if (tipo === 'expense' && !dueDate) {
    ui.toast('Informe o vencimento no formato DD/MM/AA.', 'error');
    return;
  }

  const payload = {
    type: tipo,
    description,
    amount,
    date,
    dueDate,
    status,
    categoryId
  };

  const button = $('#tx-save');
  setBusy(button, true, 'Salvando...');

  try {
    const data = editId
      ? await api.updateTransaction(editId, payload)
      : await api.createTransaction(payload);
    replaceTransaction(data.item);
    ui.closeModal('modal-tx');
    ui.renderCurrentView();
    ui.toast(editId ? 'Lançamento atualizado.' : 'Lançamento criado.', 'success');
  } catch (err) {
    handleApiError(err);
  } finally {
    setBusy(button, false);
  }
}

async function deleteTransaction(id) {
  if (!confirm('Excluir este lançamento?')) return;
  try {
    await api.deleteTransaction(id);
    state.dados.transactions = state.dados.transactions.filter((t) => t.id !== id);
    ui.closeModal('modal-tx');
    ui.renderCurrentView();
    ui.toast('Lançamento excluído.', 'success');
  } catch (err) {
    handleApiError(err);
  }
}

async function toggleTransaction(id) {
  const tx = state.dados.transactions.find((t) => t.id === id);
  if (!tx || tx.type !== 'expense') return;
  const next = tx.status === 'pending' ? 'paid' : 'pending';
  try {
    const data = await api.setTransactionStatus(id, next);
    replaceTransaction(data.item);
    ui.renderCurrentView();
    ui.toast(next === 'paid' ? 'Despesa marcada como paga.' : 'Despesa marcada como pendente.', 'success');
  } catch (err) {
    handleApiError(err);
  }
}

/* ------------------------------ Categorias ------------------------------ */

async function saveCategory() {
  const name = $('#cat-name').value.trim();
  if (!name) { ui.toast('Informe o nome da categoria.', 'error'); return; }

  const payload = {
    name,
    type: $('#cat-type').value,
    color: $('#cat-color').value,
    icon: ui.currentCatIcon()
  };

  const editId = ui.currentCatEditId();
  const button = $('#cat-save');
  setBusy(button, true, 'Salvando...');

  try {
    const data = editId
      ? await api.updateCategory(editId, payload)
      : await api.createCategory(payload);

    const list = state.dados.categories || [];
    const index = list.findIndex((c) => c.id === data.item.id);
    if (index >= 0) list[index] = data.item;
    else list.push(data.item);
    state.dados.categories = list;

    ui.closeModal('modal-cat');
    ui.renderCurrentView();
    ui.toast(editId ? 'Categoria atualizada.' : 'Categoria criada.', 'success');
  } catch (err) {
    handleApiError(err);
  } finally {
    setBusy(button, false);
  }
}

async function deleteCategory(id) {
  if (!confirm('Excluir esta categoria?')) return;
  try {
    await api.deleteCategory(id);
    state.dados.categories = state.dados.categories.filter((c) => c.id !== id);
    ui.closeModal('modal-cat');
    ui.renderCurrentView();
    ui.toast('Categoria excluída.', 'success');
  } catch (err) {
    handleApiError(err);
  }
}

/* ------------------------------- Carteira ------------------------------- */

async function saveWallet() {
  const name = $('#wallet-name').value.trim();
  const initial = parseAmount($('#wallet-init').value);

  if (!name) { ui.toast('Informe o nome da carteira.', 'error'); return; }
  if (!Number.isFinite(initial)) { ui.toast('Informe um saldo inicial válido.', 'error'); return; }

  const button = $('#wallet-save');
  setBusy(button, true, 'Salvando...');

  try {
    const data = await api.updateWallet({ name, initialBalance: initial });
    state.dados.wallet = data.carteira;
    ui.closeModal('modal-wallet');
    ui.renderCurrentView();
    ui.toast('Carteira atualizada.', 'success');
  } catch (err) {
    handleApiError(err);
  } finally {
    setBusy(button, false);
  }
}

/* ------------------------------- Senha ------------------------------- */

async function savePassword() {
  const atual = $('#pass-old').value;
  const nova = $('#pass-new').value;
  const confirma = $('#pass-new2').value;

  if (nova.length < 4) { ui.toast('A nova senha precisa ter pelo menos 4 caracteres.', 'error'); return; }
  if (nova !== confirma) { ui.toast('As senhas não conferem.', 'error'); return; }

  const button = $('#pass-save');
  setBusy(button, true, 'Salvando...');

  try {
    await api.changePassword(atual, nova);
    ui.closeModal('modal-pass');
    ui.toast('Senha alterada com sucesso.', 'success');
  } catch (err) {
    handleApiError(err);
  } finally {
    setBusy(button, false);
  }
}

/* ---------------------------- Import/Export ---------------------------- */

function exportData() {
  const payload = { exportadoEm: new Date().toISOString(), dados: state.dados };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'meu-controle-backup-' + todayISO() + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function normalizeImported(raw) {
  const src = raw && raw.dados ? raw.dados : raw;
  if (!src || typeof src !== 'object') throw new Error('Arquivo inválido.');

  if (!Array.isArray(src.categories) || !Array.isArray(src.transactions)) {
    throw new Error('Arquivo inválido. Selecione um backup exportado por este app.');
  }

  let walletName = 'Carteira';
  let initialBalance = 0;

  if (src.wallet) {
    walletName = typeof src.wallet.name === 'string' && src.wallet.name.trim()
      ? src.wallet.name.trim().slice(0, 60)
      : 'Carteira';
    initialBalance = Number(src.wallet.initialBalance) || 0;
  } else if (Array.isArray(src.accounts)) {
    initialBalance = src.accounts.reduce(
      (sum, acc) => sum + (Number(acc.initialBalance) || 0),
      0
    );
  }

  return {
    version: 3,
    userName: typeof src.userName === 'string' ? src.userName : null,
    wallet: { name: walletName, initialBalance },
    categories: src.categories
      .filter((c) => c && c.name)
      .map((c) => ({
        id: c.id || undefined,
        name: String(c.name).slice(0, 60),
        type: c.type === 'income' ? 'income' : 'expense',
        color: c.color || '#78716c',
        icon: c.icon || 'tags'
      })),
    transactions: src.transactions
      .filter((t) => t && t.date && (t.type === 'income' || t.type === 'expense') && Number(t.amount) > 0)
      .map((t) => ({
        id: t.id || undefined,
        type: t.type,
        description: String(t.description || '').slice(0, 140),
        amount: Number(t.amount),
        date: String(t.date).slice(0, 10),
        dueDate: String(t.dueDate || t.date).slice(0, 10),
        status: t.type === 'income' ? 'paid' : (t.status === 'pending' ? 'pending' : 'paid'),
        categoryId: t.categoryId || null
      }))
  };
}

async function importFile(file) {
  if (!file) return;
  let parsed;
  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (_) {
    ui.toast('Não foi possível ler o arquivo.', 'error');
    return;
  }

  let snapshot;
  try {
    snapshot = normalizeImported(parsed);
  } catch (err) {
    ui.toast(err.message, 'error');
    return;
  }

  if (!confirm('Importar este backup substituirá todos os dados atuais. Continuar?')) return;

  try {
    const data = await api.saveSnapshot(snapshot);
    setDados(data.dados);
    ui.renderCurrentView();
    ui.toast('Dados importados com sucesso.', 'success');
  } catch (err) {
    handleApiError(err);
  }
}

/* ------------------------------ Eventos ------------------------------ */

function bindEvents() {
  $('#login-form').addEventListener('submit', handleLogin);
  $('#login-toggle').addEventListener('click', () => {
    const form = $('#login-form');
    const create = form.dataset.mode !== 'create';
    ui.setLoginMode(create);
    $('#login-msg').textContent = '';
  });

  $('#btn-lock').addEventListener('click', handleLogout);

  $('#dash-novo').addEventListener('click', () => ui.openTxModal(null));
  $('#tx-novo').addEventListener('click', () => ui.openTxModal(null));

  $('#tx-tipo-seg').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-tipo]');
    if (!btn) return;
    const tipo = btn.dataset.tipo;
    const currentCat = $('#tx-categoria').value || null;
    ui.setTxTipo(tipo);
    ui.fillTxSelects(tipo, currentCat);
    $('#tx-hint').textContent = tipo === 'expense'
      ? 'Pendente não desconta do saldo até ser marcada como paga.'
      : '';
  });

  $('#tx-status-seg').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-status]');
    if (!btn) return;
    ui.setTxStatus(btn.dataset.status);
  });

  $('#tx-due').addEventListener('input', (event) => {
    event.target.value = maskDate(event.target.value);
  });

  $('#tx-save').addEventListener('click', saveTransaction);
  $('#tx-delete').addEventListener('click', () => {
    const id = $('#modal-tx').dataset.editId;
    if (id) deleteTransaction(id);
  });

  $('#f-mes').addEventListener('change', (event) => {
    state.txFilters.month = event.target.value;
    ui.renderTransacoes();
  });
  $('#f-tipo').addEventListener('change', (event) => {
    state.txFilters.tipo = event.target.value;
    ui.renderTransacoes();
  });
  $('#f-status').addEventListener('change', (event) => {
    state.txFilters.status = event.target.value;
    ui.renderTransacoes();
  });
  $('#f-limpar').addEventListener('click', () => {
    state.txFilters = { month: '', tipo: 'todos', status: 'todos' };
    ui.renderTransacoes();
  });

  $('#cat-novo').addEventListener('click', () => ui.openCatModal(null));
  $('#cat-save').addEventListener('click', saveCategory);
  $('#cat-delete').addEventListener('click', () => {
    const id = ui.currentCatEditId();
    if (id) deleteCategory(id);
  });
  $('#cat-color').addEventListener('input', ui.updateColorName);

  $('#wallet-edit').addEventListener('click', ui.openWalletModal);
  $('#wallet-save').addEventListener('click', saveWallet);

  $('#rel-presets').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-preset]');
    if (!btn) return;
    ui.applyPreset(btn.dataset.preset);
  });
  $('#rel-de').addEventListener('change', (event) => {
    state.relFrom = event.target.value;
    ui.setRelPresetNone();
    ui.renderRelatorios();
  });
  $('#rel-ate').addEventListener('change', (event) => {
    state.relTo = event.target.value;
    ui.setRelPresetNone();
    ui.renderRelatorios();
  });

  $('#btn-mudar-senha').addEventListener('click', ui.openPassModal);
  $('#pass-save').addEventListener('click', savePassword);

  $('#btn-exportar').addEventListener('click', exportData);
  $('#btn-importar').addEventListener('click', () => $('#file-importar').click());
  $('#file-importar').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    importFile(file);
  });

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-view]');
    if (nav) {
      event.preventDefault();
      if (state.dados) ui.showView(nav.dataset.view);
      return;
    }

    const close = event.target.closest('[data-close]');
    if (close) {
      ui.closeModal(close.dataset.close);
      return;
    }

    const editTx = event.target.closest('[data-edit-tx]');
    if (editTx) {
      const tx = state.dados.transactions.find((t) => t.id === editTx.dataset.editTx);
      if (tx) ui.openTxModal(tx);
      return;
    }

    const delTx = event.target.closest('[data-del-tx]');
    if (delTx) {
      deleteTransaction(delTx.dataset.delTx);
      return;
    }

    const toggleTx = event.target.closest('[data-toggle-tx]');
    if (toggleTx) {
      toggleTransaction(toggleTx.dataset.toggleTx);
      return;
    }

    const editCat = event.target.closest('[data-edit-cat]');
    if (editCat) {
      const cat = state.dados.categories.find((c) => c.id === editCat.dataset.editCat);
      if (cat) ui.openCatModal(cat);
      return;
    }

    const delCat = event.target.closest('[data-del-cat]');
    if (delCat) {
      deleteCategory(delCat.dataset.delCat);
    }
  });

  $$('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.classList.remove('open');
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') ui.closeAllModals();
  });
}

/* -------------------------------- Boot -------------------------------- */

async function boot() {
  bindEvents();
  prefillLogin();

  if (getToken()) {
    try {
      const data = await api.getSnapshot();
      setDados(data.dados);
      ui.enterApp();
      maybeMigrateLegacy(getEmail());
      return;
    } catch (err) {
      if (err.status !== 401) ui.toast(err.message, 'error');
      setToken('');
    }
  }

  ui.showLogin();
  prefillLogin();
}

boot();
