// El repartidor a pie: movimiento con colisiones, bajar del vehículo y subir a él.
// Mientras va a pie, el vehículo se queda aparcado donde lo dejó (state.player.x/y/angle sigue siendo
// la posición del vehículo, como siempre); la persona está en state.player.foot.

import { getVehicleType } from '../config/vehicles.js';
import { clamp, normalizeAngle } from '../core/util.js';
import { PARKED_SPOTS, isInsideDepot, parkedSpot } from '../world/depotLayout.js';
import { circlePush, stopVehicle } from './playerVehicle.js';
import { refreshTransitStatus } from './orders.js';
import { getPlayerVehicle } from './stats.js';
import { updateStreetLamps } from './streetLamps.js';

export const WALKER_RADIUS = 4.5;
export const WALK_SPEED = 64; // px/s
export const RUN_SPEED = 108;
export const EYE_HEIGHT = 13; // altura de los ojos en la vista en primera persona
export const MAX_EXIT_SPEED = 25; // por encima de esto hay que frenar antes de bajarse
export const JUMP_SPEED = 58; // px/s hacia arriba al saltar
export const GRAVITY = 270; // px/s²: salto de ~6 px (unos 75 cm a la escala de la persona) y ~0,43 s
const SUBSTEP = 3;

/**
 * ¿La furgoneta de un repartidor está fuera de su plaza (saliendo, en la calle o volviendo)? Mientras el
 * repartidor va a pie por el almacén a por las cajas, su furgoneta sigue aparcada (rt.atSpot).
 */
export function vehicleOnRoad(rt) {
  return Boolean(rt) && rt.phase !== 'idle' && !rt.atSpot;
}

/**
 * Plazas del patio: cada vehículo conserva la suya aunque su repartidor esté en ruta, así los demás no
 * cambian de sitio y él vuelve a la misma. Primero los libres (para poder subir a ellos) y después los de
 * los repartidores. Devuelve [{ vehicle, x, y, angle, onRoad }].
 */
function yardSpots(game) {
  const { state, runtime, city } = game;
  const list = [];
  const queue = [];
  for (const vehicle of state.vehicles) {
    if (vehicle.id === state.player.vehicleId) continue;
    if (!vehicle.driver && vehicle.park) list.push({ vehicle, ...vehicle.park, onRoad: false });
    else queue.push(vehicle);
  }
  queue.sort((a, b) => Number(Boolean(a.driver)) - Number(Boolean(b.driver)));
  queue.slice(0, PARKED_SPOTS).forEach((vehicle, index) => {
    const rt = vehicle.driver ? runtime.workers[vehicle.driver] : null;
    list.push({ vehicle, ...parkedSpot(city.depot, index), onRoad: vehicleOnRoad(rt) });
  });
  return list;
}

/**
 * Vehículos aparcados (mismo orden y sitio en las dos vistas y en la lógica). Un vehículo que el jugador
 * dejó al cambiar de vehículo se queda donde lo dejó (vehicle.park); el resto ocupa las plazas del patio.
 */
export function parkedVehicles(game) {
  return yardSpots(game).filter((spot) => !spot.onRoad).map(({ onRoad, ...spot }) => spot);
}

/** Plaza del patio que le toca a un vehículo (esté aparcado o en ruta), o null si no le cabe ninguna. */
export function parkingSpotOf(game, vehicleId) {
  const spot = yardSpots(game).find((s) => s.vehicle.id === vehicleId);
  return spot ? { x: spot.x, y: spot.y, angle: spot.angle } : null;
}

/**
 * Puntos de interacción de un vehículo: trasera (zona de carga) y las dos puertas delanteras. "cab" es la del
 * conductor (lado izquierdo; la usan los repartidores), "cabRight" la del acompañante; "doors" tiene las dos.
 */
export function vehiclePoints(x, y, angle, type) {
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const lx = fy; // izquierda en un mapa con la y hacia abajo
  const ly = -fx;
  const ahead = type.length * 0.12;
  const out = type.width / 2 + 3;
  const cab = { x: x + fx * ahead + lx * out, y: y + fy * ahead + ly * out, side: 'left' };
  const cabRight = { x: x + fx * ahead - lx * out, y: y + fy * ahead - ly * out, side: 'right' };
  return {
    rear: { x: x - fx * (type.length / 2 + 3), y: y - fy * (type.length / 2 + 3) },
    cab,
    cabRight,
    doors: [cab, cabRight],
  };
}

/** La puerta delantera más cercana a un punto (para guiar a la persona hacia el lado por el que llega). */
export function nearestDoor(points, x, y) {
  return points.doors.reduce((best, door) => (Math.hypot(door.x - x, door.y - y) < Math.hypot(best.x - x, best.y - y) ? door : best));
}

