import {
  esc, fmtBRL, formatAmountInput, isoToBR, isoToBRFull, todayISO, currentMonth,
  monthOf, monthLong, lastMonths, monthRange, dueLabel
} from './util.js';
import { iconSvg, ICON_OPTIONS, ICON_NAMES } from './icons.js';
import {
  state, walletTotals, totals, monthTransactions, expensesByCategory,
  monthlyTotals, periodTransactions, pendingTransactions, dataRange, catById,
  wallet, categories, transactions, isOverdue, isDueSoon
} from './state.js';
import { expenseDonut, expenseLegend, monthlyBars } from './charts.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let catEditId = null;
let catIconSel = 'tags';

/* ------------------------------ Toast/Modais ------------------------------ */

export function toast(message, type = '') {
  const container = $('#toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

export function closeAllModals() {
  $$('.modal-overlay').forEach((m) => m.classList.remove('open'));
}

/* ------------------------------ Login/App ------------------------------ */

export function showLogin() {
  $('#app-shell').classList.add('hidden');
  $('#view-login').classList.remove('hidden');
  setLoginMode(false);
  $('#login-msg').textContent = '';
  $('#login-senha').value = '';
  $('#login-confirma').value = '';
  $('#login-email').focus();
}

export function enterApp() {
  $('#view-login').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  const user = state.dados && state.dados.userName;
  $('#header-user').textContent = user ? `Olá, ${user}!` : '';
  showView('dashboard');
}

export function setLoginMode(create) {
  const form = $('#login-form');
  form.dataset.mode = create ? 'create' : 'login';
  $('#login-confirm-wrap').classList.toggle('hidden', !create);
  $('#login-submit').textContent = create ? 'Criar acesso' : 'Entrar';
  $('#login-toggle').textContent = create ? 'Já tenho acesso' : 'Criar novo acesso';
}

/* ------------------------------ Navegação ------------------------------ */

const renderers = {
  dashboard: renderDashboard,
  transacoes: renderTransacoes,
  categorias: renderCategorias,
  carteira: renderCarteira,
  relatorios: renderRelatorios
};

export function showView(name) {
  if (!renderers[name]) name = 'dashboard';
  state.view = name;
  $$('.view').forEach((v) => v.classList.remove('active'));
  const section = $('#view-' + name);
  if (section) section.classList.add('active');
  $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.view === name));
  const user = state.dados && state.dados.userName;
  $('#header-user').textContent = user ? `Olá, ${user}!` : '';
  renderers[name]();
}

export function renderCurrentView() {
  if (state.dados) renderers[state.view]();
}

/* ------------------------------ Helpers ------------------------------ */

function statusBadge(t) {
  if (t.type === 'income') return '<span class="badge income">Recebida</span>';
  if (t.status === 'pending') {
    return isOverdue(t)
      ? '<span class="badge overdue">Pendente · atrasada</span>'
      : '<span class="badge pending">Pendente</span>';
  }
  return '<span class="badge paid">Pago</span>';
}

function typeBadge(t) {
  return t.type === 'income'
    ? '<span class="badge income">Receita</span>'
    : '<span class="badge expense">Despesa</span>';
}

function typeBadgeShort(t) {
  return t.type === 'income' ? 'Receita' : 'Despesa';
}

function amountCell(t) {
  const pending = t.type === 'expense' && t.status === 'pending';
  const cls = t.type === 'income' ? 'income' : pending ? 'pending' : 'expense';
  const sign = t.type === 'income' ? '+ ' : '− ';
  return `<td class="tx-val ${cls}">${sign}${fmtBRL(t.amount)}</td>`;
}

function dueCell(t) {
  const iso = t.dueDate || t.date;
  const cls = isOverdue(t) ? 'overdue' : isDueSoon(t) ? 'soon' : '';
  return `<td class="tx-date ${cls}" title="${esc(isoToBRFull(iso))}">${esc(isoToBR(iso))}</td>`;
}

