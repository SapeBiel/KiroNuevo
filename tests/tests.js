// Pruebas automáticas en el navegador: lógica del juego, guardado, interfaz y arranque completo.
// Se ejecutan abriendo tests/index.html a través del servidor local (ver README).

import { Game } from '../js/core/game.js';
import { createCity } from '../js/world/cityMap.js';
import { createPathService } from '../js/world/pathfinding.js';
import { saveState, loadState, clearSave } from '../js/core/storage.js';
import { SAVE_KEY, TILE, DAY_LENGTH, DEFAULT_CITY_SEED } from '../js/config/constants.js';
import { ZONE_ORDER } from '../js/config/zones.js';
import { UPGRADES } from '../js/config/upgrades.js';
import { ACHIEVEMENTS } from '../js/config/achievements.js';
import { getLevelUnlocks, xpToNextLevel } from '../js/config/levels.js';
import { createOrder, completeDelivery, getOrder, cargoSlotsUsed, loadBest, deliverNearby } from '../js/systems/orders.js';
import {
  awaitingPacking, getFootAction, loadIntoVehicle, packOrder, placeOnTable, rackBoxes, storeOnRack, takeFromRack, takeItem,
} from '../js/systems/handling.js';
import { GRAVITY, JUMP_SPEED, exitVehicle, playerVehiclePoints } from '../js/systems/onFoot.js';
import { BELT_WIDTH, beltPoint, depotColliders, depotLayout, isInsideDepot } from '../js/world/depotLayout.js';
import { depotPath } from '../js/world/depotNav.js';
import { SIGN_SHOW_DISTANCE, nearestLockedZone, signOpacity } from '../js/world/zoneBorder.js';
import { BOX_SIZES, PRODUCTS, boxSizeFor, productInfo } from '../js/config/products.js';
import { getPickerRuntime, stationFor } from '../js/systems/warehouseStaff.js';
import { deliveryDoorPoint } from '../js/world/lotLayout.js';
import { computeReward, chargeOperating, incomePerMinute } from '../js/systems/economy.js';
import { addXp } from '../js/systems/progression.js';
import { endDay } from '../js/systems/dayCycle.js';
import { getUpgradeStatus, upgradeCost } from '../js/systems/upgrades.js';
import { setHtml } from '../js/ui/dom.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message = 'Condición falsa') {
  if (!condition) throw new Error(message);
}
const near = (a, b, tolerance, message) => assert(Math.abs(a - b) <= tolerance, `${message ?? 'Valores distintos'}: ${a} vs ${b}`);

/**
 * Partida de prueba. Por defecto, al volante en la salida del almacén y con el primer pedido ya empaquetado
 * (las pruebas de economía usan las funciones internas loadBest/deliverNearby, las mismas que la simulación).
 * Con { foot: true } es una partida tal cual empieza: a pie dentro del almacén y con el pedido por preparar.
 * Las mejoras solo se compran desde la oficina; para no teletransportar a nadie, por defecto las pruebas compran
 * como si estuvieran allí. Con { office: false } se usa la comprobación real de la posición.
 */
function fresh(overrides = {}, { foot = false, office = true } = {}) {
  // Semilla fija: las pruebas usan siempre la misma ciudad
  const game = Game.create({ loadSave: false, persist: false, seed: DEFAULT_CITY_SEED });
  if (office) game.isPlayerInOffice = () => true;
  game.state.tutorial.welcomed = true;
  if (!foot) {
    const p = game.state.player;
    p.mode = 'drive';
    p.x = game.city.depot.startX; p.y = game.city.depot.startY; p.angle = 0;
    for (const order of game.state.orders) quickPack(order);
  }
  Object.assign(game.state, overrides);
  game.recomputeStats();
  return game;
}

/** Deja un pedido empaquetado en expedición (como si lo hubiera preparado un preparador). */
function quickPack(order) {
  order.prep = 0;
  order.readySince = -100;
  for (const item of order.items) item.at = 'box';
  return order;
}
const quickLoad = (game) => { toDepot(game); return loadBest(game); };
const quickDeliver = (game, order) => { toDrop(game, order); return deliverNearby(game); };

/** Coloca a la persona en un punto mirando hacia otro. */
function standAt(game, x, y, lookX = x, lookY = y - 1) {
  const f = game.state.player.foot;
  f.x = x; f.y = y; f.yaw = Math.atan2(lookY - y, lookX - x);
}

const available = (item) => item.at === 'belt' || item.at === 'bin';

/**
 * Hace avanzar la simulación hasta que todos los productos del pedido han salido de recepción a la cinta
 * (o han caído al cajón). Se sigue el pedido para que la cinta lo saque primero.
 */
function releaseItems(game, order, maxSeconds = 90) {
  game.trackedOrderId = order.id;
  for (let t = 0; t < maxSeconds && order.items.some((i) => i.at === 'queued'); t += 0.05) game.update(0.05);
  return order.items.every((i) => available(i) || i.at === 'hand' || i.at === 'table');
}

/** Coge un producto concreto del pedido (esperando a que llegue a la cinta si hace falta). */
function takeOrderItem(game, order, index) {
  const item = order.items[index];
  for (let t = 0; t < 90 && item.at === 'queued'; t += 0.05) {
    game.trackedOrderId = order.id;
    game.update(0.05);
  }
  return takeItem(game, order, index);
}

/** Prepara un pedido con las acciones de bajo nivel (cinta, mesa, empaquetar) y deja la caja en expedición. */
function handPrepare(game, order) {
  if (!releaseItems(game, order)) return false;
  for (let index = 0; index < order.items.length; index++) {
    if (!available(order.items[index])) continue;
    if (!takeItem(game, order, index).ok) {
      if (!placeOnTable(game).ok || !takeItem(game, order, index).ok) return false;
    }
  }
  if (game.state.player.hands.items.length && !placeOnTable(game).ok) return false;
  if (!packOrder(game).ok) return false;
  storeOnRack(game);
  game.trackedOrderId = null;
  return true;
}

function advance(game, seconds, { dt = 0.05, ackSummary = true } = {}) {
  for (let t = 0; t < seconds; t += dt) {
    if (game.state.pendingSummary && ackSummary) game.acknowledgeSummary();
    game.update(dt);
  }
}

const toDepot = (game) => { game.state.player.x = game.city.depot.zoneCenter.x; game.state.player.y = game.city.depot.zoneCenter.y; };
const toDrop = (game, order) => {
  const b = game.city.getBuilding(order.buildingId);
  game.state.player.x = b.dropX; game.state.player.y = b.dropY;
};
const unlockAll = (game) => {
  for (const id of ZONE_ORDER) game.state.zones[id] = true;
  game.city.setUnlockedZones(game.state.zones);
};
const readyOrder = (game, options = {}) => {
  const order = createOrder(game, { kind: 'small', instantReady: true, ...options });
  order.readySince = game.state.time - 10;
  return order;
};

// ---------------------------------------------------------------- Ciudad ----

test('Ciudad: el almacén y la posición inicial son válidos', () => {
  const city = createCity();
  assert(city.depot, 'No hay almacén');
  assert(!city.circleHitsSolid(city.depot.startX, city.depot.startY, 12), 'La furgoneta empieza dentro de un obstáculo');
});

test('Ciudad: cada zona tiene suficientes destinos y todos son alcanzables', () => {
  const city = createCity();
  const flags = Object.fromEntries(ZONE_ORDER.map((z) => [z, true]));
  city.setUnlockedZones(flags);
  const paths = createPathService(city);
  for (const zone of ZONE_ORDER) {
    const list = city.buildingsInZone(zone);
    assert(list.length >= 8, `La zona ${zone} solo tiene ${list.length} edificios`);
  }
  for (const b of city.buildings) {
    assert(!city.circleHitsSolid(b.dropX, b.dropY, 12), `Zona de entrega bloqueada en ${b.id}`);
    const route = paths.route({ x: city.depot.dropX, y: city.depot.dropY }, { x: b.dropX, y: b.dropY });
    assert(route, `Sin ruta hasta ${b.id} (${b.zoneId})`);
    const straight = Math.hypot(b.dropX - city.depot.dropX, b.dropY - city.depot.dropY);
    assert(route.length >= straight - 1, 'La ruta no puede ser más corta que la línea recta');
  }
});

test('Ciudad: las zonas bloqueadas son sólidas y se abren al desbloquearlas', () => {
  const game = fresh();
  const downtown = game.city.buildingsInZone('downtown')[0];
  assert(game.city.circleHitsSolid(downtown.dropX, downtown.dropY, 10), 'El centro debería estar bloqueado');
  game.state.level = 4; game.state.money = 5000; game.recomputeStats();
  assert(game.unlockZone('downtown').ok, 'No se pudo desbloquear');
  assert(!game.city.circleHitsSolid(downtown.dropX, downtown.dropY, 10), 'El centro sigue bloqueado');
  assert(game.state.money === 2500, 'No se cobró el precio de la zona');
});

