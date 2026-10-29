// Preparadores de pedidos visibles en el almacén. Cada preparador contratado tiene un puesto (media mesa) y
// trabaja con pedidos reales:
//   puesto → reserva un pedido libre → va al cajón de fin de línea → recoge sus productos (agachándose) →
//   vuelve al puesto y los deja en la mesa → cuando están todos, empaqueta (tarda según la mejora de
//   preparación) → lleva la caja a expedición → vuelve al puesto.
// Nunca tocan pedidos reservados por el jugador ni cajas de otros. El estado del movimiento es de la sesión
// (game.runtime.pickers); al cargar una partida lo que llevaban vuelve al cajón y las cajas, a expedición.

import { productInfo, HAND_CAPACITY } from '../config/products.js';
import { distance, normalizeAngle } from '../core/util.js';
import { depotLayout } from '../world/depotLayout.js';
import { depotPath } from '../world/depotNav.js';
import { compareOrders, getOrder } from './orders.js';

const WALK_SPEED = 38; // px/s
const PICK_TIME = 0.8;
const PLACE_TIME = 0.6;
const STORE_TIME = 0.7;

export const pickersOf = (state) => state.workers.filter((w) => w.typeId === 'picker');

/** Puesto de trabajo del preparador (según el orden de contratación). */
export function stationFor(game, worker) {
  const L = depotLayout(game.city.depot);
  const index = Math.max(0, pickersOf(game.state).indexOf(worker));
  return L.stations[index % L.stations.length];
}

function faceToward(rt, x, y) {
  rt.yaw = Math.atan2(y - rt.y, x - rt.x);
}

export function getPickerRuntime(game, worker) {
  if (!game.runtime.pickers) game.runtime.pickers = {};
  let rt = game.runtime.pickers[worker.id];
  if (!rt) {
    const station = stationFor(game, worker);
    rt = {
      phase: 'idle', x: station.stand.x, y: station.stand.y, yaw: station.side === 'north' ? Math.PI / 2 : -Math.PI / 2,
      path: [], after: null, orderId: null, timer: 0, scan: Math.random() * 0.5, moving: 0,
      anim: 'idle', animTime: 0, status: 'Esperando pedidos',
    };
    game.runtime.pickers[worker.id] = rt;
  }
  return rt;
}

function walkTo(game, rt, target, after) {
  rt.path = depotPath(game.city, { x: rt.x, y: rt.y }, target);
  rt.after = after;
  rt.phase = 'walking';
  rt.anim = 'walk';
}

/** Pedido que puede preparar un empleado: sin reservar y con todos sus productos por la cinta o en el cajón. */
function freeOrder(game) {
  const list = game.state.orders.filter((o) => o.status === 'pending' && o.prep > 0 && !o.assignedTo
    && o.items?.length && o.items.every((i) => i.at === 'queued' || i.at === 'belt' || i.at === 'bin'));
  // Primero los que ya tienen productos esperando en el cajón o en la cinta
  const ready = (o) => o.items.filter((i) => i.at !== 'queued').length;
  list.sort((a, b) => ready(b) - ready(a) || compareOrders(a, b));
  return list[0] ?? null;
}

const pickupFor = (game, worker) => {
  const L = depotLayout(game.city.depot);
  return L.pickupSpots[Math.max(0, pickersOf(game.state).indexOf(worker)) % L.pickupSpots.length];
};

function backToStation(game, worker, rt, status = 'Volviendo a su puesto') {
  const station = stationFor(game, worker);
  rt.orderId = null;
  rt.status = status;
  walkTo(game, rt, station.stand, 'idle');
}

/** Suelta todo lo que tuviera: productos al cajón, caja terminada a expedición, pedido sin reservar. */
export function releasePickerWork(game, workerId) {
  for (const order of game.state.orders) {
    if (order.assignedTo !== workerId) continue;
    for (const item of order.items ?? []) {
      if (item.at === 'worker' || (item.at === 'table' && item.table !== 0)) {
        item.at = 'bin';
        item.binAt = game.state.time;
        delete item.by;
        delete item.table;
        delete item.station;
      }
    }
    order.assignedTo = null;
    order.handling = null;
    order.status = 'pending';
    if (order.prep <= 0) {
      order.readySince = game.state.time;
      order.dispatched = true;
    }
  }
  if (game.runtime.pickers) delete game.runtime.pickers[workerId];
}

