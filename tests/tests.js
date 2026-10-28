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
import { createOrder, completeDelivery, getOrder, cargoSlotsUsed, loadBest } from '../js/systems/orders.js';
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

function fresh(overrides = {}) {
  // Semilla fija: las pruebas usan siempre la misma ciudad
  const game = Game.create({ loadSave: false, persist: false, seed: DEFAULT_CITY_SEED });
  game.state.tutorial.welcomed = true;
  Object.assign(game.state, overrides);
  game.recomputeStats();
  return game;
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

test('Inicio: furgoneta, dinero y un único pedido sencillo', () => {
  const game = fresh();
  const s = game.state;
  assert(s.vehicles.length === 1 && s.money === 50 && s.level === 1, 'Estado inicial incorrecto');
  assert(s.orders.length === 1, 'Debe haber un único pedido');
  const order = s.orders[0];
  assert(order.kind === 'small' && order.prep === 0 && order.status === 'pending', 'El primer pedido debe estar listo');
  assert(game.city.getBuilding(order.buildingId).kind === 'house', 'El primer destino debe ser una casa');
  assert(!game.isPlayerInDepot(), 'El jugador debe empezar fuera del almacén');
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

test('Entrega completa: cargar, viajar, cobrar y no cobrar dos veces', () => {
  const game = fresh();
  const order = game.state.orders[0];
  toDepot(game);
  const loaded = game.interact();
  assert(loaded.ok && loaded.kind === 'load', 'No cargó');
  assert(order.status === 'picked' && game.state.player.cargo.includes(order.id), 'El pedido no está cargado');
  assert(!game.interact().ok, 'No debería haber nada más que hacer en el almacén');

  const before = game.state.money;
  assert(game.getDeliverableOrders().length === 0, 'No debe poder entregar desde el almacén');
  toDrop(game, order);
  const result = game.interact();
  assert(result.ok && result.kind === 'deliver', 'No entregó');
  const reward = result.delivered[0].reward;
  assert(reward > 0 && game.state.money === before + reward, 'El pago no coincide');
  assert(game.state.stats.deliveries === 1 && game.state.stats.totalEarned === reward, 'Estadísticas incorrectas');
  assert(!game.state.orders.includes(order) && game.state.player.cargo.length === 0, 'El pedido sigue activo');
  assert(game.state.xp > 0, 'No se dio experiencia');

  const after = game.state.money;
  assert(completeDelivery(game, order, { type: 'player' }) === null, 'Segundo pago permitido');
  assert(!game.interact().ok && game.state.money === after, 'El dinero cambió sin entregar');
});

test('Entrega: hay que estar dentro de la zona de entrega', () => {
  const game = fresh();
  const order = game.state.orders[0];
  toDepot(game); game.interact();
  const b = game.city.getBuilding(order.buildingId);
  game.state.player.x = b.dropX + 200; game.state.player.y = b.dropY;
  assert(!game.interact().ok, 'Entregó demasiado lejos');
  game.state.player.x = b.dropX + 40;
  assert(game.interact().ok, 'No entregó a 40 px');
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
  toDepot(game); game.interact();
  assert(game.unloadOrder(order.id).ok && order.status === 'pending' && game.state.player.cargo.length === 0, 'Descarga');
  const other = readyOrder(game);
  assert(game.rejectOrder(other.id).ok && !game.state.orders.includes(other), 'Rechazo');
  toDepot(game); game.interact();
  assert(!game.rejectOrder(order.id).ok, 'No se puede rechazar un pedido cargado');
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
  assert(order.prep < t0, 'No avanzó la preparación');
  game.state.workers.push({ id: 'wx', typeId: 'picker', name: 'Test', skill: 1, delivered: 0, earned: 0, vehicleId: null });
  game.recomputeStats();
  assert(game.derived.prepLanes === 2, 'El preparador debe añadir una línea');
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
  toDepot(game); game.interact(); toDrop(game, order); game.interact();
  assert(game.state.money > money, 'Aún se cobra algo por entregar tarde');
});

test('Frágiles: un golpe fuerte daña el paquete y baja la recompensa', () => {
  const game = fresh({ level: 2 });
  game.state.upgrades.fragilePacking = 1; game.recomputeStats();
  const order = createOrder(game, { kind: 'fragile', instantReady: true });
  const intact = computeReward(game, order).total;
  toDepot(game); game.interact();
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
    toDepot(game); game.interact(); toDrop(game, o);
    rewards.push(game.interact().delivered[0].reward);
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
  toDepot(game); game.interact(); toDrop(game, order);
  const res = game.interact();
  advance(game, 1);
  assert(incomePerMinute(game) > 0 && incomePerMinute(game) <= res.delivered[0].reward * 3 + 1, 'Ingresos/min incoherentes');
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
  toDepot(game); game.interact(); toDrop(game, order); game.interact();
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
  toDepot(game); game.interact(); toDrop(game, order);
  const res = game.interact();
  assert(game.state.missions[0].done, 'Misión sin completar');
  assert(game.state.money === res.delivered[0].reward + 77, 'Premio de misión incorrecto');
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

test('Guardado: datos corruptos o antiguos no rompen el juego', () => {
  localStorage.setItem(SAVE_KEY, '{esto no es json');
  assert(loadState(createCity()) === null, 'Debe ignorar el guardado corrupto');
  localStorage.setItem(SAVE_KEY, JSON.stringify({ version: 1, money: 999, level: 4, stats: { deliveries: 5 } }));
  const state = loadState(createCity());
  assert(state && state.money === 999 && state.stats.bonusEarned === 0 && state.vehicles.length === 1, 'Debe completar campos que faltan');
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
        toDrop(game, order);
        game.interact();
      }
      bot.trip = null;
    }
    toDepot(game);
    const n = loadBest(game);
    if (!n) { bot.busyUntil = clock() + 0.5; continue; }
    const cargo = game.state.player.cargo.map((id) => getOrder(game.state, id));
    const dist = cargo.reduce((sum, o) => sum + o.distanceTiles * TILE, 0) * (cargo.length > 1 ? 0.75 : 1) * 2;
    bot.busyUntil = clock() + 1.5 + dist / speed() + cargo.length * 1.2;
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
  const x0 = p.x;
  key('keydown', 'KeyD'); key('keydown', 'KeyW');
  await sleep(900);
  key('keyup', 'KeyD'); key('keyup', 'KeyW');
  assert(Math.hypot(p.x - x0, 0) > 15 || p.distanceDriven > 15, `La furgoneta no se movió (${p.distanceDriven})`);

  const tabs = [...d.querySelectorAll('.dock-tab')];
  assert(tabs.length === 5, 'Faltan pestañas');
  for (const tab of tabs) {
    tab.click();
    await sleep(350);
    assert(d.getElementById('dock-panel').innerHTML.length > 120, `Panel vacío: ${tab.dataset.tab}`);
  }
  // Mejoras: cada subpestaña debe pintarse
  d.querySelector('[data-tab="upgrades"]').click();
  await sleep(300);
  for (const sub of [...d.querySelectorAll('.subtab')]) {
    sub.click();
    await sleep(300);
    assert(d.querySelectorAll('.upgrade').length > 0, 'Sin tarjetas de mejora');
  }
  // Teclas de panel y de interacción
  key('keydown', 'Digit1');
  await sleep(300);
  assert(d.querySelector('.dock-tab.is-active')?.dataset.tab === 'orders', 'La tecla 1 no abre Pedidos');
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