export function playerVehiclePoints(game) {
  const p = game.state.player;
  return vehiclePoints(p.x, p.y, p.angle, getVehicleType(getPlayerVehicle(game.state).typeId));
}

/** Los vehículos parados son obstáculos para la persona: tres círculos a lo largo de la carrocería. */
function blockingVehicleCircles(game) {
  const p = game.state.player;
  const circles = [];
  const add = (x, y, angle, type) => {
    const r = type.width * 0.5;
    const offset = type.length * 0.3;
    for (const k of [-1, 0, 1]) circles.push({ x: x + Math.cos(angle) * offset * k, y: y + Math.sin(angle) * offset * k, r });
  };
  add(p.x, p.y, p.angle, getVehicleType(getPlayerVehicle(game.state).typeId));
  for (const parked of parkedVehicles(game)) add(parked.x, parked.y, parked.angle, getVehicleType(parked.vehicle.typeId));
  return circles;
}

/** Empuje para sacar a la persona de paredes, muebles, árboles y vehículos (o null si no toca nada). */
export function walkerPush(game, x, y, r = WALKER_RADIUS) {
  let px = 0;
  let py = 0;
  const world = circlePush(game.city, x, y, r, true);
  if (world) { px += world.x; py += world.y; }
  for (const c of blockingVehicleCircles(game)) {
    const dx = x + px - c.x;
    const dy = y + py - c.y;
    const min = r + c.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    if (d > 1e-6) { px += (dx / d) * (min - d); py += (dy / d) * (min - d); } else { px += min; }
  }
  return px || py ? { x: px, y: py } : null;
}

export function walkerBlocked(game, x, y) {
  return walkerPush(game, x, y) !== null;
}

function resolve(game, foot) {
  for (let i = 0; i < 4; i++) {
    const push = walkerPush(game, foot.x, foot.y);
    if (!push) return;
    foot.x += push.x;
    foot.y += push.y;
  }
}

/**
 * Salto: solo desde el suelo (no se puede volar encadenando saltos en el aire) y con gravedad. Las colisiones
 * con paredes, muebles y vehículos siguen activas en el aire (se aplican en el plano, como al andar).
 * f.z es la altura de los pies sobre el suelo; f.vz la velocidad vertical.
 */
function updateJump(game, f, dt) {
  const controls = game.controls;
  const wants = controls.jump;
  controls.jump = false; // la pulsación se consume: mantener la tecla no hace saltar en bucle
  if (!Number.isFinite(f.z)) f.z = 0;
  if (!Number.isFinite(f.vz)) f.vz = 0;
  const grounded = f.z <= 0 && f.vz <= 0;
  if (wants && grounded) {
    f.vz = JUMP_SPEED;
    f.jumps = (f.jumps ?? 0) + 1;
    game.events.emit('playerJumped', {});
  }
  if (f.z > 0 || f.vz > 0) {
    f.vz -= GRAVITY * dt;
    f.z += f.vz * dt;
    if (f.z <= 0) {
      const impact = -f.vz;
      f.z = 0;
      f.vz = 0;
      f.landed = impact; // la cámara hace un pequeño amortiguado al aterrizar
      game.events.emit('playerLanded', { impact });
    }
  }
}

/**
 * Mueve a la persona. game.controls.walkX/walkY es la dirección en el mapa (la calcula la entrada según
 * la vista); lookYaw/lookPitch son giros acumulados del ratón; faceMove orienta hacia donde se anda (2D).
 */
export function updateOnFoot(game, dt) {
  const { state, controls, derived } = game;
  const p = state.player;
  const f = p.foot;
  f.yaw = normalizeAngle(f.yaw + (controls.lookYaw || 0));
  f.pitch = clamp(f.pitch + (controls.lookPitch || 0), -1.25, 1.25);
  controls.lookYaw = 0;
  controls.lookPitch = 0;

  let mx = controls.walkX || 0;
  let my = controls.walkY || 0;
  const len = Math.hypot(mx, my);
  if (len > 1) { mx /= len; my /= len; }
  if (controls.faceMove && len > 0.05) f.yaw = Math.atan2(my, mx);
  const carrying = Boolean(p.hands.box);
  const speed = (controls.sprint ? RUN_SPEED : WALK_SPEED) * (derived.walkSpeedMult ?? 1) * (carrying ? 0.85 : 1);
  const dx = mx * speed * dt;
  const dy = my * speed * dt;
  const dist = Math.hypot(dx, dy);
  const startX = f.x;
  const startY = f.y;
  if (dist > 0) {
    const steps = Math.max(1, Math.ceil(dist / SUBSTEP));
    for (let s = 0; s < steps; s++) {
      f.x += dx / steps;
      f.y += dy / steps;
      resolve(game, f);
    }
  }
  f.moving = Math.hypot(f.x - startX, f.y - startY) / Math.max(dt, 1e-6);
  f.walked += Math.hypot(f.x - startX, f.y - startY);
  updateJump(game, f, dt);

  // El vehículo sigue aparcado; las farolas derribadas siguen su temporizador
  p.speed = 0;
  updateStreetLamps(game, dt, getVehicleType(getPlayerVehicle(state).typeId), p.angle);
  refreshTransitStatus(game);
}