test('Zonas: el cartel de una zona bloqueada solo sale muy cerca de su borde', () => {
  const game = fresh();
  const { city } = game;
  const locked = (tx, ty) => !city.isZoneUnlocked(city.zoneIdAtTile(tx, ty));
  // Una casilla abierta con una bloqueada justo a la derecha
  let edge = null;
  for (let ty = 0; ty < city.height && !edge; ty++) {
    for (let tx = 0; tx < city.width - 1 && !edge; tx++) if (!locked(tx, ty) && locked(tx + 1, ty)) edge = { tx, ty };
  }
  assert(edge, 'No hay frontera con una zona bloqueada');
  const borderX = (edge.tx + 1) * TILE;
  const y = (edge.ty + 0.5) * TILE;
  const close = nearestLockedZone(city, borderX - 10, y);
  assert(close && !city.isZoneUnlocked(close.zoneId) && close.dist <= 10.01, 'Junto al borde debe salir el cartel');
  assert(signOpacity(close.dist) === 1, 'Muy cerca se ve entero');
  // Lejos de cualquier borde no sale
  let inland = null;
  for (let ty = 3; ty < city.height - 3 && !inland; ty++) {
    for (let tx = 3; tx < city.width - 3 && !inland; tx++) {
      let clear = true;
      for (let dy = -3; dy <= 3 && clear; dy++) for (let dx = -3; dx <= 3 && clear; dx++) if (locked(tx + dx, ty + dy)) clear = false;
      if (clear) inland = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
  }
  assert(inland && nearestLockedZone(city, inland.x, inland.y) === null, 'Lejos del borde no debe salir el cartel');
  assert(signOpacity(SIGN_SHOW_DISTANCE + 1) === 0 && signOpacity(SIGN_SHOW_DISTANCE - 1) > 0, 'Aparece de forma gradual');
  // Al desbloquearla deja de salir
  game.state.level = 20; game.state.money = 1e9; game.recomputeStats();
  for (const id of ZONE_ORDER) game.unlockZone(id);
  assert(nearestLockedZone(city, borderX - 10, y) === null, 'Una zona desbloqueada no tiene cartel');
});

test('Zonas: respetan nivel, dinero y zona contigua', () => {
  const game = fresh({ money: 1000000 });
  assert(!game.unlockZone('downtown').ok, 'Centro sin nivel');
  game.state.level = 5; game.recomputeStats();
  assert(!game.unlockZone('commercial').ok, 'Comercial sin Centro');
  assert(game.unlockZone('downtown').ok);
  assert(game.unlockZone('commercial').ok);
  game.state.money = 10;
  assert(!game.unlockZone('industrial').ok, 'Industrial sin nivel/dinero');
});

test('Rutas: las paradas múltiples son crecientes', () => {
  const game = fresh();
  unlockAll(game);
  const houses = game.city.buildingsInZone('residential').slice(0, 3);
  const d = game.city.depot;
  const route = game.paths.routeThrough([{ x: d.dropX, y: d.dropY }, ...houses.map((h) => ({ x: h.dropX, y: h.dropY })), { x: d.dropX, y: d.dropY }]);
  assert(route, 'Sin ruta');
  for (let i = 1; i < route.stopDistances.length; i++) assert(route.stopDistances[i] >= route.stopDistances[i - 1], 'Paradas desordenadas');
  near(route.stopDistances.at(-1), route.length, 1, 'La última parada debe ser el final de la ruta');
});

// ------------------------------------------------------- Partida inicial ----

test('Inicio: a pie en el almacén, con la furgoneta en el patio y un pedido por preparar', () => {
  const game = fresh({}, { foot: true });
  const s = game.state;
  assert(s.vehicles.length === 1 && s.money === 50 && s.level === 1, 'Estado inicial incorrecto');
  assert(s.orders.length === 1, 'Debe haber un único pedido');
  const order = s.orders[0];
  assert(order.kind === 'small' && order.prep > 0 && order.status === 'pending', 'El primer pedido se prepara a mano');
  assert(order.items.length === 1 && order.items[0].at === 'queued' && order.items[0].name === 'Libro de bienvenida', 'El libro espera en recepción para salir por la cinta');
  assert(productInfo(order.items[0].name).shape === 'book', 'El libro tiene forma de libro');
  assert(game.city.getBuilding(order.buildingId).kind === 'house', 'El primer destino debe ser una casa');
  assert(s.player.mode === 'foot' && isInsideDepot(game.city.depot, s.player.foot.x, s.player.foot.y), 'Se empieza a pie dentro del almacén');
  assert(game.isPlayerInDepot(), 'La furgoneta está aparcada en el patio del almacén');
  assert(game.derived.prepLanes === 0, 'Sin preparadores nadie empaqueta solo');
  const f = s.player.foot;
  assert(!game.city.circleHitsSolid(f.x, f.y, 4.5, { walker: true }), 'La persona empieza dentro de un obstáculo');
  assert(!game.city.circleHitsSolid(s.player.x, s.player.y, 10), 'La furgoneta empieza dentro de un obstáculo');
});

// ------------------------------------------------------------ Conducción ----

test('Conducción: acelera, no supera la velocidad máxima y se mueve', () => {
  const game = fresh();
  const p = game.state.player;
  const start = { x: p.x, y: p.y };
  game.controls.throttle = 1;
  advance(game, 3);
  const max = game.getPlayerStats().maxSpeed;
  assert(Math.hypot(p.x - start.x, p.y - start.y) > 50, 'No se movió');
  assert(p.speed <= max + 0.001 && p.speed > max * 0.9, `Velocidad inesperada ${p.speed}`);
  game.controls.throttle = 0;
  advance(game, 4);
  assert(Math.abs(p.speed) < 1, 'Debe frenar sola');
});

test('Conducción: no atraviesa edificios ni sale del mapa', () => {
  const game = fresh();
  const p = game.state.player;
  p.angle = -Math.PI / 2; // hacia el norte, contra la fachada sur del almacén
  p.x = game.city.depot.doorX; p.y = game.city.depot.doorY + 30;
  game.controls.throttle = 1;
  advance(game, 3);
  assert(!game.city.circleHitsSolid(p.x, p.y, 8), 'Terminó dentro de un edificio');
  assert(p.y > game.city.depot.doorY, 'Atravesó el almacén');
  p.x = 60; p.y = game.city.depot.startY; p.angle = Math.PI; p.speed = 100;
  advance(game, 5);
  assert(p.x > 0, 'La furgoneta debe quedarse dentro del mapa');
  assert(p.x >= 0 && p.y >= 0 && p.x <= game.city.widthPx && p.y <= game.city.heightPx, 'Salió del mapa');
});

test('Conducción: la gasolina cuesta dinero pero nunca deja saldo negativo', () => {
  const game = fresh({ money: 3 });
  game.controls.throttle = 1;
  for (let i = 0; i < 12; i++) {
    game.state.player.angle = i % 2 ? Math.PI : 0;
    advance(game, 1.5);
    assert(game.state.money >= 0, 'Saldo negativo');
  }
  assert(game.state.money >= 0, 'Saldo negativo');
  assert(game.state.stats.expenses.fuel > 0, 'No se cobró combustible');
});

// ------------------------------------------------------- Ciclo de entrega ----

test('Reparto a pie de principio a fin: recoger, empaquetar, cargar, conducir, bajar y entregar en la puerta', () => {
  const game = fresh({}, { foot: true });
  const { state, city } = game;
  const order = state.orders[0];
  const L = depotLayout(city.depot);
  const center = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

  void center;

  // 1) Cinta: el libro sale de recepción, avanza y se coge el que pasa por delante
  const item = order.items[0];
  for (let t = 0; t < 20 && !(item.at === 'belt' && item.pos >= 40); t += 0.05) game.update(0.05);
  assert(item.at === 'belt' && item.pos >= 40, `El producto no avanza por la cinta (${item.at}, ${item.pos})`);
  const p = beltPoint(L, item.pos);
  // De pie junto al tramo que baja de recepción, mirando al producto
  standAt(game, p.x - (BELT_WIDTH / 2 + 7), p.y, p.x, p.y);
  const pickAction = game.getContextAction();
  assert(pickAction?.kind === 'pick' && pickAction.label.includes(item.name), `Delante de la cinta debería poder coger (${pickAction?.label})`);
  assert(game.interact().ok, 'No cogió el producto');
  assert(item.at === 'hand' && order.assignedTo === 'player' && state.player.hands.items.length === 1, 'El producto no está en las manos');

  // 2) Mesa: dejarlo y empaquetar
  const t = L.table.rect;
  standAt(game, (t.x0 + t.x1) / 2, t.y1 + 8, (t.x0 + t.x1) / 2, t.y0);
  assert(game.interact().kind === 'place' && item.at === 'table', 'No lo dejó en la mesa');
  const packed = game.interact();
  assert(packed.ok && packed.kind === 'pack' && state.player.hands.box === order.id && order.prep === 0, 'No empaquetó');
  assert(state.stats.boxesPacked === 1, 'Sin estadística de empaquetado');

  // 3) Expedición: sin registrar la caja no se puede cargar; se registra y se vuelve a coger
  assert(!order.dispatched && !loadIntoVehicle(game).ok, 'Una caja sin pasar por expedición no se carga');
  standAt(game, L.rack.stand.x, L.rack.stand.y, L.rack.rect.x0, (L.rack.rect.y0 + L.rack.rect.y1) / 2);
  const stored = game.interact();
  assert(stored.ok && stored.kind === 'store' && order.dispatched && !state.player.hands.box && rackBoxes(state).includes(order), `No la registró (${stored.reason})`);
  assert(state.stats.boxesDispatched === 1, 'Sin estadística de expedición');
  const taken = game.interact();
  assert(taken.ok && taken.kind === 'take' && state.player.hands.box === order.id, 'No cogió la caja de expedición');

  // 4) Trasera del vehículo: cargar la caja
  let points = playerVehiclePoints(game);
  standAt(game, points.rear.x, points.rear.y, state.player.x, state.player.y);
  const loaded = game.interact();
  assert(loaded.ok && loaded.kind === 'load' && state.player.cargo.includes(order.id) && !state.player.hands.box, 'No cargó la caja');

  // 4) Puerta del conductor: subir y conducir hasta el destino
  standAt(game, points.cab.x, points.cab.y, state.player.x, state.player.y);
  assert(game.interact().kind === 'enter' && state.player.mode === 'drive', 'No subió al vehículo');
  toDrop(game, order);
  state.player.speed = 0;
  assert(game.getContextAction()?.kind === 'exit', 'Al volante, E debe bajar del vehículo');
  assert(game.getDeliverableOrders().length === 1, 'Debería estar aparcado en la zona de entrega');

  // 5) Bajar, sacar la caja de la trasera y llevarla a la puerta
  assert(game.interact().kind === 'exit' && state.player.mode === 'foot', 'No se bajó');
  points = playerVehiclePoints(game);
  standAt(game, points.rear.x, points.rear.y, state.player.x, state.player.y);
  assert(game.interact().kind === 'unload' && state.player.hands.box === order.id && !state.player.cargo.length, 'No sacó la caja');
  const money = state.money;
  const building = city.getBuilding(order.buildingId);
  const door = deliveryDoorPoint(building);
  standAt(game, door.x + 30, door.y, door.x, door.y);
  assert(game.getContextAction()?.kind !== 'deliver', 'No se puede entregar lejos de la puerta');
  standAt(game, door.x, door.y, building.centerX, building.centerY);
  const delivered = game.interact();
  assert(delivered.ok && delivered.kind === 'deliver', `No entregó en la puerta (${delivered.reason})`);
  const reward = delivered.delivered[0].reward;
  assert(reward > 0 && state.money === money + reward && state.stats.deliveries === 1 && state.stats.manualDeliveries === 1, 'Pago o estadísticas');
  assert(!state.orders.includes(order) && !state.player.hands.box, 'El pedido sigue activo');
  assert(completeDelivery(game, order, { type: 'player' }) === null && state.money === money + reward, 'Segundo pago permitido');
});

test('Entrega rápida interna (simulación y automatización): cobra una vez y exige estar en la zona', () => {
  const game = fresh();
  const order = game.state.orders[0];
  assert(quickLoad(game) === 1 && order.status === 'picked' && game.state.player.cargo.includes(order.id), 'No cargó');
  assert(quickLoad(game) === 0, 'No debería quedar nada más que cargar');
  assert(game.getDeliverableOrders().length === 0, 'No debe poder entregar desde el almacén');
  const b = game.city.getBuilding(order.buildingId);
  game.state.player.x = b.dropX + 200; game.state.player.y = b.dropY;
  assert(deliverNearby(game).length === 0, 'Entregó demasiado lejos');
  const before = game.state.money;
  game.state.player.x = b.dropX + 40;
  const result = deliverNearby(game);
  assert(result.length === 1 && game.state.money === before + result[0].reward, 'No entregó a 40 px');
  assert(game.state.stats.deliveries === 1 && game.state.stats.totalEarned === result[0].reward && game.state.xp > 0, 'Estadísticas');
  assert(deliverNearby(game).length === 0 && completeDelivery(game, order, { type: 'player' }) === null, 'Segundo pago permitido');
});

test('A pie: la puerta peatonal del almacén deja pasar a las personas, no a los vehículos', () => {
  const game = fresh({}, { foot: true });
  const L = depotLayout(game.city.depot);
  const y = (L.inner.y1 + L.outer.y1) / 2;
  assert(!game.city.circleHitsSolid(L.doorX, y, 4.5, { walker: true }), 'La persona no cabe por la puerta');
  assert(game.city.circleHitsSolid(L.doorX, y, 10), 'Un vehículo no debería caber por la puerta');
  assert(game.city.circleHitsSolid(L.doorX + 40, y, 4.5, { walker: true }), 'La barandilla debería frenar a la persona');
  // Andar de verdad hacia la puerta desde dentro
  const f = game.state.player.foot;
  game.controls.walkX = 0; game.controls.walkY = 1;
  for (let i = 0; i < 60; i++) { game.controls.walkX = (L.doorX - f.x) * 0.2; game.controls.walkY = 1; game.update(0.05); }
  assert(f.y > L.outer.y1, `No salió del almacén (y=${f.y.toFixed(1)})`);
  assert(game.state.player.speed === 0, 'El vehículo no se mueve mientras se va a pie');
});

test('Cinta: los productos salen de recepción, avanzan sin parar y los que nadie coge caen al cajón', () => {
  const game = fresh({}, { foot: true });
  const L = depotLayout(game.city.depot);
  const item = game.state.orders[0].items[0];
  let last = -1;
  let moved = 0;
  for (let t = 0; t < 40 && item.at !== 'bin'; t += 0.05) {
    game.update(0.05);
    if (item.at === 'belt') {
      assert(item.pos >= last, 'El producto retrocedió en la cinta');
      if (last >= 0) moved += item.pos - last;
      last = item.pos;
    }
  }
  assert(moved > L.belt.length * 0.9, `El producto no recorrió la cinta (${moved.toFixed(1)} de ${L.belt.length.toFixed(1)})`);
  assert(item.at === 'bin' && game.state.orders[0].items.length === 1, 'El producto debe acabar en el cajón, sin desaparecer');
  // Sigue disponible: se puede coger desde el cajón
  const bin = L.bin.rect;
  standAt(game, (bin.x0 + bin.x1) / 2, bin.y1 + 7, (bin.x0 + bin.x1) / 2, bin.y0);
  const action = getFootAction(game);
  assert(action?.kind === 'pick' && action.label.includes('cajón'), `Desde el cajón se debe poder coger (${action?.label})`);
  assert(action.run().ok && item.at === 'hand', 'No lo cogió del cajón');
  // Los puntos de la cinta están sobre ella y el recorrido acaba en el cajón
  const end = beltPoint(L, L.belt.length);
  assert(Math.abs(end.x - bin.x1) < 1 && end.y > bin.y0 && end.y < bin.y1, 'La cinta debe terminar en el cajón');
});

test('Cinta: con varios pedidos sale un producto cada vez, con separación, y no se cogen productos ajenos', () => {
  const game = fresh({ level: 4, money: 100000 }, { foot: true });
  for (const contents of ['Libro', 'Camiseta', 'Cafetera']) createOrder(game, { kind: 'small', contents });
  advance(game, 6);
  const onBelt = game.state.orders.flatMap((o) => o.items).filter((i) => i.at === 'belt').map((i) => i.pos).sort((a, b) => a - b);
  assert(onBelt.length >= 3, `Deberían ir varios productos en la cinta (${onBelt.length})`);
  for (let i = 1; i < onBelt.length; i++) assert(onBelt[i] - onBelt[i - 1] >= 11.9, 'Productos amontonados en la cinta');
  // Un pedido reservado por un preparador no lo puede coger el jugador
  const order = game.state.orders.find((o) => o.items.some((i) => i.at === 'belt'));
  const index = order.items.findIndex((i) => i.at === 'belt');
  order.assignedTo = 'w_fake';
  const r = takeItem(game, order, index);
  assert(!r.ok && order.items[index].at === 'belt', 'Se pudo coger un producto reservado por otro');
});

test('Salto: solo desde el suelo, con gravedad, sin saltos en el aire y desactivado al conducir', () => {
  const game = fresh({}, { foot: true });
  const f = game.state.player.foot;
  const events = [];
  game.events.on('playerJumped', () => events.push('jump'));
  game.events.on('playerLanded', () => events.push('land'));
  const dt = 0.01;
  game.controls.jump = true;
  game.update(dt);
  assert(f.z > 0 && f.vz > 0 && events[0] === 'jump', 'No saltó');
  let peak = f.z;
  // Pulsar otra vez en el aire no hace nada
  for (let i = 0; i < 4; i++) { game.controls.jump = true; game.update(dt); peak = Math.max(peak, f.z); }
  assert(events.filter((e) => e === 'jump').length === 1, 'Saltó en el aire');
  for (let i = 0; i < 200 && f.z > 0; i++) { game.update(dt); peak = Math.max(peak, f.z); }
  const expectedPeak = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
  assert(f.z === 0 && f.vz === 0 && events.includes('land'), 'No aterrizó');
  near(peak, expectedPeak, 0.8, 'Altura del salto');
  // Mantener la tecla no repite el salto: hace falta una pulsación nueva (la consume onFoot)
  assert(game.controls.jump === false, 'La pulsación debe consumirse');
  game.controls.jump = true;
  game.update(dt);
  game.update(dt);
  assert(events.filter((e) => e === 'jump').length === 2, 'Desde el suelo se puede volver a saltar');
  // En el aire no se sube al vehículo
  const inAir = game.enterVehicle();
  assert(!inAir.ok && inAir.reason.includes('suelo') && game.state.player.mode === 'foot', 'No se sube al vehículo en pleno salto');
  for (let i = 0; i < 200 && f.z > 0; i++) game.update(dt);
  // Las colisiones siguen activas en el aire: saltar contra la pared no la atraviesa
  const L = depotLayout(game.city.depot);
  standAt(game, L.inner.x1 - 8, L.inner.y0 + 120, L.inner.x1 + 10, L.inner.y0 + 120);
  for (let i = 0; i < 30; i++) {
    game.controls.jump = i % 10 === 0;
    game.controls.walkX = 1; game.controls.walkY = 0;
    game.update(0.05);
  }
  game.controls.walkX = 0;
  assert(f.x < L.inner.x1 - 3, `Atravesó la pared saltando (x=${f.x.toFixed(1)})`);
  const drive = fresh();
  drive.controls.jump = true;
  drive.update(0.05);
  assert((drive.state.player.foot.z ?? 0) === 0 && drive.state.player.mode === 'drive', 'Al volante no se salta');
});

test('Oficina: se puede entrar, el ordenador abre la gestión y tiene sus muebles con colisión', () => {
  const game = fresh({}, { foot: true });
  const L = depotLayout(game.city.depot);
  const o = L.office;
  // La puerta deja pasar y los tabiques no
  assert(!game.city.circleHitsSolid(o.door.x, o.door.y, 4.5, { walker: true }), 'La puerta de la oficina no deja pasar');
  assert(game.city.circleHitsSolid(o.door.x0 - 12, o.door.y, 4.5, { walker: true }), 'El tabique de la oficina no tiene colisión');
  for (const r of [o.desk, o.cabinets, o.bookcase, o.plant]) {
    assert(game.city.circleHitsSolid((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 2, { walker: true }), 'Mueble de la oficina sin colisión');
  }
  // Se llega andando desde la entrada hasta el ordenador
  const path = depotPath(game.city, L.walkStart, o.computerStand);
  const last = path[path.length - 1];
  assert(Math.hypot(last.x - o.computerStand.x, last.y - o.computerStand.y) < 0.01, 'Sin ruta hasta el ordenador');
  let from = L.walkStart;
  for (const point of path) {
    for (let k = 1; k <= 8; k++) {
      const x = from.x + ((point.x - from.x) * k) / 8;
      const y = from.y + ((point.y - from.y) * k) / 8;
      assert(!game.city.circleHitsSolid(x, y, 1, { walker: true }), `La ruta hasta la oficina cruza un obstáculo en (${x.toFixed(1)}, ${y.toFixed(1)})`);
    }
    from = point;
  }
  standAt(game, o.computerStand.x, o.computerStand.y, o.computer.x, o.computer.y);
  let opened = 0;
  game.events.on('officeComputer', () => opened++);
  const action = game.getContextAction();
  assert(action?.kind === 'computer', `Junto a la mesa debe ofrecer el ordenador (${action?.label})`);
  assert(game.interact().ok && opened === 1, 'El ordenador no abrió la gestión');
});

test('Almacén: los puntos de trabajo están libres y conectados, y la expedición es obligatoria antes de cargar', () => {
  const game = fresh({}, { foot: true });
  const L = depotLayout(game.city.depot);
  const free = (p, label) => assert(!game.city.circleHitsSolid(p.x, p.y, 3, { walker: true }), `${label} está dentro de un obstáculo`);
  free(L.walkStart, 'La entrada');
  free(L.rack.stand, 'El frente de expedición');
  free(L.office.computerStand, 'El sitio del ordenador');
  L.stations.forEach((s, i) => free(s.stand, `El puesto ${i + 1}`));
  L.pickupSpots.forEach((s, i) => free(s, `El punto de recogida ${i + 1}`));
  // Todos los colisionadores del almacén quedan dentro del edificio
  for (const r of depotColliders(game.city.depot)) {
    assert(r.x0 >= L.outer.x0 - 0.01 && r.x1 <= L.outer.x1 + 0.01 && r.y0 >= L.outer.y0 - 0.01 && r.y1 <= L.outer.y1 + 0.01, 'Colisionador fuera del almacén');
  }
  // Cada puesto se comunica con el cajón y con expedición
  for (const s of L.stations) {
    for (const target of [L.pickupSpots[0], L.rack.stand]) {
      const path = depotPath(game.city, s.stand, target);
      let from = s.stand;
      for (const point of path) {
        const steps = Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / 2);
        for (let k = 1; k <= steps; k++) {
          const x = from.x + ((point.x - from.x) * k) / steps;
          const y = from.y + ((point.y - from.y) * k) / steps;
          assert(!game.city.circleHitsSolid(x, y, 1, { walker: true }), `Ruta bloqueada desde el puesto ${s.index + 1}`);
        }
        from = point;
      }
    }
  }
  // Una caja empaquetada a mano no se carga sin pasar por expedición
  const order = game.state.orders[0];
  assert(handPrepare(game, order) && order.dispatched, 'Preparar a mano');
  assert(takeFromRack(game).ok && loadIntoVehicle(game).ok, 'Con la caja registrada sí se carga');
});

test('Pedidos con varios productos: no se cierran hasta tenerlos todos en la mesa', () => {
  const game = fresh({ level: 2 }, { foot: true });
  const order = createOrder(game, { kind: 'medium', items: ['Cafetera', 'Auriculares'] });
  assert(order.items.length === 2 && order.items[0].shelf === 'D' && order.items[1].shelf === 'B', 'Productos o estanterías');
  assert(order.contents === 'Cafetera + 1 más', `Resumen del contenido: ${order.contents}`);
  assert(takeOrderItem(game, order, 0).ok && placeOnTable(game).ok, 'Primer producto');
  assert(!packOrder(game).ok, 'No debería empaquetar con un producto en falta');
  assert(takeOrderItem(game, order, 1).ok && placeOnTable(game).ok, 'Segundo producto');
  const packed = packOrder(game);
  assert(packed.ok && packed.order === order && order.items.every((i) => i.at === 'box'), 'No empaquetó el pedido completo');
  const extra = createOrder(game, { kind: 'small', contents: 'Libro' });
  assert(!takeOrderItem(game, extra, 0).ok, 'Con una caja en las manos no se cogen productos');
  // La caja se adapta a lo que lleva dentro
  const size = boxSizeFor(order);
  for (const name of ['Cafetera', 'Auriculares']) {
    const dims = [...productInfo(name).size].sort((a, b) => b - a);
    assert(Math.max(size[0], size[2]) >= dims[0] && Math.min(size[0], size[2]) >= dims[1], `${name} no cabe en su caja`);
  }
});

test('Productos: cada uno tiene forma, medidas y volumen propios, y la caja crece con lo que lleva', () => {
  const shapes = new Set(Object.values(PRODUCTS).map((p) => p.shape));
  assert(shapes.size >= 15, `Pocas formas distintas: ${shapes.size}`);
  for (const [name, p] of Object.entries(PRODUCTS)) {
    assert(p.size.length === 3 && p.size.every((v) => v > 0), `Medidas de ${name}`);
    assert(p.bulk >= 1 && p.bulk <= 3, `Volumen de ${name}`);
  }
  assert(PRODUCTS['Libro'].shape === 'book' && PRODUCTS['Cosmética'].shape === 'bottle' && PRODUCTS['Bicicleta'].shape === 'bike', 'Formas básicas');
  const small = boxSizeFor({ size: 'small', items: [{ name: 'Libro' }] });
  assert(small[0] >= BOX_SIZES.small[0] && small[1] === BOX_SIZES.small[1] && small[2] === BOX_SIZES.small[2], `Caja pequeña: ${small}`);
  const sofa = boxSizeFor({ size: 'large', items: [{ name: 'Sofá desmontado' }] });
  assert(Math.max(sofa[0], sofa[2]) >= 11.5, 'La caja de un sofá debe ser alargada');
});

test('Preparadores: empaquetan solos y dejan la caja en expedición, sin tocar lo que preparas tú', () => {
  const game = fresh({ level: 4, money: 100000 }, { foot: true });
  const mine = game.state.orders[0];
  assert(takeOrderItem(game, mine, 0).ok && mine.assignedTo === 'player', 'Reservar el pedido propio');
  game.trackedOrderId = null;
  const other = createOrder(game, { kind: 'small', contents: 'Camiseta' });
  const hire = game.hireWorker('picker');
  assert(hire.ok && game.derived.prepLanes === 1, 'Contratar preparador');
  const worker = hire.worker;
  const seen = { reserved: false, walked: false, carried: false, packing: false, touchedMine: false };
  const start = { ...getPickerRuntime(game, worker) };
  for (let i = 0; i < 6000 && !(other.dispatched && !other.assignedTo && other.prep === 0); i++) {
    game.update(0.05);
    const rt = getPickerRuntime(game, worker);
    if (other.assignedTo === worker.id) seen.reserved = true;
    if (Math.hypot(rt.x - start.x, rt.y - start.y) > 10) seen.walked = true;
    if (other.items.some((it) => it.at === 'worker' && it.by === worker.id)) seen.carried = true;
    if (rt.phase === 'packing') seen.packing = true;
    if (mine.assignedTo !== 'player' || mine.items[0].at !== 'hand') seen.touchedMine = true;
    // Ningún preparador atraviesa muebles ni paredes
    assert(!game.city.circleHitsSolid(rt.x, rt.y, 1, { walker: true }), `El preparador se metió en un obstáculo (${rt.x.toFixed(1)}, ${rt.y.toFixed(1)}, ${rt.phase})`);
  }
  assert(seen.reserved && seen.walked && seen.carried && seen.packing, `El preparador no hizo el trabajo físico: ${JSON.stringify(seen)}`);
  assert(other.prep === 0 && other.items.every((i) => i.at === 'box') && rackBoxes(game.state).includes(other), 'El preparador no lo dejó en expedición');
  assert(!seen.touchedMine && mine.prep > 0 && mine.assignedTo === 'player' && mine.items[0].at === 'hand', 'El preparador tocó el pedido del jugador');
  assert(game.state.stats.boxesPacked === 0, 'Las cajas del equipo no cuentan como empaquetadas por ti');
  // La caja de expedición se puede coger y volver a dejar (antes se deja el producto en la mesa)
  placeOnTable(game);
  assert(takeFromRack(game).ok && game.state.player.hands.box === other.id && other.assignedTo === 'player', 'Coger de expedición');
  assert(storeOnRack(game).ok && !other.assignedTo && rackBoxes(game.state).includes(other), 'Dejar en expedición');
});

test('Preparadores: si se despide a uno, los demás no se quedan atascados al cambiar de puesto', () => {
  const game = fresh({ level: 4, money: 100000 }, { foot: true });
  game.state.orders.length = 0;
  const first = game.hireWorker('picker').worker;
  const second = game.hireWorker('picker').worker;
  assert(first && second, 'Contratar dos preparadores');
  const order = createOrder(game, { kind: 'medium', items: ['Libro', 'Camiseta'] });
  // El segundo ya tenía un producto en su puesto y trae el otro en las manos
  const oldStation = stationFor(game, second);
  order.assignedTo = second.id;
  order.handling = 'staff';
  Object.assign(order.items[0], { at: 'table', table: oldStation.table, station: oldStation.index });
  Object.assign(order.items[1], { at: 'worker', by: second.id });
  const rt = getPickerRuntime(game, second);
  Object.assign(rt, { orderId: order.id, phase: 'placing', timer: 0 });
  assert(game.fireWorker(first.id).ok, 'Despedir');
  assert(stationFor(game, second).index !== oldStation.index, 'Debería haber cambiado de puesto');
  for (let i = 0; i < 4000 && !(order.dispatched && !order.assignedTo); i++) game.update(0.05);
  assert(order.dispatched && !order.assignedTo && rackBoxes(game.state).includes(order), 'El preparador se quedó atascado');
});

test('Carga física: la capacidad del vehículo limita las cajas', () => {
  const game = fresh({}, { foot: true });
  game.state.orders.length = 0;
  for (let i = 0; i < 4; i++) quickPack(createOrder(game, { kind: 'small', instantReady: true }));
  for (let i = 0; i < 3; i++) {
    assert(takeFromRack(game).ok, 'Coger caja');
    assert(loadIntoVehicle(game).ok, `Cargar caja ${i + 1}`);
  }
  assert(cargoSlotsUsed(game) === 3 && takeFromRack(game).ok, 'Cuarta caja');
  const full = loadIntoVehicle(game);
  assert(!full.ok && full.reason.includes('Sin espacio') && game.state.player.hands.box, 'Debería quedarse en las manos por falta de sitio');
});

test('Bajar del vehículo: hay que frenar antes, y no se sube con las manos ocupadas', () => {
  const game = fresh();
  game.state.player.speed = 120;
  assert(!exitVehicle(game).ok, 'Se bajó en marcha');
  game.state.player.speed = 0;
  assert(exitVehicle(game).ok && game.state.player.mode === 'foot', 'No se bajó parado');
  assert(!game.city.circleHitsSolid(game.state.player.foot.x, game.state.player.foot.y, 4.5, { walker: true }), 'Se bajó dentro de un obstáculo');
  assert(quickPack(createOrder(game, { kind: 'small', instantReady: true })) && takeFromRack(game).ok, 'Coger caja');
  assert(!game.enterVehicle().ok, 'No se debe subir con una caja en las manos');
});

test('Capacidad: la carga está limitada por los huecos del vehículo', () => {
  const game = fresh();
  for (let i = 0; i < 6; i++) readyOrder(game);
  toDepot(game);
  const loaded = loadBest(game);
  assert(loaded === 3, `Cargó ${loaded} paquetes con capacidad 3`);
  assert(cargoSlotsUsed(game) === 3, 'Huecos usados incorrectos');
  const medium = createOrder(game, { kind: 'medium', instantReady: true });
  assert(!game.canLoadOrder(medium).ok, 'No debería caber otro paquete');
  assert(game.canLoadOrder(medium).reason.includes('Sin espacio'), 'Falta el motivo');
});

test('Paquetes medianos y grandes ocupan más huecos y respetan la capacidad', () => {
  const game = fresh();
  game.state.orders.length = 0;
  const large = createOrder(game, { kind: 'large', instantReady: true });
  toDepot(game);
  assert(large.slots === 4 && !game.canLoadOrder(large).ok, 'El paquete grande no debe caber en 3 huecos');
  game.state.level = 2; game.state.money = 5000; game.recomputeStats();
  assert(game.buyUpgrade('cargo').ok, 'Compra de capacidad');
  assert(game.canLoadOrder(large).ok, 'Con 4 huecos ya debería caber');
});

test('Descargar devuelve el pedido al almacén y rechazar lo elimina', () => {
  const game = fresh();
  const order = game.state.orders[0];
  quickLoad(game);
  assert(game.unloadOrder(order.id).ok && order.status === 'pending' && game.state.player.cargo.length === 0, 'Descarga');
  const other = readyOrder(game);
  assert(game.rejectOrder(other.id).ok && !game.state.orders.includes(other), 'Rechazo');
  quickLoad(game);
  assert(!game.rejectOrder(order.id).ok, 'No se puede rechazar un pedido cargado');
  // Un pedido a medio reunir sí se puede descartar (y se suelta lo que había en las manos)
  game.state.player.mode = 'foot';
  const picking = createOrder(game, { kind: 'small', contents: 'Libro' });
  game.trackedOrderId = picking.id;
  assert(takeOrderItem(game, picking, 0).ok && picking.assignedTo === 'player', 'Reservar');
  assert(game.rejectOrder(picking.id).ok && game.state.player.hands.items.length === 0, 'Rechazar un pedido a medio preparar');
});

// ------------------------------------------------------- Pedidos y pagos ----

test('Pedidos: no superan el máximo activo ni el almacenamiento y aparecen gradualmente', () => {
  const game = fresh();
  let maxSeen = 0;
  const kinds = new Set();
  for (let t = 0; t < 600; t += 0.1) {
    game.update(0.1);
    if (game.state.pendingSummary) game.acknowledgeSummary();
    maxSeen = Math.max(maxSeen, game.state.orders.length);
    for (const o of game.state.orders) kinds.add(o.kind);
  }
  assert(maxSeen <= game.derived.maxActiveOrders, `Hubo ${maxSeen} pedidos activos`);
  assert([...kinds].every((k) => k === 'small'), `En nivel 1 solo debe haber pequeños: ${[...kinds]}`);
});

test('Pedidos: tipos nuevos aparecen con el nivel y las mejoras', () => {
  const game = fresh({ level: 4 });
  game.state.upgrades.orderSlots = 8; game.state.upgrades.storage = 8; game.state.upgrades.fragilePacking = 1;
  game.state.upgrades.cargo = 2;
  game.recomputeStats();
  unlockAll(game);
  const kinds = new Set();
  for (let i = 0; i < 200; i++) {
    game.state.orders.length = 0;
    const order = createOrder(game);
    if (order) kinds.add(order.kind);
  }
  for (const expected of ['small', 'medium', 'large', 'urgent', 'fragile']) assert(kinds.has(expected), `Falta el tipo ${expected}`);
  assert(!kinds.has('contract'), 'Los contratos no deben aparecer sin la mejora');
});

test('Pedidos: la preparación depende de las mejoras y de los preparadores', () => {
  const game = fresh({ level: 6, money: 100000 });
  const base = game.derived.prepRate;
  game.state.upgrades.prep = 2; game.recomputeStats();
  assert(game.derived.prepRate > base, 'La mejora no acelera la preparación');
  const order = createOrder(game, { kind: 'medium' });
  assert(order.prep > 0, 'Un pedido nuevo debe tardar en prepararse');
  toDepot(game);
  assert(!game.canLoadOrder(order).ok && game.canLoadOrder(order).reason.includes('preparando'), 'No se puede cargar mientras se prepara');
  const t0 = order.prep;
  advance(game, 1);
  assert(order.prep === t0, 'Sin preparadores nadie empaqueta solo (lo hace el jugador a mano)');
  game.state.workers.push({ id: 'wx', typeId: 'picker', name: 'Test', skill: 1, delivered: 0, earned: 0, vehicleId: null });
  game.recomputeStats();
  assert(game.derived.prepLanes === 1, 'El preparador debe añadir una línea');
  // El preparador tiene que ir a por los productos a la cinta antes de empaquetar: tarda, pero avanza
  let reserved = false;
  for (let t = 0; t < 240 && order.prep >= t0; t += 0.05) {
    game.update(0.05);
    if (game.state.pendingSummary) game.acknowledgeSummary();
    if (order.assignedTo === 'wx') reserved = true;
  }
  assert(order.prep < t0, 'No avanzó la preparación con el preparador');
  assert(reserved && order.items.every((i) => i.at === 'table' || i.at === 'box'), 'Solo empaqueta con todos los productos en su mesa');
});

test('Urgentes: tienen plazo, y llegar tarde reduce la recompensa sin quitar dinero', () => {
  const game = fresh({ level: 3 });
  const order = createOrder(game, { kind: 'urgent', instantReady: true });
  assert(order.timeLeft > 20, 'Plazo demasiado corto');
  const onTime = computeReward(game, order).total;
  const rep = game.state.reputation;
  order.timeLeft = 0.01;
  advance(game, 0.2);
  assert(order.late && game.state.reputation < rep, 'No marcó el retraso');
  const late = computeReward(game, order).total;
  assert(late < onTime && late > 0, `Recompensa tardía incorrecta ${late} vs ${onTime}`);
  const money = game.state.money;
  quickLoad(game); quickDeliver(game, order);
  assert(game.state.money > money, 'Aún se cobra algo por entregar tarde');
});

test('Frágiles: un golpe fuerte daña el paquete y baja la recompensa', () => {
  const game = fresh({ level: 2 });
  game.state.upgrades.fragilePacking = 1; game.recomputeStats();
  const order = createOrder(game, { kind: 'fragile', instantReady: true });
  const intact = computeReward(game, order).total;
  quickLoad(game);
  assert(game.state.player.cargo.includes(order.id), 'El frágil no se cargó');
  const p = game.state.player;
  p.x = game.city.depot.doorX; p.y = game.city.depot.doorY + 26; p.angle = -Math.PI / 2; p.speed = 140;
  game.controls.throttle = 1;
  advance(game, 0.4);
  assert(order.damaged, 'El golpe no dañó el paquete');
  assert(computeReward(game, order).total < intact, 'La recompensa no bajó');
});

test('Racha: entregas seguidas a tiempo aumentan la recompensa', () => {
  const game = fresh({ money: 0 });
  game.state.orders.length = 0;
  const b = game.city.buildingsInZone('residential')[0];
  const rewards = [];
  for (let i = 0; i < 4; i++) {
    const o = createOrder(game, { kind: 'small', size: 'small', building: b, instantReady: true });
    quickLoad(game);
    rewards.push(quickDeliver(game, o)[0].reward);
  }
  assert(game.state.streak.count === 4, `Racha ${game.state.streak.count}`);
  assert(rewards[3] > rewards[0], `La racha no aumenta el pago: ${rewards}`);
  assert(game.state.stats.bestStreak === 4, 'Mejor racha');
});

test('Recompensa: crece con la distancia, la zona y las mejoras', () => {
  const game = fresh();
  unlockAll(game);
  const near = game.city.buildingsInZone('residential')[0];
  const far = game.city.buildingsInZone('metropolitan')[0];
  const a = createOrder(game, { kind: 'small', size: 'small', building: near });
  const b = createOrder(game, { kind: 'small', size: 'small', building: far });
  assert(b.distanceTiles > a.distanceTiles, 'La distancia no crece');
  assert(computeReward(game, b).total > computeReward(game, a).total * 1.5, 'El destino lejano debe pagar mucho más');
  const base = computeReward(game, a).total;
  game.state.upgrades.premium = 4; game.recomputeStats();
  assert(computeReward(game, a).total > base, 'Clientes premium no afecta al pago');
});

// -------------------------------------------------------------- Economía ----

test('Economía: no se compra sin fondos ni sin requisitos', () => {
  const game = fresh({ money: 10 });
  assert(!game.buyUpgrade('engine').ok && game.state.money === 10 && !game.state.upgrades.engine, 'Compró sin fondos');
  game.state.money = 100000;
  assert(!game.buyUpgrade('cargo').ok, 'Mejora de nivel 2 comprada en nivel 1');
  assert(!game.buyUpgrade('hq').ok, 'Sede comprada sin nivel');
  assert(!game.buyUpgrade('droneProgram').ok, 'Drones sin requisitos');
  assert(!game.buyUpgrade('inventada').ok, 'Mejora inexistente');
  game.state.level = 15; game.recomputeStats();
  assert(!game.buyUpgrade('droneProgram').ok, 'Drones sin la sede requerida');
});

test('Mejoras: solo se compran a pie dentro de la oficina', () => {
  const game = fresh({ money: 100000 }, { foot: true, office: false });
  const o = depotLayout(game.city.depot).office;
  assert(!game.isPlayerInOffice(), 'La partida no empieza dentro de la oficina');
  const away = getUpgradeStatus(game, UPGRADES.engine);
  assert(away.state === 'locked' && away.officeOnly, `Fuera de la oficina debe estar bloqueada (${away.state})`);
  assert(!game.buyUpgrade('engine').ok && !game.state.upgrades.engine && game.state.money === 100000, 'Compró fuera de la oficina');
  standAt(game, o.computerStand.x, o.computerStand.y, o.computer.x, o.computer.y);
  assert(game.isPlayerInOffice(), 'Junto al ordenador debe contar como dentro de la oficina');
  assert(getUpgradeStatus(game, UPGRADES.engine).state === 'available', 'En la oficina debe poder comprarse');
  assert(game.buyUpgrade('engine').ok && game.state.upgrades.engine === 1, 'No compró desde la oficina');
  // Al volante no cuenta, aunque el vehículo esté en el almacén
  game.state.player.mode = 'drive';
  assert(!game.isPlayerInOffice() && !game.buyUpgrade('engine').ok && game.state.upgrades.engine === 1, 'Compró al volante');
});

test('Mejoras: cada compra cambia de verdad las estadísticas', () => {
  const game = fresh({ money: 1000000, level: 15 });
  game.recomputeStats();
  const check = (id, read, label) => {
    const before = read();
    const money = game.state.money;
    const status = getUpgradeStatus(game, UPGRADES[id]);
    const result = game.buyUpgrade(id);
    assert(result.ok, `${id}: ${result.reason}`);
    assert(game.state.money === money - status.cost, `${id}: cobro incorrecto`);
    assert(read() !== before, `${label} no cambió al comprar ${id}`);
  };
  const v = () => game.getPlayerStats();
  check('engine', () => v().maxSpeed, 'Velocidad');
  check('accel', () => v().accel, 'Aceleración');
  check('cargo', () => v().capacity, 'Capacidad');
  check('fuel', () => v().fuelPerTile, 'Consumo');
  check('handling', () => v().handling, 'Maniobrabilidad');
  check('garage', () => game.derived.maxVehicles, 'Garaje');
  check('storage', () => game.derived.storageCapacity, 'Almacén');
  check('prep', () => game.derived.prepRate, 'Preparación');
  check('organization', () => game.derived.staffEfficiency, 'Eficiencia');
  check('hq', () => game.derived.maxStaff, 'Plantilla');
  for (let i = 0; i < 3; i++) assert(game.buyUpgrade('hq').ok, 'Niveles superiores de la sede');
  check('orderSlots', () => game.derived.maxActiveOrders, 'Pedidos activos');
  check('marketing', () => game.derived.spawnInterval, 'Llegada de pedidos');
  check('premium', () => game.derived.rewardMult, 'Recompensa');
  check('service', () => game.derived.reputationGainMult, 'Reputación');
  check('costControl', () => game.derived.costMult, 'Costes');
  check('routes', () => game.derived.staffEfficiency, 'Rutas');
  check('fragilePacking', () => game.derived.fragileEnabled, 'Frágiles');
  check('contracts', () => game.derived.contractsEnabled, 'Contratos');
  check('autoDispatch', () => game.derived.maxStops, 'Paradas');
  check('droneProgram', () => game.derived.droneUnlocked, 'Drones');
  check('controlCenter', () => game.derived.droneCapacity, 'Control');
  check('droneAdvanced', () => game.state.upgrades.droneAdvanced, 'Dron avanzado');
  check('droneHeavy', () => game.state.upgrades.droneHeavy, 'Dron pesado');
  assert(game.buyUpgrade('controlCenter').ok, 'Segundo nivel del centro de control');
  check('droneSwarm', () => game.derived.droneSpeedMult, 'Enjambre');
});

test('Mejoras: el motor sube exactamente un 8 % por nivel y los costes crecen', () => {
  const game = fresh({ money: 100000 });
  const base = game.getPlayerStats().maxSpeed;
  game.buyUpgrade('engine'); game.buyUpgrade('engine');
  near(game.getPlayerStats().maxSpeed, base * 1.16, 0.001, 'Velocidad tras dos niveles');
  const def = UPGRADES.engine;
  assert(upgradeCost(def, 1) > upgradeCost(def, 0), 'El coste no crece');
  for (let i = 0; i < 20; i++) game.buyUpgrade('engine');
  assert(game.state.upgrades.engine === def.maxLevel, 'No respeta el nivel máximo');
});

test('Economía: los gastos operativos nunca dejan el saldo en negativo', () => {
  const game = fresh({ money: 5 });
  const r = chargeOperating(game, 50, 'salaries');
  assert(game.state.money === 0 && r.paid === 5 && r.unpaid === 45, 'Cobro parcial incorrecto');
});

test('Ingresos por minuto reflejan los ingresos recientes', () => {
  const game = fresh();
  const order = game.state.orders[0];
  quickLoad(game);
  const res = quickDeliver(game, order);
  advance(game, 1);
  assert(incomePerMinute(game) > 0 && incomePerMinute(game) <= res[0].reward * 3 + 1, 'Ingresos/min incoherentes');
});

// ------------------------------------------------- Progresión y objetivos ----

test('Niveles: la experiencia sube de nivel y desbloquea contenido', () => {
  const game = fresh();
  let levelUps = 0;
  game.events.on('levelUp', () => levelUps++);
  addXp(game, xpToNextLevel(1));
  assert(game.state.level === 2 && levelUps === 1, 'No subió a nivel 2');
  assert(getLevelUnlocks(2).length > 0 && getLevelUnlocks(4).length > 0 && getLevelUnlocks(8).length > 0, 'Faltan desbloqueos');
  addXp(game, 10000000);
  assert(game.state.level === 15, 'No llegó al nivel máximo');
});

test('Logros: se conceden una sola vez', () => {
  const game = fresh({ money: 0 });
  const order = game.state.orders[0];
  quickLoad(game); quickDeliver(game, order);
  advance(game, 1.2);
  assert(game.state.achievements.first_delivery, 'Logro no concedido');
  const bonus = game.state.stats.bonusEarned;
  assert(bonus >= 20, 'Sin premio');
  advance(game, 5);
  assert(game.state.stats.bonusEarned === bonus, 'Premio duplicado');
  assert(ACHIEVEMENTS.length >= 15, 'Pocos logros');
});

test('Misiones diarias: se completan y pagan una vez', () => {
  const game = fresh({ money: 0 });
  assert(game.state.missions.length >= 2, 'Sin misiones');
  game.state.missions = [{ id: 'mt', type: 'deliveries', target: 1, progress: 0, done: false, moneyReward: 77, xpReward: 5, text: 'Prueba', zoneId: null }];
  const order = game.state.orders[0];
  quickLoad(game);
  const res = quickDeliver(game, order);
  assert(game.state.missions[0].done, 'Misión sin completar');
  assert(game.state.money === res[0].reward + 77, 'Premio de misión incorrecto');
});

// ----------------------------------------------------------------- Equipo ----

function companyReady(level = 6) {
  const game = fresh({ level, money: 500000 });
  game.recomputeStats();
  return game;
}

test('Empleados: requisitos de contratación', () => {
  const game = fresh({ money: 500000 });
  assert(!game.hireWorker('courier').ok, 'Contratado sin nivel');
  game.state.level = 4; game.recomputeStats();
  const noVehicle = game.hireWorker('courier');
  assert(!noVehicle.ok && noVehicle.reason.includes('vehículo'), 'Debe exigir vehículo libre');
  assert(game.hireWorker('picker').ok, 'El preparador no necesita vehículo');
  assert(!game.hireWorker('manager').ok, 'Encargado sin nivel 6');
});

test('Repartidor: genera ingresos, usa su vehículo y cobra sueldo', () => {
  const game = companyReady();
  assert(game.buyUpgrade('garage').ok && game.buyVehicle('van_basic').ok, 'Compra de vehículo');
  const hire = game.hireWorker('courier');
  assert(hire.ok, hire.reason);
  const worker = hire.worker;
  assert(game.state.vehicles.some((v) => v.driver === worker.id), 'Sin vehículo asignado');
  game.state.player.x = game.city.depot.startX;
  for (let i = 0; i < 6; i++) readyOrder(game);
  const money0 = game.state.money;
  advance(game, 200, { ackSummary: false });
  assert(worker.delivered >= 3, `Entregó solo ${worker.delivered}`);
  assert(worker.earned > 0 && game.state.stats.workerDeliveries === worker.delivered, 'Estadísticas del empleado');
  assert(game.state.money > money0 - 2000, 'Los ingresos no compensan');
  assert(game.state.stats.expenses.fuel > 0, 'Sin gasto de combustible');
});

test('Fin de jornada: cobra sueldos y mantenimiento y muestra el resumen', () => {
  const game = companyReady();
  game.buyUpgrade('garage'); game.buyVehicle('van_basic'); game.hireWorker('courier');
  const money = game.state.money;
  advance(game, DAY_LENGTH + 1, { ackSummary: false });
  const s = game.state.pendingSummary;
  assert(s && s.day === 1, 'No hay resumen');
  assert(s.salaries === 60 && s.upkeep === 16, `Gastos incorrectos: ${s.salaries}/${s.upkeep}`);
  assert(game.state.stats.expenses.salaries === 60 && game.state.stats.expenses.upkeep === 16, 'Los gastos no constan en las estadísticas');
  assert(money > 0 && game.state.money >= 0, 'Saldo inválido');
  const time = game.state.time;
  game.update(1);
  assert(game.state.time === time, 'El juego debe quedar en pausa durante el resumen');
  game.acknowledgeSummary();
  assert(game.state.day === 2 && game.state.dayTime === 0 && game.state.pendingSummary === null, 'No empezó el día 2');
  assert(game.state.dayStats.deliveries === 0 && game.state.missions.length >= 2, 'Estado diario sin reiniciar');
});

test('Sueldos sin fondos: baja la reputación pero el saldo no es negativo', () => {
  const game = companyReady();
  game.buyUpgrade('garage'); game.buyVehicle('van_basic'); game.hireWorker('courier');
  game.state.money = 0;
  const rep = game.state.reputation;
  const summary = endDay(game);
  assert(game.state.money === 0, 'El saldo no puede ser negativo');
  assert(summary.unpaid === 76 && game.state.reputation < rep, `Gestión de impagos: ${summary.unpaid}`);
});

test('Automatización gradual: el preparador y el encargado mejoran el sistema', () => {
  const game = companyReady(7);
  const prep = game.derived.prepRate;
  const eff = game.derived.staffEfficiency;
  assert(game.hireWorker('picker').ok && game.hireWorker('manager').ok, 'Contratar');
  assert(game.derived.prepRate > prep && game.derived.staffEfficiency > eff, 'Sin efecto');
  assert(game.state.workers.length === 2, 'Plantilla');
  assert(game.fireWorker(game.state.workers[0].id).ok && game.state.workers.length === 1, 'Despedir');
});

test('Multi-parada: la automatización avanzada agrupa entregas', () => {
  const game = companyReady(10);
  game.state.upgrades.hq = 3; game.state.upgrades.autoDispatch = 2; game.state.upgrades.garage = 2; game.recomputeStats();
  game.buyVehicle('van_large');
  const w = game.hireWorker('courier').worker;
  const b = game.city.buildingsInZone('residential');
  for (let i = 0; i < 3; i++) readyOrder(game, { building: b[i] });
  advance(game, 12, { ackSummary: false });
  const rt = game.runtime.workers[w.id];
  assert(rt && rt.orders.length >= 2, `Debería llevar varias entregas a la vez (${rt?.orders.length})`);
});

// ----------------------------------------------------------------- Drones ----

test('Drones: se desbloquean con requisitos, respetan la capacidad y entregan', () => {
  const game = fresh({ level: 8, money: 1000000 });
  game.recomputeStats();
  assert(!game.buyDrone('drone_basic').ok, 'Dron comprado sin programa');
  game.state.upgrades.hq = 3; game.recomputeStats();
  assert(game.buyUpgrade('droneProgram').ok, 'Programa de drones');
  assert(game.buyDrone('drone_basic').ok && game.buyDrone('drone_basic').ok, 'Dos drones');
  const full = game.buyDrone('drone_basic');
  assert(!full.ok && full.reason.includes('Centro de control'), 'Debe limitar por centro de control');
  assert(!game.buyDrone('drone_advanced').ok, 'Avanzado sin investigación');
  game.state.orders.length = 0;
  const house = game.city.buildingsInZone('residential')[0];
  for (let i = 0; i < 3; i++) readyOrder(game, { building: house });
  const money = game.state.money;
  advance(game, 60, { ackSummary: false });
  assert(game.state.stats.droneDeliveries >= 2, `Entregas de drones: ${game.state.stats.droneDeliveries}`);
  assert(game.state.money > money - 100, 'Los drones no generan ingresos');
  assert(game.state.drones.every((d) => d.delivered >= 0), 'Estadísticas de drones');
});

test('Drones: los avanzados y pesados llevan paquetes mayores', () => {
  const game = fresh({ level: 12, money: 10000000 });
  Object.assign(game.state.upgrades, { hq: 3, droneProgram: 1, droneAdvanced: 1, droneHeavy: 1, controlCenter: 1 });
  game.recomputeStats();
  assert(game.buyDrone('drone_heavy').ok, 'Dron pesado');
  game.state.orders.length = 0;
  const house = game.city.buildingsInZone('residential')[0];
  const large = createOrder(game, { kind: 'large', instantReady: true, building: house });
  large.readySince = -100;
  advance(game, 40, { ackSummary: false });
  assert(game.state.stats.droneDeliveries >= 1 && !game.state.orders.includes(large), 'El dron pesado no entregó el paquete grande');
});

// ---------------------------------------------------------------- Guardado ----

test('Guardado: ida y vuelta conserva el progreso', () => {
  const game = fresh({ money: 1234, level: 3 });
  game.state.upgrades.engine = 3; game.state.zones.downtown = true;
  game.city.setUnlockedZones(game.state.zones);
  game.recomputeStats();
  readyOrder(game);
  assert(saveState(game.state), 'No se pudo guardar');
  const loaded = Game.create({ loadSave: true, persist: false });
  assert(loaded.state.money === 1234 && loaded.state.level === 3, 'Dinero o nivel');
  assert(loaded.state.upgrades.engine === 3 && loaded.state.zones.downtown, 'Mejoras o zonas');
  assert(loaded.state.orders.length === game.state.orders.length, 'Pedidos');
  assert(loaded.city.isZoneUnlocked('downtown'), 'La ciudad no refleja las zonas guardadas');
  clearSave();
  assert(loadState(createCity()) === null, 'No se borró');
});

test('Guardado: conserva empleados y drones y repara trayectos interrumpidos', () => {
  const game = companyReady();
  game.buyUpgrade('garage'); game.buyVehicle('van_basic'); game.hireWorker('courier');
  readyOrder(game);
  advance(game, 10, { ackSummary: false });
  assert(game.state.orders.some((o) => o.assignedTo), 'Se esperaba un pedido en reparto');
  saveState(game.state);
  const loaded = Game.create({ loadSave: true, persist: false });
  clearSave();
  assert(loaded.state.workers.length === 1 && loaded.state.vehicles.length === 2, 'Plantilla o flota');
  assert(loaded.state.orders.every((o) => !o.assignedTo && o.status === 'pending'), 'Los trayectos interrumpidos deben volver al almacén');
});

test('Guardado: conserva lo que llevas en las manos y lo que hay en la mesa', () => {
  const game = fresh({ level: 2 }, { foot: true });
  const order = createOrder(game, { kind: 'medium', items: ['Cafetera', 'Auriculares'] });
  assert(takeOrderItem(game, order, 0).ok && placeOnTable(game).ok && takeOrderItem(game, order, 1).ok, 'Preparar a medias');
  // Otro pedido con su producto aún en la cinta y otro con el producto en el cajón
  const onBelt = createOrder(game, { kind: 'small', contents: 'Libro' });
  const inBin = createOrder(game, { kind: 'small', contents: 'Camiseta' });
  onBelt.items[0].at = 'belt'; onBelt.items[0].pos = 33.5;
  inBin.items[0].at = 'bin'; inBin.items[0].binAt = game.state.time;
  assert(saveState(game.state), 'No se pudo guardar');
  const loaded = Game.create({ loadSave: true, persist: false });
  clearSave();
  const copy = loaded.state.orders.find((o) => o.id === order.id);
  assert(loaded.state.player.mode === 'foot', 'Debe seguir a pie');
  assert(copy && copy.assignedTo === 'player' && copy.items[0].at === 'table' && copy.items[1].at === 'hand', 'Mesa o manos');
  assert(loaded.state.player.hands.items.length === 1, 'Manos');
  assert(awaitingPacking(copy) && copy.prep > 0, 'Sigue pendiente de empaquetar');
  const beltCopy = loaded.state.orders.find((o) => o.id === onBelt.id);
  const binCopy = loaded.state.orders.find((o) => o.id === inBin.id);
  assert(beltCopy?.items[0].at === 'belt' && Math.abs(beltCopy.items[0].pos - 33.5) < 0.01, 'El producto de la cinta conserva su posición');
  assert(binCopy?.items[0].at === 'bin', 'El producto del cajón sigue en el cajón');
  assert(loaded.state.player.foot.z === 0, 'Se carga con los pies en el suelo');
});

test('Guardado: lo que llevaba un preparador vuelve al cajón y su caja terminada queda en expedición', () => {
  const game = fresh({ level: 4, money: 100000 }, { foot: true });
  const hire = game.hireWorker('picker');
  assert(hire.ok, 'Contratar');
  const a = createOrder(game, { kind: 'small', contents: 'Libro' });
  const b = createOrder(game, { kind: 'small', contents: 'Camiseta' });
  a.assignedTo = hire.worker.id; a.handling = 'staff'; a.items[0].at = 'worker'; a.items[0].by = hire.worker.id;
  b.assignedTo = hire.worker.id; b.handling = 'staff'; b.prep = 0; b.status = 'picked';
  for (const item of b.items) item.at = 'box';
  assert(saveState(game.state), 'No se pudo guardar');
  const loaded = Game.create({ loadSave: true, persist: false });
  clearSave();
  const ca = loaded.state.orders.find((o) => o.id === a.id);
  const cb = loaded.state.orders.find((o) => o.id === b.id);
  assert(ca && ca.items[0].at === 'bin' && !ca.assignedTo && ca.status === 'pending', `Producto del preparador: ${ca?.items[0].at}`);
  assert(cb && cb.dispatched && !cb.assignedTo && cb.status === 'pending' && rackBoxes(loaded.state).includes(cb), 'Caja terminada del preparador');
});

test('Guardado: datos corruptos o antiguos no rompen el juego', () => {
  localStorage.setItem(SAVE_KEY, '{esto no es json');
  assert(loadState(createCity()) === null, 'Debe ignorar el guardado corrupto');
  localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, money: 999, level: 4, stats: { deliveries: 5 } }));
  const state = loadState(createCity());
  assert(state && state.money === 999 && state.stats.bonusEarned === 0 && state.vehicles.length === 1, 'Debe completar campos que faltan');
  assert(state.player.mode === 'drive' && state.player.hands.box === '' && state.player.hands.items.length === 0, 'Las partidas antiguas siguen al volante');
  localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 99 }));
  assert(loadState(createCity()) === null, 'Versión desconocida');
  clearSave();
  localStorage.removeItem(`${SAVE_KEY}:corrupt`);
});

