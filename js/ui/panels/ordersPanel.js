// Panel de pedidos: lista, estado, recompensa estimada y acciones de carga.

import { ORDER_KINDS, STATUS_LABELS } from '../../config/packages.js';
import { ZONES } from '../../config/zones.js';
import { formatDistanceMeters, formatDuration, formatMoney, formatInt, pad } from '../../core/util.js';
import { compareOrders, etaSeconds, storageUsed, cargoSlotsUsed, playerCapacity } from '../../systems/orders.js';
import { rewardPreview } from '../../systems/economy.js';
import { bar } from '../dom.js';
import { attr, chip, emptyState } from './shared.js';

export function renderOrdersPanel(game) {
  const { state, city, derived } = game;
  const orders = [...state.orders].sort(compareOrders);
  const playerStats = game.getPlayerStats();
  const inDepot = game.isPlayerInDepot();
  const used = cargoSlotsUsed(game);
  const capacity = playerCapacity(game);
  const context = game.getContextAction();

  let html = `
    <div class="panel-head">
      <h3>📦 Pedidos</h3>
      <div class="chips">
        ${chip(`Activos ${state.orders.length}/${derived.maxActiveOrders}`, 'Pedidos activos / máximo permitido. Mejora "Más pedidos activos" o la sede para ampliar.')}
        ${chip(`Almacén ${storageUsed(state)}/${derived.storageCapacity}`, 'Huecos ocupados por pedidos esperando en el almacén.')}
      </div>
    </div>
    <div class="cargo-box ${used ? 'has-cargo' : ''}">
      <div class="cargo-line"><span>🚐 Tu vehículo</span><b>${used}/${capacity} huecos</b></div>
      ${bar(capacity ? (used / capacity) * 100 : 0, 'bar-cargo')}
      <p class="muted">${inDepot
    ? (context?.kind === 'load' ? `Estás en el almacén. Pulsa <kbd>E</kbd> para ${context.label.toLowerCase()}.` : 'Estás en el almacén.')
    : used ? 'Ve hasta el pin de color (también en el minimapa) y pulsa <kbd>E</kbd> en su círculo.' : 'Ve al almacén (círculo amarillo) para cargar pedidos.'}</p>
    </div>`;

  if (!orders.length) {
    html += emptyState('🛎️', 'Sin pedidos por ahora', 'Los clientes llaman enseguida. Mejora el marketing para recibir pedidos con más frecuencia.');
  } else {
    html += '<div class="cards">';
    for (const order of orders) html += renderOrderCard(game, order, playerStats, inDepot);
    html += '</div>';
  }

  if (state.recentDeliveries.length) {
    html += `<h4 class="section-title">Últimas entregas</h4><ul class="recent">
      ${state.recentDeliveries.slice(0, 5).map((r) => `<li><span>#${pad(r.number)} · ${attr(r.address)}</span><span class="by">${attr(r.by)}</span><b>+${formatInt(r.reward)} €</b></li>`).join('')}
    </ul>`;
  }
  void city;
  return html;
}

function renderOrderCard(game, order, playerStats, inDepot) {
  const { city, state } = game;
  const kind = ORDER_KINDS[order.kind];
  const building = city.getBuilding(order.buildingId);
  const zone = ZONES[order.zoneId];
  const reward = rewardPreview(game, order);
  const mine = order.assignedTo === 'player';
  const otherAssignee = order.assignedTo && !mine
    ? (state.workers.find((w) => w.id === order.assignedTo)?.name ?? state.drones.find((d) => d.id === order.assignedTo)?.name ?? 'Equipo')
    : null;

  let statusText = STATUS_LABELS[order.status];
  let statusClass = order.status;
  if (otherAssignee) { statusText = `En reparto · ${otherAssignee}`; statusClass = 'in_transit'; }
  else if (!mine && order.prep > 0) { statusText = 'Preparando'; statusClass = 'prep'; }

  const prepPercent = order.prepTotal ? (1 - order.prep / order.prepTotal) * 100 : 100;
  const tracked = game.trackedOrderId === order.id;

  let timer = '';
  if (order.timeLeft !== null) {
    const urgentClass = order.late ? 'bar-late' : order.timeLeft < 15 ? 'bar-danger' : 'bar-timer';
    timer = `<div class="timer"><span>${order.late ? '⏰ Con retraso: -45 % de recompensa' : `⏰ Quedan ${formatDuration(order.timeLeft)}`}</span>
      ${bar(order.late ? 100 : (order.timeLeft / order.timeTotal) * 100, urgentClass)}</div>`;
  }
  const prep = !mine && !otherAssignee && order.prep > 0
    ? `<div class="timer"><span>📋 Preparando pedido…</span>${bar(prepPercent, 'bar-prep')}</div>` : '';

  let actions = '';
  if (!order.assignedTo) {
    const check = game.canLoadOrder(order);
    const reason = check.ok ? '' : check.reason;
    actions = `
      <button class="btn ${check.ok ? 'btn-primary' : 'is-disabled'}" data-action="load" data-id="${order.id}" aria-disabled="${!check.ok}" data-reason="${attr(reason)}" ${reason ? `data-tip="${attr(reason)}"` : ''}>📥 Cargar</button>
      <button class="btn ${tracked ? 'is-active' : ''}" data-action="track" data-id="${order.id}" data-tip="Resaltar este destino en el mapa y en el Parcel Nav">📍 ${tracked ? 'Siguiendo' : 'Rastrear'}</button>
      <button class="btn btn-ghost" data-action="reject" data-id="${order.id}" data-tip="Descartar el pedido${order.priority === 'urgent' ? ' (pierdes 1 de reputación)' : ''}">✖</button>`;
  } else if (mine) {
    actions = `
      <button class="btn ${tracked ? 'is-active' : ''}" data-action="track" data-id="${order.id}">📍 ${tracked ? 'Siguiendo' : 'Rastrear'}</button>
      <button class="btn ${inDepot ? '' : 'is-disabled'}" data-action="unload" data-id="${order.id}" aria-disabled="${!inDepot}" data-reason="Vuelve al almacén para descargar" ${inDepot ? '' : 'data-tip="Vuelve al almacén para descargar"'}>↩ Descargar</button>`;
  }

  return `
    <article class="card order priority-${order.priority} status-${statusClass}" style="--kind:${kind.color}">
      <header class="order-head">
        <span class="badge" style="--badge:${kind.color}">${kind.icon} ${kind.short}</span>
        <span class="order-num">#${pad(order.number)}</span>
        <span class="status status-${statusClass}">${attr(statusText)}</span>
      </header>
      <h4>${attr(order.contents)}</h4>
      <p class="addr">📍 ${attr(building.name)} · ${attr(building.address)}<small> · ${attr(zone.name)}</small></p>
      <ul class="facts">
        <li data-tip="Recompensa estimada con tus mejoras y reputación actuales">💶 <b>${formatMoney(reward)}</b></li>
        <li data-tip="Distancia aproximada por carretera">📏 ${formatDistanceMeters(order.distanceM)}</li>
        <li data-tip="Tiempo estimado con tu vehículo actual">⏱ ~${formatDuration(etaSeconds(order, playerStats.maxSpeed))}</li>
        <li data-tip="Huecos de carga necesarios y peso">🧳 ${order.slots} hueco${order.slots > 1 ? 's' : ''} · ${order.weight} kg</li>
      </ul>
      ${timer}${prep}
      ${actions ? `<footer class="card-actions">${actions}</footer>` : ''}
    </article>`;
}
