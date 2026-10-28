// Panel de equipo: contratación, plantilla con su rendimiento y flota de drones.

import { WORKER_TYPES, WORKER_ORDER } from '../../config/workers.js';
import { DRONE_TYPES } from '../../config/drones.js';
import { getVehicleType } from '../../config/vehicles.js';
import { formatInt, formatMoney } from '../../core/util.js';
import { computeDailyCosts } from '../../systems/economy.js';
import { hireStatus } from '../../systems/workers.js';
import { getWorkerRuntime } from '../../systems/workers.js';
import { getDroneRuntime } from '../../systems/drones.js';
import { attr, buyButton, chip, emptyState } from './shared.js';

export const teamUiState = { firing: null, firingUntil: 0 };

export function renderTeamPanel(game) {
  const { state, derived } = game;
  const costs = computeDailyCosts(game);
  const unlockedAny = state.level >= WORKER_TYPES.courier.unlockLevel;

  let html = `<div class="panel-head"><h3>👥 Equipo</h3><div class="chips">
      ${chip(`Plantilla ${state.workers.length}/${derived.maxStaff}`, 'Amplía la sede para contratar a más personas')}
      ${chip(`Gastos diarios ${formatMoney(costs.salaries + costs.upkeep)}`, `Sueldos ${formatMoney(costs.salaries)} + mantenimiento ${formatMoney(costs.upkeep)}. Se pagan al terminar cada jornada.`)}
    </div></div>`;

  if (!unlockedAny) {
    html += emptyState('🔒', 'Contratación bloqueada', 'Alcanza el nivel 4 para contratar a tu primer empleado. Hasta entonces, el negocio depende de ti.');
  }

  html += '<h4 class="section-title">Contratar</h4><div class="cards">';
  for (const id of WORKER_ORDER) {
    const type = WORKER_TYPES[id];
    const status = hireStatus(game, id);
    html += `
      <article class="card upgrade is-${status.state}">
        <div class="card-icon" aria-hidden="true">${type.icon}</div>
        <div class="card-main">
          <h4>${type.name} <span class="lvl">${state.workers.filter((w) => w.typeId === id).length}${type.max ? `/${type.max}` : ''}</span></h4>
          <p>${type.description}</p>
          <p class="effect">💶 Sueldo: ${formatMoney(type.salary * derived.costMult)}/día</p>
        </div>
        ${buyButton({ action: 'hire', id, status, label: 'Contratar', price: status.cost })}
      </article>`;
  }
  html += '</div>';

  html += '<h4 class="section-title">Plantilla</h4>';
  if (!state.workers.length) {
    html += '<p class="muted">Todavía no has contratado a nadie.</p>';
  } else {
    html += '<div class="cards">';
    for (const worker of state.workers) html += renderWorkerCard(game, worker);
    html += '</div>';
  }

  if (derived.droneUnlocked || state.drones.length) {
    html += `<h4 class="section-title">Flota de drones ${chip(`${state.drones.length}/${derived.droneCapacity}`, 'Drones en servicio / capacidad del centro de control')}</h4>`;
    if (!state.drones.length) {
      html += '<p class="muted">Compra drones en Mejoras → Tecnología.</p>';
    } else {
      html += '<div class="cards">';
      for (const drone of state.drones) {
        const type = DRONE_TYPES[drone.typeId];
        const rt = getDroneRuntime(game, drone);
        html += `
          <article class="card worker">
            <div class="card-icon" aria-hidden="true">${type.icon}</div>
            <div class="card-main">
              <h4>${attr(drone.name)} <span class="lvl">${type.name}</span></h4>
              <p class="effect">${attr(rt.status)}</p>
              <ul class="facts compact"><li>📦 ${formatInt(drone.delivered)} entregas</li><li>💶 ${formatMoney(drone.earned)}</li><li>🔧 ${formatMoney(type.upkeep * derived.costMult)}/día</li></ul>
            </div>
          </article>`;
      }
      html += '</div>';
    }
  }
  return html;
}

function renderWorkerCard(game, worker) {
  const { state, derived } = game;
  const type = WORKER_TYPES[worker.typeId];
  const vehicle = state.vehicles.find((v) => v.id === worker.vehicleId);
  const rt = type.needsVehicle ? getWorkerRuntime(game, worker) : null;
  const stars = '★'.repeat(Math.round((worker.skill - 0.7) / 0.1)).padEnd(5, '☆').slice(0, 5);
  const confirming = teamUiState.firing === worker.id && performance.now() < teamUiState.firingUntil;
  const busy = rt && rt.phase !== 'idle';
  const status = rt ? rt.status : worker.typeId === 'picker' ? 'Preparando pedidos en el almacén' : 'Optimizando rutas de la empresa';

  return `
    <article class="card worker">
      <div class="card-icon" aria-hidden="true">${type.icon}</div>
      <div class="card-main">
        <h4>${attr(worker.name)} <span class="lvl">${type.name}</span>
          <button class="btn btn-ghost btn-sm btn-rename" data-action="rename-worker" data-id="${attr(worker.id)}"
            aria-label="Cambiar el nombre de ${attr(worker.name)}" data-tip="Cambiar nombre">✏️</button></h4>
        <p class="effect" data-tip="Habilidad: multiplica su velocidad de trabajo">${stars} · ${attr(status)}</p>
        ${type.needsVehicle ? `<p class="effect">🚐 ${vehicle ? getVehicleType(vehicle.typeId).name : 'Sin vehículo'}</p>` : ''}
        <ul class="facts compact">
          ${type.needsVehicle ? `<li>📦 ${formatInt(worker.delivered)} entregas</li><li>💶 ${formatMoney(worker.earned)}</li>` : ''}
          <li data-tip="Se paga al final de la jornada">💼 ${formatMoney(type.salary * derived.costMult)}/día</li>
        </ul>
      </div>
      <div class="card-side">
        ${type.needsVehicle ? `<button class="btn ${busy ? 'is-disabled' : ''}" data-action="cycle-vehicle" data-id="${worker.id}" aria-disabled="${Boolean(busy)}" data-reason="Está en ruta: espera a que vuelva" data-tip="Cambiar al siguiente vehículo libre">🔄</button>` : ''}
        <button class="btn ${confirming ? 'btn-danger' : 'btn-ghost'}" data-action="fire" data-id="${worker.id}">${confirming ? '¿Seguro?' : 'Despedir'}</button>
      </div>
    </article>`;
}
