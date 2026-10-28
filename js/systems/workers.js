// Empleados: contratación y simulación de los repartidores automáticos.

import { TILE } from '../config/constants.js';
import { WORKER_TYPES, FIRST_NAMES } from '../config/workers.js';
import { formatMoney, distance } from '../core/util.js';
import { allocateId } from '../core/state.js';
import { pointAlongRoute } from '../world/pathfinding.js';
import { chargeFuel, spend } from './economy.js';
import { completeDelivery, compareOrders, isAvailableForAutomation } from './orders.js';
import { getVehicleStats, countWorkers } from './stats.js';
import { freeVehicles } from './fleet.js';

export function hireCost(state, typeId) {
  const type = WORKER_TYPES[typeId];
  return Math.round((type.cost * Math.pow(type.costGrowth, countWorkers(state, typeId))) / 5) * 5;
}

export function hireStatus(game, typeId) {
  const { state, derived } = game;
  const type = WORKER_TYPES[typeId];
  const cost = hireCost(state, typeId);
  if (state.level < type.unlockLevel) return { state: 'locked', cost, reason: `Requiere nivel ${type.unlockLevel}` };
  if (type.max && countWorkers(state, typeId) >= type.max) return { state: 'maxed', cost, reason: 'Máximo alcanzado' };
  if (state.workers.length >= derived.maxStaff) return { state: 'locked', cost, reason: 'Sede llena: amplía la sede' };
  if (type.needsVehicle && freeVehicles(state).length === 0) return { state: 'locked', cost, reason: 'Necesita un vehículo libre (compra uno en Mejoras)' };
  if (state.money < cost) return { state: 'poor', cost, reason: `Te faltan ${formatMoney(cost - state.money)}` };
  return { state: 'available', cost, reason: '' };
}

function uniqueName(state) {
  const used = new Set(state.workers.map((w) => w.name));
  const pool = FIRST_NAMES.filter((n) => !used.has(n));
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  return `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${state.workers.length + 1}`;
}

export function hireWorker(game, typeId) {
  const { state } = game;
  const type = WORKER_TYPES[typeId];
  if (!type) return { ok: false, reason: 'Tipo de empleado desconocido' };
  const status = hireStatus(game, typeId);
  if (status.state !== 'available') return { ok: false, reason: status.reason };
  if (!spend(game, status.cost)) return { ok: false, reason: 'Fondos insuficientes' };

  const worker = {
    id: allocateId(state, 'w'),
    typeId,
    name: uniqueName(state),
    skill: Math.round((0.85 + Math.random() * 0.35) * 100) / 100,
    delivered: 0,
    earned: 0,
    vehicleId: null,
    hiredDay: state.day,
  };
  if (type.needsVehicle) {
    const vehicle = freeVehicles(state).sort((a, b) => getVehicleStats(state, b.typeId, game.derived).capacity - getVehicleStats(state, a.typeId, game.derived).capacity)[0];
    vehicle.driver = worker.id;
    worker.vehicleId = vehicle.id;
  }
  state.workers.push(worker);
  game.recomputeStats();
  game.events.emit('workerHired', { worker, type });
  return { ok: true, worker };
}

function releaseOrders(game, workerId) {
  for (const order of game.state.orders) {
    if (order.assignedTo === workerId) {
      order.assignedTo = null;
      order.status = 'pending';
    }
  }
}

export function fireWorker(game, workerId) {
  const { state } = game;
  const worker = state.workers.find((w) => w.id === workerId);
  if (!worker) return { ok: false, reason: 'Empleado inexistente' };
  releaseOrders(game, workerId);
  const vehicle = state.vehicles.find((v) => v.id === worker.vehicleId);
  if (vehicle) vehicle.driver = null;
  state.workers = state.workers.filter((w) => w.id !== workerId);
  delete game.runtime.workers[workerId];
  game.recomputeStats();
  game.events.emit('workerFired', { worker });
  return { ok: true };
}

export const MAX_WORKER_NAME = 18;

/** Limpia un nombre escrito por el jugador: sin caracteres de control, espacios simples y longitud máxima. */
export function sanitizeWorkerName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_WORKER_NAME);
}

export function renameWorker(game, workerId, rawName) {
  const { state } = game;
  const worker = state.workers.find((w) => w.id === workerId);
  if (!worker) return { ok: false, reason: 'Empleado inexistente' };
  const name = sanitizeWorkerName(rawName);
  if (!name) return { ok: false, reason: 'Escribe un nombre' };
  const taken = state.workers.some((w) => w.id !== workerId && w.name.toLowerCase() === name.toLowerCase());
  if (taken) return { ok: false, reason: 'Ya hay otro empleado con ese nombre' };
  const previous = worker.name;
  worker.name = name;
  game.events.emit('workerRenamed', { worker, previous });
  return { ok: true, worker };
}

/** Pasa al siguiente vehículo libre de la flota (solo si el repartidor está parado en el almacén). */
export function cycleWorkerVehicle(game, workerId) {
  const { state } = game;
  const worker = state.workers.find((w) => w.id === workerId);
  if (!worker || !WORKER_TYPES[worker.typeId].needsVehicle) return { ok: false, reason: 'No necesita vehículo' };
  const rt = game.runtime.workers[workerId];
  if (rt && rt.phase !== 'idle') return { ok: false, reason: 'Está en ruta: espera a que vuelva' };
  const options = freeVehicles(state);
  if (!options.length) return { ok: false, reason: 'No hay vehículos libres' };
  const current = state.vehicles.find((v) => v.id === worker.vehicleId);
  if (current) current.driver = null;
  const next = options.find((v) => v.id !== worker.vehicleId) ?? options[0];
  next.driver = worker.id;
  worker.vehicleId = next.id;
  return { ok: true };
}

