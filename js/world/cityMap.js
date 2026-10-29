// Generación de la ciudad a partir de una semilla: cada partida nueva tiene un plano distinto.
// - Manzanas de 5 a 8 casillas y calles de 2 a 4 casillas de ancho (con alguna avenida ancha).
// - Supermanzanas: a veces desaparece un tramo de calle entre dos manzanas de la misma zona
//   (centro comercial, nave enorme, torre o gran parque), lo que crea calles en T y fondos de saco.
// - Plazas peatonales con fuente por las que se puede circular, y parques de tamaño variable.
// No usa DOM ni canvas, así que se puede probar sin navegador gráfico.

import { TILE, DEPOT_RADIUS, CITY_BLOCKS_X, CITY_BLOCKS_Y, DEFAULT_CITY_SEED } from '../config/constants.js';
import {
  ZONES, ZONE_ORDER, zoneIdForBlock, DEPOT_POSITION, HORIZONTAL_STREETS, VERTICAL_STREETS,
} from '../config/zones.js';
import {
  BUILDING_KINDS, SHOP_NAMES, OFFICE_NAMES, FACTORY_NAMES, WAREHOUSE_NAMES, TOWER_NAMES,
} from '../config/packages.js';
import { createRng, choice, randomInt, weightedChoice } from '../core/random.js';
import { clamp } from '../core/util.js';
import { hasGarden, gardenColliders } from './lotLayout.js';
import { depotColliders, depotLayout, playerParkSpot } from './depotLayout.js';

/** Reparto de parcelas dentro de una manzana de w x h casillas (cada parcela: dx, dy, w, h, puerta). */
export function layoutLots(layoutId, w, h) {
  const hT = Math.floor(h / 2);
  const hB = h - hT;
  switch (layoutId) {
    case 'quad': {
      const wL = Math.floor(w / 2);
      return [
        { dx: 0, dy: 0, w: wL, h: hT, door: 'top' }, { dx: wL, dy: 0, w: w - wL, h: hT, door: 'top' },
        { dx: 0, dy: hT, w: wL, h: hB, door: 'bottom' }, { dx: wL, dy: hT, w: w - wL, h: hB, door: 'bottom' },
      ];
    }
    case 'row': {
      // Tres parcelas por lado (manzanas anchas): casas adosadas o tiendas en fila
      const a = Math.floor(w / 3);
      const b = Math.floor((w - a) / 2);
      const c = w - a - b;
      const lots = [];
      for (const [dy, hh, door] of [[0, hT, 'top'], [hT, hB, 'bottom']]) {
        lots.push({ dx: 0, dy, w: a, h: hh, door }, { dx: a, dy, w: b, h: hh, door }, { dx: a + b, dy, w: c, h: hh, door });
      }
      return lots;
    }
    case 'stack':
      return [{ dx: 0, dy: 0, w, h: hT, door: 'top' }, { dx: 0, dy: hT, w, h: hB, door: 'bottom' }];
    case 'single':
      return [{ dx: 0, dy: 0, w, h, door: 'bottom' }];
    default:
      return [];
  }
}

const LAYOUT_WEIGHTS = {
  residential: { quad: 70, row: 15, park: 15 },
  downtown: { stack: 55, single: 25, quad: 15, plaza: 5 },
  commercial: { quad: 40, stack: 30, row: 22, plaza: 8 },
  industrial: { stack: 60, single: 40 },
  metropolitan: { single: 38, quad: 25, stack: 22, park: 9, plaza: 6 },
};

// Contenido de las supermanzanas (dos manzanas unidas)
const MERGED_WEIGHTS = {
  residential: { park: 60, stack: 40 },
  downtown: { single: 45, stack: 35, park: 20 },
  commercial: { single: 50, stack: 30, park: 20 },
  industrial: { single: 70, stack: 30 },
  metropolitan: { single: 55, park: 30, stack: 15 },
};

