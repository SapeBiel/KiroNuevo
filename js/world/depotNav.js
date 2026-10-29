// Navegación de los empleados dentro del almacén: rejilla de 4 px sobre el interior, marcada como
// transitable con las mismas colisiones que usa el jugador (city.circleHitsSolid con walker: true).
// Las rutas se buscan con BFS y se suavizan quitando los puntos intermedios que se ven entre sí.

import { depotLayout } from './depotLayout.js';

const CELL = 4;
const RADIUS = 4;
const cache = new WeakMap();

function buildGrid(city) {
  const L = depotLayout(city.depot);
  const { inner } = L;
  const cols = Math.ceil((inner.x1 - inner.x0) / CELL);
  const rows = Math.ceil((inner.y1 - inner.y0) / CELL);
  const free = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = inner.x0 + (c + 0.5) * CELL;
      const y = inner.y0 + (r + 0.5) * CELL;
      free[r * cols + c] = city.circleHitsSolid(x, y, RADIUS, { walker: true }) ? 0 : 1;
    }
  }
  return { inner, cols, rows, free };
}

function gridOf(city) {
  let grid = cache.get(city);
  if (!grid) {
    grid = buildGrid(city);
    cache.set(city, grid);
  }
  return grid;
}

const cellOf = (g, x, y) => ({
  c: Math.max(0, Math.min(g.cols - 1, Math.floor((x - g.inner.x0) / CELL))),
  r: Math.max(0, Math.min(g.rows - 1, Math.floor((y - g.inner.y0) / CELL))),
});
const centerOf = (g, c, r) => ({ x: g.inner.x0 + (c + 0.5) * CELL, y: g.inner.y0 + (r + 0.5) * CELL });
const isFree = (g, c, r) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.free[r * g.cols + c] === 1;

/** Casilla libre más cercana (por si el punto pedido cae junto a un mueble). */
function nearestFree(g, cell) {
  if (isFree(g, cell.c, cell.r)) return cell;
  for (let d = 1; d < 8; d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
        if (isFree(g, cell.c + dc, cell.r + dr)) return { c: cell.c + dc, r: cell.r + dr };
      }
    }
  }
  return null;
}

/** ¿Se puede ir en línea recta de a a b sin tocar obstáculos? */
function clearLine(g, a, b) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cell = cellOf(g, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (!isFree(g, cell.c, cell.r)) return false;
  }
  return true;
}

/**
 * Ruta dentro del almacén de "from" a "to": lista de puntos (sin incluir el de partida).
 * Si no hay camino devuelve [to] (el empleado iría en línea recta; no debería ocurrir).
 */
export function depotPath(city, from, to) {
  const g = gridOf(city);
  const start = nearestFree(g, cellOf(g, from.x, from.y));
  const goal = nearestFree(g, cellOf(g, to.x, to.y));
  if (!start || !goal) return [{ x: to.x, y: to.y }];
  const total = g.cols * g.rows;
  const prev = new Int32Array(total).fill(-1);
  const startIndex = start.r * g.cols + start.c;
  const goalIndex = goal.r * g.cols + goal.c;
  prev[startIndex] = startIndex;
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIndex;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (head < tail) {
    const cur = queue[head++];
    if (cur === goalIndex) break;
    const c = cur % g.cols;
    const r = (cur - c) / g.cols;
    for (const [dc, dr] of dirs) {
      const nc = c + dc;
      const nr = r + dr;
      if (!isFree(g, nc, nr)) continue;
      // En diagonal, solo si no se recorta una esquina
      if (dc && dr && (!isFree(g, c + dc, r) || !isFree(g, c, r + dr))) continue;
      const ni = nr * g.cols + nc;
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }
  if (prev[goalIndex] === -1) return [{ x: to.x, y: to.y }];
  const cells = [];
  for (let i = goalIndex; i !== startIndex; i = prev[i]) cells.push(i);
  cells.reverse();
  const points = cells.map((i) => centerOf(g, i % g.cols, Math.floor(i / g.cols)));
  points.push({ x: to.x, y: to.y });
  // Suavizado: de cada punto se salta al más lejano que se vea en línea recta
  const result = [];
  let anchor = { x: from.x, y: from.y };
  let i = 0;
  while (i < points.length) {
    let j = points.length - 1;
    while (j > i && !clearLine(g, anchor, points[j])) j--;
    result.push(points[j]);
    anchor = points[j];
    i = j + 1;
  }
  return result;
}
