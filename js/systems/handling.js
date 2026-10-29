// Trabajo físico del repartidor a pie:
//   cinta (coger el producto que tienes delante) → mesa (dejar y empaquetar) → expedición (registrar la caja)
//   → vehículo (cargarla) → conducir → vehículo (sacarla) → puerta del destinatario (entregar).
// getFootAction() decide qué hace la tecla E según dónde está la persona y hacia dónde mira; las funciones
// de bajo nivel (takeItem, packOrder…) solo comprueban el estado de las manos y del pedido.
// Estado: state.player.hands = { box: id del pedido o '', items: [{ orderId, index }] } y order.items[i].at.

import { DEPOT_RADIUS } from '../config/constants.js';
import { ORDER_KINDS } from '../config/packages.js';
import { HAND_CAPACITY, getShelf, productInfo } from '../config/products.js';
import { getVehicleType } from '../config/vehicles.js';
import { clamp, distance, pad } from '../core/util.js';
import { TUTORIAL_STEPS } from '../config/tutorial.js';
import { beltPoint, depotLayout, isInsideDepot, isInsideOffice } from '../world/depotLayout.js';
import { deliveryDoorPoint } from '../world/lotLayout.js';
import { cargoSlotsUsed, compareOrders, completeDelivery, getOrder, playerCapacity } from './orders.js';
import { enterVehicle, parkedVehicles, playerVehiclePoints, vehiclePoints } from './onFoot.js';
import { getPlayerVehicle } from './stats.js';

export const REACH = 16; // px desde el borde de un mueble
export const BELT_REACH = 17; // px desde el producto de la cinta
export const VEHICLE_REACH = 15; // px desde la trasera o la puerta del conductor
export const DOOR_RADIUS = 20; // px desde el punto de entrega de la puerta
export const TABLE_CAPACITY = 9; // volumen de productos que caben en la mesa del jugador

const handsOf = (game) => game.state.player.hands;
const orderTag = (order) => `#${pad(order.number)}`;

export function heldBox(game) {
  const id = handsOf(game).box;
  return id ? getOrder(game.state, id) ?? null : null;
}

export function heldItems(game) {
  const result = [];
  for (const ref of handsOf(game).items) {
    const order = getOrder(game.state, ref.orderId);
    const item = order?.items?.[ref.index];
    if (item) result.push({ ref, order, item });
  }
  return result;
}

export const handsEmpty = (game) => !handsOf(game).box && handsOf(game).items.length === 0;
export const handsBulk = (game) => heldItems(game).reduce((sum, { item }) => sum + productInfo(item.name).bulk, 0);

/** ¿El pedido espera a que el jugador lo prepare? (sin caja todavía y sin empleado asignado) */
export function awaitingPacking(order) {
  return order.status === 'pending' && order.prep > 0 && (!order.assignedTo || order.assignedTo === 'player');
}

export const isPlayerPicking = (order) => order.assignedTo === 'player' && order.handling === 'picking';

/** Cajas ya preparadas en la zona de expedición (las mismas que pueden coger empleados y drones). */
export function rackBoxes(state) {
  return state.orders.filter((o) => o.status === 'pending' && !o.assignedTo && o.prep <= 0).sort(compareOrders);
}

/** Primero lo que ya se está preparando, después el pedido seguido y luego por prioridad. */
function prioritized(game, list) {
  const tracked = game.trackedOrderId;
  return list.sort((a, b) => Number(isPlayerPicking(b)) - Number(isPlayerPicking(a))
    || Number(b.id === tracked) - Number(a.id === tracked)
    || compareOrders(a, b));
}

/** Productos en un sitio concreto: [{ order, index, item }]. */
export function itemsAt(state, where) {
  const list = [];
  for (const order of state.orders) {
    (order.items ?? []).forEach((item, index) => { if (item.at === where) list.push({ order, index, item }); });
  }
  return list;
}

/** Productos de la cinta con su posición en el mapa. */
export function beltItems(game) {
  const L = depotLayout(game.city.depot);
  return itemsAt(game.state, 'belt').map((entry) => ({ ...entry, point: beltPoint(L, entry.item.pos ?? 0) }));
}

