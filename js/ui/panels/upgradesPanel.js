// Panel de mejoras por categorías: vehículos (con flota), almacén, empresa y tecnología (con drones).

import { UPGRADES, UPGRADE_CATEGORIES } from '../../config/upgrades.js';
import { VEHICLES, VEHICLE_ORDER, getVehicleType } from '../../config/vehicles.js';
import { DRONE_TYPES, DRONE_ORDER } from '../../config/drones.js';
import { formatMoney } from '../../core/util.js';
import { getUpgradeStatus } from '../../systems/upgrades.js';
import { vehiclePurchaseStatus } from '../../systems/fleet.js';
import { droneStatus, droneCost } from '../../systems/drones.js';
import { getVehicleStats } from '../../systems/stats.js';
import { bar } from '../dom.js';
import { attr, buyButton, chip, pips, toKmh } from './shared.js';

export const upgradesUiState = { category: 'vehicles' };

export function renderUpgradesPanel(game) {
  const { state } = game;
  const category = upgradesUiState.category;
  const available = (id) => Object.values(UPGRADES).some((u) => u.category === id && getUpgradeStatus(game, u).state === 'available');

  let html = `<div class="panel-head"><h3>🔧 Mejoras</h3><div class="chips">${chip(`Saldo ${formatMoney(state.money)}`)}</div></div>
    <div class="subtabs" role="tablist" aria-label="Categorías de mejoras">
      ${UPGRADE_CATEGORIES.map((c) => `<button role="tab" class="subtab ${c.id === category ? 'is-active' : ''}" aria-selected="${c.id === category}" data-action="subtab" data-id="${c.id}">
        ${c.icon} ${c.name}${available(c.id) ? '<i class="dot" aria-label="Hay mejoras disponibles"></i>' : ''}</button>`).join('')}
    </div>`;

  if (category === 'vehicles') html += renderFleet(game);
  html += '<div class="cards">';
  for (const def of Object.values(UPGRADES)) {
    if (def.category === category) html += renderUpgradeCard(game, def);
  }
  html += '</div>';
  if (category === 'tech') html += renderDroneShop(game);
  return html;
}

function renderUpgradeCard(game, def) {
  const status = getUpgradeStatus(game, def);
  const { level } = status;
  const next = level < def.maxLevel ? def.describe(level + 1) : null;
  return `
    <article class="card upgrade is-${status.state}">
      <div class="card-icon" aria-hidden="true">${def.icon}</div>
      <div class="card-main">
        <h4>${def.name} ${def.maxLevel > 1 ? `<span class="lvl">Nv ${level}/${def.maxLevel}</span>` : level ? '<span class="lvl">Activa</span>' : ''}</h4>
        <p>${def.description}</p>
        <p class="effect">${level ? `Ahora: ${def.describe(level)}` : 'Sin mejorar'}${next ? ` <span class="next">→ ${next}</span>` : ''}</p>
        ${pips(level, def.maxLevel)}
      </div>
      ${buyButton({ action: 'buy-upgrade', id: def.id, status, label: level ? 'Mejorar' : 'Comprar', price: status.cost })}
    </article>`;
}

