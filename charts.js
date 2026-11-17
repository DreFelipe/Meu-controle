import { esc, fmtBRL, fmtCompact, monthShort } from './util.js';

export function expenseDonut(cats, centerText, size = 220, thickness = 34) {
  const total = cats.reduce((sum, c) => sum + c.total, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  let offset = 0;
  let inner = '';

  if (total > 0) {
    for (const cat of cats) {
      for (const part of [
        { value: cat.paid, opacity: 1 },
        { value: cat.pending, opacity: 0.34 }
      ]) {
        if (!(part.value > 0)) continue;
        const len = (part.value / total) * c;
        inner += `<circle r="${r}" cx="${cx}" cy="${cx}" fill="none" stroke="${esc(cat.color)}"
          stroke-opacity="${part.opacity}" stroke-width="${thickness}"
          stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
        offset += len;
      }
    }
  }

  return `<svg viewBox="0 0 ${size} ${size}" class="donut" role="img" aria-label="Despesas por categoria">
    <g transform="rotate(-90 ${cx} ${cx})">${inner}</g>
    <circle cx="${cx}" cy="${cx}" r="${r - thickness / 2}" fill="var(--card)"/>
    <text x="50%" y="46%" text-anchor="middle" class="donut-total">${esc(centerText)}</text>
    <text x="50%" y="58%" text-anchor="middle" class="donut-sub">total</text>
  </svg>`;
}

export function expenseLegend(cats) {
  if (!cats.length) return '';
  return `<div class="pie-legend">${cats.map((cat) => `
    <div class="row">
      <span class="dot" style="background:${esc(cat.color)}"></span>
      <span class="name">${esc(cat.label)}</span>
      <span class="vals">
        <b>${fmtBRL(cat.paid)}</b>
        ${cat.pending > 0 ? `<span class="pend">+ ${fmtBRL(cat.pending)} pend.</span>` : ''}
      </span>
    </div>`).join('')}</div>`;
}

export function monthlyBars(months, totalsMap) {
  if (!months.length) return '';

  const W = 560;
  const H = 240;
  const padL = 56;
  const padR = 14;
  const padT = 16;
  const padB = 32;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  let maxVal = 1;
  for (const mk of months) {
    const t = totalsMap.get(mk) || { income: 0, paid: 0, pending: 0 };
    maxVal = Math.max(maxVal, t.income, t.paid, t.pending);
  }

  const groupW = chartW / months.length;
  const barW = Math.max(4, Math.min(14, groupW * 0.18));
  const y = (value) => padT + chartH - (value / maxVal) * chartH;

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Evolução mensal">`;

  for (let i = 0; i <= 4; i += 1) {
    const yv = padT + chartH * (i / 4);
    const val = maxVal * (1 - i / 4);
    svg += `<line x1="${padL}" y1="${yv}" x2="${W - padR}" y2="${yv}" class="grid"/>`;
    svg += `<text x="${padL - 6}" y="${yv + 4}" class="grid-label" text-anchor="end">${esc(fmtCompact(val))}</text>`;
  }

  months.forEach((mk, i) => {
    const t = totalsMap.get(mk) || { income: 0, paid: 0, pending: 0 };
    const cx = padL + groupW * i + groupW / 2;
    const hIncome = Math.max(0, y(0) - y(t.income));
    const hPaid = Math.max(0, y(0) - y(t.paid));
    const hPending = Math.max(0, y(0) - y(t.pending));

    svg += `<rect x="${(cx - barW * 1.7).toFixed(2)}" y="${y(t.income).toFixed(2)}" width="${barW.toFixed(2)}" height="${hIncome.toFixed(2)}" rx="2" class="bar income"><title>Receitas: ${esc(fmtBRL(t.income))}</title></rect>`;
    svg += `<rect x="${(cx - barW / 2).toFixed(2)}" y="${y(t.paid).toFixed(2)}" width="${barW.toFixed(2)}" height="${hPaid.toFixed(2)}" rx="2" class="bar expense"><title>Despesas pagas: ${esc(fmtBRL(t.paid))}</title></rect>`;
    svg += `<rect x="${(cx + barW * 0.7).toFixed(2)}" y="${y(t.pending).toFixed(2)}" width="${barW.toFixed(2)}" height="${hPending.toFixed(2)}" rx="2" class="bar pending" stroke="var(--expense)" stroke-width="1" stroke-dasharray="3 2"><title>Despesas pendentes: ${esc(fmtBRL(t.pending))}</title></rect>`;
    svg += `<text x="${cx}" y="${H - 8}" class="grid-label" text-anchor="middle">${esc(monthShort(mk))}</text>`;
  });

  svg += '</svg>';
  return svg;
}
