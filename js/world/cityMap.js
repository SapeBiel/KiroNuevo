// Generación determinista de la ciudad: manzanas, edificios, calles, zonas y colisiones.
// No usa DOM ni canvas, así que se puede probar sin navegador gráfico.

import {
  TILE, BLOCK_PITCH, ROAD_WIDTH, BLOCK_SIZE, BLOCKS_X, BLOCKS_Y, MAP_TILES_X, MAP_TILES_Y,
  MAP_WIDTH_PX, MAP_HEIGHT_PX, DEPOT_RADIUS,
} from '../config/constants.js';
import {
  ZONES, ZONE_ORDER, zoneIdForBlock, DEPOT_BLOCK, HORIZONTAL_STREETS, VERTICAL_STREETS,
} from '../config/zones.js';
import {
  BUILDING_KINDS, SHOP_NAMES, OFFICE_NAMES, FACTORY_NAMES, WAREHOUSE_NAMES, TOWER_NAMES,
} from '../config/packages.js';
import { createRng, choice, weightedChoice } from '../core/random.js';
import { clamp } from '../core/util.js';

const LAYOUTS = {
  quad: [
    { dx: 0, dy: 0, w: 3, h: 3, door: 'top' },
    { dx: 3, dy: 0, w: 3, h: 3, door: 'top' },
    { dx: 0, dy: 3, w: 3, h: 3, door: 'bottom' },
    { dx: 3, dy: 3, w: 3, h: 3, door: 'bottom' },
  ],
  stack: [
    { dx: 0, dy: 0, w: 6, h: 3, door: 'top' },
    { dx: 0, dy: 3, w: 6, h: 3, door: 'bottom' },
  ],
  single: [{ dx: 0, dy: 0, w: 6, h: 6, door: 'bottom' }],
  park: [],
};

const LAYOUT_WEIGHTS = {
  residential: { quad: 85, park: 15 },
  downtown: { stack: 65, single: 35 },
  commercial: { quad: 55, stack: 45 },
  industrial: { stack: 65, single: 35 },
  metropolitan: { single: 45, quad: 25, stack: 30 },
};

