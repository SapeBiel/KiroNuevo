// Empleados: contratación y simulación de los repartidores automáticos.

import { TILE } from '../config/constants.js';
import { WORKER_TYPES, FIRST_NAMES } from '../config/workers.js';
import { getVehicleType } from '../config/vehicles.js';
import { formatMoney, distance, normalizeAngle } from '../core/util.js';
import { allocateId } from '../core/state.js';
import { pointAlongRoute } from '../world/pathfinding.js';
import { depotLayout } from '../world/depotLayout.js';
import { depotPath } from '../world/depotNav.js';
import { deliveryDoorPoint } from '../world/lotLayout.js';
import { parkingSpotOf, vehiclePoints } from './onFoot.js';
import { chargeFuel, spend } from './economy.js';
import { completeDelivery, compareOrders, isAvailableForAutomation, automationIdleReason } from './orders.js';
import { getVehicleStats, countWorkers } from './stats.js';
import { freeVehicles } from './fleet.js';
import { releasePickerWork } from './warehouseStaff.js';

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
  if (type.needsVehicle && freeVehicles(state).length === 0) return { state: 'locked', cost, reason: 'Necesita un vehículo libre (cómpralo en Mejoras → Flota)' };
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
  // Un preparador deja sus productos en el cajón de la cinta y su caja en expedición
  if (worker.typeId === 'picker') releasePickerWork(game, workerId);
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

// Los repartidores trabajan a la vista: bajan de su furgoneta aparcada, entran en el almacén, cogen las cajas
// de expedición, las meten por la trasera, suben, salen de la plaza y se van. En cada destino aparcan, llevan
// la caja andando hasta la puerta y vuelven; al terminar regresan a su plaza del patio.
// Runtime (no se guarda): rt.x/y/angle es la furgoneta cuando está en la calle; rt.walker la persona a pie
// (o null si va dentro); rt.atSpot indica que la furgoneta sigue en su plaza; rt.hands, las cajas que lleva.
const COURIER_WALK = 72; // px/s (con prisa: algo más rápido que andar)
const BOX_TIME = 0.6; // coger las cajas de la estantería
const LOAD_TIME = 0.7; // meterlas en la trasera
const DOOR_TIME = 0.6; // entregar en la puerta
const BOARD_TIME = 0.35; // subir o bajar de la furgoneta
const PULL_SPEED = 60; // px/s al salir de la plaza o al aparcar
const PULL_REACH = 30; // px que avanza recto antes de girar al salir (o antes de parar al aparcar)

export function getWorkerRuntime(game, worker) {
  let rt = game.runtime.workers[worker.id];
  if (!rt) {
    rt = {
      phase: 'idle', timer: 0, scanTimer: Math.random(), route: null, travelled: 0, orders: [], stopIndex: 0,
      x: 0, y: 0, angle: 0, status: 'Esperando pedidos',
      walker: null, after: null, atSpot: false, spot: null, hands: [], pull: null,
    };
    game.runtime.workers[worker.id] = rt;
  }
  return rt;
}

/** Cajas que lleva en las manos un repartidor (para dibujarlas). */
export function courierLoad(game, worker) {
  const rt = game.runtime.workers?.[worker.id];
  if (!rt?.walker || !rt.hands?.length) return [];
  return rt.hands.map((id) => game.state.orders.find((o) => o.id === id)).filter(Boolean);
}

/** Cajas reservadas por un repartidor que todavía no ha cogido: siguen a la vista en expedición. */
export function reservedOnRack(game) {
  const out = [];
  for (const worker of game.state.workers) {
    const rt = game.runtime.workers?.[worker.id];
    if (!rt || !(rt.phase === 'pickBoxes' || (rt.phase === 'walking' && rt.after === 'pickBoxes'))) continue;
    for (const order of rt.orders) if (game.state.orders.includes(order)) out.push(order);
  }
  return out;
}

// ------------------------------------------------------------ A pie ----

function spawnWalker(rt, at, yaw) {
  rt.walker = { x: at.x, y: at.y, yaw, path: [], anim: 'idle', animTime: 0, moving: 0 };
}

function walkTo(rt, path, after, status) {
  rt.walker.path = path.map((p) => ({ x: p.x, y: p.y }));
  rt.walker.anim = 'walk';
  rt.after = after;
  rt.phase = 'walking';
  if (status) rt.status = status;
}

function faceToward(walker, x, y) {
  walker.yaw = Math.atan2(y - walker.y, x - walker.x);
}

