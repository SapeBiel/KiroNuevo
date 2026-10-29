// Núcleo del juego: junta el estado, el mapa y los sistemas. No toca DOM ni canvas.

import { AUTOSAVE_INTERVAL, DEPOT_RADIUS, DROP_RADIUS } from '../config/constants.js';
import { ORDER_KINDS } from '../config/packages.js';
import { TUTORIAL_STEPS } from '../config/tutorial.js';
import { createCity, randomCitySeed } from '../world/cityMap.js';
import { createPathService } from '../world/pathfinding.js';
import { isInsideOffice } from '../world/depotLayout.js';
import { EventBus } from './eventBus.js';
import { createInitialState } from './state.js';
import { loadState, saveState, clearSave, peekSavedCitySeed } from './storage.js';
import { distance } from './util.js';
import { computeStats, getPlayerVehicle, getVehicleStats } from '../systems/stats.js';
import { updatePlayerVehicle } from '../systems/playerVehicle.js';
import {
  updateOrders, createFirstOrder, getOrder, loadOrder, unloadOrder, rejectOrder,
  getDeliverableOrders, canLoadOrder,
} from '../systems/orders.js';
import { MAX_EXIT_SPEED, exitVehicle, enterVehicle, updateOnFoot } from '../systems/onFoot.js';
import { doFootAction, getFootAction, getFootGuide, rackBoxes } from '../systems/handling.js';
import { updateConveyor } from '../systems/conveyor.js';
import { updatePickers } from '../systems/warehouseStaff.js';
import { buyUpgrade } from '../systems/upgrades.js';
import { buyVehicle, driveVehicle } from '../systems/fleet.js';
import { hireWorker, fireWorker, cycleWorkerVehicle, renameWorker, updateWorkers } from '../systems/workers.js';
import { buyDrone, updateDrones } from '../systems/drones.js';
import { unlockZone } from '../systems/progression.js';
import { setCompany } from '../systems/branding.js';
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
    // Conducción (throttle, steer, drift) y a pie (walkX/walkY en el mapa, giros del ratón, correr)
    this.controls = {
      throttle: 0, steer: 0, drift: false,
      walkX: 0, walkY: 0, faceMove: false, sprint: false, lookYaw: 0, lookPitch: 0, jump: false,
    };
    this.crashCooldown = 0;
    this.trackedOrderId = null;
    this.runtime = { clock: 0, incomeEvents: [], fuelDebt: 0, workers: {}, drones: {}, pickers: {} };
    this.autosaveTimer = 0;
    this.achievementTimer = 0;
    this.derived = computeStats(this.state);
    this.city.setUnlockedZones(this.state.zones);

    this.events.on('orderDelivered', (delivery) => trackMissionProgress(this, delivery));
    for (const name of ['upgradePurchased', 'workerHired', 'workerRenamed', 'companyChanged', 'vehicleBought', 'droneBought', 'zoneUnlocked', 'levelUp', 'daySummary', 'newDay']) {
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

  /** A pie dentro de la oficina del almacén: el único sitio desde el que se compran mejoras. */
  isPlayerInOffice() {
    const p = this.state.player;
    return p.mode === 'foot' && isInsideOffice(this.city.depot, p.foot.x, p.foot.y);
  }

  getDeliverableOrders() {
    return getDeliverableOrders(this);
  }

  getPlayerStats() {
    return getVehicleStats(this.state, getPlayerVehicle(this.state).typeId, this.derived);
  }

  get onFoot() {
    return this.state.player.mode === 'foot';
  }

  /** Lo que sigue la cámara: la persona a pie o el vehículo ({ x, y, angle, speed }). */
  getFocus() {
    const p = this.state.player;
    if (p.mode === 'foot') return { x: p.foot.x, y: p.foot.y, angle: p.foot.yaw, speed: 0 };
    return p;
  }

  /** Acción disponible con la tecla E en este momento (para el botón contextual). */
  getContextAction() {
    const p = this.state.player;
    if (p.mode === 'foot') {
      const found = getFootAction(this);
      return found ? { kind: found.kind, label: found.label, ok: found.ok } : null;
    }
    if (Math.abs(p.speed) > MAX_EXIT_SPEED) return null;
    const near = getDeliverableOrders(this).length > 0;
    return { kind: 'exit', ok: true, label: near ? 'Bajar y llevar el paquete a la puerta' : 'Bajar del vehículo' };
  }

  /** Siguiente paso cuando se va a pie (texto y destino), o null. */
  getFootGuide() {
    return this.onFoot ? getFootGuide(this) : null;
  }

  /** Destino al que apunta la flecha de navegación. */
  getNavigationTarget() {
    const { state, city } = this;
    const p = state.player;
    if (p.mode === 'foot') return getFootGuide(this)?.target ?? null;
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
    // Hay trabajo en el almacén: cajas en expedición o pedidos que preparar
    const waiting = rackBoxes(state).length > 0 || state.orders.some((o) => o.status === 'pending' && o.prep > 0);
    if (waiting && !this.isPlayerInDepot()) {
      const { depot } = city;
      return { x: depot.zoneCenter.x, y: depot.zoneCenter.y, kind: 'depot', order: null, color: '#ffb703', label: 'Almacén' };
    }
    return null;
  }

  /** Destino de la flecha junto al vehículo: requiere la mejora y nunca manda de vuelta al almacén. */
  getArrowTarget() {
    if (!(this.state.upgrades.guideArrow > 0) || this.onFoot) return null;
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

    if (state.player.mode === 'foot') updateOnFoot(this, dt);
    else {
      this.controls.jump = false; // al volante no se salta (y no queda un salto pendiente al bajarse)
      updatePlayerVehicle(this, dt);
    }
    updateOrders(this, dt);
    updateConveyor(this, dt);
    updatePickers(this, dt);
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

  /**
   * Tecla E. Al volante: bajarse. A pie: lo que haya delante (coger un producto, empaquetar, cargar o sacar
   * una caja del vehículo, subir a él o entregar en la puerta). Todo exige estar físicamente en el sitio.
   */
  interact() {
    if (this.paused || this.state.pendingSummary) return { ok: false };
    if (this.state.player.mode !== 'foot') return this.act(exitVehicle(this));
    return this.act(doFootAction(this));
  }

  exitVehicle() { return this.act(exitVehicle(this)); }
  enterVehicle(id) { return this.act(enterVehicle(this, id)); }

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
  /** Nombre, logotipo y colores de la empresa (la ventana muestra el error ella misma). */
  setCompany(changes) { return setCompany(this, changes); }
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
