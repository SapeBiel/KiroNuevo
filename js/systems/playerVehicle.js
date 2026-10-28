// Física arcade del vehículo controlado por el jugador, con colisiones contra edificios y límites.
// Derrape: con controls.drift (Espacio) a buena velocidad, la carrocería (p.angle) gira más deprisa que
// la dirección real de avance (drift.moveAngle) y el vehículo se desliza. Un derrape largo da un turbo al soltar.

import { CRASH_DAMAGE_SPEED, TILE } from '../config/constants.js';
import { clamp, normalizeAngle } from '../core/util.js';
import { chargeFuel } from './economy.js';
import { getOrder, refreshTransitStatus } from './orders.js';
import { getVehicleStats, getPlayerVehicle } from './stats.js';
import { updateStreetLamps } from './streetLamps.js';

export const DRIFT_MIN_SPEED = 70; // px/s para empezar a derrapar
const DRIFT_KEEP_SPEED = 45; // por debajo de esto el derrape termina solo
const DRIFT_MAX_SLIP = 1.15; // rad: ángulo máximo entre carrocería y avance (evita trompos)
export const BOOST_MIN_TIME = 0.55; // s de derrape necesarios para el turbo

/** Estado del derrape (no se guarda en la partida). */
export function getDrift(game) {
  if (!game.runtime.drift) {
    game.runtime.drift = { active: false, time: 0, slip: 0, maxSlip: 0, moveAngle: game.state.player.angle, boost: 0, boostTotal: 0 };
  }
  return game.runtime.drift;
}

/** Posición de las dos ruedas traseras (para marcas de derrape y humo). */
export function rearWheelPositions(p, type) {
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const back = type.length * 0.3;
  const side = type.width * 0.42;
  const bx = p.x - cos * back;
  const by = p.y - sin * back;
  return [
    { x: bx - sin * side, y: by + cos * side },
    { x: bx + sin * side, y: by - cos * side },
  ];
}

// --------------------------------------------------------- Colisiones ----
// El vehículo es una fila de tres círculos (morro, centro y cola). En vez de rechazar el movimiento
// cuando choca (lo que lo dejaba "pegado"), se mueve y después se le empuja fuera de las casillas
// sólidas. Así siempre puede girar para separarse y, si roza en ángulo, resbala a lo largo de la pared.

const SUBSTEP = 6; // px máximos por subpaso (evita atravesar paredes a mucha velocidad)

/** Empuje necesario para sacar un círculo de las casillas sólidas que toca (o null). */
function circlePush(city, cx, cy, r) {
  let px = 0;
  let py = 0;
  const minTx = Math.floor((cx - r) / TILE);
  const maxTx = Math.floor((cx + r) / TILE);
  const minTy = Math.floor((cy - r) / TILE);
  const maxTy = Math.floor((cy + r) / TILE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!city.isSolidTile(tx, ty)) continue;
      // Se aplica casilla a casilla para no empujar dos veces contra una pared recta
      const x = cx + px;
      const y = cy + py;
      const left = tx * TILE;
      const top = ty * TILE;
      const nearestX = clamp(x, left, left + TILE);
      const nearestY = clamp(y, top, top + TILE);
      const dx = x - nearestX;
      const dy = y - nearestY;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        px += (dx / d) * (r - d);
        py += (dy / d) * (r - d);
      } else {
        // El centro ha quedado dentro de la casilla: sale por el lado más cercano
        const exits = [
          [x - left, -1, 0], [left + TILE - x, 1, 0], [y - top, 0, -1], [top + TILE - y, 0, 1],
        ].sort((a, b) => a[0] - b[0]);
        const [depth, nx, ny] = exits[0];
        px += nx * (depth + r);
        py += ny * (depth + r);
      }
    }
  }
  return px || py ? { x: px, y: py } : null;
}

/** Saca el vehículo de las paredes. Devuelve la normal del choque (hacia fuera) o null si no toca nada. */
function depenetrate(city, type, p) {
  const r = type.width * 0.45;
  const offset = type.length * 0.26;
  let totalX = 0;
  let totalY = 0;
  for (let iteration = 0; iteration < 4; iteration++) {
    let pushed = false;
    for (const k of [1, 0, -1]) {
      const push = circlePush(city, p.x + Math.cos(p.angle) * offset * k, p.y + Math.sin(p.angle) * offset * k, r);
      if (!push) continue;
      p.x += push.x;
      p.y += push.y;
      totalX += push.x;
      totalY += push.y;
      pushed = true;
    }
    if (!pushed) break;
  }
  const length = Math.hypot(totalX, totalY);
  return length > 1e-6 ? { nx: totalX / length, ny: totalY / length } : null;
}