/** Avanza por el camino; devuelve true al llegar al final. */
function stepWalker(walker, speed, dt) {
  let step = speed * dt;
  const startX = walker.x;
  const startY = walker.y;
  while (step > 0 && walker.path.length) {
    const next = walker.path[0];
    const d = distance(walker.x, walker.y, next.x, next.y);
    if (d <= step) {
      walker.x = next.x; walker.y = next.y; step -= d; walker.path.shift();
    } else {
      walker.x += ((next.x - walker.x) / d) * step;
      walker.y += ((next.y - walker.y) / d) * step;
      step = 0;
    }
  }
  const moved = distance(startX, startY, walker.x, walker.y);
  walker.moving = dt > 0 ? moved / dt : 0;
  if (moved > 0.01) {
    const target = Math.atan2(walker.y - startY, walker.x - startX);
    walker.yaw += normalizeAngle(target - walker.yaw) * Math.min(1, dt * 12);
  }
  return walker.path.length === 0;
}

/**
 * Recorrido a pie entre la plaza del patio y expedición. Desde la primera fila se va recto hacia la
 * fachada; desde la segunda, por el pasillo entre filas hasta pasar los vehículos aparcados.
 */
function yardRoute(game, spot, vehicle) {
  const depot = game.city.depot;
  const L = depotLayout(depot);
  const points = vehiclePoints(spot.x, spot.y, spot.angle, getVehicleType(vehicle.typeId));
  const backRow = spot.y > depot.lot.y + 30;
  const aisleY = points.cab.y;
  const exitX = backRow ? depot.lot.x + 92 : points.cab.x;
  const inside = { x: exitX, y: L.inner.y1 - 8 };
  const yardToInside = [...(backRow ? [{ x: exitX, y: aisleY }] : []), inside];
  return {
    ...points,
    toRack: [...yardToInside, ...depotPath(game.city, inside, L.rack.stand)],
    toRear: [...depotPath(game.city, L.rack.stand, inside), { x: exitX, y: aisleY }, { x: points.rear.x, y: aisleY }, points.rear],
    toCab: [{ x: points.rear.x, y: aisleY }, points.cab],
    rackFace: { x: L.rack.rect.x0, y: (L.rack.rect.y0 + L.rack.rect.y1) / 2 },
  };
}

// ------------------------------------------------------------ Maniobras ----

/** Curva suave para salir de la plaza hasta la calzada (o al revés para aparcar). */
function makePull(from, to, angle, leaving) {
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  // Al salir se avanza recto desde la plaza; al aparcar se llega recto hasta ella
  const control = leaving
    ? { x: from.x + fx * PULL_REACH, y: from.y + fy * PULL_REACH }
    : { x: to.x - fx * PULL_REACH, y: to.y - fy * PULL_REACH };
  const length = distance(from.x, from.y, control.x, control.y) + distance(control.x, control.y, to.x, to.y);
  return { from, control, to, t: 0, length: Math.max(1, length) };
}

function stepPull(rt, dt) {
  const pull = rt.pull;
  pull.t = Math.min(1, pull.t + (PULL_SPEED * dt) / pull.length);
  const t = pull.t;
  const u = 1 - t;
  const { from: a, control: c, to: b } = pull;
  rt.x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
  rt.y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
  const dx = 2 * u * (c.x - a.x) + 2 * t * (b.x - c.x);
  const dy = 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y);
  if (Math.abs(dx) + Math.abs(dy) > 1e-6) rt.angle = Math.atan2(dy, dx);
  return t >= 1;
}

function startTrip(game, worker, rt) {
  const { state, city } = game;
  const depot = city.depot;
  const waypoints = [{ x: depot.dropX, y: depot.dropY }];
  for (const order of rt.orders) {
    const b = city.getBuilding(order.buildingId);
    waypoints.push({ x: b.dropX, y: b.dropY });
  }
  waypoints.push({ x: depot.dropX, y: depot.dropY });
  const route = game.paths.routeThrough(waypoints);
  if (!route) {
    // Sin camino: se aparta el pedido un rato para no reintentar el mismo viaje en bucle (la caja vuelve a expedición)
    for (const order of rt.orders) order.autoSkipUntil = state.time + 30;
    releaseOrders(game, worker.id);
    rt.orders = [];
    rt.hands = [];
    rt.phase = 'idle';
    return false;
  }
  rt.route = route;
  rt.travelled = 0;
  rt.stopIndex = 0;
  rt.status = 'En reparto';
  for (const order of rt.orders) order.status = 'in_transit';
  return true;
}