/** Bajar del vehículo por la puerta por la que se subió (o por donde haya sitio). */
export function exitVehicle(game) {
  const { state } = game;
  const p = state.player;
  if (p.mode === 'foot') return { ok: false, reason: 'Ya vas a pie' };
  if (Math.abs(p.speed) > MAX_EXIT_SPEED) return { ok: false, reason: 'Frena antes de bajarte' };
  stopVehicle(game);
  const type = getVehicleType(getPlayerVehicle(state).typeId);
  const fx = Math.cos(p.angle);
  const fy = Math.sin(p.angle);
  const side = type.width / 2 + WALKER_RADIUS + 3;
  const left = { x: p.x + fx * type.length * 0.12 + fy * side, y: p.y + fy * type.length * 0.12 - fx * side };
  const right = { x: p.x + fx * type.length * 0.12 - fy * side, y: p.y + fy * type.length * 0.12 + fx * side };
  // Se baja por la misma puerta por la que subió (si hay sitio); si no, por la otra, por detrás o por delante
  const doors = game.runtime.doorSide === 'right' ? [right, left] : [left, right];
  const candidates = [
    ...doors,
    { x: p.x - fx * (type.length / 2 + WALKER_RADIUS + 4), y: p.y - fy * (type.length / 2 + WALKER_RADIUS + 4) }, // detrás
    { x: p.x + fx * (type.length / 2 + WALKER_RADIUS + 4), y: p.y + fy * (type.length / 2 + WALKER_RADIUS + 4) }, // delante
  ];
  // Nunca al otro lado de una pared del almacén (son finas: el punto podría quedar dentro)
  const depot = game.city.depot;
  const vehicleInside = isInsideDepot(depot, p.x, p.y);
  const spot = candidates.find((c) => isInsideDepot(depot, c.x, c.y) === vehicleInside && !walkerBlocked(game, c.x, c.y));
  if (!spot) return { ok: false, reason: 'No hay sitio para abrir la puerta: mueve un poco el vehículo' };
  const f = p.foot;
  f.x = spot.x;
  f.y = spot.y;
  f.yaw = p.angle;
  f.pitch = 0;
  f.z = 0;
  f.vz = 0;
  p.mode = 'foot';
  game.controls.throttle = 0;
  game.controls.steer = 0;
  game.events.emit('playerExited', { x: f.x, y: f.y });
  return { ok: true, kind: 'exit' };
}

/**
 * Subir al vehículo propio o, si está aparcado en el patio y libre, a otro de la flota. "side" es la puerta
 * usada ('left' conductor, 'right' acompañante): al bajar se sale por el mismo lado.
 */
export function enterVehicle(game, vehicleId = game.state.player.vehicleId, side = 'left') {
  const { state } = game;
  const p = state.player;
  if (p.mode === 'drive') return { ok: false, reason: 'Ya estás conduciendo' };
  if (p.hands.box || p.hands.items.length) return { ok: false, reason: 'Deja lo que llevas antes de conducir' };
  if (p.foot.z > 0.5) return { ok: false, reason: 'Espera a tocar el suelo' };
  p.foot.z = 0;
  p.foot.vz = 0;
  if (vehicleId !== p.vehicleId) {
    const parked = parkedVehicles(game).find((entry) => entry.vehicle.id === vehicleId);
    if (!parked || parked.vehicle.driver) return { ok: false, reason: 'Ese vehículo no está disponible' };
    if (p.cargo.length) return { ok: false, reason: 'Descarga primero las cajas de tu vehículo' };
    const previous = state.vehicles.find((v) => v.id === p.vehicleId);
    if (previous) {
      previous.driver = null;
      previous.park = { x: p.x, y: p.y, angle: p.angle }; // se queda donde estaba aparcado
    }
    parked.vehicle.driver = 'player';
    delete parked.vehicle.park;
    p.vehicleId = parked.vehicle.id;
    p.x = parked.x;
    p.y = parked.y;
    p.angle = parked.angle;
    game.events.emit('vehicleChanged', { vehicle: parked.vehicle, type: getVehicleType(parked.vehicle.typeId) });
  }
  p.mode = 'drive';
  game.runtime.doorSide = side === 'right' ? 'right' : 'left';
  stopVehicle(game);
  game.controls.walkX = 0;
  game.controls.walkY = 0;
  game.events.emit('playerEntered', { vehicleId: p.vehicleId });
  return { ok: true, kind: 'enter' };
}
