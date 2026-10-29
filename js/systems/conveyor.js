// Cinta transportadora del almacén. Los productos de los pedidos por preparar salen de recepción uno a uno
// ("queued" → "belt"), avanzan a velocidad constante y, si nadie los recoge, caen al cajón de fin de línea
// ("bin"), de donde se pueden seguir cogiendo. Nada desaparece: el estado vive en order.items y se guarda.
//   item.at  : queued | belt | bin | hand | worker | table | box
//   item.pos : distancia recorrida por la cinta (solo con at = belt)

import { compareOrders } from './orders.js';
import { BELT_SPEED, depotLayout } from '../world/depotLayout.js';

export { BELT_SPEED };
const SPACING = 12; // px mínimos entre productos al entrar en la cinta
const RELEASE_GAP = 1.2; // s entre dos productos
const MAX_ON_BELT = 10;

export function getConveyor(game) {
  if (!game.runtime.conveyor) game.runtime.conveyor = { releaseTimer: 0 };
  return game.runtime.conveyor;
}

/** Tiempo aproximado que tarda un producto en recorrer la cinta entera (s). */
export function beltTravelTime(game) {
  return depotLayout(game.city.depot).belt.length / BELT_SPEED;
}

/** Pedido que todavía no está empaquetado (sus productos pueden pasar por la cinta). */
export const needsPacking = (order) => order.status === 'pending' && order.prep > 0;

/** Primero lo que alguien está preparando (empleados, después el jugador), luego el pedido seguido y la prioridad. */
function releaseRank(game, order) {
  if (order.assignedTo && order.assignedTo !== 'player') return 0;
  if (order.assignedTo === 'player') return 1;
  if (order.id === game.trackedOrderId) return 2;
  return 3;
}

export function updateConveyor(game, dt) {
  const { state, city } = game;
  const L = depotLayout(city.depot);
  const length = L.belt.length;
  const rt = getConveyor(game);

  let onBelt = 0;
  let nearestToStart = Infinity;
  for (const order of state.orders) {
    if (!order.items) continue;
    for (const item of order.items) {
      if (item.at !== 'belt') continue;
      item.pos = (Number.isFinite(item.pos) ? item.pos : 0) + BELT_SPEED * dt;
      if (item.pos >= length) {
        // Fin de línea: cae al cajón y espera a que alguien lo recoja
        item.at = 'bin';
        delete item.pos;
        item.binAt = state.time;
        game.events.emit('itemBinned', { order, item });
        continue;
      }
      onBelt++;
      nearestToStart = Math.min(nearestToStart, item.pos);
    }
  }

  rt.releaseTimer -= dt;
  if (rt.releaseTimer > 0 || onBelt >= MAX_ON_BELT || nearestToStart < SPACING) return;
  const candidates = state.orders.filter((o) => needsPacking(o) && o.items?.some((i) => i.at === 'queued'));
  if (!candidates.length) return;
  candidates.sort((a, b) => releaseRank(game, a) - releaseRank(game, b) || compareOrders(a, b));
  const order = candidates[0];
  const item = order.items.find((i) => i.at === 'queued');
  item.at = 'belt';
  item.pos = 0;
  rt.releaseTimer = RELEASE_GAP;
  game.events.emit('itemOnBelt', { order, item });
}