function finishAtDepot(rt) {
  rt.phase = 'idle';
  rt.route = null;
  rt.orders = [];
  rt.hands = [];
  rt.walker = null;
  rt.pull = null;
  rt.yard = null;
  rt.atSpot = false;
  rt.scanTimer = 0; // busca el siguiente viaje en cuanto llega
  rt.status = 'Esperando pedidos';
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

/**
 * Vehículo del repartidor. Si no tiene (partida antigua, vehículo liberado...) coge el libre con más
 * capacidad; así no se queda parado en el almacén habiendo furgonetas aparcadas.
 */
function ensureWorkerVehicle(game, worker) {
  const { state } = game;
  const current = state.vehicles.find((v) => v.id === worker.vehicleId);
  if (current && (current.driver === worker.id || !current.driver)) {
    current.driver = worker.id;
    return current;
  }
  worker.vehicleId = null;
  const free = freeVehicles(state)
    .sort((a, b) => getVehicleStats(state, b.typeId, game.derived).capacity - getVehicleStats(state, a.typeId, game.derived).capacity)[0];
  if (!free) return null;
  free.driver = worker.id;
  delete free.park; // deja de estar aparcado donde lo dejó el jugador
  worker.vehicleId = free.id;
  return free;
}

export function updateWorkers(game, dt) {
  const { state, city, derived } = game;
  const depot = city.depot;
  for (const worker of state.workers) {
    if (!WORKER_TYPES[worker.typeId].needsVehicle) continue;
    const rt = getWorkerRuntime(game, worker);
    const vehicle = ensureWorkerVehicle(game, worker);
    if (!vehicle) {
      rt.status = 'Sin vehículo: compra uno o deja libre alguno';
      continue;
    }
    const vstats = getVehicleStats(state, vehicle.typeId, derived);
    const efficiency = worker.skill * derived.staffEfficiency;

    const walkSpeed = COURIER_WALK * Math.min(1.4, efficiency);
    const type = getVehicleType(vehicle.typeId);

    switch (rt.phase) {
      case 'idle': {
        rt.x = depot.dropX; rt.y = depot.dropY; rt.angle = 0;
        rt.walker = null;
        rt.atSpot = false;
        rt.scanTimer -= dt;
        if (rt.scanTimer > 0) break;
        rt.scanTimer = 0.6;
        const trip = planTrip(game, vstats.capacity);
        if (!trip.length) {
          rt.status = automationIdleReason(game, (o) => o.kind !== 'fragile' && o.slots <= vstats.capacity);
          break;
        }
        // Las cajas quedan reservadas ya (nadie más las coge), aunque sigan en la estantería hasta que llegue
        for (const order of trip) { order.assignedTo = worker.id; order.status = 'picked'; }
        rt.orders = trip;
        rt.hands = [];
        const spot = parkingSpotOf(game, vehicle.id);
        if (!spot) {
          // Sin plaza en el patio (más vehículos que plazas): carga directamente en la calzada, como antes
          rt.spot = null;
          rt.phase = 'loading';
          rt.timer = 2.5 / efficiency;
          rt.status = 'Cargando paquetes';
          break;
        }
        rt.spot = spot;
        rt.atSpot = true;
        rt.x = spot.x; rt.y = spot.y; rt.angle = spot.angle;
        const yard = yardRoute(game, spot, vehicle);
        rt.yard = yard;
        spawnWalker(rt, yard.cab, spot.angle - Math.PI / 2);
        walkTo(rt, yard.toRack, 'pickBoxes', 'Va a expedición a por las cajas');
        break;
      }
      case 'walking': {
        if (!rt.walker) { rt.phase = rt.after ?? 'idle'; break; }
        rt.walker.animTime += dt;
        if (!stepWalker(rt.walker, walkSpeed, dt)) break;
        rt.walker.anim = 'idle';
        rt.walker.animTime = 0;
        rt.walker.moving = 0;
        rt.phase = rt.after;
        rt.timer = { pickBoxes: BOX_TIME, loadVan: LOAD_TIME, handOver: DOOR_TIME, boarding: BOARD_TIME, reboard: BOARD_TIME }[rt.after] ?? 0;
        if (rt.phase === 'pickBoxes' || rt.phase === 'loadVan' || rt.phase === 'handOver') rt.walker.anim = 'reach';
        break;
      }
      case 'pickBoxes': {
        const yard = rt.yard ?? (rt.yard = yardRoute(game, rt.spot, vehicle));
        faceToward(rt.walker, yard.rackFace.x, yard.rackFace.y);
        rt.walker.animTime += dt;
        rt.timer -= dt;
        if (rt.timer > 0) break;
        // Coge todas las cajas del viaje de la estantería de expedición
        rt.orders = rt.orders.filter((o) => state.orders.includes(o));
        if (!rt.orders.length) { rt.walker.anim = 'walk'; walkTo(rt, [...yard.toRear, ...yard.toCab], 'boarding', 'Vuelve a su furgoneta'); break; }
        rt.hands = rt.orders.map((o) => o.id);
        game.events.emit('courierPicked', { worker, orders: rt.orders });
        walkTo(rt, yard.toRear, 'loadVan', 'Lleva las cajas a la furgoneta');
        break;
      }
      case 'loadVan': {
        faceToward(rt.walker, rt.spot.x, rt.spot.y);
        rt.walker.animTime += dt;
        rt.timer -= dt;
        if (rt.timer > 0) break;
        rt.hands = [];
        game.events.emit('courierLoaded', { worker, orders: rt.orders });
        walkTo(rt, (rt.yard ?? yardRoute(game, rt.spot, vehicle)).toCab, 'boarding', 'Sube a la furgoneta');
        break;
      }
      case 'boarding': {
        rt.timer -= dt;
        if (rt.timer > 0) break;
        rt.walker = null;
        if (!rt.orders.length || !startTrip(game, worker, rt)) { finishAtDepot(rt); break; }
        // Sale de la plaza hasta la calzada y desde ahí sigue la ruta
        rt.atSpot = false;
        rt.pull = makePull({ x: rt.spot.x, y: rt.spot.y }, { x: depot.dropX, y: depot.dropY }, rt.spot.angle, true);
        rt.phase = 'departing';
        rt.status = 'Saliendo del almacén';
        break;
      }
      case 'departing': {
        if (!stepPull(rt, dt)) break;
        rt.pull = null;
        rt.phase = 'driving';
        rt.status = 'En reparto';
        break;
      }
      case 'loading': {
        // Sin plaza en el patio: carga sin animación
        rt.timer -= dt;
        if (rt.timer > 0) break;
        if (startTrip(game, worker, rt)) rt.phase = 'driving';
        break;
      }
      case 'driving': {
        const speed = vstats.maxSpeed * 0.8 * efficiency;
        const target = rt.route.stopDistances[rt.stopIndex];
        const step = Math.min(speed * dt, Math.max(0, target - rt.travelled));
        rt.travelled += step;
        chargeFuel(game, step, vstats.fuelPerTile);
        const pose = pointAlongRoute(rt.route, rt.travelled);
        rt.x = pose.x; rt.y = pose.y; rt.angle = pose.angle;
        if (rt.travelled < target - 0.01) break;
        if (rt.stopIndex >= rt.orders.length) {
          // De vuelta: aparca en su plaza del patio (si tiene)
          const spot = parkingSpotOf(game, vehicle.id);
          if (!spot) { finishAtDepot(rt); break; }
          rt.spot = spot;
          rt.pull = makePull({ x: rt.x, y: rt.y }, { x: spot.x, y: spot.y }, spot.angle, false);
          rt.phase = 'arriving';
          rt.status = 'Aparcando en el almacén';
          break;
        }
        // Parada: baja con la caja y la lleva andando hasta la puerta del cliente
        const order = rt.orders[rt.stopIndex];
        const building = city.getBuilding(order.buildingId);
        const cab = vehiclePoints(rt.x, rt.y, rt.angle, type).cab;
        spawnWalker(rt, cab, rt.angle - Math.PI / 2);
        rt.hands = [order.id];
        rt.stopCab = cab;
        walkTo(rt, [deliveryDoorPoint(building)], 'handOver', 'Entregando');
        break;
      }
      case 'handOver': {
        const order = rt.orders[rt.stopIndex];
        const building = city.getBuilding(order.buildingId);
        const door = { x: building.doorX, y: building.doorY };
        faceToward(rt.walker, door.x, door.y);
        rt.walker.animTime += dt;
        rt.timer -= dt;
        if (rt.timer > 0) break;
        completeDelivery(game, order, { type: 'worker', worker });
        rt.hands = [];
        walkTo(rt, [rt.stopCab], 'reboard');
        break;
      }
      case 'reboard': {
        rt.timer -= dt;
        if (rt.timer > 0) break;
        rt.walker = null;
        rt.stopIndex += 1;
        rt.phase = 'driving';
        rt.status = rt.stopIndex >= rt.orders.length ? 'Volviendo al almacén' : 'En reparto';
        break;
      }
      case 'arriving': {
        if (!stepPull(rt, dt)) break;
        finishAtDepot(rt);
        break;
      }
      default:
        finishAtDepot(rt);
    }
  }
}
