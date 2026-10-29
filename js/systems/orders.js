// Pedidos: generación, preparación en el almacén, carga, entrega y pago.

import {
  TILE, METERS_PER_TILE, DROP_RADIUS, STREAK_WINDOW,
} from '../config/constants.js';
import { PACKAGES, ORDER_KINDS, KIND_ORDER } from '../config/packages.js';
import { DRONE_TYPES } from '../config/drones.js';
import { ITEMS_BY_SIZE, shelfOf } from '../config/products.js';
import { BELT_SPEED, depotLayout } from '../world/depotLayout.js';
import { ZONES } from '../config/zones.js';
import { distance, clamp, pad } from '../core/util.js';
import { choice, randomInt, randomFloat, weightedChoice } from '../core/random.js';
import { allocateId } from '../core/state.js';
import { computeReward, earn, rewardPreview } from './economy.js';
import { addXp, adjustReputation } from './progression.js';
import { getVehicleStats, getPlayerVehicle, maxVehicleCapacity } from './stats.js';

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2 };
const rng = Math.random;

export const getOrder = (state, id) => state.orders.find((o) => o.id === id);

export function storageUsed(state) {
  return state.orders.reduce((sum, o) => (o.status === 'pending' ? sum + o.slots : sum), 0);
}

export function playerCapacity(game) {
  return getVehicleStats(game.state, getPlayerVehicle(game.state).typeId, game.derived).capacity;
}

export function cargoSlotsUsed(game) {
  let used = 0;
  for (const id of game.state.player.cargo) used += getOrder(game.state, id)?.slots ?? 0;
  return used;
}

/** Segundos que un pedido listo espera antes de que empleados y drones puedan quedárselo. */
export const AUTOMATION_DELAY = 5;
/** Máximo de pedidos "solo para el jugador" (frágiles, demasiado grandes...) antes de dejar de generarlos. */
const MAX_PLAYER_ONLY_ORDERS = 2;

export function isAvailableForAutomation(game, order) {
  return order.status === 'pending' && !order.assignedTo && order.prep <= 0
    && game.state.time - (order.readySince ?? 0) >= AUTOMATION_DELAY
    && !(order.autoSkipUntil > game.state.time);
}

/** ¿Un dron de este tipo puede volar hasta el edificio? */
export function droneCanReach(city, droneType, building) {
  const depot = city.depot;
  return Boolean(building?.droneOk)
    && distance(depot.centerX, depot.centerY, building.centerX, building.centerY) <= droneType.range;
}

/** Qué pueden llevar ahora mismo los repartidores y drones de la empresa. */
export function automationProfile(game) {
  const { state, derived } = game;
  let courierCapacity = 0;
  for (const worker of state.workers) {
    if (worker.typeId !== 'courier') continue;
    const vehicle = state.vehicles.find((v) => v.id === worker.vehicleId);
    if (vehicle) courierCapacity = Math.max(courierCapacity, getVehicleStats(state, vehicle.typeId, derived).capacity);
  }
  const drones = state.drones.map((d) => DRONE_TYPES[d.typeId]).filter(Boolean);
  const maxSlots = Math.max(courierCapacity, ...drones.map((t) => t.capacity), 0);
  return { courierCapacity, drones, maxSlots, any: courierCapacity > 0 || drones.length > 0 };
}

/** ¿Algún repartidor o dron podría llevar este pedido? (los frágiles solo los entrega el jugador) */
export function canAutomate(game, profile, order) {
  if (order.kind === 'fragile') return false;
  if (order.slots <= profile.courierCapacity) return true;
  const building = game.city.getBuilding(order.buildingId);
  return profile.drones.some((t) => order.slots <= t.capacity && droneCanReach(game.city, t, building));
}

function countPlayerOnlyOrders(game, profile) {
  return game.state.orders.filter((o) => o.status === 'pending' && !o.assignedTo && !canAutomate(game, profile, o)).length;
}

/**
 * Explica por qué un repartidor o dron está parado en el almacén.
 * "canTake(order)" indica si esa unidad concreta podría llevar el pedido.
 */
export function automationIdleReason(game, canTake) {
  let preparing = 0;
  let waiting = 0;
  let unfit = 0;
  for (const order of game.state.orders) {
    if (order.status !== 'pending' || order.assignedTo) continue;
    if (order.prep > 0) { preparing++; continue; }
    if (!canTake(order)) { unfit++; continue; }
    if (!isAvailableForAutomation(game, order)) waiting++;
  }
  if (waiting) return 'Pedido listo: espera unos segundos por si lo cargas tú';
  if (preparing && game.derived.prepLanes === 0) return 'Nadie prepara los pedidos: empaquétalos tú o contrata un preparador';
  if (preparing) return 'Esperando a que se preparen los pedidos';
  if (unfit) return 'Los pedidos listos no le sirven (tamaño, destino o frágiles)';
  return 'Esperando pedidos nuevos';
}