/** Volumen de productos sobre la mesa del jugador. */
export const tableBulk = (state) => itemsAt(state, 'table')
  .filter(({ item }) => (item.table ?? 0) === 0)
  .reduce((sum, { item }) => sum + productInfo(item.name).bulk, 0);

/** Si el jugador ya no tiene nada de un pedido en las manos ni en la mesa, el pedido queda libre otra vez. */
function releaseIfIdle(order) {
  if (!isPlayerPicking(order)) return;
  if (order.items.some((i) => i.at === 'hand' || i.at === 'table')) return;
  order.assignedTo = null;
  order.handling = null;
}

// ------------------------------------------------------ Acciones de bajo nivel ----

/** ¿Puede el jugador coger este producto? (devuelve el motivo si no) */
export function canTakeItem(game, order, item) {
  if (!order || !item || (item.at !== 'belt' && item.at !== 'bin')) return 'Ese producto no está disponible';
  if (!awaitingPacking(order)) {
    const worker = game.state.workers.find((w) => w.id === order.assignedTo);
    return worker ? `${item.name} es del pedido que prepara ${worker.name}` : 'Ese producto ya tiene dueño';
  }
  if (handsOf(game).box) return 'Tienes las manos ocupadas con una caja';
  const bulk = productInfo(item.name).bulk;
  if (handsBulk(game) + bulk > HAND_CAPACITY) {
    return bulk >= HAND_CAPACITY ? `${item.name} es voluminoso: necesitas las manos libres` : 'Llevas las manos llenas: deja los productos en la mesa';
  }
  return null;
}

/** Coge un producto concreto de la cinta o del cajón de fin de línea. */
export function takeItem(game, order, index) {
  const item = order?.items?.[index];
  const reason = canTakeItem(game, order, item);
  if (reason) return { ok: false, reason };
  const from = item.at;
  item.at = 'hand';
  delete item.pos;
  delete item.binAt;
  handsOf(game).items.push({ orderId: order.id, index });
  order.assignedTo = 'player'; // reservado: los preparadores y la automatización no lo tocan
  order.handling = 'picking';
  game.state.stats.itemsPicked += 1;
  game.events.emit('itemPicked', { order, item, from });
  return { ok: true, kind: 'pick', order, item };
}

/** El mejor producto del cajón para el jugador (el del pedido que ya prepara, el seguido, el prioritario). */
export function binPick(game) {
  const entries = itemsAt(game.state, 'bin').filter(({ order }) => awaitingPacking(order));
  if (!entries.length) return null;
  const order = prioritized(game, [...new Set(entries.map((e) => e.order))])[0];
  return entries.find((e) => e.order === order);
}

/** Deja en el cajón el último producto que llevas (vuelve a estar disponible para cualquiera). */
export function dropInBin(game) {
  const hands = handsOf(game);
  const held = heldItems(game);
  const entry = held[held.length - 1];
  if (!entry) return { ok: false, reason: 'No llevas productos' };
  entry.item.at = 'bin';
  entry.item.binAt = game.state.time;
  hands.items = hands.items.filter((ref) => ref !== entry.ref);
  releaseIfIdle(entry.order);
  game.events.emit('itemReturned', { order: entry.order, item: entry.item });
  return { ok: true, kind: 'return', order: entry.order, item: entry.item };
}

export function placeOnTable(game) {
  const held = heldItems(game);
  if (!held.length) return { ok: false, reason: 'No llevas productos' };
  const incoming = held.reduce((sum, { item }) => sum + productInfo(item.name).bulk, 0);
  if (tableBulk(game.state) + incoming > TABLE_CAPACITY) return { ok: false, reason: 'La mesa está llena: empaqueta antes un pedido' };
  for (const { item } of held) {
    item.at = 'table';
    item.table = 0;
  }
  handsOf(game).items = [];
  game.events.emit('itemsPlaced', { count: held.length });
  return { ok: true, kind: 'place', count: held.length };
}

/** Pedido cuyos productos ya están todos en la mesa del jugador. */
export function packableOrder(game) {
  const onTable = (i) => i.at === 'table' && (i.table ?? 0) === 0;
  const list = game.state.orders.filter((o) => isPlayerPicking(o) && o.items.length && o.items.every(onTable));
  return prioritized(game, list)[0] ?? null;
}

