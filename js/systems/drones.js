// Drones: compra y simulación de entregas aéreas automáticas en línea recta.

import { DRONE_TYPES } from '../config/drones.js';
import { UPGRADES } from '../config/upgrades.js';
import { formatMoney, distance } from '../core/util.js';
import { allocateId } from '../core/state.js';
import { spend, rewardPreview } from './economy.js';
import { completeDelivery, compareOrders, isAvailableForAutomation } from './orders.js';

export function droneCost(state, typeId) {
  const type = DRONE_TYPES[typeId];
  const owned = state.drones.filter((d) => d.typeId === typeId).length;
  return Math.round((type.cost * Math.pow(type.costGrowth, owned)) / 5) * 5;
}

export function droneStatus(game, typeId) {
  const { state, derived } = game;
  const type = DRONE_TYPES[typeId];
  const cost = droneCost(state, typeId);
  if (!(state.upgrades[type.requires] > 0)) {
    return { state: 'locked', cost, reason: `Requiere: ${UPGRADES[type.requires].name}` };
  }
  if (state.drones.length >= derived.droneCapacity) {
    return { state: 'locked', cost, reason: 'Sin capacidad de control: mejora el Centro de control' };
  }
  if (state.money < cost) return { state: 'poor', cost, reason: `Te faltan ${formatMoney(cost - state.money)}` };
  return { state: 'available', cost, reason: '' };
}

export function buyDrone(game, typeId) {
  const { state } = game;
  const type = DRONE_TYPES[typeId];
  if (!type) return { ok: false, reason: 'Dron desconocido' };
  const status = droneStatus(game, typeId);
  if (status.state !== 'available') return { ok: false, reason: status.reason };
  if (!spend(game, status.cost)) return { ok: false, reason: 'Fondos insuficientes' };
  const drone = { id: allocateId(state, 'd'), typeId, name: `Dron ${state.drones.length + 1}`, delivered: 0, earned: 0 };
  state.drones.push(drone);
  game.recomputeStats();
  game.events.emit('droneBought', { drone, type });
  return { ok: true, drone };
}

/** Plaza de aterrizaje de cada dron en el tejado del almacén. */
export function droneHome(depot, index) {
  return { x: depot.centerX - 60 + (index % 5) * 30, y: depot.centerY - 10 + Math.floor(index / 5) * 26 };
}

export function getDroneRuntime(game, drone) {
  let rt = game.runtime.drones[drone.id];
  if (!rt) {
    const home = droneHome(game.city.depot, game.state.drones.indexOf(drone));
    rt = { phase: 'idle', timer: 0, scanTimer: Math.random(), x: home.x, y: home.y, angle: -Math.PI / 2, order: null, fromX: 0, fromY: 0, toX: 0, toY: 0, length: 0, travelled: 0, status: 'Esperando pedidos' };
    game.runtime.drones[drone.id] = rt;
  }
  return rt;
}

function pickOrder(game, type) {
  const { state, city } = game;
  const depot = city.depot;
  const candidates = state.orders.filter((o) => {
    if (o.kind === 'fragile' || o.slots > type.capacity || !isAvailableForAutomation(game, o)) return false;
    const b = city.getBuilding(o.buildingId);
    return b.droneOk && distance(depot.centerX, depot.centerY, b.centerX, b.centerY) <= type.range;
  });
  candidates.sort((a, b) => compareOrders(a, b) || rewardPreview(game, b) - rewardPreview(game, a));
  return candidates[0] ?? null;
}

export function updateDrones(game, dt) {
  const { state, city, derived } = game;
  const depot = city.depot;
  for (const [index, drone] of state.drones.entries()) {
    const type = DRONE_TYPES[drone.typeId];
    const rt = getDroneRuntime(game, drone);
    const speed = type.speed * derived.droneSpeedMult;
    const home = droneHome(depot, index);

    switch (rt.phase) {
      case 'idle': {
        rt.x = home.x; rt.y = home.y;
        rt.scanTimer -= dt;
        if (rt.scanTimer > 0) break;
        rt.scanTimer = 0.6;
        const order = pickOrder(game, type);
        if (!order) { rt.status = 'Esperando pedidos'; break; }
        order.assignedTo = drone.id;
        order.status = 'picked';
        rt.order = order;
        rt.phase = 'loading';
        rt.timer = 1.5;
        rt.status = 'Cargando';
        break;
      }
      case 'loading': {
        rt.timer -= dt;
        if (rt.timer > 0) break;
        const b = city.getBuilding(rt.order.buildingId);
        rt.fromX = home.x; rt.fromY = home.y;
        rt.toX = b.centerX; rt.toY = b.centerY;
        rt.length = distance(rt.fromX, rt.fromY, rt.toX, rt.toY);
        rt.travelled = 0;
        rt.angle = Math.atan2(rt.toY - rt.fromY, rt.toX - rt.fromX);
        rt.order.status = 'in_transit';
        rt.phase = 'outbound';
        rt.status = 'Volando al destino';
        break;
      }
      case 'outbound': {
        rt.travelled = Math.min(rt.length, rt.travelled + speed * dt);
        const t = rt.length ? rt.travelled / rt.length : 1;
        rt.x = rt.fromX + (rt.toX - rt.fromX) * t;
        rt.y = rt.fromY + (rt.toY - rt.fromY) * t;
        if (rt.travelled >= rt.length) { rt.phase = 'dropping'; rt.timer = 1; rt.status = 'Soltando paquete'; }
        break;
      }
      case 'dropping': {
        rt.timer -= dt;
        if (rt.timer > 0) break;
        completeDelivery(game, rt.order, { type: 'drone', drone });
        rt.order = null;
        rt.travelled = 0;
        rt.phase = 'inbound';
        rt.angle = Math.atan2(rt.fromY - rt.toY, rt.fromX - rt.toX);
        rt.status = 'Volviendo';
        break;
      }
      case 'inbound': {
        rt.travelled = Math.min(rt.length, rt.travelled + speed * dt);
        const t = rt.length ? rt.travelled / rt.length : 1;
        rt.x = rt.toX + (rt.fromX - rt.toX) * t;
        rt.y = rt.toY + (rt.fromY - rt.toY) * t;
        if (rt.travelled >= rt.length) { rt.phase = 'charging'; rt.timer = type.recharge * derived.droneRechargeMult; rt.status = 'Recargando batería'; }
        break;
      }
      case 'charging': {
        rt.x = home.x; rt.y = home.y;
        rt.timer -= dt;
        if (rt.timer <= 0) { rt.phase = 'idle'; rt.scanTimer = 0; }
        break;
      }
      default:
        rt.phase = 'idle';
    }
  }
}
