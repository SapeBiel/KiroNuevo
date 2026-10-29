// Panel empresarial: finanzas, eficiencia, jornadas anteriores y expansión de la ciudad.

import { ZONES, ZONE_ORDER } from '../../config/zones.js';
import { escapeHtml, formatInt, formatMoney } from '../../core/util.js';
import { getCompany, getLogo } from '../../systems/branding.js';
import { computeDailyCosts, incomePerMinute, autoIncomePerMinute } from '../../systems/economy.js';
import { zoneStatus } from '../../systems/progression.js';
import { chip } from './shared.js';

export function renderBusinessPanel(game) {
  const { state, city } = game;
  const s = state.stats;
  const expenses = s.expenses.fuel + s.expenses.salaries + s.expenses.upkeep;
  const profit = s.totalEarned - expenses;
  const onTime = s.deliveries ? Math.round((s.onTime / s.deliveries) * 100) : 100;
  const auto = s.workerDeliveries + s.droneDeliveries;
  const autoPct = s.deliveries ? Math.round((auto / s.deliveries) * 100) : 0;
  const avg = s.deliveries ? s.totalEarned / s.deliveries : 0;
  const costs = computeDailyCosts(game);
  const d = state.dayStats;

  const kpi = (icon, label, value, tip = '', cls = '') => `
    <div class="kpi ${cls}" ${tip ? `data-tip="${tip}"` : ''}><span class="kpi-icon" aria-hidden="true">${icon}</span><div><small>${label}</small><b>${value}</b></div></div>`;

  const company = getCompany(state);
  const logo = getLogo(company.logo);
  let html = `<div class="panel-head"><h3>📊 Empresa</h3><div class="chips">${chip(`Día ${state.day}`)}</div></div>
    <article class="card brand-card">
      <div class="card-icon brand-swatch" style="background:${company.primary}" aria-hidden="true">${logo.icon}</div>
      <div class="card-main">
        <h4>${escapeHtml(company.name)}</h4>
        <p>${company.slogan ? escapeHtml(company.slogan) : 'Sin eslogan'}</p>
        <p class="effect"><span class="swatches" aria-hidden="true"><i style="background:${company.primary}"></i><i style="background:${company.secondary}"></i><i style="background:${company.accent}"></i></span>
          ${company.fleetColors ? 'Flota con los colores de la empresa' : 'Cada modelo con su pintura de serie'}</p>
      </div>
      <button class="btn btn-buy" data-action="edit-brand" data-tip="Nombre, eslogan, logotipo y colores">🎨 Personalizar</button>
    </article>
    <div class="kpis">
      ${kpi('💶', 'Ingresos totales', formatMoney(s.totalEarned), 'Dinero ganado con entregas')}
      ${kpi('🧾', 'Gastos operativos', formatMoney(expenses), `Combustible ${formatMoney(s.expenses.fuel)} · Sueldos ${formatMoney(s.expenses.salaries)} · Mantenimiento ${formatMoney(s.expenses.upkeep)}`)}
      ${kpi('📈', 'Beneficio', formatMoney(profit), 'Ingresos menos gastos operativos', profit >= 0 ? 'good' : 'bad')}
      ${kpi('🏗️', 'Inversión', formatMoney(s.investments), 'Dinero gastado en mejoras, vehículos, empleados y zonas')}
      ${kpi('📦', 'Entregas', formatInt(s.deliveries), `Tú ${formatInt(s.manualDeliveries)} · Empleados ${formatInt(s.workerDeliveries)} · Drones ${formatInt(s.droneDeliveries)}`)}
      ${kpi('✅', 'A tiempo', `${onTime} %`, 'Entregas realizadas sin retraso')}
      ${kpi('⚙️', 'Automatizado', `${autoPct} %`, 'Porcentaje de entregas hechas por empleados y drones')}
      ${kpi('⏱️', 'Ingresos/min', `${formatMoney(incomePerMinute(game))}`, `De los cuales automáticos: ${formatMoney(autoIncomePerMinute(game))}/min`)}
      ${kpi('💼', 'Gasto diario', formatMoney(costs.salaries + costs.upkeep), 'Sueldos + mantenimiento, se pagan al acabar la jornada')}
      ${kpi('🔥', 'Mejor racha', formatInt(s.bestStreak), 'Entregas seguidas a tiempo')}
      ${kpi('💵', 'Recompensa media', formatMoney(avg))}
      ${kpi('⭐', 'Reputación', `${Math.floor(state.reputation)}/100`, 'Aumenta la recompensa hasta un +40 % y acelera la llegada de pedidos')}
    </div>
    <h4 class="section-title">Hoy</h4>
    <div class="today">
      <span>📦 ${formatInt(d.deliveries)} entregas</span><span class="pos">+${formatMoney(d.income)}</span>
      <span class="neg">-${formatMoney(d.fuel + d.salaries + d.upkeep)}</span>
    </div>
    ${renderChart(state.history)}
    <h4 class="section-title">Expansión de la ciudad</h4><div class="cards">`;

  for (const id of ZONE_ORDER) {
    const zone = ZONES[id];
    const status = zoneStatus(game, id);
    const count = city.buildingsInZone(id).length;
    let action;
    if (status.state === 'unlocked') action = '<span class="tag tag-ok">Desbloqueada</span>';
    else {
      const ok = status.state === 'available';
      action = `<button class="btn ${ok ? 'btn-primary' : 'is-disabled'} btn-buy" data-action="unlock-zone" data-id="${id}" aria-disabled="${!ok}"
        data-reason="${status.reason ?? ''}" ${status.reason ? `data-tip="${status.reason}"` : ''}>${status.state === 'locked' ? `🔒 ${status.reason}` : `Abrir<small>${formatMoney(zone.unlockCost)}</small>`}</button>`;
    }
    html += `
      <article class="card upgrade is-${status.state === 'unlocked' ? 'maxed' : status.state}">
        <div class="card-icon" aria-hidden="true">${zone.icon}</div>
        <div class="card-main">
          <h4>${zone.name}</h4>
          <p>${zone.description}</p>
          <p class="effect">${count} destinos · pagos ×${zone.rewardMult.toFixed(2)}</p>
        </div>
        ${action}
      </article>`;
  }
  return `${html}</div>`;
}