function buildingKindFor(zoneId, layoutId, rng, merged) {
  if (merged && layoutId === 'single') {
    switch (zoneId) {
      case 'industrial': return rng() < 0.5 ? 'factory' : 'warehouse';
      case 'commercial': return 'office';
      case 'residential': return 'apartment';
      default: return 'tower';
    }
  }
  switch (zoneId) {
    case 'residential': return 'house';
    case 'downtown':
      if (layoutId === 'single') return rng() < 0.6 ? 'office' : 'tower';
      return 'apartment';
    case 'commercial':
      if (layoutId === 'stack') return rng() < 0.6 ? 'shop' : 'office';
      return 'shop';
    case 'industrial': return rng() < 0.55 ? 'factory' : 'warehouse';
    default:
      if (layoutId === 'single') return 'tower';
      if (layoutId === 'quad' || layoutId === 'row') return 'villa';
      return 'office';
  }
}

function buildingNameFor(kind, rng) {
  switch (kind) {
    case 'house': return 'Casa';
    case 'villa': return 'Villa';
    case 'apartment': return `Apartamentos ${choice(rng, ['Aurora', 'Brisa', 'Cielo', 'Jardín', 'Miramar', 'Plaza', 'Rosal'])}`;
    case 'shop': return choice(rng, SHOP_NAMES);
    case 'office': return choice(rng, OFFICE_NAMES);
    case 'tower': return choice(rng, TOWER_NAMES);
    case 'factory': return choice(rng, FACTORY_NAMES);
    case 'warehouse': return choice(rng, WAREHOUSE_NAMES);
    default: return BUILDING_KINDS[kind]?.label ?? 'Edificio';
  }
}

// Colisión de los árboles: un poco menor que la copa dibujada, para que se pueda pasar rozándolos
const TREE_COLLISION_SCALE = 0.75;
const MAX_TREE_COLLIDER = 16 * TREE_COLLISION_SCALE; // radio máximo (r va de 9 a 16)
const PARK_PATH_CLEARANCE = 7; // px libres a cada lado del eje de los caminos

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** ¿El árbol queda fuera del estanque y de los dos caminos diagonales (los mismos que dibuja mapLayer)? */
function isTreeSpotClear(park, tree) {
  const reach = tree.r * TREE_COLLISION_SCALE;
  const { pond } = park;
  const ex = (tree.x - pond.x) / (pond.rx + reach);
  const ey = (tree.y - pond.y) / (pond.ry + reach);
  if (ex * ex + ey * ey < 1) return false;
  const x0 = park.x + 14;
  const y0 = park.y + 14;
  const x1 = park.x + park.w - 14;
  const y1 = park.y + park.h - 14;
  const minGap = reach + PARK_PATH_CLEARANCE;
  return distanceToSegment(tree.x, tree.y, x0, y0, x1, y1) >= minGap
    && distanceToSegment(tree.x, tree.y, x1, y0, x0, y1) >= minGap;
}