/** Respuesta al choque: de frente se para o rebota; de refilón resbala y endereza el morro. */
function respondToWall(game, p, drift, normal, moveAngle, dt) {
  const runtime = game.runtime;
  const speed = Math.abs(p.speed);
  if (speed < 1) return;
  const vx = Math.cos(moveAngle) * p.speed;
  const vy = Math.sin(moveAngle) * p.speed;
  // 1 = de frente contra la pared, 0 = paralelo a ella
  const into = -(vx * normal.nx + vy * normal.ny) / speed;
  if (into <= 0.05) {
    runtime.wallContact = false; // se está separando de la pared
    return;
  }
  const firstContact = !runtime.wallContact;
  runtime.wallContact = true;
  const impact = speed * into;
  // Golpe al tocar la pared o al empotrarse de frente (no en cada fotograma de roce)
  if (firstContact || into > 0.8) registerImpact(game, impact);
  if (impact > 45) endDrift(game, drift, { allowBoost: false });

  if (into > 0.8) {
    // De frente: rebote suave si iba rápido; si no, se queda quieto (marcha atrás o girar para salir)
    p.speed = impact > 70 ? -p.speed * 0.25 : 0;
    return;
  }
  // De refilón: pierde algo de velocidad al primer roce y muy poca mientras sigue rozando
  if (firstContact) p.speed *= 1 - into * 0.45;
  p.speed *= Math.exp(-0.8 * dt);
  // El morro se alinea con la pared en el sentido de la marcha
  let tx = -normal.ny;
  let ty = normal.nx;
  if (tx * vx + ty * vy < 0) { tx = -tx; ty = -ty; }
  const target = Math.atan2(ty, tx) + (p.speed < 0 ? Math.PI : 0);
  p.angle += normalizeAngle(target - p.angle) * (1 - Math.exp(-6 * dt));
  if (!drift.active) drift.moveAngle = p.angle;
}

function endDrift(game, drift, { allowBoost }) {
  if (!drift.active) return;
  const earned = allowBoost && drift.time >= BOOST_MIN_TIME && drift.maxSlip > 0.25;
  const { state } = game;
  if (!earned) drift.boost = 0;
  if (earned) {
    // Cuanto más largo el derrape, más dura el turbo (con tope)
    drift.boostTotal = Math.min(1.6, 0.5 + drift.time * 0.55);
    drift.boost = drift.boostTotal;
    const level = drift.time >= 2 ? 3 : drift.time >= 1.2 ? 2 : 1;
    game.events.emit('driftBoost', { level, duration: drift.time, x: state.player.x, y: state.player.y });
  }
  game.events.emit('driftEnd', { duration: drift.time, boosted: earned });
  drift.active = false;
  drift.time = 0;
  drift.maxSlip = 0;
}