function iconSquare(cat, cls = '') {
  const color = cat ? cat.color : '#a8a29e';
  const icon = cat ? cat.icon : 'tags';
  return `<span class="ic-sq ${cls}" style="background:${esc(color)}">${iconSvg(icon)}</span>`;
}

/* ------------------------------ Dashboard ------------------------------ */

export function renderDashboard() {
  const mk = currentMonth();
  const monthTxs = monthTransactions(mk);
  const mTot = totals(monthTxs);
  const wt = walletTotals();

  $('#dash-sub').textContent = 'Visão geral — ' + monthLong(mk);
  $('#dash-saldo').textContent = fmtBRL(wt.available);
  $('#dash-receitas').textContent = fmtBRL(mTot.income);
  $('#dash-despesas').textContent = fmtBRL(mTot.paid);
  $('#dash-pendente').textContent = fmtBRL(wt.pending);
  $('#dash-projetado').textContent = fmtBRL(wt.projected);
  $('#dash-projetado').style.color = wt.projected < 0 ? 'var(--expense)' : '';

  const cats = expensesByCategory(monthTxs);
  if (cats.length) {
    $('#dash-pie').innerHTML = expenseDonut(cats, fmtBRL(mTot.expenseTotal));
    $('#dash-pie-legend').innerHTML = expenseLegend(cats);
  } else {
    $('#dash-pie').innerHTML = '<div class="empty">Sem despesas registradas neste mês.</div>';
    $('#dash-pie-legend').innerHTML = '';
  }

  const months = lastMonths(6, mk);
  $('#dash-bars').innerHTML = monthlyBars(months, monthlyTotals(transactions()));

  const upcoming = pendingTransactions().slice(0, 6);
  if (!upcoming.length) {
    $('#dash-upcoming').innerHTML = '<div class="empty">Nenhuma despesa pendente. Tudo em dia!</div>';
  } else {
    $('#dash-upcoming').innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Vencimento</th><th>Descrição</th><th>Situação</th><th class="num">Valor</th></tr></thead>
      <tbody>${upcoming.map((t) => {
        const cat = catById(t.categoryId);
        const cls = isOverdue(t) ? 'overdue' : isDueSoon(t) ? 'soon' : '';
        return `<tr>
          ${dueCell(t)}
          <td><div class="tx-main">${iconSquare(cat)}<div>
            <div class="tx-desc">${esc(t.description)}</div>
            <div class="tx-sub">${esc(cat ? cat.name : 'Sem categoria')}</div>
          </div></div></td>
          <td><span class="tx-date ${cls}">${esc(dueLabel(t.dueDate || t.date))}</span></td>
          <td class="tx-val pending">${fmtBRL(t.amount)}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  const recent = transactions()
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 6);

  if (!recent.length) {
    $('#dash-recent').innerHTML = '<div class="empty">Nenhum lançamento ainda. Comece adicionando sua primeira receita ou despesa.</div>';
  } else {
    $('#dash-recent').innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Data</th><th>Descrição</th><th>Status</th><th class="num">Valor</th></tr></thead>
      <tbody>${recent.map((t) => {
        const cat = catById(t.categoryId);
        return `<tr>
          <td class="tx-date">${esc(isoToBR(t.date))}</td>
          <td><div class="tx-main">${iconSquare(cat)}<div>
            <div class="tx-desc">${esc(t.description)}</div>
            <div class="tx-sub">${esc(cat ? cat.name : 'Sem categoria')}</div>
          </div></div></td>
          <td>${statusBadge(t)}</td>
          ${amountCell(t)}
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }
}

/* ------------------------------ Lançamentos ------------------------------ */

export function renderTransacoes() {
  $('#f-mes').value = state.txFilters.month;
  $('#f-tipo').value = state.txFilters.tipo;
  $('#f-status').value = state.txFilters.status;

  const txs = transactions()
    .filter((t) => {
      if (state.txFilters.month && monthOf(t.date) !== state.txFilters.month) return false;
      if (state.txFilters.tipo !== 'todos' && t.type !== state.txFilters.tipo) return false;
      if (state.txFilters.status !== 'todos' && t.status !== state.txFilters.status) return false;
      return true;
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const tb = $('#tx-tbody');
  const resumo = $('#tx-resumo');

  if (!txs.length) {
    tb.innerHTML = '<tr><td colspan="6" class="empty">Nenhum lançamento encontrado.</td></tr>';
    resumo.innerHTML = '';
    return;
  }

  const t = totals(txs);
  resumo.innerHTML = `
    <span>${txs.length} lançamento${txs.length === 1 ? '' : 's'}</span>
    <span class="inc">Receitas: <b>+${fmtBRL(t.income)}</b></span>
    <span class="exp">Pagas: <b>−${fmtBRL(t.paid)}</b></span>
    <span class="pend">Pendentes: <b>${fmtBRL(t.pending)}</b></span>
    <span class="bal">Resultado: <b>${fmtBRL(t.realized)}</b></span>`;

  tb.innerHTML = txs.map((tx) => {
    const cat = catById(tx.categoryId);
    const toggleBtn = tx.type === 'expense'
      ? `<button class="icon-btn toggle" data-toggle-tx="${esc(tx.id)}" title="${tx.status === 'pending' ? 'Marcar como pago' : 'Marcar como pendente'}">${iconSvg(tx.status === 'pending' ? 'check' : 'clock')}</button>`
      : '';
    return `<tr>
      ${dueCell(tx)}
      <td><div class="tx-main">${iconSquare(cat)}<div>
        <div class="tx-desc">${esc(tx.description)}</div>
        <div class="tx-sub">${esc(cat ? cat.name : 'Sem categoria')} · ${esc(typeBadgeShort(tx))}</div>
      </div></div></td>
      <td>${typeBadge(tx)}</td>
      <td>${statusBadge(tx)}</td>
      ${amountCell(tx)}
      <td class="tx-actions">
        <button class="icon-btn edit" data-edit-tx="${esc(tx.id)}" title="Editar">${iconSvg('pencil')}</button>
        ${toggleBtn}
        <button class="icon-btn del" data-del-tx="${esc(tx.id)}" title="Excluir">${iconSvg('trash')}</button>
      </td>
    </tr>`;
  }).join('');
}

/* ------------------------------ Modal de lançamento ------------------------------ */

export function setTxTipo(tipo) {
  $$('#tx-tipo-seg .seg-btn').forEach((b) => {
    b.classList.remove('active', 'expense', 'income');
    if (b.dataset.tipo === tipo) {
      b.classList.add('active', tipo);
    }
  });
  $('#tx-expense-fields').classList.toggle('hidden', tipo !== 'expense');
}

export function setTxStatus(status) {
  $$('#tx-status-seg .seg-btn').forEach((b) => {
    b.classList.remove('active', 'paid', 'pending');
    if (b.dataset.status === status) {
      b.classList.add('active', status);
    }
  });
}

export function fillTxSelects(tipo, catId) {
  const select = $('#tx-categoria');
  const list = categories().filter((c) => c.type === tipo);
  if (!list.length) {
    select.innerHTML = `<option value="">Sem categorias de ${tipo === 'income' ? 'receita' : 'despesa'}</option>`;
  } else {
    select.innerHTML = '<option value="">Sem categoria</option>' +
      list.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  }
  if (catId && list.some((c) => c.id === catId)) select.value = catId;
}

export function openTxModal(tx) {
  const editing = !!tx;
  $('#tx-modal-title').textContent = editing ? 'Editar lançamento' : 'Novo lançamento';
  $('#tx-delete').classList.toggle('hidden', !editing);

  const tipo = editing ? tx.type : 'expense';
  setTxTipo(tipo);
  setTxStatus(editing ? (tx.type === 'income' ? 'paid' : tx.status) : 'pending');

  $('#tx-desc').value = editing ? tx.description : '';
  $('#tx-val').value = editing ? formatAmountInput(tx.amount) : '';
  $('#tx-date').value = editing ? tx.date : todayISO();
  $('#tx-due').value = editing ? isoToBR(tx.dueDate || tx.date) : isoToBR(todayISO());
  fillTxSelects(tipo, editing ? tx.categoryId : null);

  $('#modal-tx').dataset.editId = editing ? tx.id : '';
  $('#tx-hint').textContent = tipo === 'expense'
    ? 'Pendente não desconta do saldo até ser marcada como paga.'
    : '';
  openModal('modal-tx');
  $('#tx-desc').focus();
}

/* ------------------------------ Categorias ------------------------------ */

export function renderCategorias() {
  const groups = [
    { title: 'Receitas', type: 'income' },
    { title: 'Despesas', type: 'expense' }
  ];

  $('#cat-list').innerHTML = groups.map((group) => {
    const items = categories().filter((c) => c.type === group.type);
    const rows = items.length ? items.map((c) => {
      const count = transactions().filter((t) => t.categoryId === c.id).length;
      return `<div class="chip">
        ${iconSquare(c, 'lg')}
        <div class="info">
          <div class="name">${esc(c.name)}</div>
          <div class="meta">${esc(ICON_NAMES[c.icon] || '')} · ${count} lançamento${count === 1 ? '' : 's'}</div>
        </div>
        <div class="actions">
          <button class="icon-btn edit" data-edit-cat="${esc(c.id)}" title="Editar">${iconSvg('pencil')}</button>
          <button class="icon-btn del" data-del-cat="${esc(c.id)}" title="Excluir">${iconSvg('trash')}</button>
        </div>
      </div>`;
    }).join('') : '<div class="empty">Nenhuma categoria.</div>';
    return `<div class="section-title">${group.title}</div><div class="chip-list">${rows}</div>`;
  }).join('');
}

function buildIconGrid(selected) {
  const grid = $('#cat-icon-grid');
  grid.innerHTML = ICON_OPTIONS.map((name) =>
    `<button type="button" data-icon="${name}" title="${esc(ICON_NAMES[name])}" class="${name === selected ? 'selected' : ''}">${iconSvg(name)}</button>`
  ).join('');
  grid.onclick = (event) => {
    const btn = event.target.closest('[data-icon]');
    if (!btn) return;
    catIconSel = btn.dataset.icon;
    $$('[data-icon]', grid).forEach((b) => b.classList.toggle('selected', b.dataset.icon === catIconSel));
  };
}

export function openCatModal(cat) {
  catEditId = cat ? cat.id : null;
  $('#cat-modal-title').textContent = cat ? 'Editar categoria' : 'Nova categoria';
  $('#cat-delete').classList.toggle('hidden', !cat);
  $('#cat-name').value = cat ? cat.name : '';
  $('#cat-type').value = cat ? cat.type : 'expense';
  $('#cat-color').value = cat ? cat.color : '#16a34a';
  catIconSel = cat ? cat.icon : 'tags';
  buildIconGrid(catIconSel);
  updateColorName();
  openModal('modal-cat');
  $('#cat-name').focus();
}

export function updateColorName() {
  $('#cat-color-name').textContent = $('#cat-color').value;
}

export function currentCatEditId() {
  return catEditId;
}

export function currentCatIcon() {
  return catIconSel;
}

/* ------------------------------ Carteira ------------------------------ */

export function renderCarteira() {
  const w = wallet();
  const wt = walletTotals();
  const balanceColor = wt.available >= 0 ? 'var(--income)' : 'var(--expense)';

  $('#wallet-card').innerHTML = `<div class="card wallet-card">
    <div class="wallet-main">
      <div class="wallet-avatar">${iconSvg('wallet')}</div>
      <div>
        <div class="wallet-title">${esc(w.name || 'Carteira')}</div>
        <div class="wallet-sub">Saldo inicial ${fmtBRL(wt.initial)}</div>
        <div class="wallet-balance" style="color:${balanceColor}">${fmtBRL(wt.available)}</div>
        <div class="wallet-sub">Saldo disponível (receitas − despesas pagas)</div>
      </div>
    </div>
    <div class="wallet-breakdown">
      <div class="wallet-line"><span class="lbl">Receitas</span><b style="color:var(--income)">+ ${fmtBRL(wt.income)}</b></div>
      <div class="wallet-line"><span class="lbl">Despesas pagas</span><b style="color:var(--expense)">− ${fmtBRL(wt.paid)}</b></div>
      <div class="wallet-line pending-row"><span class="lbl">A pagar (pendente)</span><b>${fmtBRL(wt.pending)}</b></div>
      <div class="wallet-line projected-row"><span class="lbl">Saldo projetado</span><b>${fmtBRL(wt.projected)}</b></div>
    </div>
  </div>`;
}

export function openWalletModal() {
  const w = wallet();
  $('#wallet-name').value = w.name || 'Carteira';
  $('#wallet-init').value = formatAmountInput(w.initialBalance);
  openModal('modal-wallet');
  $('#wallet-name').focus();
}

/* ------------------------------ Relatórios ------------------------------ */

export function renderRelatorios() {
  if (!state.relFrom) state.relFrom = currentMonth();
  if (!state.relTo) state.relTo = currentMonth();
  if (state.relFrom > state.relTo) {
    const tmp = state.relFrom;
    state.relFrom = state.relTo;
    state.relTo = tmp;
  }

  $('#rel-de').value = state.relFrom;
  $('#rel-ate').value = state.relTo;

  const txs = periodTransactions(state.relFrom, state.relTo);
  const t = totals(txs);

  $('#rel-rec').textContent = fmtBRL(t.income);
  $('#rel-pagas').textContent = fmtBRL(t.paid);
  $('#rel-pendentes').textContent = fmtBRL(t.pending);
  $('#rel-sal').textContent = fmtBRL(t.realized);
  $('#rel-sal').style.color = t.realized >= 0 ? 'var(--income)' : 'var(--expense)';

  const cats = expensesByCategory(txs);
  if (cats.length) {
    $('#rel-pie').innerHTML = expenseDonut(cats, fmtBRL(t.expenseTotal));
    $('#rel-pie-legend').innerHTML = expenseLegend(cats);
  } else {
    $('#rel-pie').innerHTML = '<div class="empty">Sem despesas no período.</div>';
    $('#rel-pie-legend').innerHTML = '';
  }

  const months = monthRange(state.relFrom, state.relTo);
  if (months.length > 60) {
    $('#rel-bars').innerHTML = '<p class="hint">Período muito longo para o gráfico mensal. Selecione um intervalo menor (até 60 meses).</p>';
  } else {
    $('#rel-bars').innerHTML = monthlyBars(months, monthlyTotals(txs));
  }

  $$('#rel-presets .preset-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.preset === state.relPreset);
  });
}

export function applyPreset(key) {
  const mk = currentMonth();
  state.relPreset = key;
  if (key === 'mes') {
    state.relFrom = mk;
    state.relTo = mk;
  } else if (key === '3') {
    state.relFrom = addMonthsSafe(mk, -2);
    state.relTo = mk;
  } else if (key === '6') {
    state.relFrom = addMonthsSafe(mk, -5);
    state.relTo = mk;
  } else if (key === 'ano') {
    state.relFrom = mk.slice(0, 4) + '-01';
    state.relTo = mk;
  } else if (key === 'tudo') {
    const range = dataRange();
    state.relFrom = range.min;
    state.relTo = range.max;
  }
  renderRelatorios();
}

function addMonthsSafe(mk, delta) {
  let [y, m] = String(mk).split('-').map(Number);
  m += delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function setRelPresetNone() {
  state.relPreset = '';
  $$('#rel-presets .preset-btn').forEach((b) => b.classList.remove('active'));
}

export function openPassModal() {
  $('#pass-old').value = '';
  $('#pass-new').value = '';
  $('#pass-new2').value = '';
  openModal('modal-pass');
  $('#pass-old').focus();
}
