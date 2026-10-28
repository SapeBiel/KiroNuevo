// Núcleo del juego: junta el estado, el mapa y los sistemas. No toca DOM ni canvas.

import { AUTOSAVE_INTERVAL, DEPOT_RADIUS, DROP_RADIUS } from '../config/constants.js';
import { ORDER_KINDS } from '../config/packages.js';
import { TUTORIAL_STEPS } from '../config/tutorial.js';
import { createCity, randomCitySeed } from '../world/cityMap.js';
import { createPathService } from '../world/pathfinding.js';
import { EventBus } from './eventBus.js';
import { createInitialState } from './state.js';
import { loadState, saveState, clearSave, peekSavedCitySeed } from './storage.js';
import { distance } from './util.js';
import { computeStats, getPlayerVehicle, getVehicleStats } from '../systems/stats.js';
import { updatePlayerVehicle } from '../systems/playerVehicle.js';
import {
  updateOrders, createFirstOrder, getOrder, loadBest, loadOrder, unloadOrder, rejectOrder,
  deliverNearby, getDeliverableOrders, canLoadOrder, cargoSlotsUsed, playerCapacity, compareOrders,
} from '../systems/orders.js';
import { buyUpgrade } from '../systems/upgrades.js';
import { buyVehicle, driveVehicle } from '../systems/fleet.js';
import { hireWorker, fireWorker, cycleWorkerVehicle, renameWorker, updateWorkers } from '../systems/workers.js';
import { buyDrone, updateDrones } from '../systems/drones.js';
import { unlockZone } from '../systems/progression.js';
import { updateDayCycle, startNextDay } from '../systems/dayCycle.js';
import { generateMissions, trackMissionProgress } from '../systems/missions.js';
import { updateAchievements } from '../systems/achievements.js';

export class Game {
  constructor({ city, state, events = new EventBus(), persist = true } = {}) {
    this.city = city ?? createCity();
    this.paths = createPathService(this.city);
    this.state = state;
    this.events = events;
    this.persist = persist;
    this.resetting = false;
    this.paused = false;
    this.controls = { throttle: 0, steer: 0, drift: false };
    this.crashCooldown = 0;
    this.trackedOrderId = null;
    this.runtime = { clock: 0, incomeEvents: [], fuelDebt: 0, workers: {}, drones: {} };
    this.autosaveTimer = 0;
    this.achievementTimer = 0;
    this.derived = computeStats(this.state);
    this.city.setUnlockedZones(this.state.zones);

    this.events.on('orderDelivered', (delivery) => trackMissionProgress(this, delivery));
    for (const name of ['upgradePurchased', 'workerHired', 'workerRenamed', 'vehicleBought', 'droneBought', 'zoneUnlocked', 'levelUp', 'daySummary', 'newDay']) {
      this.events.on(name, () => this.save());
    }
  }

  /**
   * Crea el juego cargando la partida guardada si existe y es válida.
   * La ciudad sale de la semilla guardada; una partida nueva estrena una ciudad aleatoria
   * (o la semilla indicada, como hacen las pruebas).
   */
  static create({ loadSave = true, persist = true, seed = null } = {}) {
    const savedSeed = loadSave ? peekSavedCitySeed() : null;
    const city = createCity(seed ?? savedSeed ?? randomCitySeed());
    const saved = loadSave ? loadState(city) : null;
    const state = saved ?? createInitialState(city);
    const game = new Game({ city, state, persist });
    game.isNewGame = !saved;
    if (!saved) {
      createFirstOrder(game);
      state.missions = generateMissions(game);
    } else if (!state.missions.length && !state.pendingSummary) {
      state.missions = generateMissions(game);
    }
    return game;
  }

  recomputeStats() {
    this.derived = computeStats(this.state);
  }

  // ----------------------------------------------------------- Consultas ----

  isPlayerInDepot() {
    const { depot } = this.city;
    const p = this.state.player;
    return distance(p.x, p.y, depot.zoneCenter.x, depot.zoneCenter.y) <= DEPOT_RADIUS;
  }

  getDeliverableOrders() {
    return getDeliverableOrders(this);
  }

  getPlayerStats() {
    return getVehicleStats(this.state, getPlayerVehicle(this.state).typeId, this.derived);
  }

  /** Acción disponible con la tecla E en este momento (para el botón contextual). */
  getContextAction() {
    const deliverable = getDeliverableOrders(this);
    if (deliverable.length) {
      return { kind: 'deliver', count: deliverable.length, label: `Entregar ${deliverable.length > 1 ? `${deliverable.length} pedidos` : 'pedido'}` };
    }
    if (this.isPlayerInDepot()) {
      let used = cargoSlotsUsed(this);
      const capacity = playerCapacity(this);
      let count = 0;
      const ready = this.state.orders.filter((o) => o.status === 'pending' && !o.assignedTo && o.prep <= 0).sort(compareOrders);
      for (const order of ready) {
        if (used + order.slots <= capacity) { used += order.slots; count += 1; }
      }
      if (count) return { kind: 'load', count, label: `Cargar ${count > 1 ? `${count} paquetes` : 'paquete'}` };
    }
    return null;
  }

