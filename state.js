import { currentMonth, addMonths, monthOf, todayISO } from './util.js';

export const state = {
  dados: null,
  view: 'dashboard',
  txFilters: { month: currentMonth(), tipo: 'todos', status: 'todos' },
  relFrom: addMonths(currentMonth(), -5),
  relTo: currentMonth(),
  relPreset: '6'
};

export function setDados(dados) {
  state.dados = dados || null;
}

export function transactions() {
  return state.dados && Array.isArray(state.dados.transactions) ? state.dados.transactions : [];
}

export function categories() {
  return state.dados && Array.isArray(state.dados.categories) ? state.dados.categories : [];
}

export function wallet() {
  return (state.dados && state.dados.wallet) || { name: 'Carteira', initialBalance: 0 };
}

export function catById(id) {
  return categories().find((c) => c.id === id) || null;
}

export function walletTotals() {
  const initial = Number(wallet().initialBalance) || 0;
  let income = 0;
  let paid = 0;
  let pending = 0;

  for (const t of transactions()) {
    const amount = Number(t.amount) || 0;
    if (t.type === 'income') income += amount;
    else if (t.status === 'pending') pending += amount;
    else paid += amount;
  }

  const available = initial + income - paid;
  return {
    initial,
    income,
    paid,
    pending,
    available,
    projected: available - pending
  };
}

export function totals(txs) {
  let income = 0;
  let paid = 0;
  let pending = 0;

  for (const t of txs) {
    const amount = Number(t.amount) || 0;
    if (t.type === 'income') income += amount;
    else if (t.status === 'pending') pending += amount;
    else paid += amount;
  }

  return {
    income,
    paid,
    pending,
    expenseTotal: paid + pending,
    realized: income - paid
  };
}

export function txInMonth(t, mk) {
  return monthOf(t.date) === mk;
}

export function monthTransactions(mk) {
  return transactions().filter((t) => txInMonth(t, mk));
}

export function expensesByCategory(txs) {
  const map = new Map();

  for (const t of txs) {
    if (t.type !== 'expense') continue;
    const cat = catById(t.categoryId);
    const key = cat ? cat.id : '__none__';
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        label: cat ? cat.name : 'Sem categoria',
        color: cat ? cat.color : '#a8a29e',
        icon: cat ? cat.icon : 'tags',
        paid: 0,
        pending: 0,
        total: 0
      });
    }
    const item = map.get(key);
    const amount = Number(t.amount) || 0;
    if (t.status === 'pending') item.pending += amount;
    else item.paid += amount;
    item.total += amount;
  }

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function monthlyTotals(txs) {
  const map = new Map();

  for (const t of txs) {
    const key = monthOf(t.date);
    if (!map.has(key)) map.set(key, { income: 0, paid: 0, pending: 0 });
    const item = map.get(key);
    const amount = Number(t.amount) || 0;
    if (t.type === 'income') item.income += amount;
    else if (t.status === 'pending') item.pending += amount;
    else item.paid += amount;
  }

  return map;
}

export function periodTransactions(from, to) {
  return transactions().filter((t) => {
    const mk = monthOf(t.date);
    return mk >= from && mk <= to;
  });
}

export function pendingTransactions() {
  return transactions()
    .filter((t) => t.type === 'expense' && t.status === 'pending')
    .sort((a, b) => String(a.dueDate || a.date).localeCompare(String(b.dueDate || b.date)));
}

export function isOverdue(t) {
  if (!t || t.type !== 'expense' || t.status !== 'pending') return false;
  return String(t.dueDate || t.date) < todayISO();
}

export function isDueSoon(t) {
  if (!t || t.type !== 'expense' || t.status !== 'pending') return false;
  const due = String(t.dueDate || t.date);
  if (due < todayISO()) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = due.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const diff = Math.round((target - today) / 86400000);
  return diff >= 0 && diff <= 7;
}

export function dataRange() {
  let min = null;
  let max = null;
  for (const t of transactions()) {
    const mk = monthOf(t.date);
    if (!mk) continue;
    if (!min || mk < min) min = mk;
    if (!max || mk > max) max = mk;
  }
  if (!min) return { min: currentMonth(), max: currentMonth() };
  return { min, max };
}
