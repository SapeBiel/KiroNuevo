// Aplicación Mejoras del ordenador de la oficina. Empieza en "Recomendadas" (lo que se puede comprar ya, lo que
// está casi al alcance y lo próximo que se desbloquea) y tiene una pestaña por categoría. Dentro de cada
// categoría las tarjetas se agrupan por estado: disponibles, falta dinero, bloqueadas y completadas.

import { UPGRADES, UPGRADE_CATEGORIES } from '../../config/upgrades.js';
import { VEHICLES, VEHICLE_ORDER, getVehicleType } from '../../config/vehicles.js';
import { DRONE_TYPES, DRONE_ORDER } from '../../config/drones.js';
import { formatMoney } from '../../core/util.js';
import { getUpgradeStatus, isUpgradeReady, requiredLevelFor } from '../../systems/upgrades.js';
import { vehiclePurchaseStatus } from '../../systems/fleet.js';
import { droneStatus, droneCost } from '../../systems/drones.js';
import { getVehicleStats } from '../../systems/stats.js';
import { bar } from '../dom.js';
import { attr, buyButton, chip, emptyState, pips, toKmh } from './shared.js';

export const upgradesUiState = { category: 'recommended' };

const CATEGORY_INTROS = {
  vehicles: 'Hacen más rápidos, ágiles y espaciosos todos tus vehículos, también los de tus repartidores.',
  fleet: 'Tus vehículos y los que puedes comprar. Cada repartidor necesita un vehículo libre.',
  warehouse: 'Más espacio para paquetes, preparación más rápida y una sede mayor para tener más empleados.',
  business: 'Más pedidos a la vez, más clientes, mejores recompensas y gastos más bajos.',
  tech: 'Automatización y drones para que la empresa reparta sola.',
};

// Pestañas: Recomendadas, las categorías del catálogo y la flota (comprar vehículos) aparte de sus mejoras
const TABS = [
  { id: 'recommended', name: 'Recomendadas', icon: '⭐', intro: 'Lo que puedes comprar ya, lo que tienes casi al alcance y lo próximo que se desbloquea al subir de nivel.' },
  ...UPGRADE_CATEGORIES.flatMap((c) => {
    const tab = { ...c, intro: CATEGORY_INTROS[c.id] ?? '' };
    return c.id === 'vehicles' ? [tab, { id: 'fleet', name: 'Flota', icon: '🚚', intro: CATEGORY_INTROS.fleet }] : [tab];
  }),
];

function categoryOf(id) {
  return UPGRADE_CATEGORIES.find((c) => c.id === id);
}

/** Estado de una mejora con lo que hace falta para mostrarla y ordenarla. */
function entriesOf(game, defs) {
  return defs.map((def) => {
    const status = getUpgradeStatus(game, def);
    return { def, status, ready: isUpgradeReady(status) };
  });
}

export function renderUpgradesPanel(game) {
  const { state } = game;
  if (!TABS.some((t) => t.id === upgradesUiState.category)) upgradesUiState.category = 'recommended';
  const category = upgradesUiState.category;
  const all = entriesOf(game, Object.values(UPGRADES));
  const readyIn = (id) => all.filter((e) => e.ready && e.def.category === id).length;
  const fleetReady = VEHICLE_ORDER.filter((id) => vehiclePurchaseStatus(game, id).state === 'available').length;
  const counts = {
    recommended: all.filter((e) => e.ready).length,
    fleet: fleetReady,
    ...Object.fromEntries(UPGRADE_CATEGORIES.map((c) => [c.id, readyIn(c.id)])),
  };
  const tab = TABS.find((t) => t.id === category);
  const inOffice = game.isPlayerInOffice();

  let html = `<div class="panel-head"><h3>🔧 Mejoras</h3><div class="chips">
      ${chip(`💶 Saldo ${formatMoney(state.money)}`)}
      ${chip(`✅ ${counts.recommended} para comprar`, 'Mejoras que puedes pagar ahora mismo')}
      ${chip(`⭐ Nivel ${state.level}`, 'Al subir de nivel se desbloquean más mejoras')}
    </div></div>
    ${inOffice ? '' : '<p class="callout" role="note">🏢 Las mejoras solo se compran desde el ordenador de la oficina del almacén (esquina del fondo a la izquierda).</p>'}
    <div class="subtabs" role="tablist" aria-label="Categorías de mejoras">
      ${TABS.map((t) => `<button role="tab" class="subtab ${t.id === category ? 'is-active' : ''}" aria-selected="${t.id === category}" data-action="subtab" data-id="${t.id}">
        <span aria-hidden="true">${t.icon}</span> ${t.name}${counts[t.id] ? `<i class="count" aria-label="${counts[t.id]} disponibles">${counts[t.id]}</i>` : ''}</button>`).join('')}
    </div>
    <p class="panel-intro muted">${tab.intro}</p>`;

  if (category === 'recommended') html += renderRecommended(game, all);
  else if (category === 'fleet') html += renderFleet(game);
  else html += renderCategory(game, all.filter((e) => e.def.category === category));
  if (category === 'tech') html += renderDroneShop(game);
  return html;
}