test('Reinicio: borra la partida guardada y bloquea el autoguardado', () => {
  const game = Game.create({ loadSave: false, persist: true });
  game.save();
  assert(localStorage.getItem(SAVE_KEY), 'No guardó');
  game.reset();
  assert(!localStorage.getItem(SAVE_KEY), 'No borró');
  game.save();
  assert(!localStorage.getItem(SAVE_KEY), 'Guardó tras el reinicio');
});

test('Autoguardado: se guarda periódicamente al jugar', () => {
  clearSave();
  const game = Game.create({ loadSave: false, persist: true });
  game.state.tutorial.welcomed = true;
  advance(game, 10);
  assert(localStorage.getItem(SAVE_KEY), 'No hubo autoguardado');
  clearSave();
});

// ---------------------------------------------------------------- Interfaz ----

test('UI: setHtml actualiza sin recrear los elementos', () => {
  const box = document.createElement('div');
  setHtml(box, '<button id="b" data-x="1">Uno</button><p>a</p>');
  const button = box.querySelector('#b');
  setHtml(box, '<button id="b" data-x="2">Dos</button><p>a</p><p>b</p>');
  assert(box.querySelector('#b') === button, 'El botón se recreó');
  assert(button.textContent === 'Dos' && button.dataset.x === '2' && box.children.length === 3, 'Contenido sin actualizar');
  setHtml(box, '<span>solo</span>');
  assert(box.children.length === 1 && box.firstElementChild.tagName === 'SPAN', 'Reemplazo de nodos');
});