// ------------------------------------------------------------ Simulación ----

export function getWorkerRuntime(game, worker) {
  let rt = game.runtime.workers[worker.id];
  if (!rt) {
    rt = { phase: 'idle', timer: 0, scanTimer: Math.random(), route: null, travelled: 0, orders: [], stopIndex: 0, x: 0, y: 0, angle: 0, status: 'Esperando pedidos' };
    game.runtime.workers[worker.id] = rt;
  }
  return rt;
}

function planTrip(game, capacity) {
  const { state, city, derived } = game;
  const eligible = state.orders.filter((o) => o.kind !== 'fragile' && isAvailableForAutomation(game, o)).sort(compareOrders);
  const first = eligible.find((o) => o.slots <= capacity);
  if (!first) return [];
  const chosen = [first];
  let used = first.slots;
  while (chosen.length < derived.maxStops) {
    const last = city.getBuilding(chosen[chosen.length - 1].buildingId);
    const options = eligible
      .filter((o) => !chosen.includes(o) && used + o.slots <= capacity)
      .map((o) => ({ o, d: distance(last.dropX, last.dropY, city.getBuilding(o.buildingId).dropX, city.getBuilding(o.buildingId).dropY) }))
      .filter((x) => x.d < 16 * TILE)
      .sort((a, b) => a.d - b.d);
    if (!options.length) break;
    chosen.push(options[0].o);
    used += options[0].o.slots;
  }
  return chosen;
}

export function updateWorkers(game, dt) {
  const { state, city, derived } = game;
  const depot = city.depot;
  for (const worker of state.workers) {
    if (!WORKER_TYPES[worker.typeId].needsVehicle) continue;
    const rt = getWorkerRuntime(game, worker);
    const vehicle = state.vehicles.find((v) => v.id === worker.vehicleId);
    if (!vehicle) {
      rt.status = 'Sin vehículo asignado';
      continue;
    }
    const vstats = getVehicleStats(state, vehicle.typeId, derived);
    const efficiency = worker.skill * derived.staffEfficiency;

    if (rt.phase === 'idle') {
      rt.x = depot.dropX; rt.y = depot.dropY; rt.angle = 0;
      rt.scanTimer -= dt;
      if (rt.scanTimer > 0) { rt.status = 'Esperando pedidos'; continue; }
      rt.scanTimer = 0.6;
      const trip = planTrip(game, vstats.capacity);
      if (!trip.length) { rt.status = 'Esperando pedidos'; continue; }
      for (const order of trip) { order.assignedTo = worker.id; order.status = 'picked'; }
      rt.orders = trip;
      rt.phase = 'loading';
      rt.timer = 2.5 / efficiency;
      rt.status = 'Cargando paquetes';
    } else if (rt.phase === 'loading') {
      rt.timer -= dt;
      if (rt.timer > 0) continue;
      const waypoints = [{ x: depot.dropX, y: depot.dropY }];
      for (const order of rt.orders) {
        const b = city.getBuilding(order.buildingId);
        waypoints.push({ x: b.dropX, y: b.dropY });
      }
      waypoints.push({ x: depot.dropX, y: depot.dropY });
      const route = game.paths.routeThrough(waypoints);
      if (!route) {
        releaseOrders(game, worker.id);
        rt.phase = 'idle';
        continue;
      }
      rt.route = route;
      rt.travelled = 0;
      rt.stopIndex = 0;
      rt.phase = 'driving';
      rt.status = 'En reparto';
      for (const order of rt.orders) order.status = 'in_transit';
    } else if (rt.phase === 'driving') {
      const speed = vstats.maxSpeed * 0.8 * efficiency;
      const target = rt.route.stopDistances[rt.stopIndex];
      const step = Math.min(speed * dt, Math.max(0, target - rt.travelled));
      rt.travelled += step;
      chargeFuel(game, step, vstats.fuelPerTile);
      const pose = pointAlongRoute(rt.route, rt.travelled);
      rt.x = pose.x; rt.y = pose.y; rt.angle = pose.angle;
      if (rt.travelled >= target - 0.01) {
        if (rt.stopIndex >= rt.orders.length) {
          rt.phase = 'idle';
          rt.route = null;
          rt.orders = [];
          rt.x = depot.dropX; rt.y = depot.dropY;
          rt.status = 'Esperando pedidos';
        } else {
          rt.phase = 'dropping';
          rt.timer = 1.2 / efficiency;
          rt.status = 'Entregando';
        }
      }
    } else if (rt.phase === 'dropping') {
      rt.timer -= dt;
      if (rt.timer > 0) continue;
      const order = rt.orders[rt.stopIndex];
      completeDelivery(game, order, { type: 'worker', worker });
      rt.stopIndex += 1;
      rt.phase = 'driving';
      rt.status = rt.stopIndex >= rt.orders.length ? 'Volviendo al almacén' : 'En reparto';
    }
  }
}
