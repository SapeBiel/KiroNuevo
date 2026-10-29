// Cercanía a la frontera de una zona bloqueada: el cartel "🔒 Zona · Desbloquéala en el ordenador (Empresa)"
// solo aparece cuando el jugador (a pie o al volante) se acerca mucho al borde de esa zona.

import { TILE } from '../config/constants.js';

/** A partir de esta distancia (px) al borde empieza a verse el cartel; a SIGN_FULL_DISTANCE ya se ve entero. */
export const SIGN_SHOW_DISTANCE = 70;
export const SIGN_FULL_DISTANCE = 40;

/**
 * Zona bloqueada más cercana a (x, y) dentro de maxDist: { zoneId, dist, x, y } con el punto más próximo de
 * su borde, o null si no hay ninguna tan cerca.
 */
export function nearestLockedZone(city, x, y, maxDist = SIGN_SHOW_DISTANCE) {
  const reach = Math.ceil(maxDist / TILE) + 1;
  const cx = Math.floor(x / TILE);
  const cy = Math.floor(y / TILE);
  let best = null;
  for (let ty = cy - reach; ty <= cy + reach; ty++) {
    if (ty < 0 || ty >= city.height) continue;
    for (let tx = cx - reach; tx <= cx + reach; tx++) {
      if (tx < 0 || tx >= city.width) continue;
      const zoneId = city.zoneIdAtTile(tx, ty);
      if (!zoneId || city.isZoneUnlocked(zoneId)) continue;
      const px = Math.max(tx * TILE, Math.min((tx + 1) * TILE, x));
      const py = Math.max(ty * TILE, Math.min((ty + 1) * TILE, y));
      const dist = Math.hypot(px - x, py - y);
      if (dist <= maxDist && (!best || dist < best.dist)) best = { zoneId, dist, x: px, y: py };
    }
  }
  return best;
}

/** Opacidad del cartel según la distancia al borde (0 = oculto, 1 = entero). */
export function signOpacity(dist) {
  const t = (SIGN_SHOW_DISTANCE - dist) / (SIGN_SHOW_DISTANCE - SIGN_FULL_DISTANCE);
  return Math.max(0, Math.min(1, t));
}

/** Dónde colocar el cartel: sobre el borde, un poco hacia dentro de la zona bloqueada. */
export function signPosition(near, fromX, fromY, inset = 22) {
  const dx = near.x - fromX;
  const dy = near.y - fromY;
  const len = Math.hypot(dx, dy) || 1;
  return { x: near.x + (dx / len) * inset, y: near.y + (dy / len) * inset };
}