function buildingKindFor(zoneId, layoutId, rng) {
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
      if (layoutId === 'quad') return 'villa';
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

export function createCity(seed = 20240607) {
  const rng = createRng(seed);
  const solidBase = new Uint8Array(MAP_TILES_X * MAP_TILES_Y);
  const tileZoneIndex = new Uint8Array(MAP_TILES_X * MAP_TILES_Y);
  const unlockedByIndex = new Array(ZONE_ORDER.length).fill(false);
  const buildings = [];
  const parks = [];
  const lampPosts = [];
  const blocks = [];
  let depot = null;
  let version = 0;

  // Zona de cada casilla (las calles pertenecen a la manzana de su derecha/abajo).
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      const bc = Math.min(BLOCKS_X - 1, Math.floor(tx / BLOCK_PITCH));
      const br = Math.min(BLOCKS_Y - 1, Math.floor(ty / BLOCK_PITCH));
      tileZoneIndex[ty * MAP_TILES_X + tx] = ZONE_ORDER.indexOf(zoneIdForBlock(bc, br));
    }
  }

  function markSolid(tx, ty, w, h) {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) solidBase[y * MAP_TILES_X + x] = 1;
  }

  function addBuilding(spec) {
    const { kind, zoneId, bc, br, tx, ty, w, h, door, dx } = spec;
    const x = tx * TILE;
    const y = ty * TILE;
    const pw = w * TILE;
    const ph = h * TILE;
    const doorX = x + pw / 2;
    const doorY = door === 'top' ? y : y + ph;
    const dropY = door === 'top' ? y - ROAD_WIDTH * TILE / 2 : y + ph + ROAD_WIDTH * TILE / 2;
    const roadIndex = door === 'top' ? br : br + 1;
    const number = (bc * 6 + dx) * 2 + (door === 'top' ? 0 : 1) + 2;
    const building = {
      id: spec.id ?? `b${buildings.length}`,
      kind, zoneId, bc, br, tx, ty, w, h, x, y, pw, ph,
      door, doorX, doorY, dropX: doorX, dropY,
      centerX: x + pw / 2, centerY: y + ph / 2,
      street: HORIZONTAL_STREETS[roadIndex],
      number,
      name: spec.name ?? buildingNameFor(kind, rng),
      variant: Math.floor(rng() * 1000),
      droneOk: BUILDING_KINDS[kind]?.droneOk ?? false,
    };
    building.address = `${building.street} ${building.number}`;
    markSolid(tx, ty, w, h);
    buildings.push(building);
    return building;
  }

  for (let br = 0; br < BLOCKS_Y; br++) {
    for (let bc = 0; bc < BLOCKS_X; bc++) {
      const zoneId = zoneIdForBlock(bc, br);
      const ox = bc * BLOCK_PITCH + ROAD_WIDTH;
      const oy = br * BLOCK_PITCH + ROAD_WIDTH;
      blocks.push({ bc, br, ox, oy, zoneId });

      // Farolas en las esquinas de cada manzana
      for (const [lx, ly] of [[ox * TILE - 10, oy * TILE - 10], [(ox + BLOCK_SIZE) * TILE + 10, oy * TILE - 10],
        [ox * TILE - 10, (oy + BLOCK_SIZE) * TILE + 10], [(ox + BLOCK_SIZE) * TILE + 10, (oy + BLOCK_SIZE) * TILE + 10]]) {
        lampPosts.push({ x: lx, y: ly });
      }

      if (bc === DEPOT_BLOCK.bc && br === DEPOT_BLOCK.br) {
        const x = ox * TILE;
        const y = oy * TILE;
        const pw = BLOCK_SIZE * TILE;
        const ph = 4 * TILE;
        markSolid(ox, oy, BLOCK_SIZE, 4);
        const dropY = (oy + BLOCK_SIZE + ROAD_WIDTH / 2) * TILE;
        depot = {
          id: 'depot', kind: 'depot', zoneId, bc, br, tx: ox, ty: oy, w: BLOCK_SIZE, h: 4,
          x, y, pw, ph, door: 'bottom', doorX: x + pw / 2, doorY: y + ph,
          dropX: x + pw / 2, dropY, centerX: x + pw / 2, centerY: y + ph / 2,
          street: HORIZONTAL_STREETS[br + 1], number: 1, name: 'Almacén central',
          address: `${HORIZONTAL_STREETS[br + 1]} 1`, variant: 0, droneOk: false,
          lot: { x, y: y + ph, w: pw, h: 2 * TILE },
          zoneCenter: { x: x + pw / 2, y: y + ph + TILE },
          zoneRadius: DEPOT_RADIUS,
          startX: x + pw / 2 - 6 * TILE,
          startY: dropY,
        };
        continue;
      }

      const layoutId = weightedChoice(rng, Object.keys(LAYOUT_WEIGHTS[zoneId]), (k) => LAYOUT_WEIGHTS[zoneId][k]);
      if (layoutId === 'park') {
        markSolid(ox, oy, BLOCK_SIZE, BLOCK_SIZE);
        const trees = [];
        for (let i = 0; i < 14; i++) {
          trees.push({ x: (ox + 0.6 + rng() * 4.8) * TILE, y: (oy + 0.6 + rng() * 4.8) * TILE, r: 9 + rng() * 7 });
        }
        parks.push({
          bc, br, zoneId, x: ox * TILE, y: oy * TILE, size: BLOCK_SIZE * TILE, trees,
          pond: { x: (ox + 3) * TILE, y: (oy + 3) * TILE, rx: 40 + rng() * 14, ry: 26 + rng() * 10 },
        });
        continue;
      }

      for (const rect of LAYOUTS[layoutId]) {
        addBuilding({
          kind: buildingKindFor(zoneId, layoutId, rng), zoneId, bc, br,
          tx: ox + rect.dx, ty: oy + rect.dy, w: rect.w, h: rect.h, door: rect.door, dx: rect.dx,
        });
      }
    }
  }

  const buildingById = new Map(buildings.map((b) => [b.id, b]));

  function tileIndex(tx, ty) {
    return ty * MAP_TILES_X + tx;
  }

  function isSolidTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_TILES_X || ty >= MAP_TILES_Y) return true;
    const index = tileIndex(tx, ty);
    return solidBase[index] === 1 || !unlockedByIndex[tileZoneIndex[index]];
  }

  function isSolidBuildingTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_TILES_X || ty >= MAP_TILES_Y) return true;
    return solidBase[tileIndex(tx, ty)] === 1;
  }

  function zoneIdAtTile(tx, ty) {
    const x = clamp(tx, 0, MAP_TILES_X - 1);
    const y = clamp(ty, 0, MAP_TILES_Y - 1);
    return ZONE_ORDER[tileZoneIndex[tileIndex(x, y)]];
  }

  function zoneIdAtPoint(px, py) {
    return zoneIdAtTile(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  /** ¿Un círculo choca contra algún obstáculo (edificio, límite del mapa o zona bloqueada)? */
  function circleHitsSolid(cx, cy, radius) {
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

  /** Las casillas de la línea central de cada calle forman el grafo para las rutas automáticas. */
  function isRoadNode(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MAP_TILES_X || ty >= MAP_TILES_Y) return false;
    const onCenterColumn = tx % BLOCK_PITCH === 1;
    const onCenterRow = ty % BLOCK_PITCH === 1;
    return (onCenterColumn || onCenterRow) && !isSolidTile(tx, ty);
  }

  function setUnlockedZones(zoneFlags) {
    ZONE_ORDER.forEach((id, index) => {
      unlockedByIndex[index] = Boolean(zoneFlags[id]);
    });
    version++;
  }

  function isZoneUnlocked(zoneId) {
    return unlockedByIndex[ZONE_ORDER.indexOf(zoneId)] === true;
  }

  function buildingsInZone(zoneId) {
    return buildings.filter((b) => b.zoneId === zoneId);
  }

  /** Centro aproximado y límites de una zona (para etiquetas y minimapa). */
  function zoneBounds(zoneId) {
    const index = ZONE_ORDER.indexOf(zoneId);
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity; let sumX = 0; let sumY = 0; let count = 0;
    for (let ty = 0; ty < MAP_TILES_Y; ty++) {
      for (let tx = 0; tx < MAP_TILES_X; tx++) {
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

  return {
    seed,
    width: MAP_TILES_X,
    height: MAP_TILES_Y,
    widthPx: MAP_WIDTH_PX,
    heightPx: MAP_HEIGHT_PX,
    buildings,
    buildingById,
    parks,
    blocks,
    lampPosts,
    depot,
    get version() { return version; },
    isSolidTile,
    isSolidBuildingTile,
    isRoadNode,
    zoneIdAtTile,
    zoneIdAtPoint,
    circleHitsSolid,
    setUnlockedZones,
    isZoneUnlocked,
    buildingsInZone,
    zoneBounds,
    getBuilding: (id) => (id === 'depot' ? depot : buildingById.get(id)),
    zones: ZONES,
  };
}
