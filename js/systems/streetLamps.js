// Farolas que se pueden derribar: al pasar por encima con el vehículo caen al suelo y, unos 10 segundos
// después, se vuelven a levantar en su sitio. Es estado de la sesión (game.runtime), no se guarda en la partida.

import { clamp } from '../core/util.js';

export const LAMP_RESPAWN_TIME = 10; // s desde el golpe hasta que vuelve a estar en pie
export const LAMP_FALL_TIME = 0.55; // s que tarda en caer
export const LAMP_RISE_TIME = 0.8; // s que tarda en levantarse (dentro de los 10 s)
const POLE_RADIUS = 2.5; // px
const MIN_HIT_SPEED = 12; // px/s: parado o casi parado no la tira
const SLIDE = 7; // px que el golpe arrastra la base del poste
const LYING = Math.PI / 2;

/** Farolas derribadas: índice de city.lampPosts → { age, dirX, dirY, rising }. */
export function getBrokenLamps(game) {
  if (!game.runtime.brokenLamps) game.runtime.brokenLamps = new Map();
  return game.runtime.brokenLamps;
}

/** Avanza las farolas caídas y tira las que toque el vehículo del jugador (mismos círculos que las colisiones). */
export function updateStreetLamps(game, dt, type, moveAngle) {
  const lamps = game.city.lampPosts;
  if (!lamps?.length) return;
  const broken = getBrokenLamps(game);
  const p = game.state.player;
  const r = type.width * 0.45 + POLE_RADIUS;
  const offset = type.length * 0.26;
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const touches = (x, y, extra = 0) => {
    const reach = (r + extra) ** 2;
    for (const k of [1, 0, -1]) {
      const cx = p.x + cos * offset * k;
      const cy = p.y + sin * offset * k;
      if ((x - cx) ** 2 + (y - cy) ** 2 < reach) return true;
    }
    return false;
  };

  // Tiempos de las caídas; no se levanta debajo del vehículo (espera a que se aparte)
  const riseAt = LAMP_RESPAWN_TIME - LAMP_RISE_TIME;
  for (const [index, entry] of broken) {
    if (!entry.rising && entry.age + dt >= riseAt) {
      if (touches(lamps[index].x, lamps[index].y, 12)) {
        entry.age = riseAt;
        continue;
      }
      entry.rising = true;
    }
    entry.age += dt;
    if (entry.age >= LAMP_RESPAWN_TIME) broken.delete(index);
  }

  // Golpes nuevos
  const speed = Math.abs(p.speed);
  if (speed < MIN_HIT_SPEED) return;
  const box = offset + r;
  for (let i = 0; i < lamps.length; i++) {
    const lamp = lamps[i];
    if (Math.abs(lamp.x - p.x) > box || Math.abs(lamp.y - p.y) > box) continue;
    if (broken.has(i) || !touches(lamp.x, lamp.y)) continue;
    // Cae en el sentido de la marcha, algo desviada hacia el lado por el que se le ha dado
    const dir = p.speed >= 0 ? moveAngle : p.angle + Math.PI;
    const ox = lamp.x - p.x;
    const oy = lamp.y - p.y;
    const ol = Math.hypot(ox, oy) || 1;
    let fx = Math.cos(dir) + (ox / ol) * 0.5;
    let fy = Math.sin(dir) + (oy / ol) * 0.5;
    const fl = Math.hypot(fx, fy) || 1;
    fx /= fl;
    fy /= fl;
    broken.set(i, { age: 0, dirX: fx, dirY: fy, rising: false });
    p.speed *= 0.94; // el golpe frena un poco (sin llegar a parar el vehículo)
    game.events.emit('lampHit', { index: i, x: lamp.x, y: lamp.y, speed, dirX: fx, dirY: fy });
  }
}

/**
 * Postura de una farola derribada para dibujarla: inclinación (0 = de pie, π/2 = tumbada),
 * y desplazamiento de la base en la dirección de la caída. Mientras está derribada, la bombilla está rota.
 */
export function lampPose(entry) {
  const { age } = entry;
  const riseAt = LAMP_RESPAWN_TIME - LAMP_RISE_TIME;
  let tilt;
  let slide;
  if (age < LAMP_FALL_TIME) {
    // Cae acelerando, como un poste que vuelca
    const t = age / LAMP_FALL_TIME;
    tilt = LYING * t * t;
    slide = SLIDE * Math.sin((t * Math.PI) / 2);
  } else if (age < riseAt) {
    // Pequeño rebote al tocar el suelo
    const u = age - LAMP_FALL_TIME;
    tilt = LYING - Math.abs(Math.sin(u * 9)) * 0.14 * Math.exp(-u * 6);
    slide = SLIDE;
  } else {
    const u = clamp((age - riseAt) / LAMP_RISE_TIME, 0, 1);
    const e = u * u * (3 - 2 * u);
    tilt = LYING * (1 - e);
    slide = SLIDE * (1 - e);
  }
  return { tilt, slide, dirX: entry.dirX, dirY: entry.dirY };
}