export function updatePickers(game, dt) {
  const { state, derived } = game;
  const L = depotLayout(game.city.depot);
  for (const worker of pickersOf(state)) {
    const rt = getPickerRuntime(game, worker);
    const efficiency = worker.skill * derived.staffEfficiency;
    const station = stationFor(game, worker);
    rt.animTime += dt;
    rt.moving = 0;
    const order = rt.orderId ? getOrder(state, rt.orderId) : null;
    // El pedido ya no existe o ya no es suyo (rechazado, despedido...): vuelve al puesto
    if (rt.orderId && (!order || order.assignedTo !== worker.id)) {
      backToStation(game, worker, rt);
      continue;
    }

    switch (rt.phase) {
      case 'walking': {
        let step = WALK_SPEED * Math.min(1.6, efficiency) * dt;
        const startX = rt.x;
        const startY = rt.y;
        while (step > 0 && rt.path.length) {
          const next = rt.path[0];
          const d = distance(rt.x, rt.y, next.x, next.y);
          if (d <= step) {
            rt.x = next.x; rt.y = next.y; step -= d; rt.path.shift();
          } else {
            rt.x += ((next.x - rt.x) / d) * step;
            rt.y += ((next.y - rt.y) / d) * step;
            step = 0;
          }
        }
        const moved = distance(startX, startY, rt.x, rt.y);
        if (moved > 0.01) {
          const target = Math.atan2(rt.y - startY, rt.x - startX);
          rt.yaw += normalizeAngle(target - rt.yaw) * Math.min(1, dt * 12);
          rt.moving = moved / dt;
        }
        if (!rt.path.length) arrive(game, worker, rt, station, L);
        break;
      }
      case 'idle': {
        rt.anim = 'idle';
        faceToward(rt, (station.surface.x0 + station.surface.x1) / 2, (station.surface.y0 + station.surface.y1) / 2);
        rt.scan -= dt;
        if (rt.scan > 0) break;
        rt.scan = 0.5;
        const next = freeOrder(game);
        if (!next) { rt.status = 'Esperando pedidos'; break; }
        next.assignedTo = worker.id;
        next.handling = 'staff';
        rt.orderId = next.id;
        rt.status = `Pedido #${String(next.number).padStart(4, '0')}: a por los productos`;
        walkTo(game, rt, pickupFor(game, worker), 'waitItem');
        break;
      }
      case 'waitItem': {
        rt.anim = 'idle';
        faceToward(rt, (L.bin.rect.x0 + L.bin.rect.x1) / 2, (L.bin.rect.y0 + L.bin.rect.y1) / 2);
        if (order.items.some((i) => i.at === 'bin')) {
          rt.phase = 'picking';
          rt.timer = PICK_TIME / Math.min(1.6, efficiency);
          rt.anim = 'crouch';
          rt.animTime = 0;
        } else {
          const coming = order.items.find((i) => i.at === 'queued' || i.at === 'belt');
          rt.status = coming ? `Esperando ${coming.name} en la cinta` : 'Esperando productos';
        }
        break;
      }
      case 'picking': {
        rt.timer -= dt;
        if (rt.timer > 0) break;
        let bulk = 0;
        for (const item of order.items) {
          if (item.at !== 'bin') continue;
          const b = productInfo(item.name).bulk;
          if (bulk && bulk + b > HAND_CAPACITY) break;
          bulk += b;
          item.at = 'worker';
          item.by = worker.id;
          delete item.binAt;
        }
        if (!bulk) { rt.phase = 'waitItem'; break; }
        rt.status = 'Llevando productos a su mesa';
        walkTo(game, rt, station.stand, 'placing');
        break;
      }
      case 'placing': {
        rt.anim = 'reach';
        rt.timer -= dt;
        if (rt.timer > 0) break;
        for (const item of order.items) {
          const mineOnTable = item.at === 'table' && item.table !== 0; // ya en su mesa (quizá en un puesto anterior)
          if (!mineOnTable && (item.at !== 'worker' || item.by !== worker.id)) continue;
          // Si al despedir a otro preparador le ha tocado otro puesto, lo que ya tenía se pasa al nuevo
          item.at = 'table';
          item.table = station.table;
          item.station = station.index;
          delete item.by;
        }
        const complete = order.items.every((i) => i.at === 'table' && i.station === station.index);
        if (complete) {
          rt.phase = 'packing';
          rt.anim = 'pack';
          rt.status = `Empaquetando el pedido #${String(order.number).padStart(4, '0')}`;
        } else {
          rt.status = 'Faltan productos: vuelve a la cinta';
          walkTo(game, rt, pickupFor(game, worker), 'waitItem');
        }
        break;
      }
      case 'packing': {
        rt.anim = 'pack';
        faceToward(rt, (station.surface.x0 + station.surface.x1) / 2, (station.surface.y0 + station.surface.y1) / 2);
        order.prep = Math.max(0, order.prep - dt * derived.prepRate * efficiency);
        if (order.prep > 0) break;
        for (const item of order.items) {
          item.at = 'box';
          delete item.table;
          delete item.station;
        }
        order.status = 'picked'; // la caja va en las manos del empleado
        rt.status = 'Llevando la caja a expedición';
        game.events.emit('staffPacked', { order, worker });
        walkTo(game, rt, L.rack.stand, 'storing');
        break;
      }
      case 'storing': {
        rt.anim = 'reach';
        faceToward(rt, L.rack.rect.x0, (L.rack.rect.y0 + L.rack.rect.y1) / 2);
        rt.timer -= dt;
        if (rt.timer > 0) break;
        // En expedición queda libre para el jugador, los repartidores y los drones
        order.assignedTo = null;
        order.handling = null;
        order.status = 'pending';
        order.readySince = state.time;
        order.dispatched = true;
        game.events.emit('orderReady', { order, by: worker });
        backToStation(game, worker, rt);
        break;
      }
      default:
        rt.phase = 'idle';
    }
  }
}

/** Qué hacer al terminar un trayecto. */
function arrive(game, worker, rt, station) {
  rt.anim = 'idle';
  switch (rt.after) {
    case 'placing': rt.phase = 'placing'; rt.timer = PLACE_TIME; rt.animTime = 0; break;
    case 'storing': rt.phase = 'storing'; rt.timer = STORE_TIME; rt.animTime = 0; break;
    case 'waitItem': rt.phase = 'waitItem'; break;
    default:
      rt.phase = 'idle';
      rt.x = station.stand.x;
      rt.y = station.stand.y;
      if (!rt.orderId) rt.status = 'Esperando pedidos';
  }
}

/** Caja o productos que lleva un preparador (para dibujarlos en sus manos). */
export function pickerLoad(game, worker) {
  const rt = game.runtime.pickers?.[worker.id];
  const order = rt?.orderId ? getOrder(game.state, rt.orderId) : null;
  if (!order) return { box: null, items: [] };
  if (order.prep <= 0 && order.assignedTo === worker.id) return { box: order, items: [] };
  return { box: null, items: order.items.filter((i) => i.at === 'worker' && i.by === worker.id) };
}