function renderChart(history) {
  if (!history.length) {
    return '<p class="muted">Cuando termine tu primera jornada verás aquí la evolución de ingresos y gastos.</p>';
  }
  const days = history.slice(-7);
  const max = Math.max(1, ...days.flatMap((h) => [h.income, h.expenses]));
  const barWidth = 18;
  const gap = 10;
  const width = days.length * (barWidth * 2 + gap) + gap;
  const height = 90;
  let bars = '';
  days.forEach((h, i) => {
    const x = gap + i * (barWidth * 2 + gap);
    const hi = (h.income / max) * (height - 22);
    const he = (h.expenses / max) * (height - 22);
    bars += `<rect x="${x}" y="${height - 14 - hi}" width="${barWidth}" height="${hi}" rx="3" fill="#46c28e"><title>Día ${h.day}: ingresos ${formatMoney(h.income)}</title></rect>
      <rect x="${x + barWidth}" y="${height - 14 - he}" width="${barWidth}" height="${he}" rx="3" fill="#ff6b6b"><title>Día ${h.day}: gastos ${formatMoney(h.expenses)}</title></rect>
      <text x="${x + barWidth}" y="${height - 2}" text-anchor="middle" font-size="9" fill="#9aa7c4">D${h.day}</text>`;
  });
  return `<h4 class="section-title">Últimas jornadas <small class="legend"><i style="background:#46c28e"></i>Ingresos <i style="background:#ff6b6b"></i>Gastos</small></h4>
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Ingresos y gastos de las últimas jornadas">${bars}</svg>`;
}