// ------------------------------------------------------------ Vistas ----

function section(icon, title, count, body, hint = '') {
  return `<h4 class="section-title"><span aria-hidden="true">${icon}</span> ${title}${count ? ` <span class="chip">${count}</span>` : ''}${hint ? `<span class="legend">${hint}</span>` : ''}</h4>${body}`;
}

const cards = (list, opts) => `<div class="cards">${list.map((e) => renderUpgradeCard(e, opts)).join('')}</div>`;

function renderRecommended(game, all) {
  const { state } = game;
  const ready = all.filter((e) => e.ready).sort((a, b) => a.status.cost - b.status.cost);
  const poor = all.filter((e) => e.status.state === 'poor')
    .sort((a, b) => (a.status.cost - state.money) - (b.status.cost - state.money)).slice(0, 3);
  // Lo próximo que se desbloquea por nivel (no las que dependen de otra mejora)
  const soon = all
    .filter((e) => e.status.state === 'locked' && !e.status.officeOnly && /nivel/i.test(e.status.reason) && !/Requiere:/.test(e.status.reason))
    .map((e) => ({ ...e, needed: requiredLevelFor(e.def, e.status.level) }))
    .sort((a, b) => a.needed - b.needed || a.status.cost - b.status.cost)
    .slice(0, 3);
  const opts = { game, showCategory: true };
  let html = '';
  if (ready.length) html += section('✅', 'Puedes comprarlas ya', ready.length, cards(ready, opts), 'Las más baratas primero');
  else html += emptyState('💰', 'Ahora mismo no te llega para ninguna', 'Haz entregas para ganar dinero: abajo tienes las que están más cerca.');
  if (poor.length) html += section('💶', 'Casi al alcance', 0, cards(poor, opts), 'Lo que te falta para cada una');
  if (soon.length) html += section('🔓', 'Se desbloquean pronto', 0, cards(soon, opts), `Ahora estás en el nivel ${state.level}`);
  return html;
}

function renderCategory(game, entries) {
  const groups = [
    { icon: '✅', title: 'Disponibles', list: entries.filter((e) => e.ready).sort((a, b) => a.status.cost - b.status.cost) },
    { icon: '💶', title: 'Te falta dinero', list: entries.filter((e) => e.status.state === 'poor').sort((a, b) => a.status.cost - b.status.cost) },
    { icon: '🔒', title: 'Bloqueadas', list: entries.filter((e) => e.status.state === 'locked' && !e.ready) },
  ];
  const opts = { game, showCategory: false };
  let html = '';
  for (const g of groups) if (g.list.length) html += section(g.icon, g.title, g.list.length, cards(g.list, opts));
  const done = entries.filter((e) => e.status.state === 'maxed');
  if (done.length) {
    html += section('🏁', 'Completadas', done.length, `<ul class="done-list">${done.map(({ def }) => `
      <li class="done-chip" data-tip="${attr(def.describe(def.maxLevel))}"><span aria-hidden="true">${def.icon}</span> ${def.name} · ✓</li>`).join('')}</ul>`);
  }
  if (!html) html = emptyState('🔧', 'Nada en esta categoría', '');
  return html;
}