/** Pedido a medio reunir en la mesa (para avisar de lo que falta). */
export function incompleteOnTable(game) {
  const list = game.state.orders.filter((o) => isPlayerPicking(o) && o.items.some((i) => i.at === 'table') && !o.items.every((i) => i.at === 'table'));
  return prioritized(game, list)[0] ?? null;
}

export function packOrder(game) {
  const hands = handsOf(game);
  if (!handsEmpty(game)) return { ok: false, reason: 'Deja primero lo que llevas en las manos' };
  const order = packableOrder(game);
  if (!order) return { ok: false, reason: 'Reúne en la mesa todos los productos de un pedido' };
  for (const item of order.items) {
    item.at = 'box';
    delete item.table;
  }
  order.prep = 0;
  order.readySince = game.state.time;
  order.handling = null;
  order.dispatched = false; // hay que registrarla en expedición antes de cargarla
  order.status = 'picked'; // la caja va en las manos del jugador (assignedTo sigue siendo 'player')
  hands.box = order.id;
  game.state.stats.boxesPacked += 1;
  game.events.emit('orderPacked', { order });
  return { ok: true, kind: 'pack', order };
}

export function takeFromRack(game) {
  if (!handsEmpty(game)) return { ok: false, reason: 'Tienes las manos ocupadas' };
  const order = prioritized(game, rackBoxes(game.state))[0];
  if (!order) return { ok: false, reason: 'No hay cajas preparadas en expedición' };
  order.assignedTo = 'player';
  order.status = 'picked';
  order.dispatched = true;
  handsOf(game).box = order.id;
  game.events.emit('boxTaken', { order });
  return { ok: true, kind: 'take', order };
}

/** Deja la caja en expedición: queda registrada y disponible para el jugador, los repartidores y los drones. */
export function storeOnRack(game) {
  const order = heldBox(game);
  if (!order) return { ok: false, reason: 'No llevas ninguna caja' };
  const first = !order.dispatched;
  order.assignedTo = null;
  order.status = 'pending';
  order.handling = null;
  order.readySince = game.state.time;
  order.dispatched = true;
  handsOf(game).box = '';
  if (first) game.state.stats.boxesDispatched += 1;
  game.events.emit('boxStored', { order });
  return { ok: true, kind: 'store', order };
}

export function loadIntoVehicle(game) {
  const order = heldBox(game);
  if (!order) return { ok: false, reason: 'No llevas ninguna caja' };
  if (!order.dispatched) return { ok: false, reason: 'Registra antes la caja en expedición (estantería junto a la fachada)' };
  const used = cargoSlotsUsed(game);
  const capacity = playerCapacity(game);
  if (used + order.slots > capacity) {
    return { ok: false, reason: `Sin espacio: ${used}/${capacity} huecos (la caja ocupa ${order.slots})` };
  }
  const { state } = game;
  state.player.cargo.push(order.id);
  handsOf(game).box = '';
  order.assignedTo = 'player';
  order.status = 'picked';
  game.events.emit('orderLoaded', { order, from: { x: state.player.foot.x, y: state.player.foot.y } });
  return { ok: true, kind: 'load', order };
}

/** Caja que conviene sacar: la seguida o la del destino más cercano al vehículo. */
export function chooseCargoBox(game) {
  const { state, city } = game;
  const p = state.player;
  const cargo = p.cargo.map((id) => getOrder(state, id)).filter(Boolean);
  if (!cargo.length) return null;
  const tracked = cargo.find((o) => o.id === game.trackedOrderId);
  if (tracked) return tracked;
  const doorDistance = (o) => {
    const door = deliveryDoorPoint(city.getBuilding(o.buildingId));
    return distance(p.x, p.y, door.x, door.y);
  };
  return cargo.sort((a, b) => doorDistance(a) - doorDistance(b))[0];
}

export function takeFromVehicle(game) {
  if (!handsEmpty(game)) return { ok: false, reason: 'Tienes las manos ocupadas' };
  const order = chooseCargoBox(game);
  if (!order) return { ok: false, reason: 'La zona de carga está vacía' };
  const p = game.state.player;
  p.cargo = p.cargo.filter((id) => id !== order.id);
  handsOf(game).box = order.id;
  game.events.emit('boxUnloaded', { order });
  return { ok: true, kind: 'unload', order };
}

