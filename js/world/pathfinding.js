// Rutas por el centro de las calles (BFS sobre las casillas de la línea central).
// Las usan repartidores automáticos y el cálculo de distancias de los pedidos.

import { TILE, MAP_TILES_X, MAP_TILES_Y } from '../config/constants.js';
import { distance } from '../core/util.js';

export function createPathService(city) {
  const trees = new Map();
  let treesVersion = -1;
  const totalTiles = MAP_TILES_X * MAP_TILES_Y;
  const queue = new Int32Array(totalTiles);

  function ensureFresh() {
    if (treesVersion !== city.version) {
      trees.clear();
      treesVersion = city.version;
    }
  }

  /** Casilla de ruta más cercana a un punto del mapa (o -1). */
  function nodeIndexAt(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (city.isRoadNode(tx, ty)) return ty * MAP_TILES_X + tx;
    for (let r = 1; r <= 4; r++) {
      let best = -1;
      let bestDist = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (!city.isRoadNode(nx, ny)) continue;
          const d = distance((nx + 0.5) * TILE, (ny + 0.5) * TILE, x, y);
          if (d < bestDist) { bestDist = d; best = ny * MAP_TILES_X + nx; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  function getTree(startIndex) {
    ensureFresh();
    let tree = trees.get(startIndex);
    if (tree) return tree;
    const dist = new Int32Array(totalTiles).fill(-1);
    const parent = new Int32Array(totalTiles).fill(-1);
    let head = 0;
    let tail = 0;
    queue[tail++] = startIndex;
    dist[startIndex] = 0;
    while (head < tail) {
      const current = queue[head++];
      const cx = current % MAP_TILES_X;
      const cy = (current - cx) / MAP_TILES_X;
      const neighbours = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
      for (const [nx, ny] of neighbours) {
        if (!city.isRoadNode(nx, ny)) continue;
        const ni = ny * MAP_TILES_X + nx;
        if (dist[ni] !== -1) continue;
        dist[ni] = dist[current] + 1;
        parent[ni] = current;
        queue[tail++] = ni;
      }
    }
    tree = { dist, parent };
    trees.set(startIndex, tree);
    return tree;
  }

  function simplify(points) {
    const out = [];
    for (const p of points) {
      const last = out[out.length - 1];
      if (last && distance(last.x, last.y, p.x, p.y) < 0.5) continue;
      out.push({ x: p.x, y: p.y });
    }
    // Elimina puntos intermedios colineales, pero conserva los cambios de sentido (media vuelta)
    const result = [];
    for (let i = 0; i < out.length; i++) {
      const prev = result[result.length - 1];
      const next = out[i + 1];
      const cur = out[i];
      if (prev && next) {
        const ax = cur.x - prev.x;
        const ay = cur.y - prev.y;
        const bx = next.x - cur.x;
        const by = next.y - cur.y;
        const cross = ax * by - ay * bx;
        const dot = ax * bx + ay * by;
        if (Math.abs(cross) < 0.01 && dot > 0) continue;
      }
      result.push(cur);
    }
    return result;
  }

  function finishRoute(points) {
    const simple = simplify(points);
    const cum = [0];
    for (let i = 1; i < simple.length; i++) {
      cum.push(cum[i - 1] + distance(simple[i - 1].x, simple[i - 1].y, simple[i].x, simple[i].y));
    }
    return { points: simple, cum, length: cum[cum.length - 1] };
  }

  /** Ruta entre dos puntos. Devuelve null si no hay camino. */
  function route(from, to) {
    const a = nodeIndexAt(from.x, from.y);
    const b = nodeIndexAt(to.x, to.y);
    if (a < 0 || b < 0) return null;
    const tree = getTree(a);
    if (tree.dist[b] < 0) return null;
    const tiles = [];
    for (let i = b; i !== -1; i = tree.parent[i]) tiles.push(i);
    tiles.reverse();
    const points = [{ x: from.x, y: from.y }];
    for (const index of tiles) {
      const tx = index % MAP_TILES_X;
      const ty = (index - tx) / MAP_TILES_X;
      points.push({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
    }
    points.push({ x: to.x, y: to.y });
    return finishRoute(points);
  }

  /** Longitud aproximada del trayecto (px) o null. */
  function routeLength(from, to) {
    return route(from, to)?.length ?? null;
  }

  /**
   * Ruta que pasa por varios puntos en orden. Devuelve también la distancia
   * acumulada de cada parada (stopDistances).
   */
  function routeThrough(waypoints) {
    let points = [];
    const stopDistances = [];
    let accumulated = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const leg = route(waypoints[i], waypoints[i + 1]);
      if (!leg) return null;
      points = points.concat(i === 0 ? leg.points : leg.points.slice(1));
      accumulated += leg.length;
      stopDistances.push(accumulated);
    }
    const full = finishRoute(points);
    // finishRoute puede acortar la ruta al eliminar puntos redundantes; reescalamos las paradas.
    const scale = accumulated > 0 ? full.length / accumulated : 1;
    return { ...full, stopDistances: stopDistances.map((d) => d * scale) };
  }

  return { route, routeLength, routeThrough, nodeIndexAt };
}

/** Posición y orientación a una distancia dada a lo largo de una ruta. */
export function pointAlongRoute(routeData, travelled) {
  const { points, cum, length } = routeData;
  if (points.length === 0) return { x: 0, y: 0, angle: 0 };
  if (points.length === 1) return { x: points[0].x, y: points[0].y, angle: 0 };
  const d = Math.max(0, Math.min(length, travelled));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const a = points[i - 1];
  const b = points[i];
  const segmentLength = cum[i] - cum[i - 1] || 1;
  const t = (d - cum[i - 1]) / segmentLength;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}