export const compareOrders = (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.number - b.number;

/** Segundos estimados para llegar al destino a la velocidad indicada. */
export function etaSeconds(order, speed) {
  return (order.distanceTiles * TILE) / Math.max(30, speed * 0.75);
}

function bestVehicleSpeed(game) {
  let best = 0;
  for (const v of game.state.vehicles) best = Math.max(best, getVehicleStats(game.state, v.typeId, game.derived).maxSpeed);
  return best;
}

/** Tipos de pedido que se pueden generar. "limits" restringe para que los pueda llevar la automatización. */
function availableKinds(game, limits = null) {
  const { state, derived } = game;
  const free = derived.storageCapacity - storageUsed(state);
  const capacity = Math.min(maxVehicleCapacity(state, derived), limits?.maxSlots ?? Infinity);
  const result = [];
  for (const kindId of KIND_ORDER) {
    const kind = ORDER_KINDS[kindId];
    if (state.level < kind.minLevel) continue;
    if (kind.requiresUpgrade && !(state.upgrades[kind.requiresUpgrade] > 0)) continue;
    if (limits && kindId === 'fragile') continue;
    const sizes = kind.sizes.filter((s) => PACKAGES[s].slots <= free && PACKAGES[s].slots <= capacity);
    if (sizes.length) result.push({ kind, sizes });
  }
  return result;
}

function pickKindAndSize(game, limits = null) {
  const available = availableKinds(game, limits);
  if (!available.length) return null;
  const level = game.state.level;
  const pick = weightedChoice(rng, available, ({ kind: k }) => {
    let weight = k.spawnWeight;
    if (k.id === 'small') weight *= clamp(1.2 - 0.08 * level, 0.3, 1);
    return weight;
  });
  return { kind: pick.kind, size: choice(rng, pick.sizes) };
}

/**
 * Si ya hay bastantes pedidos que solo puede hacer el jugador, el siguiente se genera para que lo pueda
 * llevar algún repartidor o dron (tamaño y, si solo cabe en un dron, destino a su alcance).
 */
function pickAutomatableOrder(game) {
  const profile = automationProfile(game);
  if (!profile.any || countPlayerOnlyOrders(game, profile) < MAX_PLAYER_ONLY_ORDERS) return null;
  const pick = pickKindAndSize(game, { maxSlots: profile.maxSlots });
  if (!pick) return null;
  const slots = PACKAGES[pick.size].slots;
  const filter = slots <= profile.courierCapacity
    ? null
    : (b) => profile.drones.some((t) => slots <= t.capacity && droneCanReach(game.city, t, b));
  const building = pickBuilding(game, pick.kind, filter);
  return building ? { ...pick, building } : null;
}

function candidateBuildings(game, kind, filter) {
  const { city, state } = game;
  const busy = new Set(state.orders.map((o) => o.buildingId));
  // El punto de entrega debe estar en una calle ya abierta (algunas calles pertenecen a la zona vecina)
  return city.buildings
    .filter((b) => state.zones[b.zoneId] && !city.circleHitsSolid(b.dropX, b.dropY, 10)
      && (!kind.buildingKinds || kind.buildingKinds.includes(b.kind)) && (!filter || filter(b)))
    .map((b) => ({ b, busy: busy.has(b.id) }));
}

function pickBuilding(game, kind, filter = null) {
  const candidates = candidateBuildings(game, kind, filter);
  if (!candidates.length) return null;
  const pick = weightedChoice(rng, candidates, ({ b, busy }) => ZONES[b.zoneId].orderWeight * (busy ? 0.15 : 1));
  return pick?.b ?? null;
}

/**
 * Crea un pedido nuevo. "options" permite forzar tipo, tamaño o destino (primer pedido y pruebas).
 * Devuelve null si no se puede crear ninguno (almacén lleno, sin destinos, etc.).
 */
export function createOrder(game, options = {}) {
  const { state, city, derived } = game;
  let kind;
  let size;
  let building = options.building ?? null;
  if (options.kind) {
    kind = ORDER_KINDS[options.kind];
    size = options.size ?? kind.sizes[0];
  } else {
    const pick = pickAutomatableOrder(game) ?? pickKindAndSize(game);
    if (!pick) return null;
    kind = pick.kind;
    size = pick.size;
    building = building ?? pick.building ?? null;
  }

  building = building ?? pickBuilding(game, kind);
  if (!building) return null;
  const depot = city.depot;
  const route = game.paths.route({ x: depot.dropX, y: depot.dropY }, { x: building.dropX, y: building.dropY });
  if (!route) return null;

  const pkg = PACKAGES[size];
  const distanceTiles = route.length / TILE;
  const prepTotal = options.instantReady ? 0 : pkg.prep;
  const items = buildItems(kind, size, options, prepTotal === 0);
  let timeLeft = null;
  if (kind.priority === 'urgent') {
    // Margen para que los productos recorran la cinta, empaquetarlos, registrarlos en expedición y cargarlos
    const beltTime = depotLayout(city.depot).belt.length / BELT_SPEED;
    const handling = prepTotal > 0 ? beltTime + 25 + 8 * items.length : 0;
    timeLeft = Math.round(handling + 40 + 2 * (route.length / (bestVehicleSpeed(game) * 0.7)));
  }

  const order = {
    id: allocateId(state, 'o'),
    number: state.nextOrderNumber++,
    kind: kind.id,
    size,
    slots: pkg.slots,
    weight: randomInt(rng, pkg.weight[0], pkg.weight[1]),
    contents: summarizeItems(items),
    // Productos que llegan por la cinta y se empaquetan (at: queued | belt | bin | hand | worker | table | box)
    items,
    handling: null, // 'picking' mientras el jugador los reúne; 'staff' si lo prepara un empleado
    dispatched: prepTotal === 0, // la caja está registrada en expedición y se puede cargar
    buildingId: building.id,
    zoneId: building.zoneId,
    distanceTiles,
    distanceM: Math.round(distanceTiles * METERS_PER_TILE),
    priority: kind.priority,
    status: 'pending',
    assignedTo: null,
    prep: prepTotal,
    prepTotal,
    readySince: prepTotal === 0 ? state.time : null,
    timeLeft,
    timeTotal: timeLeft,
    late: false,
    damaged: false,
    createdAt: state.time,
  };
  state.orders.push(order);
  state.stats.ordersCreated += 1;
  game.events.emit('orderCreated', { order, building });
  return order;
}

/**
 * Lista de productos del pedido. El primero es options.contents (o uno al azar del tipo);
 * los pedidos medianos y grandes pueden traer más, siempre distintos. options.items fuerza la lista.
 */
function buildItems(kind, size, options, packed) {
  let names;
  if (Array.isArray(options.items) && options.items.length) {
    names = options.items.map(String);
  } else {
    const first = options.contents ?? choice(rng, kind.contents);
    const [min, max] = ITEMS_BY_SIZE[size] ?? [1, 1];
    const pool = kind.contents.filter((name) => name !== first);
    names = [first];
    const extra = options.contents ? 0 : randomInt(rng, min, max) - 1;
    for (let i = 0; i < extra && pool.length; i++) names.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return names.map((name) => ({ name, shelf: shelfOf(name), at: packed ? 'box' : 'queued' }));
}

/** Texto corto del contenido para avisos y tarjetas: "Cafetera" o "Cafetera + 1 más". */
export function summarizeItems(items) {
  if (!items.length) return 'Paquete';
  return items.length === 1 ? items[0].name : `${items[0].name} + ${items.length - 1} más`;
}

/** Primer pedido del tutorial: una casa cercana del barrio inicial, con un producto que preparar a mano. */
export function createFirstOrder(game) {
  const { city } = game;
  const depot = city.depot;
  let best = null;
  let bestScore = Infinity;
  for (const b of city.buildings) {
    if (b.zoneId !== 'residential' || b.kind !== 'house') continue;
    const route = game.paths.route({ x: depot.dropX, y: depot.dropY }, { x: b.dropX, y: b.dropY });
    if (!route) continue;
    const score = Math.abs(route.length / TILE - 15);
    if (score < bestScore) { bestScore = score; best = b; }
  }
  return createOrder(game, { kind: 'small', size: 'small', building: best, contents: 'Libro de bienvenida' });
}

export function updateOrders(game, dt) {
  const { state, derived } = game;

  // Llegada de pedidos nuevos
  state.spawnTimer -= dt;
  if (state.orders.length === 0) state.spawnTimer = Math.min(state.spawnTimer, 3);
  if (state.spawnTimer <= 0) {
    if (state.orders.length < derived.maxActiveOrders) {
      const order = createOrder(game);
      if (order) {
        state.spawnTimer = derived.spawnInterval * randomFloat(rng, 0.75, 1.25);
        if (order.priority === 'urgent') {
          game.events.emit('notify', { type: 'warn', icon: '⚡', title: `Pedido urgente #${pad(order.number)}`, text: `Tienes ${order.timeLeft} s para entregarlo. Paga ${ORDER_KINDS.urgent.rewardMult}× más.` });
        }
      } else {
        state.spawnTimer = 3;
      }
    } else {
      state.spawnTimer = 2;
    }
  }

  // La preparación ya no es un contador: los productos llegan por la cinta (systems/conveyor.js) y los
  // empaquetan el jugador o los preparadores, que trabajan físicamente en el almacén (systems/warehouseStaff.js).
  void derived;

  // Plazos de entrega
  for (const order of state.orders) {
    if (order.timeLeft === null || order.late) continue;
    order.timeLeft -= dt;
    if (order.timeLeft <= 0) {
      order.timeLeft = 0;
      order.late = true;
      adjustReputation(game, -2);
      game.events.emit('notify', { type: 'warn', icon: '⏰', title: `Pedido #${pad(order.number)} con retraso`, text: 'Pierdes parte de la recompensa, pero aún puedes entregarlo.' });
    }
  }

  // Racha de entregas
  if (state.streak.timer > 0) {
    state.streak.timer -= dt;
    if (state.streak.timer <= 0) { state.streak.timer = 0; state.streak.count = 0; }
  }
}

// ---------------------------------------------------------------- Carga ----

export function canLoadOrder(game, order) {
  if (!order || order.status !== 'pending') return { ok: false, reason: 'Este pedido no está disponible' };
  if (order.assignedTo) return { ok: false, reason: 'Ya está asignado' };
  if (order.prep > 0) return { ok: false, reason: 'Aún se está preparando' };
  if (!game.isPlayerInDepot()) return { ok: false, reason: 'Ve al almacén para cargarlo' };
  const capacity = playerCapacity(game);
  const used = cargoSlotsUsed(game);
  if (used + order.slots > capacity) return { ok: false, reason: `Sin espacio: ${used}/${capacity} huecos (necesita ${order.slots})` };
  return { ok: true };
}

export function loadOrder(game, orderId) {
  const order = getOrder(game.state, orderId);
  const check = canLoadOrder(game, order);
  if (!check.ok) return check;
  order.status = 'picked';
  order.assignedTo = 'player';
  game.state.player.cargo.push(order.id);
  game.events.emit('orderLoaded', { order });
  return { ok: true };
}

/** Carga todos los pedidos listos que quepan, empezando por los más importantes. */
export function loadBest(game) {
  const candidates = game.state.orders
    .filter((o) => o.status === 'pending' && !o.assignedTo && o.prep <= 0)
    .sort((a, b) => compareOrders(a, b) || rewardPreview(game, b) / b.slots - rewardPreview(game, a) / a.slots);
  let loaded = 0;
  for (const order of candidates) {
    if (loadOrder(game, order.id).ok) loaded += 1;
  }
  return loaded;
}

export function unloadOrder(game, orderId) {
  const { state } = game;
  const order = getOrder(state, orderId);
  if (!order || order.assignedTo !== 'player') return { ok: false, reason: 'Ese pedido no está en tu vehículo' };
  if (!game.isPlayerInDepot()) return { ok: false, reason: 'Vuelve al almacén para descargarlo' };
  order.status = 'pending';
  order.assignedTo = null;
  state.player.cargo = state.player.cargo.filter((id) => id !== order.id);
  game.events.emit('orderUnloaded', { order });
  return { ok: true };
}

export function rejectOrder(game, orderId) {
  const { state } = game;
  const order = getOrder(state, orderId);
  if (!order) return { ok: false, reason: 'Pedido inexistente' };
  // Un pedido que el jugador está reuniendo a mano (sin caja todavía) también se puede descartar
  const picking = order.assignedTo === 'player' && order.handling === 'picking';
  if (order.assignedTo && !picking) return { ok: false, reason: 'No se puede rechazar un pedido en reparto' };
  if (state.player.hands) state.player.hands.items = state.player.hands.items.filter((ref) => ref.orderId !== order.id);
  state.orders = state.orders.filter((o) => o.id !== order.id);
  state.stats.ordersRejected += 1;
  if (order.priority === 'urgent') adjustReputation(game, -1);
  game.events.emit('orderRejected', { order });
  return { ok: true };
}

// -------------------------------------------------------------- Entrega ----

export function getDeliverableOrders(game) {
  const { state, city } = game;
  const p = state.player;
  const result = [];
  for (const id of p.cargo) {
    const order = getOrder(state, id);
    const building = order && city.getBuilding(order.buildingId);
    if (building && distance(p.x, p.y, building.dropX, building.dropY) <= DROP_RADIUS) result.push(order);
  }
  return result;
}

/**
 * Cierra un pedido y paga la recompensa. Es el ÚNICO camino de pago: si el pedido
 * ya no está activo no devuelve nada, así que nunca se cobra dos veces.
 */
export function completeDelivery(game, order, by) {
  const { state, city } = game;
  const index = order ? state.orders.indexOf(order) : -1;
  if (index < 0 || order.status === 'delivered') return null;
  state.orders.splice(index, 1);
  order.status = 'delivered';
  state.player.cargo = state.player.cargo.filter((id) => id !== order.id);
  const hands = state.player.hands;
  if (hands) {
    if (hands.box === order.id) hands.box = '';
    hands.items = hands.items.filter((ref) => ref.orderId !== order.id);
  }

  const isPlayer = by.type === 'player';
  let streakCount = 0;
  if (isPlayer) {
    if (!order.late && !order.damaged) {
      state.streak.count = state.streak.timer > 0 ? state.streak.count + 1 : 1;
      state.streak.timer = STREAK_WINDOW;
      streakCount = state.streak.count;
      state.stats.bestStreak = Math.max(state.stats.bestStreak, streakCount);
      state.dayStats.bestStreak = Math.max(state.dayStats.bestStreak, streakCount);
    } else {
      state.streak.count = 0;
      state.streak.timer = 0;
    }
  }

  const reward = computeReward(game, order, { streakCount });
  const paid = earn(game, reward.total, { auto: !isPlayer });
  const kind = ORDER_KINDS[order.kind];
  const pkg = PACKAGES[order.size];

  const s = state.stats;
  s.deliveries += 1;
  state.dayStats.deliveries += 1;
  if (by.type === 'player') s.manualDeliveries += 1;
  else if (by.type === 'worker') s.workerDeliveries += 1;
  else s.droneDeliveries += 1;

  if (order.late) {
    s.late += 1;
    state.dayStats.late += 1;
  } else {
    s.onTime += 1;
    if (order.priority === 'urgent') { s.urgentOnTime += 1; state.dayStats.urgentOnTime += 1; }
    const base = order.priority === 'urgent' ? 1.4 : order.kind === 'contract' ? 1.0 : 0.6;
    adjustReputation(game, base * game.derived.reputationGainMult * Math.max(0.1, 1.15 - state.reputation / 100));
  }
  if (order.damaged) {
    s.damaged += 1;
    adjustReputation(game, -1.5);
  }

  const xp = Math.round(pkg.xp * kind.xpMult * (order.late ? 0.5 : 1) * (1 + reward.streakBonus));
  addXp(game, xp);

  const building = city.getBuilding(order.buildingId);
  const byName = by.type === 'player' ? 'Tú' : by.type === 'worker' ? by.worker.name : by.drone.name;
  if (by.worker) { by.worker.delivered += 1; by.worker.earned += paid; }
  if (by.drone) { by.drone.delivered += 1; by.drone.earned += paid; }
  state.recentDeliveries.unshift({ number: order.number, address: building.address, reward: paid, by: byName, kind: order.kind, day: state.day, late: order.late });
  state.recentDeliveries.length = Math.min(state.recentDeliveries.length, 8);

  const payload = { order, building, by, reward: paid, breakdown: reward.breakdown, xp, streak: streakCount };
  game.events.emit('orderDelivered', payload);
  return payload;
}

/** Entrega manual: paga todos los pedidos cargados cuyo destino esté al alcance. */
export function deliverNearby(game) {
  const results = [];
  for (const order of getDeliverableOrders(game)) {
    const result = completeDelivery(game, order, { type: 'player' });
    if (result) results.push(result);
  }
  return results;
}

/** Marca como "en reparto" los pedidos cargados cuando el vehículo se aleja del almacén. */
export function refreshTransitStatus(game) {
  const inDepot = game.isPlayerInDepot();
  for (const id of game.state.player.cargo) {
    const order = getOrder(game.state, id);
    if (order) order.status = inDepot ? 'picked' : 'in_transit';
  }
}