function shuffled(rng, list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Ancho de una calle interior: casi siempre 3 casillas, a veces más estrecha o más ancha. */
function roadWidth(rng) {
  return weightedChoice(rng, [2, 3, 4], (w) => ({ 2: 22, 3: 60, 4: 18 })[w]);
}

/**
 * Crea la ciudad. Misma semilla = misma ciudad (se guarda en la partida).
 * Si las supermanzanas dejaran calles sin conexión (no debería pasar), se genera sin ellas.
 */
export function createCity(seed = DEFAULT_CITY_SEED) {
  const city = generateCity(seed, true);
  return city.connected ? city : generateCity(seed, false);
}

function generateCity(seed, allowMerges) {
  const rng = createRng(seed);
  const BX = CITY_BLOCKS_X;
  const BY = CITY_BLOCKS_Y;

  // --- Tamaños de manzanas y calles
  const colW = Array.from({ length: BX }, () => randomInt(rng, 5, 8));
  const rowH = Array.from({ length: BY }, () => randomInt(rng, 5, 8));
  const vRoadW = Array.from({ length: BX + 1 }, (_, i) => (i === 0 || i === BX ? 3 : roadWidth(rng)));
  const hRoadW = Array.from({ length: BY + 1 }, (_, i) => (i === 0 || i === BY ? 3 : roadWidth(rng)));
  // Una gran avenida de 4 casillas en cada sentido
  vRoadW[randomInt(rng, 2, BX - 2)] = 4;
  hRoadW[randomInt(rng, 2, BY - 2)] = 4;

  // El almacén necesita una manzana de al menos 6 x 6 con calles anchas a su lado
  const depotBc = Math.floor(BX * DEPOT_POSITION.x);
  const depotBr = Math.floor(BY * DEPOT_POSITION.y);
  // El almacén es una nave con oficina, cinta transportadora y puestos de trabajo: necesita 9 x 8 casillas
  colW[depotBc] = Math.max(colW[depotBc], 9);
  rowH[depotBr] = Math.max(rowH[depotBr], 8);
  hRoadW[depotBr + 1] = Math.max(hRoadW[depotBr + 1], 3);

  // --- Posiciones (en casillas)
  const hNames = shuffled(rng, HORIZONTAL_STREETS);
  const vNames = shuffled(rng, VERTICAL_STREETS);
  const vRoads = [];
  const cols = [];
  let cursor = 0;
  for (let i = 0; i <= BX; i++) {
    vRoads.push({ index: i, x: cursor, w: vRoadW[i], name: vNames[i % vNames.length] });
    cursor += vRoadW[i];
    if (i < BX) {
      cols.push({ index: i, x: cursor, w: colW[i] });
      cursor += colW[i];
    }
  }
  const W = cursor;
  const hRoads = [];
  const rows = [];
  cursor = 0;
  for (let i = 0; i <= BY; i++) {
    hRoads.push({ index: i, y: cursor, w: hRoadW[i], name: hNames[i % hNames.length] });
    cursor += hRoadW[i];
    if (i < BY) {
      rows.push({ index: i, y: cursor, h: rowH[i] });
      cursor += rowH[i];
    }
  }
  const H = cursor;
  const N = W * H;

  // Zona de cada manzana (se escala la rejilla de 8 x 6 de zones.js a la cantidad real de manzanas)
  const blockZone = (bc, br) => zoneIdForBlock(Math.floor(((bc + 0.5) / BX) * 8), Math.floor(((br + 0.5) / BY) * 6));

  // Las calles pertenecen a la manzana de su derecha / abajo (la última, a la última manzana)
  const colOfTile = new Int16Array(W);
  const rowOfTile = new Int16Array(H);
  for (let tx = 0; tx < W; tx++) {
    let c = cols.findIndex((col) => tx < col.x + col.w);
    if (c < 0) c = BX - 1;
    colOfTile[tx] = c;
  }
  for (let ty = 0; ty < H; ty++) {
    let r = rows.findIndex((row) => ty < row.y + row.h);
    if (r < 0) r = BY - 1;
    rowOfTile[ty] = r;
  }
  const tileZoneIndex = new Uint8Array(N);
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) tileZoneIndex[ty * W + tx] = ZONE_ORDER.indexOf(blockZone(colOfTile[tx], rowOfTile[ty]));
  }

  // --- Supermanzanas: se quita un tramo de calle entre dos manzanas vecinas de la misma zona
  const mergedWith = new Map(); // "bc,br" -> { bc, br, dir } de la otra manzana
  const removedH = new Set(); // "j:c": tramo de la calle horizontal j sobre la columna c
  const removedV = new Set(); // "k:r": tramo de la calle vertical k sobre la fila r
  const key = (bc, br) => `${bc},${br}`;
  const isDepot = (bc, br) => bc === depotBc && br === depotBr;
  if (allowMerges) {
    const candidates = [];
    for (let br = 0; br < BY; br++) {
      for (let bc = 0; bc < BX; bc++) {
        if (br + 1 < BY) candidates.push({ bc, br, dir: 'down' });
        if (bc + 1 < BX) candidates.push({ bc, br, dir: 'right' });
      }
    }
    let merges = 0;
    for (const c of shuffled(rng, candidates)) {
      if (merges >= 7) break;
      const ob = c.dir === 'down' ? c.bc : c.bc + 1;
      const or = c.dir === 'down' ? c.br + 1 : c.br;
      if (rng() > 0.35) continue;
      if (mergedWith.has(key(c.bc, c.br)) || mergedWith.has(key(ob, or))) continue;
      if (isDepot(c.bc, c.br) || isDepot(ob, or)) continue;
      // Tampoco al lado del almacén, para que su barrio siga bien comunicado
      if (Math.abs(c.bc - depotBc) + Math.abs(c.br - depotBr) <= 1 || Math.abs(ob - depotBc) + Math.abs(or - depotBr) <= 1) continue;
      if (blockZone(c.bc, c.br) !== blockZone(ob, or)) continue;
      mergedWith.set(key(c.bc, c.br), { bc: ob, br: or, dir: c.dir });
      mergedWith.set(key(ob, or), { bc: c.bc, br: c.br, dir: c.dir, secondary: true });
      if (c.dir === 'down') removedH.add(`${c.br + 1}:${c.bc}`);
      else removedV.add(`${c.bc + 1}:${c.br}`);
      merges++;
    }
  }

  // --- Contenido de las manzanas
  const solidBase = new Uint8Array(N);
  const tileIndex = (tx, ty) => ty * W + tx;
  const markSolid = (tx, ty, w, h) => {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) solidBase[tileIndex(x, y)] = 1;
  };
  // Obstáculos rectangulares a medida (casas y villas con jardín): se guardan en cada casilla que tocan
  const rectGrid = new Map(); // índice de casilla -> [{ x0, y0, x1, y1, stamp }]
  const rectColliders = [];
  let rectStamp = 0;
  const addRectCollider = (rect) => {
    const collider = { ...rect, stamp: 0 };
    rectColliders.push(collider);
    const tx0 = Math.max(0, Math.floor(rect.x0 / TILE));
    const tx1 = Math.min(W - 1, Math.floor((rect.x1 - 0.001) / TILE));
    const ty0 = Math.max(0, Math.floor(rect.y0 / TILE));
    const ty1 = Math.min(H - 1, Math.floor((rect.y1 - 0.001) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const index = tileIndex(tx, ty);
        if (!rectGrid.has(index)) rectGrid.set(index, []);
        rectGrid.get(index).push(collider);
      }
    }
  };
  // Árboles de los parques: cada uno se guarda en la casilla de su centro para consultarlos rápido
  const treeGrid = new Map(); // índice de casilla -> [{ x, y, r }]
  const treeColliders = [];
  const addTreeCollider = (tree) => {
    const collider = { x: tree.x, y: tree.y, r: tree.r * TREE_COLLISION_SCALE };
    const index = tileIndex(Math.floor(tree.x / TILE), Math.floor(tree.y / TILE));
    if (!treeGrid.has(index)) treeGrid.set(index, []);
    treeGrid.get(index).push(collider);
    treeColliders.push(collider);
  };
  const buildings = [];
  const parks = [];
  const plazas = [];
  const lampPosts = [];
  const blocks = [];
  const streetNumbers = new Map();
  let depot = null;

  /** Calle horizontal pegada al borde superior o inferior de una manzana. */
  const roadAbove = (oy) => hRoads.find((r) => r.y + r.w === oy);
  const roadBelow = (oy, h) => hRoads.find((r) => r.y === oy + h);

  const nextNumber = (street, top) => {
    const k = `${street}|${top}`;
    const n = (streetNumbers.get(k) ?? 0) + 1;
    streetNumbers.set(k, n);
    return n * 2 + (top ? 0 : 1);
  };

  function addBuilding(spec) {
    const { kind, zoneId, bc, br, tx, ty, w, h, door } = spec;
    const x = tx * TILE;
    const y = ty * TILE;
    const pw = w * TILE;
    const ph = h * TILE;
    const road = door === 'top' ? spec.roadTop : spec.roadBottom;
    const doorX = x + pw / 2;
    const doorY = door === 'top' ? y : y + ph;
    const dropY = (road.y + road.w / 2) * TILE;
    const number = nextNumber(road.name, door === 'top');
    const building = {
      id: `b${buildings.length}`,
      kind, zoneId, bc, br, tx, ty, w, h, x, y, pw, ph,
      door, doorX, doorY, dropX: doorX, dropY,
      centerX: x + pw / 2, centerY: y + ph / 2,
      street: road.name,
      number,
      name: buildingNameFor(kind, rng),
      variant: Math.floor(rng() * 1000),
      droneOk: BUILDING_KINDS[kind]?.droneOk ?? false,
    };
    building.address = `${building.street} ${building.number}`;
    if (hasGarden(building)) {
      // Casas y villas: choca la casa (y el porche o la piscina), pero el jardín, el seto y los arbustos no
      for (const rect of gardenColliders(building)) addRectCollider(rect);
    } else {
      markSolid(tx, ty, w, h);
    }
    buildings.push(building);
    return building;
  }

  function addPark(block) {
    // El césped, los caminos y el estanque son transitables: solo los árboles bloquean el paso
    const { ox, oy, w, h, zoneId, bc, br } = block;
    const candidates = [];
    const count = Math.round((w * h) / 36 * 14);
    for (let i = 0; i < count; i++) {
      candidates.push({ x: (ox + 0.6 + rng() * (w - 1.2)) * TILE, y: (oy + 0.6 + rng() * (h - 1.2)) * TILE, r: 9 + rng() * 7 });
    }
    const park = {
      bc, br, zoneId, x: ox * TILE, y: oy * TILE, w: w * TILE, h: h * TILE, size: Math.min(w, h) * TILE, trees: [],
      pond: { x: (ox + w / 2) * TILE, y: (oy + h / 2) * TILE, rx: Math.min(w, 8) * 7 + rng() * 14, ry: Math.min(h, 8) * 4.5 + rng() * 10 },
      tiles: { tx: ox, ty: oy, w, h },
    };
    // Se descartan los árboles que caerían sobre el estanque o los caminos, para dejar paso libre.
    // (Se generan todos los candidatos igualmente para no alterar la secuencia aleatoria del resto del mapa.)
    park.trees = candidates.filter((tree) => isTreeSpotClear(park, tree));
    for (const tree of park.trees) addTreeCollider(tree);
    parks.push(park);
  }

  function addPlaza(block) {
    // Plaza peatonal: se circula por ella salvo por la fuente central
    const { ox, oy, w, h } = block;
    const fw = w >= 7 ? 2 : 1;
    const fh = h >= 7 ? 2 : 1;
    const fx = ox + Math.floor((w - fw) / 2);
    const fy = oy + Math.floor((h - fh) / 2);
    markSolid(fx, fy, fw, fh);
    plazas.push({
      ...block, x: ox * TILE, y: oy * TILE, pw: w * TILE, ph: h * TILE,
      // El pilón ocupa casi exactamente las casillas sólidas, así que no se atraviesa al conducir
      fountain: { x: (fx + fw / 2) * TILE, y: (fy + fh / 2) * TILE, r: Math.min(fw, fh) * TILE * 0.5 + 2 },
    });
  }

  for (let br = 0; br < BY; br++) {
    for (let bc = 0; bc < BX; bc++) {
      const partner = mergedWith.get(key(bc, br));
      if (partner?.secondary) continue; // la manzana ya forma parte de la supermanzana de su vecina
      const zoneId = blockZone(bc, br);
      const col = cols[bc];
      const row = rows[br];
      let ox = col.x;
      let oy = row.y;
      let w = col.w;
      let h = row.h;
      if (partner?.dir === 'down') h = rows[br + 1].y + rows[br + 1].h - oy;
      if (partner?.dir === 'right') w = cols[bc + 1].x + cols[bc + 1].w - ox;
      const block = { bc, br, ox, oy, w, h, zoneId, merged: Boolean(partner), kind: 'normal' };
      blocks.push(block);
      const roadTop = roadAbove(oy);
      const roadBottom = roadBelow(oy, h);

      // Farolas en las esquinas
      for (const [lx, ly] of [[ox * TILE - 10, oy * TILE - 10], [(ox + w) * TILE + 10, oy * TILE - 10],
        [ox * TILE - 10, (oy + h) * TILE + 10], [(ox + w) * TILE + 10, (oy + h) * TILE + 10]]) {
        lampPosts.push({ x: lx, y: ly });
      }

      if (isDepot(bc, br)) {
        block.kind = 'depot';
        const x = ox * TILE;
        const y = oy * TILE;
        const pw = w * TILE;
        const ph = (h - 2) * TILE;
        // El almacén ya no es un bloque macizo: se puede entrar a pie (ver depotLayout.js)
        const dropY = (roadBottom.y + roadBottom.w / 2) * TILE;
        depot = {
          id: 'depot', kind: 'depot', zoneId, bc, br, tx: ox, ty: oy, w, h: h - 2,
          x, y, pw, ph, door: 'bottom', doorX: x + pw / 2, doorY: y + ph,
          dropX: x + pw / 2, dropY, centerX: x + pw / 2, centerY: y + ph / 2,
          street: roadBottom.name, number: 1, name: 'Almacén central',
          address: `${roadBottom.name} 1`, variant: 0, droneOk: false,
          lot: { x, y: y + ph, w: pw, h: 2 * TILE },
          zoneCenter: { x: x + pw / 2, y: y + ph + TILE },
          zoneRadius: DEPOT_RADIUS,
          // En el cruce de la izquierda, fuera del círculo de carga
          startX: x + pw / 2 - 4.5 * TILE,
          startY: dropY,
        };
        // Paredes, límite de la fachada para los vehículos, estanterías, mesa y zona de expedición
        for (const rect of depotColliders(depot)) addRectCollider(rect);
        depot.park = playerParkSpot(depot);
        depot.walkStart = depotLayout(depot).walkStart;
        continue;
      }

      const weights = partner ? MERGED_WEIGHTS[zoneId] : LAYOUT_WEIGHTS[zoneId];
      let layoutId = weightedChoice(rng, Object.keys(weights), (k) => weights[k]);
      if (layoutId === 'row' && w < 7) layoutId = 'quad';
      if (layoutId === 'park') {
        block.kind = 'park';
        addPark(block);
        continue;
      }
      if (layoutId === 'plaza') {
        block.kind = 'plaza';
        addPlaza(block);
        continue;
      }
      block.layout = layoutId;
      for (const lot of layoutLots(layoutId, w, h)) {
        addBuilding({
          kind: buildingKindFor(zoneId, layoutId, rng, Boolean(partner)), zoneId, bc, br,
          tx: ox + lot.dx, ty: oy + lot.dy, w: lot.w, h: lot.h, door: lot.door, roadTop, roadBottom,
        });
      }
    }
  }

  // Los tramos de calle quitados pertenecen a la supermanzana (ya cubiertos por sus parcelas o su parque)
  const segmentOpen = {
    /** Tramo de la calle horizontal j sobre la columna c. */
    h: (j, c) => !removedH.has(`${j}:${c}`),
    /** Tramo de la calle vertical k sobre la fila r. */
    v: (k, r) => !removedV.has(`${k}:${r}`),
  };

  // --- Eje de cada calle: casillas que usan las rutas automáticas
  const roadNode = new Uint8Array(N);
  for (const road of vRoads) {
    const cx = road.x + Math.floor(road.w / 2);
    for (let ty = 0; ty < H; ty++) roadNode[tileIndex(cx, ty)] = 1;
  }
  for (const road of hRoads) {
    const cy = road.y + Math.floor(road.w / 2);
    for (let tx = 0; tx < W; tx++) roadNode[tileIndex(tx, cy)] = 1;
  }
  // Parques y parcelas con jardín ya no son casillas sólidas, pero no forman parte de la red de calles:
  // las rutas automáticas no deben cruzarlos, ni siquiera por el tramo de calle que absorbe una supermanzana.
  const lotTiles = new Uint8Array(N); // parcelas de edificios (para las barreras de zonas bloqueadas)
  for (const b of buildings) {
    for (let ty = b.ty; ty < b.ty + b.h; ty++) {
      for (let tx = b.tx; tx < b.tx + b.w; tx++) {
        roadNode[tileIndex(tx, ty)] = 0;
        lotTiles[tileIndex(tx, ty)] = 1;
      }
    }
  }
  for (const { tiles } of parks) {
    for (let ty = tiles.ty; ty < tiles.ty + tiles.h; ty++) {
      for (let tx = tiles.tx; tx < tiles.tx + tiles.w; tx++) roadNode[tileIndex(tx, ty)] = 0;
    }
  }

  const unlockedByIndex = new Array(ZONE_ORDER.length).fill(false);
  let version = 0;

  function isSolidTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
    const index = tileIndex(tx, ty);
    return solidBase[index] === 1 || !unlockedByIndex[tileZoneIndex[index]];
  }

  /** Casilla ocupada por un edificio o su parcela (solo para dibujar barreras; no implica colisión). */
  function isSolidBuildingTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return true;
    const index = tileIndex(tx, ty);
    return solidBase[index] === 1 || lotTiles[index] === 1;
  }

  function zoneIdAtTile(tx, ty) {
    return ZONE_ORDER[tileZoneIndex[tileIndex(clamp(tx, 0, W - 1), clamp(ty, 0, H - 1))]];
  }

  /** Llama a visit(tree) para cada árbol que podría tocar un círculo de ese radio. */
  function forEachTreeNear(cx, cy, radius, visit) {
    if (!treeColliders.length) return;
    const reach = radius + MAX_TREE_COLLIDER;
    const minTx = Math.max(0, Math.floor((cx - reach) / TILE));
    const maxTx = Math.min(W - 1, Math.floor((cx + reach) / TILE));
    const minTy = Math.max(0, Math.floor((cy - reach) / TILE));
    const maxTy = Math.min(H - 1, Math.floor((cy + reach) / TILE));
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const list = treeGrid.get(tileIndex(tx, ty));
        if (list) for (const tree of list) visit(tree);
      }
    }
  }

  /** Llama a visit(rect) una sola vez por cada obstáculo rectangular que podría tocar el círculo. */
  function forEachRectNear(cx, cy, radius, visit) {
    if (!rectColliders.length) return;
    const stamp = ++rectStamp;
    const minTx = Math.max(0, Math.floor((cx - radius) / TILE));
    const maxTx = Math.min(W - 1, Math.floor((cx + radius) / TILE));
    const minTy = Math.max(0, Math.floor((cy - radius) / TILE));
    const maxTy = Math.min(H - 1, Math.floor((cy + radius) / TILE));
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        const list = rectGrid.get(tileIndex(tx, ty));
        if (!list) continue;
        for (const rect of list) {
          if (rect.stamp === stamp) continue; // ya visitado (ocupa varias casillas)
          rect.stamp = stamp;
          visit(rect);
        }
      }
    }
  }

  function circleHitsRect(cx, cy, radius, walker = false) {
    let hit = false;
    forEachRectNear(cx, cy, radius, (rect) => {
      if (hit || (walker && rect.vehicleOnly)) return;
      const dx = cx - clamp(cx, rect.x0, rect.x1);
      const dy = cy - clamp(cy, rect.y0, rect.y1);
      if (dx * dx + dy * dy < radius * radius) hit = true;
    });
    return hit;
  }

  function circleHitsTree(cx, cy, radius) {
    let hit = false;
    forEachTreeNear(cx, cy, radius, (tree) => {
      const min = radius + tree.r;
      if (!hit && (cx - tree.x) ** 2 + (cy - tree.y) ** 2 < min * min) hit = true;
    });
    return hit;
  }

  /**
   * ¿Un círculo choca contra algún obstáculo (edificio, árbol, límite del mapa o zona bloqueada)?
   * Con { walker: true } se comprueba para una persona: puede cruzar la fachada abierta del almacén.
   */
  function circleHitsSolid(cx, cy, radius, { walker = false } = {}) {
    if (circleHitsTree(cx, cy, radius) || circleHitsRect(cx, cy, radius, walker)) return true;
    const minTx = Math.floor((cx - radius) / TILE);
    const maxTx = Math.floor((cx + radius) / TILE);
    const minTy = Math.floor((cy - radius) / TILE);
    const maxTy = Math.floor((cy + radius) / TILE);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (!isSolidTile(tx, ty)) continue;
        const nearestX = clamp(cx, tx * TILE, tx * TILE + TILE);
        const nearestY = clamp(cy, ty * TILE, ty * TILE + TILE);
        const dx = cx - nearestX;
        const dy = cy - nearestY;
        if (dx * dx + dy * dy < radius * radius) return true;
      }
    }
    return false;
  }

  function isRoadNode(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    return roadNode[tileIndex(tx, ty)] === 1 && !isSolidTile(tx, ty);
  }

  /** Con todas las zonas abiertas, ¿todo el eje de las calles está conectado? */
  function checkConnected() {
    const seen = new Uint8Array(N);
    const nodes = [];
    for (let i = 0; i < N; i++) if (roadNode[i] && !solidBase[i]) nodes.push(i);
    if (!nodes.length) return false;
    const queue = [nodes[0]];
    seen[nodes[0]] = 1;
    let count = 1;
    while (queue.length) {
      const cur = queue.pop();
      const cx = cur % W;
      const cy = (cur - cx) / W;
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = tileIndex(nx, ny);
        if (seen[ni] || !roadNode[ni] || solidBase[ni]) continue;
        seen[ni] = 1;
        count++;
        queue.push(ni);
      }
    }
    return count === nodes.length;
  }

  function zoneBounds(zoneId) {
    const index = ZONE_ORDER.indexOf(zoneId);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity; let sumX = 0; let sumY = 0; let count = 0;
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        if (tileZoneIndex[tileIndex(tx, ty)] !== index) continue;
        minX = Math.min(minX, tx); maxX = Math.max(maxX, tx);
        minY = Math.min(minY, ty); maxY = Math.max(maxY, ty);
        sumX += tx + 0.5; sumY += ty + 0.5; count++;
      }
    }
    return {
      minX: minX * TILE, minY: minY * TILE, maxX: (maxX + 1) * TILE, maxY: (maxY + 1) * TILE,
      centerX: (sumX / count) * TILE, centerY: (sumY / count) * TILE,
    };
  }

  const buildingById = new Map(buildings.map((b) => [b.id, b]));

  return {
    seed,
    connected: depot !== null && checkConnected(),
    width: W,
    height: H,
    widthPx: W * TILE,
    heightPx: H * TILE,
    vRoads,
    hRoads,
    cols,
    rows,
    segmentOpen,
    buildings,
    buildingById,
    parks,
    plazas,
    blocks,
    lampPosts,
    depot,
    get version() { return version; },
    isSolidTile,
    isSolidBuildingTile,
    isRoadNode,
    zoneIdAtTile,
    zoneIdAtPoint: (px, py) => zoneIdAtTile(Math.floor(px / TILE), Math.floor(py / TILE)),
    circleHitsSolid,
    circleHitsTree,
    forEachTreeNear,
    forEachRectNear,
    rectColliders,
    treeColliders,
    setUnlockedZones(zoneFlags) {
      ZONE_ORDER.forEach((id, index) => { unlockedByIndex[index] = Boolean(zoneFlags[id]); });
      version++;
    },
    isZoneUnlocked: (zoneId) => unlockedByIndex[ZONE_ORDER.indexOf(zoneId)] === true,
    buildingsInZone: (zoneId) => buildings.filter((b) => b.zoneId === zoneId),
    zoneBounds,
    getBuilding: (id) => (id === 'depot' ? depot : buildingById.get(id)),
    zones: ZONES,
  };
}

/** Semilla nueva para una partida nueva. */
export function randomCitySeed() {
  return Math.floor(Math.random() * 2 ** 31);
}