// ------------------------------------------------- Simulación de equilibrio ----

test('Equilibrio: un jugador razonable progresa hasta los drones en tiempo razonable', () => {
  const game = fresh();
  const log = [];
  const levelTimes = {};
  const bot = { busyUntil: 0, nextBuy: 0, trip: null };
  const clock = () => game.runtime.clock;
  const goals = { checkpoints: [600, 1800, 3600] };

  const buyBest = () => {
    // Prioridad sencilla: zona, drones, empleados, vehículos y la mejora disponible más barata
    for (const id of ZONE_ORDER) if (!game.state.zones[id] && game.unlockZone(id).ok) return true;
    for (const id of ['drone_advanced', 'drone_heavy', 'drone_basic']) if (game.buyDrone(id).ok) return true;
    const couriers = game.state.workers.filter((w) => w.typeId === 'courier').length;
    if (couriers < 3) {
      for (const type of ['van_large', 'van_basic']) {
        if (game.state.vehicles.length < game.derived.maxVehicles && game.state.vehicles.filter((v) => !v.driver).length === 0) {
          if (game.buyVehicle(type).ok) return true;
        }
      }
    }
    for (const id of ['courier', 'picker', 'manager']) if (game.hireWorker(id).ok) return true;
    const options = Object.values(UPGRADES)
      .map((u) => ({ u, s: getUpgradeStatus(game, u) }))
      .filter(({ s }) => s.state === 'available')
      .sort((a, b) => a.s.cost - b.s.cost);
    if (options.length && game.buyUpgrade(options[0].u.id).ok) return true;
    if (game.state.vehicles.length < game.derived.maxVehicles) {
      for (const type of ['truck', 'van_electric', 'van_large']) if (game.buyVehicle(type).ok) return true;
    }
    return false;
  };

  const speed = () => game.getPlayerStats().maxSpeed * 0.7;
  const dt = 0.1;
  const total = 3600;
  for (let t = 0; t < total; t += dt) {
    if (game.state.pendingSummary) game.acknowledgeSummary();
    game.update(dt);
    if (!levelTimes[game.state.level]) levelTimes[game.state.level] = Math.round(clock());

    if (clock() >= bot.nextBuy) {
      bot.nextBuy = clock() + 3;
      let guard = 0;
      while (guard++ < 5 && buyBest());
    }
    if (clock() < bot.busyUntil) continue;
    if (bot.trip) {
      for (const order of bot.trip) {
        if (!game.state.orders.includes(order)) continue;
        quickDeliver(game, order);
      }
      bot.trip = null;
    }
    // Preparación a mano (como haría el jugador en el almacén) de los pedidos que nadie está preparando
    let handWork = 0;
    // (solo los que ya tienen todos sus productos en la cinta o en el cajón: el bot no adelanta el reloj)
    const todo = game.state.orders.filter((o) => awaitingPacking(o) && !o.assignedTo && o.items.every(available)).slice(0, 3);
    for (const order of todo) if (handPrepare(game, order)) handWork += 3 + order.items.length * 2.5;
    toDepot(game);
    const n = loadBest(game);
    if (!n) { bot.busyUntil = clock() + 0.5 + handWork; continue; }
    const cargo = game.state.player.cargo.map((id) => getOrder(game.state, id));
    const dist = cargo.reduce((sum, o) => sum + o.distanceTiles * TILE, 0) * (cargo.length > 1 ? 0.75 : 1) * 2;
    // Cargar cada caja, bajar del vehículo y llevarla a la puerta también lleva su tiempo
    bot.busyUntil = clock() + 1.5 + handWork + dist / speed() + cargo.length * 6;
    bot.trip = cargo;
    if (goals.checkpoints.length && clock() >= goals.checkpoints[0]) {
      const s = game.state;
      log.push(`  t=${Math.round(clock() / 60)}min nivel ${s.level} dinero ${Math.round(s.money)} entregas ${s.stats.deliveries} (tú ${s.stats.manualDeliveries}, equipo ${s.stats.workerDeliveries}, drones ${s.stats.droneDeliveries}) ingresos/min ${Math.round(incomePerMinute(game))}`);
      goals.checkpoints.shift();
    }
  }
  const s = game.state;
  log.push(`  Resultado a la hora: nivel ${s.level}, ${s.stats.deliveries} entregas, ${s.workers.length} empleados, ${s.vehicles.length} vehículos, ${s.drones.length} drones, zonas ${Object.values(s.zones).filter(Boolean).length}/5, ingresos totales ${Math.round(s.stats.totalEarned)}`);
  log.push(`  Primer momento de cada nivel (min): ${Object.entries(levelTimes).map(([l, t]) => `N${l}@${(t / 60).toFixed(1)}`).join(' ')}`);
  test.report = log;
  assert(s.money >= 0, 'Saldo negativo en la simulación');
  assert(s.level >= 6, `El jugador de prueba solo llegó al nivel ${s.level} en una hora`);
  assert(s.stats.totalEarned > 0 && s.stats.deliveries > 30, 'Pocas entregas');
});