/** Entrega en la puerta: es el mismo pago único de siempre (completeDelivery). */
export function deliverAtDoor(game, order) {
  if (!order || handsOf(game).box !== order.id) return { ok: false, reason: 'No llevas ese paquete' };
  const door = deliveryDoorPoint(game.city.getBuilding(order.buildingId));
  const result = completeDelivery(game, order, { type: 'player', at: door });
  if (!result) return { ok: false, reason: 'Este pedido ya no está activo' };
  return { ok: true, kind: 'deliver', delivered: [result] };
}

// --------------------------------------------------------- Qué hace la tecla E ----

function rectDistance(rect, x, y) {
  const dx = x - clamp(x, rect.x0, rect.x1);
  const dy = y - clamp(y, rect.y0, rect.y1);
  return Math.hypot(dx, dy);
}

const rectCenter = (rect) => ({ x: (rect.x0 + rect.x1) / 2, y: (rect.y0 + rect.y1) / 2 });
const action = (kind, label, run) => ({ kind, label, ok: true, run });
const info = (label, reason = label) => ({ kind: 'info', label, ok: false, reason, run: () => ({ ok: false, reason }) });

function beltAction(game, entry, alternatives) {
  const reason = canTakeItem(game, entry.order, entry.item);
  if (!reason) {
    return action('pick', `Coger ${entry.item.name} · pedido ${orderTag(entry.order)}`, () => takeItem(game, entry.order, entry.index));
  }
  // El que tienes delante no es tuyo: prueba con otro producto de la cinta al alcance
  const other = alternatives.find((e) => e !== entry && !canTakeItem(game, e.order, e.item));
  if (other) return action('pick', `Coger ${other.item.name} · pedido ${orderTag(other.order)}`, () => takeItem(game, other.order, other.index));
  return info(reason);
}

function binAction(game) {
  const held = heldItems(game);
  const pick = binPick(game);
  if (pick && !canTakeItem(game, pick.order, pick.item)) {
    return action('pick', `Coger ${pick.item.name} del cajón · pedido ${orderTag(pick.order)}`, () => takeItem(game, pick.order, pick.index));
  }
  if (held.length) return action('return', `Dejar ${held[held.length - 1].item.name} en el cajón`, () => dropInBin(game));
  if (pick) return info(canTakeItem(game, pick.order, pick.item));
  const waiting = itemsAt(game.state, 'bin').length;
  return info(waiting ? 'Cajón de fin de línea: lo que hay es de otros pedidos' : 'Cajón de fin de línea: aquí caen los productos que nadie recoge');
}

function tableAction(game) {
  const hands = handsOf(game);
  if (hands.items.length) {
    const n = hands.items.length;
    return action('place', `Dejar ${n} producto${n > 1 ? 's' : ''} en la mesa`, () => placeOnTable(game));
  }
  if (hands.box) return info('Ya llevas una caja: llévala a expedición');
  const packable = packableOrder(game);
  if (packable) return action('pack', `Empaquetar pedido ${orderTag(packable)}`, () => packOrder(game));
  const partial = incompleteOnTable(game);
  if (partial) {
    const missing = partial.items.filter((i) => i.at !== 'table').map((i) => i.name);
    return info(`Pedido ${orderTag(partial)}: faltan ${missing.join(', ')}`);
  }
  return info('Mesa de empaquetado: trae aquí los productos de un pedido');
}

function stationInfo(game, tableId) {
  const L = depotLayout(game.city.depot);
  const pickers = game.state.workers.filter((w) => w.typeId === 'picker');
  const names = pickers.filter((w, i) => L.stations[i % L.stations.length].table === tableId).map((w) => w.name);
  return info(names.length ? `Puesto de trabajo de ${names.join(' y ')}` : 'Puesto de trabajo libre: contrata un preparador (ordenador de la oficina → Equipo)');
}

function rackAction(game) {
  const hands = handsOf(game);
  const box = heldBox(game);
  if (box) {
    return action('store', box.dispatched ? `Dejar la caja ${orderTag(box)} en expedición` : `Registrar la caja ${orderTag(box)} en expedición`, () => storeOnRack(game));
  }
  if (hands.items.length) return info('Lleva primero los productos a la mesa de empaquetado');
  const order = prioritized(game, rackBoxes(game.state))[0];
  if (order) {
    const b = game.city.getBuilding(order.buildingId);
    return action('take', `Coger caja ${orderTag(order)} · ${b.address}`, () => takeFromRack(game));
  }
  return info('Expedición: aquí esperan las cajas listas para cargar');
}