/** Tarjeta de una mejora: qué hace, qué cambia al comprarla, cuánto cuesta y qué falta si no se puede. */
function renderUpgradeCard({ def, status, ready }, { game, showCategory }) {
  const { state } = game;
  const { level } = status;
  const maxed = status.state === 'maxed';
  const next = level < def.maxLevel ? def.describe(level + 1) : null;
  const category = showCategory ? categoryOf(def.category) : null;
  const levelTag = def.maxLevel > 1 ? `<span class="lvl">Nv ${level}/${def.maxLevel}</span>` : level ? '<span class="lvl">Activa</span>' : '';
  const change = maxed
    ? `<p class="effect">✓ ${def.describe(level)}</p>`
    : `<p class="effect"><span class="now">${level ? `Ahora: ${def.describe(level)}` : 'Aún no la tienes'}</span> <span class="next">→ ${next}</span></p>`;

  // Qué falta: dinero (con barra de progreso) o requisito
  let need = '';
  if (status.state === 'poor') {
    need = `<div class="save"><span>Tienes ${formatMoney(state.money)} de ${formatMoney(status.cost)} · te faltan <b>${formatMoney(status.cost - state.money)}</b></span>
      ${bar((state.money / Math.max(1, status.cost)) * 100, 'bar-cargo')}</div>`;
  } else if (status.state === 'locked' && !status.officeOnly) {
    const levelLock = /nivel/i.test(status.reason) && !/Requiere:/.test(status.reason);
    const text = levelLock
      ? `Se desbloquea en el nivel ${requiredLevelFor(def, level)} <span class="muted">(ahora estás en el ${state.level})</span>`
      : `Primero necesitas <b>${attr(status.reason.replace(/^Requiere:\s*/, ''))}</b>`;
    need = `<p class="need">🔒 ${text}</p>`;
  }

  return `
    <article class="card upgrade is-${ready ? 'available' : status.state}">
      <div class="card-icon" aria-hidden="true">${def.icon}</div>
      <div class="card-main">
        <h4>${def.name} ${levelTag}${category ? `<span class="cat-tag">${category.icon} ${category.name}</span>` : ''}</h4>
        <p>${def.description}</p>
        ${change}
        ${pips(level, def.maxLevel)}
        ${need}
      </div>
      ${buyButton({ action: 'buy-upgrade', id: def.id, status, label: level ? 'Mejorar' : 'Comprar', price: status.cost })}
    </article>`;
}

function renderFleet(game) {
  const { state, derived } = game;
  let html = section('🚐', 'Tu flota', 0, '', `${state.vehicles.length}/${derived.maxVehicles} plazas de garaje`);
  html += '<div class="cards">';
  for (const vehicle of state.vehicles) {
    const type = getVehicleType(vehicle.typeId);
    const stats = getVehicleStats(state, vehicle.typeId, derived);
    const isPlayer = vehicle.id === state.player.vehicleId;
    const worker = state.workers.find((w) => w.id === vehicle.driver);
    const driver = isPlayer ? 'Lo conduces tú' : worker ? `Lo conduce ${worker.name}` : 'Libre en el patio del almacén';
    const canDrive = !isPlayer && !worker;
    // Se cambia de vehículo en persona: andando hasta una de sus puertas delanteras y pulsando E
    const reason = 'Ve andando hasta él (patio del almacén) y pulsa E junto a una de sus puertas delanteras';
    html += `
      <article class="card vehicle ${isPlayer ? 'is-current' : ''}">
        <div class="card-icon" aria-hidden="true">${type.icon}</div>
        <div class="card-main">
          <h4>${type.name}</h4>
          <p class="effect">${driver}</p>
          <ul class="facts compact"><li>🏁 ${toKmh(stats.maxSpeed)} km/h</li><li>🧳 ${stats.capacity} huecos</li></ul>
        </div>
        ${canDrive ? `<span class="tag" data-tip="${attr(reason)}">🅿️ En el patio</span>` : isPlayer ? '<span class="tag">En uso</span>' : '<span class="tag">Repartidor</span>'}
      </article>`;
  }
  html += '</div>';
  if (state.vehicles.length >= derived.maxVehicles) {
    html += '<p class="callout warn">🅿️ El garaje está lleno. Compra <b>Plazas de garaje</b> en la pestaña Vehículos para tener más.</p>';
  }
  html += section('🛒', 'Comprar vehículos', 0, '', 'Cada repartidor necesita uno libre');
  html += '<div class="cards">';
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
  return `${html}</div>`;
}

function renderDroneShop(game) {
  const { state, derived } = game;
  if (!derived.droneUnlocked) {
    return section('🛸', 'Drones', 0, '<p class="muted">Investiga el <b>Programa de drones</b> (arriba) para empezar a comprar drones.</p>');
  }
  let html = section('🛸', 'Drones', 0, '', `${state.drones.length}/${derived.droneCapacity} en el centro de control`);
  html += '<div class="cards">';
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