// ------------------------------------------------------------- Arranque real ----

test('Arranque: la página real carga sin errores y responde a las teclas', async () => {
  localStorage.clear();
  const frame = document.getElementById('frame');
  frame.src = '../index.html';
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  const w = frame.contentWindow;
  const d = frame.contentDocument;
  for (let i = 0; i < 50 && !w.__game; i++) await sleep(100);
  await sleep(400);
  assert(w.__errors.length === 0, `Errores de carga: ${w.__errors.join(' | ')}`);
  assert(w.__game, 'El juego no se inicializó');
  const start = d.querySelector('[data-modal-action="start"]');
  assert(start, 'No aparece la bienvenida');
  start.click();
  await sleep(150);
  assert(!d.querySelector('.modal-overlay'), 'La bienvenida no se cerró');

  const canvas = d.getElementById('game-canvas');
  assert(canvas.width > 200 && canvas.height > 200, 'El canvas no tiene tamaño');
  const ctx = canvas.getContext('2d');
  const pixels = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 4, 4).data;
  assert(pixels.some((v) => v > 0), 'El mapa no se ha pintado');

  const key = (type, code) => w.dispatchEvent(new w.KeyboardEvent(type, { code, bubbles: true }));
  const p = w.__game.state.player;
  assert(p.mode === 'foot', 'La partida nueva empieza a pie');
  key('keydown', 'KeyW');
  await sleep(900);
  key('keyup', 'KeyW');
  assert(p.foot.walked > 15, `La persona no se movió (${p.foot.walked})`);
  assert(d.getElementById('hands-card').classList.contains('is-visible'), 'Falta la tarjeta de las manos');
  // Espacio salta (una vez por pulsación) y se vuelve al suelo
  const jumps = p.foot.jumps ?? 0;
  key('keydown', 'Space');
  await sleep(120);
  key('keyup', 'Space');
  assert((p.foot.jumps ?? 0) === jumps + 1, 'Espacio no hace saltar');
  await sleep(700);
  assert(p.foot.z === 0, 'No volvió al suelo tras el salto');
  assert(!d.getElementById('btn-view'), 'La vista 2D ya no se puede elegir');

  // Ya no hay panel lateral: toda la gestión está en el ordenador de la oficina
  assert(!d.getElementById('dock') && !d.querySelector('.dock-tab'), 'El panel lateral debería haber desaparecido');
  key('keydown', 'Digit2');
  await sleep(200);
  assert(!d.querySelector('.modal-computer'), 'Fuera del ordenador la tecla 2 no debe abrir la gestión');
  w.__game.events.emit('officeComputer', {});
  await sleep(300);
  assert(d.querySelector('.modal-computer'), 'El ordenador de la oficina no se abre');
  assert(w.__game.paused, 'El juego no se pausa delante del ordenador');
  const screen = d.querySelector('[data-pc-panel]');
  const apps = [...d.querySelectorAll('.pc-app')];
  assert(apps.length === 6, `Faltan aplicaciones (${apps.length})`);
  for (const app of apps) {
    app.click();
    await sleep(350);
    assert(screen.innerHTML.length > 120, `Aplicación vacía: ${app.dataset.tab}`);
  }
  // Mejoras: cada subpestaña debe pintarse
  d.querySelector('.pc-app[data-tab="upgrades"]').click();
  await sleep(300);
  for (const sub of [...d.querySelectorAll('.subtab')]) {
    sub.click();
    await sleep(300);
    assert(d.querySelectorAll('.upgrade').length > 0, 'Sin tarjetas de mejora');
  }
  // Con el ordenador encendido, las teclas 1-5 cambian de aplicación y Esc lo apaga
  key('keydown', 'Digit1');
  await sleep(300);
  assert(d.querySelector('.pc-app.is-active')?.dataset.tab === 'orders', 'La tecla 1 no abre Pedidos en el ordenador');
  key('keydown', 'Escape');
  await sleep(200);
  assert(!d.querySelector('.modal-overlay') && !w.__game.paused, 'Escape no apaga el ordenador');
  key('keydown', 'KeyE');
  await sleep(100);
  // Menú
  key('keydown', 'KeyP');
  await sleep(200);
  assert(d.querySelector('.modal'), 'El menú no se abre con P');
  assert(w.__game.paused, 'El juego no se pausa con el menú');
  key('keydown', 'Escape');
  await sleep(200);
  assert(!d.querySelector('.modal-overlay') && !w.__game.paused, 'Escape no cierra el menú');
  assert(w.__errors.length === 0, `Errores durante el uso: ${w.__errors.join(' | ')}`);
  localStorage.clear();
});

// ------------------------------------------------------------------ Ejecución ----

async function run() {
  const out = document.getElementById('results');
  let passed = 0;
  let failed = 0;
  const lines = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      lines.push(`<span class="pass">✔ ${name}</span>`);
    } catch (error) {
      failed++;
      lines.push(`<span class="fail">✘ ${name}\n    ${String(error.message ?? error).replace(/</g, '&lt;')}</span>`);
      console.error(name, error);
    }
    if (test.report) {
      lines.push(`<span class="info">${test.report.join('\n')}</span>`);
      test.report = null;
    }
    out.innerHTML = lines.join('\n');
  }
  lines.push(`\nRESULTADO: ${passed} correctas, ${failed} con fallos`);
  out.innerHTML = lines.join('\n');
  document.title = failed ? `FALLOS ${failed}` : `TODO OK ${passed}`;
  document.body.dataset.done = failed ? 'fail' : 'ok';
}

run();