function rearAction(game) {
  const hands = handsOf(game);
  const box = heldBox(game);
  if (box) {
    if (!box.dispatched) return info('Primero registra la caja en expedición (estantería junto a la fachada)');
    const used = cargoSlotsUsed(game);
    const capacity = playerCapacity(game);
    if (used + box.slots > capacity) return info(`Sin espacio en el vehículo (${used}/${capacity} huecos)`);
    return action('load', `Cargar caja ${orderTag(box)} · ${used + box.slots}/${capacity} huecos`, () => loadIntoVehicle(game));
  }
  if (hands.items.length) return info('Los productos sueltos se empaquetan antes en la mesa');
  const order = chooseCargoBox(game);
  if (order) {
    const b = game.city.getBuilding(order.buildingId);
    return action('unload', `Sacar caja ${orderTag(order)} · ${b.address}`, () => takeFromVehicle(game));
  }
  return info('Zona de carga vacía');
}

function cabAction(game, vehicle, own) {
  const type = getVehicleType(vehicle.typeId);
  if (!handsEmpty(game)) return info('Deja lo que llevas antes de conducir');
  if (own) return action('enter', `Subir a ${type.name.toLowerCase()}`, () => enterVehicle(game));
  if (game.state.player.cargo.length) return info('Descarga primero las cajas de tu vehículo para cambiar');
  return action('switch', `Conducir ${type.name.toLowerCase()}`, () => enterVehicle(game, vehicle.id));
}

function computerAction(game) {
  return action('computer', 'Usar el ordenador de la oficina', () => {
    game.events.emit('officeComputer', {});
    return { ok: true, kind: 'computer' };
  });
}

/**
 * Acción disponible a pie: { kind, label, ok, reason?, run() }. Se elige el objeto más cercano dentro de
 * su alcance, dando preferencia al que la persona tiene delante (hacia donde mira).
 */
export function getFootAction(game) {
  const { state, city } = game;
  const p = state.player;
  if (p.mode !== 'foot') return null;
  const f = p.foot;
  const fx = Math.cos(f.yaw);
  const fy = Math.sin(f.yaw);
  let best = null;
  const consider = (dist, target, build) => {
    const dx = target.x - f.x;
    const dy = target.y - f.y;
    const len = Math.hypot(dx, dy) || 1;
    const facing = (dx * fx + dy * fy) / len; // 1 = justo delante, -1 = a la espalda
    const score = dist + (1 - facing) * 9;
    if (!best || score < best.score) best = { score, build };
  };

  if (isInsideDepot(city.depot, f.x, f.y)) {
    const L = depotLayout(city.depot);
    // Productos de la cinta al alcance (cada uno es un objetivo distinto: se coge el que tienes delante)
    const reachable = beltItems(game).filter((e) => distance(f.x, f.y, e.point.x, e.point.y) <= BELT_REACH);
    for (const entry of reachable) {
      consider(distance(f.x, f.y, entry.point.x, entry.point.y) - 3, entry.point, () => beltAction(game, entry, reachable));
    }
    const dBin = rectDistance(L.bin.rect, f.x, f.y);
    if (dBin <= REACH) consider(dBin, rectCenter(L.bin.rect), () => binAction(game));
    for (const table of L.tables) {
      const d = rectDistance(table.rect, f.x, f.y);
      if (d > REACH) continue;
      consider(d, rectCenter(table.rect), table.player ? () => tableAction(game) : () => stationInfo(game, table.id));
    }
    const dRack = rectDistance(L.rack.rect, f.x, f.y);
    if (dRack <= REACH) consider(dRack, rectCenter(L.rack.rect), () => rackAction(game));
    const dDesk = rectDistance(L.office.desk, f.x, f.y);
    if (dDesk <= REACH) consider(dDesk - 2, L.office.computer, () => computerAction(game));
    for (const shelf of L.shelves) {
      const d = rectDistance(shelf.rect, f.x, f.y);
      if (d <= 9) {
        const s = getShelf(shelf.id);
        consider(d + 6, rectCenter(shelf.rect), () => info(`Estantería ${s.id} · ${s.name}: el stock sale por la cinta`));
      }
    }
  }

  // Vehículo propio: trasera y puerta del conductor
  const own = playerVehiclePoints(game);
  const dRear = distance(f.x, f.y, own.rear.x, own.rear.y);
  if (dRear <= VEHICLE_REACH) consider(dRear, own.rear, () => rearAction(game));
  const dCab = distance(f.x, f.y, own.cab.x, own.cab.y);
  if (dCab <= VEHICLE_REACH) consider(dCab, own.cab, () => cabAction(game, getPlayerVehicle(state), true));

  // Otros vehículos aparcados y libres en el patio
  for (const parked of parkedVehicles(game)) {
    if (parked.vehicle.driver) continue;
    const { cab } = vehiclePoints(parked.x, parked.y, parked.angle, getVehicleType(parked.vehicle.typeId));
    const d = distance(f.x, f.y, cab.x, cab.y);
    if (d <= VEHICLE_REACH) consider(d, cab, () => cabAction(game, parked.vehicle, false));
  }

  // Puerta del destinatario
  const box = heldBox(game);
  if (box) {
    const b = city.getBuilding(box.buildingId);
    const door = deliveryDoorPoint(b);
    const d = distance(f.x, f.y, door.x, door.y);
    if (d <= DOOR_RADIUS) consider(d - 6, door, () => action('deliver', `Entregar pedido ${orderTag(box)} · ${b.name}`, () => deliverAtDoor(game, box)));
  } else if (handsEmpty(game)) {
    for (const id of p.cargo) {
      const order = getOrder(state, id);
      if (!order) continue;
      const door = deliveryDoorPoint(city.getBuilding(order.buildingId));
      const d = distance(f.x, f.y, door.x, door.y);
      if (d <= DOOR_RADIUS) consider(d + 4, door, () => info(`Saca la caja ${orderTag(order)} de la trasera del vehículo`));
    }
  }
  return best ? best.build() : null;
}

