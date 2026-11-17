export function esc(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function fmtBRL(value) {
  return (Number(value) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function fmtCompact(value) {
  return fmtBRL(value).replace(',00', '');
}

export function parseAmount(value) {
  if (value == null) return NaN;
  let s = String(value).trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

export function formatAmountInput(value) {
  const n = Number(value) || 0;
  return n.toFixed(2).replace('.', ',');
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentMonth() {
  return todayISO().slice(0, 7);
}

export function monthOf(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

const MESES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES_LONGO = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function monthShort(mk) {
  const [, m] = String(mk).split('-');
  return MESES[Number(m)] || '';
}

export function monthLong(mk) {
  const [y, m] = String(mk).split('-');
  return `${MESES_LONGO[Number(m)] || ''} de ${y}`;
}

export function addMonths(mk, delta) {
  let [y, m] = String(mk).split('-').map(Number);
  m += delta;
  while (m > 12) { m -= 12; y += 1; }
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

export function lastMonths(n, endMk) {
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(addMonths(endMk, -i));
  return out;
}

export function monthRange(from, to) {
  const out = [];
  let mk = from;
  while (mk <= to && out.length < 120) {
    out.push(mk);
    mk = addMonths(mk, 1);
  }
  return out;
}

export function isoToBR(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return String(iso);
  return `${d}/${m}/${y.slice(2)}`;
}

export function isoToBRFull(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  if (!y || !m || !d) return String(iso);
  return `${d}/${m}/${y}`;
}

export function brToISO(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(value || '').trim());
  if (!match) return null;
  let year = Number(match[3]);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const month = Number(match[2]);
  const day = Number(match[1]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function maskDate(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 6);
  if (digits.length >= 5) return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

export function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export function dueLabel(iso) {
  const diff = daysUntil(iso);
  if (diff == null) return '';
  if (diff < 0) return `Atrasado ${Math.abs(diff)} dia${Math.abs(diff) === 1 ? '' : 's'}`;
  if (diff === 0) return 'Vence hoje';
  if (diff === 1) return 'Vence amanhã';
  return `Em ${diff} dias`;
}