export function updatePlayerVehicle(game, dt) {
  const { state, city, derived, controls } = game;
  const p = state.player;
  const drift = getDrift(game);
  const vehicle = getPlayerVehicle(state);
  const stats = getVehicleStats(state, vehicle.typeId, derived);
  const type = stats.type;
  const throttle = clamp(controls.throttle, -1, 1);
  const steer = clamp(controls.steer, -1, 1);
  // Si el ángulo cambió de golpe desde fuera (cargar partida, colocar el vehículo), el avance se alinea al instante
  if (!Number.isFinite(drift.moveAngle) || !Number.isFinite(drift.lastAngle)
    || Math.abs(normalizeAngle(p.angle - drift.lastAngle)) > 0.25) {
    drift.moveAngle = p.angle;
  }

  // Turbo tras un derrape: más aceleración y algo más de velocidad punta durante un instante
  if (drift.boost > 0) drift.boost = Math.max(0, drift.boost - dt);
  const accel = stats.accel * (drift.boost > 0 ? 1.7 : 1);
  const prevSpeed = p.speed;

  // Velocidad longitudinal
  if (throttle > 0) {
    p.speed += (p.speed < 0 ? accel * 2.2 : accel) * throttle * dt;
  } else if (throttle < 0) {
    p.speed -= (p.speed > 0 ? accel * 2.4 : accel * 0.7) * -throttle * dt;
  } else if (p.speed !== 0) {
    const drag = (90 + Math.abs(p.speed) * 0.35) * dt;
    p.speed -= Math.sign(p.speed) * Math.min(Math.abs(p.speed), drag);
  }

  // Inicio y fin del derrape
  const wantsDrift = Boolean(controls.drift) && p.speed > 0;
  if (!drift.active && wantsDrift && p.speed >= DRIFT_MIN_SPEED && Math.abs(steer) > 0.2) {
    drift.active = true;
    drift.time = 0;
    drift.maxSlip = 0;
    game.events.emit('driftStart', { x: p.x, y: p.y });
  } else if (drift.active && (!wantsDrift || p.speed < DRIFT_KEEP_SPEED)) {
    // Turbo solo si se suelta el botón yendo aún rápido (no si el derrape muere por frenar)
    endDrift(game, drift, { allowBoost: !controls.drift && p.speed >= DRIFT_KEEP_SPEED });
  }
  if (drift.active) {
    drift.time += dt;
    // Derrapar frena un poco el vehículo
    p.speed -= p.speed * 0.28 * dt;
  }

  // Con turbo la velocidad punta sube un 30 %; al acabar, el exceso se pierde poco a poco
  // (acelerando nunca se gana velocidad por encima del tope)
  const top = stats.maxSpeed * (drift.boost > 0 ? 1.3 : 1);
  if (p.speed > top) p.speed = Math.max(top, Math.min(p.speed, prevSpeed) - 220 * dt);
  p.speed = Math.max(p.speed, -stats.maxSpeed * 0.4);
  if (throttle === 0 && Math.abs(p.speed) < 2) p.speed = 0;

  // Dirección: depende de la velocidad y de la maniobrabilidad (derrapando gira bastante más)
  // Pegado a una pared y acelerando, se puede girar aunque la velocidad sea casi cero (para separarse)
  const pushingWall = game.runtime.wallContact && throttle !== 0;
  const speedFactor = clamp(Math.max(Math.abs(p.speed), pushingWall ? 40 : 0) / 60, 0, 1);
  const damping = 1 / (1 + (Math.abs(p.speed) / stats.maxSpeed) * 0.55);
  const steerRate = 2.7 * stats.handling * speedFactor * damping * (drift.active ? 1.6 : 1);
  // El giro ya no se bloquea al tocar una pared: si mete un extremo en ella, se le empuja fuera
  p.angle += steer * steerRate * dt * (p.speed >= 0 ? 1 : -1);
  let contact = depenetrate(city, type, p);

  // Dirección de avance: con agarre sigue a la carrocería casi al instante; derrapando se queda atrás
  const grip = drift.active ? 2.2 : 14;
  let slip = normalizeAngle(p.angle - drift.moveAngle);
  if (!drift.active && Math.abs(slip) < 0.02) {
    drift.moveAngle = p.angle;
    slip = 0;
  } else {
    drift.moveAngle += slip * (1 - Math.exp(-grip * dt));
    slip = normalizeAngle(p.angle - drift.moveAngle);
    if (Math.abs(slip) > DRIFT_MAX_SLIP) {
      drift.moveAngle = p.angle - Math.sign(slip) * DRIFT_MAX_SLIP;
      slip = Math.sign(slip) * DRIFT_MAX_SLIP;
    }
  }
  drift.slip = slip;
  if (drift.active) drift.maxSlip = Math.max(drift.maxSlip, Math.abs(slip));

  // Movimiento (en la dirección de avance, no la de la carrocería) en subpasos, saliendo de las paredes
  const moveAngle = p.speed >= 0 ? drift.moveAngle : p.angle;
  const step = p.speed * dt;
  const startX = p.x;
  const startY = p.y;
  if (step !== 0) {
    const steps = Math.max(1, Math.ceil(Math.abs(step) / SUBSTEP));
    for (let s = 0; s < steps; s++) {
      p.x += (Math.cos(moveAngle) * step) / steps;
      p.y += (Math.sin(moveAngle) * step) / steps;
      contact = depenetrate(city, type, p) ?? contact;
    }
  }
  if (contact) respondToWall(game, p, drift, contact, moveAngle, dt);
  else game.runtime.wallContact = false;
  const moved = Math.hypot(p.x - startX, p.y - startY);
  // Farolas: se derriban al pasar por encima y vuelven a su sitio al rato
  updateStreetLamps(game, dt, type, moveAngle);

  if (moved > 0) {
    p.distanceDriven += moved;
    chargeFuel(game, moved, stats.fuelPerTile);
  }
  drift.lastAngle = p.angle;
  game.crashCooldown = Math.max(0, (game.crashCooldown ?? 0) - dt);
  refreshTransitStatus(game);
}

function registerImpact(game, impact) {
  if (impact < 45 || game.crashCooldown > 0) return;
  game.crashCooldown = 0.35;
  const { state } = game;
  game.events.emit('crash', { impact, x: state.player.x, y: state.player.y });
  if (impact < CRASH_DAMAGE_SPEED) return;
  for (const id of state.player.cargo) {
    const order = getOrder(state, id);
    if (order && order.kind === 'fragile' && !order.damaged) {
      order.damaged = true;
      game.events.emit('notify', { type: 'warn', icon: '💥', title: 'Envío frágil dañado', text: 'Conduce con más cuidado: la recompensa baja un 40 %.' });
    }
  }
}
