// Física arcade del vehículo controlado por el jugador, con colisiones contra edificios y límites.

import { CRASH_DAMAGE_SPEED } from '../config/constants.js';
import { clamp } from '../core/util.js';
import { chargeFuel } from './economy.js';
import { getOrder, refreshTransitStatus } from './orders.js';
import { getVehicleStats, getPlayerVehicle } from './stats.js';

function hitsAt(city, vehicleType, x, y, angle) {
  const radius = vehicleType.width * 0.45;
  const offset = vehicleType.length * 0.26;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (
    city.circleHitsSolid(x, y, radius)
    || city.circleHitsSolid(x + cos * offset, y + sin * offset, radius)
    || city.circleHitsSolid(x - cos * offset, y - sin * offset, radius)
  );
}

export function updatePlayerVehicle(game, dt) {
  const { state, city, derived, controls } = game;
  const p = state.player;
  const vehicle = getPlayerVehicle(state);
  const stats = getVehicleStats(state, vehicle.typeId, derived);
  const type = stats.type;
  const throttle = clamp(controls.throttle, -1, 1);
  const steer = clamp(controls.steer, -1, 1);

  // Velocidad longitudinal
  if (throttle > 0) {
    p.speed += (p.speed < 0 ? stats.accel * 2.2 : stats.accel) * throttle * dt;
  } else if (throttle < 0) {
    p.speed -= (p.speed > 0 ? stats.accel * 2.4 : stats.accel * 0.7) * -throttle * dt;
  } else if (p.speed !== 0) {
    const drag = (90 + Math.abs(p.speed) * 0.35) * dt;
    p.speed -= Math.sign(p.speed) * Math.min(Math.abs(p.speed), drag);
  }
  p.speed = clamp(p.speed, -stats.maxSpeed * 0.4, stats.maxSpeed);
  if (throttle === 0 && Math.abs(p.speed) < 2) p.speed = 0;

  // Dirección: depende de la velocidad y de la maniobrabilidad
  const speedFactor = clamp(Math.abs(p.speed) / 60, 0, 1);
  const damping = 1 / (1 + (Math.abs(p.speed) / stats.maxSpeed) * 0.55);
  const steerRate = 2.7 * stats.handling * speedFactor * damping;
  const nextAngle = p.angle + steer * steerRate * dt * (p.speed >= 0 ? 1 : -1);
  if (!hitsAt(city, type, p.x, p.y, nextAngle)) p.angle = nextAngle;

  // Movimiento con colisiones por ejes
  const dx = Math.cos(p.angle) * p.speed * dt;
  const dy = Math.sin(p.angle) * p.speed * dt;
  let moved = 0;
  if (dx !== 0 || dy !== 0) {
    if (!hitsAt(city, type, p.x + dx, p.y + dy, p.angle)) {
      p.x += dx;
      p.y += dy;
      moved = Math.hypot(dx, dy);
    } else {
      const impact = Math.abs(p.speed);
      if (!hitsAt(city, type, p.x + dx, p.y, p.angle)) {
        p.x += dx;
        moved = Math.abs(dx);
        p.speed *= 0.85;
      } else if (!hitsAt(city, type, p.x, p.y + dy, p.angle)) {
        p.y += dy;
        moved = Math.abs(dy);
        p.speed *= 0.85;
      } else {
        p.speed = -p.speed * 0.25;
      }
      registerImpact(game, impact);
    }
  }

  if (moved > 0) {
    p.distanceDriven += moved;
    chargeFuel(game, moved, stats.fuelPerTile);
  }
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