  /** Destino al que apunta la flecha de navegación. */
  getNavigationTarget() {
    const { state, city } = this;
    const p = state.player;
    const asTarget = (order, kind) => {
      const b = city.getBuilding(order.buildingId);
      return { x: b.dropX, y: b.dropY, kind, order, color: ORDER_KINDS[order.kind].color, label: b.address };
    };
    const cargo = p.cargo.map((id) => getOrder(state, id)).filter(Boolean);
    const tracked = this.trackedOrderId ? getOrder(state, this.trackedOrderId) : null;
    if (tracked && p.cargo.includes(tracked.id)) return asTarget(tracked, 'destination');
    if (cargo.length) {
      cargo.sort((a, b) => {
        const ba = city.getBuilding(a.buildingId);
        const bb = city.getBuilding(b.buildingId);
        return distance(p.x, p.y, ba.dropX, ba.dropY) - distance(p.x, p.y, bb.dropX, bb.dropY);
      });
      return asTarget(cargo[0], 'destination');
    }
    if (tracked) return asTarget(tracked, 'pending');
    const waiting = state.orders.some((o) => o.status === 'pending' && !o.assignedTo && o.prep <= 0);
    if (waiting && !this.isPlayerInDepot()) {
      const { depot } = city;
      return { x: depot.zoneCenter.x, y: depot.zoneCenter.y, kind: 'depot', order: null, color: '#ffb703', label: 'Almacén' };
    }
    return null;
  }

  /** Destino de la flecha junto al vehículo: requiere la mejora y nunca manda de vuelta al almacén. */
  getArrowTarget() {
    if (!(this.state.upgrades.guideArrow > 0)) return null;
    const target = this.getNavigationTarget();
    return target && target.kind !== 'depot' ? target : null;
  }

  // ---------------------------------------------------------- Simulación ----

  update(dt) {
    if (this.paused || this.state.pendingSummary || dt <= 0) return;
    const { state } = this;
    this.runtime.clock += dt;
    state.time += dt;
    this.recomputeStats();

    updatePlayerVehicle(this, dt);
    updateOrders(this, dt);
    updateWorkers(this, dt);
    updateDrones(this, dt);
    this.updateTutorial();

    this.achievementTimer += dt;
    if (this.achievementTimer >= 1) {
      this.achievementTimer = 0;
      updateAchievements(this);
    }

    updateDayCycle(this, dt);

    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_INTERVAL) this.save();
  }

  updateTutorial() {
    const t = this.state.tutorial;
    if (t.done || !t.welcomed) return;
    const step = TUTORIAL_STEPS[t.step];
    if (!step) { t.done = true; return; }
    if (step.done(this)) {
      t.step += 1;
      if (t.step >= TUTORIAL_STEPS.length) t.done = true;
      this.events.emit('tutorialStep', { step: t.step });
    }
  }

  // -------------------------------------------------------------- Acciones ----

  /** Ejecuta una acción de la interfaz y avisa del motivo si falla. */
  act(result) {
    if (!result.ok && result.reason) {
      this.events.emit('notify', { type: 'error', icon: '⛔', title: result.reason, text: '' });
      this.events.emit('actionFailed', result);
    }
    return result;
  }

  interact() {
    if (this.paused || this.state.pendingSummary) return { ok: false };
    const delivered = deliverNearby(this);
    if (delivered.length) return { ok: true, kind: 'deliver', delivered };
    if (this.isPlayerInDepot()) {
      const count = loadBest(this);
      if (count) return { ok: true, kind: 'load', count };
      const hasReady = this.state.orders.some((o) => o.status === 'pending' && !o.assignedTo && o.prep <= 0);
      return this.act({ ok: false, reason: hasReady ? 'No hay espacio en tu vehículo' : 'No hay pedidos preparados todavía' });
    }
    return this.act({ ok: false, reason: 'Aquí no hay nada que cargar ni entregar' });
  }

  loadOrder(id) { return this.act(loadOrder(this, id)); }
  unloadOrder(id) { return this.act(unloadOrder(this, id)); }
  rejectOrder(id) { return this.act(rejectOrder(this, id)); }
  canLoadOrder(order) { return canLoadOrder(this, order); }
  buyUpgrade(id) { return this.act(buyUpgrade(this, id)); }
  buyVehicle(typeId) { return this.act(buyVehicle(this, typeId)); }
  driveVehicle(id) { return this.act(driveVehicle(this, id)); }
  hireWorker(typeId) { return this.act(hireWorker(this, typeId)); }
  fireWorker(id) { return this.act(fireWorker(this, id)); }
  cycleWorkerVehicle(id) { return this.act(cycleWorkerVehicle(this, id)); }
  /** No usa act(): la ventana de renombrar muestra el error ella misma. */
  renameWorker(id, name) { return renameWorker(this, id, name); }
  buyDrone(typeId) { return this.act(buyDrone(this, typeId)); }
  unlockZone(id) { return this.act(unlockZone(this, id)); }

  trackOrder(id) {
    this.trackedOrderId = this.trackedOrderId === id ? null : id;
  }

  acknowledgeSummary() {
    startNextDay(this);
  }

  acknowledgeTutorialFinish() {
    this.state.tutorial.finishAcknowledged = true;
    this.updateTutorial();
  }

  skipTutorial() {
    this.state.tutorial.done = true;
    this.state.tutorial.welcomed = true;
    this.state.tutorial.finishAcknowledged = true;
    this.events.emit('tutorialStep', { step: -1 });
  }

  // -------------------------------------------------------------- Guardado ----

  save() {
    this.autosaveTimer = 0;
    if (!this.persist || this.resetting) return false;
    return saveState(this.state);
  }

  /** Borra la partida y deja que la página se recargue desde cero. */
  reset() {
    this.resetting = true;
    clearSave();
  }
}