export function doFootAction(game) {
  const found = getFootAction(game);
  if (!found) return { ok: false, reason: 'Aquí no hay nada con lo que interactuar' };
  return found.run();
}

// --------------------------------------------------------------- Guía de pasos ----

/** Siguiente producto que el jugador puede ir a recoger: { order, item, where, point } o null. */
export function nextPick(game) {
  const orders = prioritized(game, game.state.orders.filter((o) => awaitingPacking(o) && o.items?.some((i) => ['queued', 'belt', 'bin'].includes(i.at))));
  const L = depotLayout(game.city.depot);
  for (const order of orders) {
    const bin = order.items.find((i) => i.at === 'bin');
    if (bin) return { order, item: bin, where: 'bin', point: rectCenter(L.bin.rect) };
    const onBelt = order.items.filter((i) => i.at === 'belt').sort((a, b) => b.pos - a.pos)[0];
    if (onBelt) return { order, item: onBelt, where: 'belt', point: beltPoint(L, onBelt.pos) };
  }
  const queued = orders.find((o) => o.items.some((i) => i.at === 'queued'));
  if (queued) {
    const item = queued.items.find((i) => i.at === 'queued');
    // Junto al tramo largo de la cinta, por donde va a pasar
    const point = beltPoint(L, L.belt.segments[0].len + 50);
    return { order: queued, item, where: 'queued', point };
  }
  return null;
}

/**
 * Siguiente paso del reparto para quien va a pie: texto para el HUD y destino para la navegación
 * ({ x, y, kind, color, label }). Devuelve null si no hay nada pendiente.
 */