function renderFleet(game) {
  const { state, derived } = game;
  const inDepot = game.isPlayerInDepot();
  let html = `<h4 class="section-title">Tu flota ${chip(`${state.vehicles.length}/${derived.maxVehicles} plazas`, 'Compra "Plazas de garaje" para tener más vehículos')}</h4><div class="cards">`;
  for (const vehicle of state.vehicles) {
    const type = getVehicleType(vehicle.typeId);
    const stats = getVehicleStats(state, vehicle.typeId, derived);
    const isPlayer = vehicle.id === state.player.vehicleId;
    const worker = state.workers.find((w) => w.id === vehicle.driver);
    const driver = isPlayer ? 'Lo conduces tú' : worker ? `Asignado a ${worker.name}` : 'Libre en el garaje';
    const canDrive = !isPlayer && !worker;
    const reason = !canDrive ? '' : !inDepot ? 'Ve al almacén para cambiar de vehículo' : state.player.cargo.length ? 'Descarga primero los paquetes' : '';
    html += `
      <article class="card vehicle ${isPlayer ? 'is-current' : ''}">
        <div class="card-icon" aria-hidden="true">${type.icon}</div>
        <div class="card-main">
          <h4>${type.name}</h4>
          <p class="effect">${driver}</p>
          <ul class="facts compact"><li>🏁 ${toKmh(stats.maxSpeed)} km/h</li><li>🧳 ${stats.capacity} huecos</li></ul>
        </div>
        ${canDrive ? `<button class="btn ${reason ? 'is-disabled' : 'btn-primary'}" data-action="drive" data-id="${vehicle.id}" aria-disabled="${Boolean(reason)}" data-reason="${attr(reason)}" ${reason ? `data-tip="${attr(reason)}"` : ''}>Conducir</button>` : isPlayer ? '<span class="tag">En uso</span>' : ''}
      </article>`;
  }
  html += '</div><h4 class="section-title">Comprar vehículos</h4><div class="cards">';
  for (const id of VEHICLE_ORDER) {
    const type = VEHICLES[id];
    const status = vehiclePurchaseStatus(game, id);
    const maxSpeed = type.maxSpeed * (1 + 0.08 * (state.upgrades.engine ?? 0));
    html += `
      <article class="card upgrade is-${status.state}">
        <div class="card-icon" aria-hidden="true">${type.icon}</div>
        <div class="card-main">
          <h4>${type.name}</h4>
          <p>${type.description}</p>
          <div class="stat-bars">
            <div><span>Velocidad</span>${bar((maxSpeed / 260) * 100, 'bar-speed')}</div>
            <div><span>Capacidad</span>${bar(((type.capacity + (state.upgrades.cargo ?? 0)) / 20) * 100, 'bar-cargo')}</div>
            <div><span>Consumo</span>${bar((type.fuel / 2.4) * 100, 'bar-fuel')}</div>
          </div>
          <p class="effect">🧳 ${type.capacity + (state.upgrades.cargo ?? 0)} huecos · 🔧 ${formatMoney(type.upkeep)}/día</p>
        </div>
        ${buyButton({ action: 'buy-vehicle', id, status, label: 'Comprar', price: type.cost })}
      </article>`;
  }
  return `${html}</div><h4 class="section-title">Mejoras de vehículos</h4>`;
}

function renderDroneShop(game) {
  const { state, derived } = game;
  if (!derived.droneUnlocked) {
    return '<h4 class="section-title">Drones</h4><p class="muted">Investiga el Programa de drones para empezar a comprar drones.</p>';
  }
  let html = `<h4 class="section-title">Drones ${chip(`${state.drones.length}/${derived.droneCapacity} en control`, 'Amplía el Centro de control para gestionar más drones')}</h4><div class="cards">`;
  for (const id of DRONE_ORDER) {
    const type = DRONE_TYPES[id];
    const status = droneStatus(game, id);
    html += `
      <article class="card upgrade is-${status.state}">
        <div class="card-icon" aria-hidden="true">${type.icon}</div>
        <div class="card-main">
          <h4>${type.name} <span class="lvl">${state.drones.filter((d) => d.typeId === id).length} en flota</span></h4>
          <p>${type.description}</p>
          <ul class="facts compact">
            <li>💨 ${toKmh(type.speed * derived.droneSpeedMult)} km/h</li>
            <li>🧳 ${type.capacity} hueco${type.capacity > 1 ? 's' : ''}</li>
            <li>📡 ${Math.round(type.range / 32 * 12)} m</li>
            <li>🔧 ${formatMoney(type.upkeep)}/día</li>
          </ul>
        </div>
        ${buyButton({ action: 'buy-drone', id, status, label: 'Comprar', price: droneCost(state, id) })}
      </article>`;
  }
  return `${html}</div>`;
}