export function getFootGuide(game) {
  const { state, city } = game;
  const p = state.player;
  const f = p.foot;
  const depot = city.depot;
  const L = depotLayout(depot);
  const inside = isInsideDepot(depot, f.x, f.y);
  const nearDepot = inside || distance(f.x, f.y, depot.zoneCenter.x, depot.zoneCenter.y) <= DEPOT_RADIUS;
  const points = playerVehiclePoints(game);
  const hands = handsOf(game);
  const target = (point, kind, color, label) => ({ x: point.x, y: point.y, kind, color, label });
  const rackFront = { x: L.rack.stand.x, y: L.rack.stand.y };
  const tableFront = { x: (L.table.rect.x0 + L.table.rect.x1) / 2, y: L.table.rect.y0 - 6 };

  const box = heldBox(game);
  if (box) {
    const kind = ORDER_KINDS[box.kind];
    const b = city.getBuilding(box.buildingId);
    if (!box.dispatched) return { text: `Lleva la caja ${orderTag(box)} a expedición (junto a la fachada) y pulsa E`, target: target(rackFront, 'rack', '#ffb703', 'Expedición') };
    if (nearDepot) {
      return { text: `Lleva la caja ${orderTag(box)} a la trasera del vehículo y pulsa E`, target: target(points.rear, 'vehicle', kind.color, 'Vehículo') };
    }
    return { text: `Lleva el paquete a la puerta: ${b.name}, ${b.address}`, target: target(deliveryDoorPoint(b), 'door', kind.color, b.address) };
  }
  if (hands.items.length) {
    const roomLeft = HAND_CAPACITY - handsBulk(game);
    const more = roomLeft > 0 ? nextPick(game) : null;
    if (more && more.where !== 'queued' && more.order.assignedTo === 'player') {
      return { text: `Coge también ${more.item.name} (${more.where === 'bin' ? 'cajón' : 'cinta'}) o lleva lo que tienes a la mesa`, target: target(more.point, 'belt', getShelf(more.item.shelf).color, more.item.name) };
    }
    return { text: 'Lleva los productos a la mesa de empaquetado y pulsa E', target: target(tableFront, 'table', '#ffd166', 'Mesa') };
  }
  const packable = packableOrder(game);
  if (packable) return { text: `Empaqueta el pedido ${orderTag(packable)} en la mesa`, target: target(tableFront, 'table', '#ffd166', 'Mesa') };

  const cargoOrder = p.cargo.length ? chooseCargoBox(game) : null;
  if (cargoOrder) {
    const door = deliveryDoorPoint(city.getBuilding(cargoOrder.buildingId));
    const vehicleNearDoor = distance(p.x, p.y, door.x, door.y) < 170;
    if (vehicleNearDoor) return { text: `Saca la caja ${orderTag(cargoOrder)} de la trasera del vehículo`, target: target(points.rear, 'vehicle', ORDER_KINDS[cargoOrder.kind].color, 'Vehículo') };
    if (!nearDepot || (!nextPick(game) && !rackBoxes(state).length)) {
      return { text: 'Sube al vehículo (puerta del conductor) y conduce hasta el destino', target: target(points.cab, 'vehicle', '#ffd166', 'Vehículo') };
    }
  }
  if (nearDepot) {
    const next = nextPick(game);
    if (next) {
      const color = getShelf(next.item.shelf).color;
      if (next.where === 'queued') {
        return { text: `${next.item.name} (pedido ${orderTag(next.order)}) está saliendo de recepción: espéralo junto a la cinta`, target: target(next.point, 'belt', color, 'Cinta') };
      }
      const where = next.where === 'bin' ? 'en el cajón del final de la cinta' : 'de la cinta transportadora';
      return { text: `Coge ${next.item.name} ${where} (pedido ${orderTag(next.order)})`, target: target(next.point, 'belt', color, next.item.name) };
    }
    if (rackBoxes(state).length) {
      return { text: 'Hay cajas listas en expedición: cógelas y cárgalas en el vehículo', target: target(rackFront, 'rack', '#ffb703', 'Expedición') };
    }
    if (p.cargo.length) return { text: 'Sube al vehículo (puerta del conductor) y conduce hasta el destino', target: target(points.cab, 'vehicle', '#ffd166', 'Vehículo') };
    // Tutorial: las mejoras solo se compran desde la oficina
    const tutorial = state.tutorial;
    if (!tutorial.done && TUTORIAL_STEPS[tutorial.step]?.id === 'upgrade' && !isInsideOffice(depot, f.x, f.y)) {
      return { text: 'Entra en la oficina (esquina del fondo a la izquierda) y usa el ordenador para comprar tu primera mejora', target: target(L.office.computerStand, 'office', '#8ecae6', 'Oficina') };
    }
    return null;
  }
  return { text: 'Vuelve a tu vehículo', target: target(points.cab, 'vehicle', '#ffd166', 'Vehículo') };
}
