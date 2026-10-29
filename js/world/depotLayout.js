// Interior del almacén central (nave de 276 x 180 px por dentro):
//   · Oficina acristalada en la esquina noroeste, con puerta, mesa, ordenador, silla y archivadores.
//   · Estanterías de stock A-F, zona de recepción con palés y columnas.
//   · Cinta transportadora en L: nace en recepción, baja y gira hacia el oeste hasta el cajón de fin de línea.
//   · Mesa de empaquetado del jugador, tres mesas con dos puestos cada una para los preparadores
//     y la estantería de expedición junto a la fachada.
// Es la única fuente de verdad del interior: la usan las colisiones (cityMap), la lógica (handling,
// conveyor, warehouseStaff), la navegación de los empleados (depotNav) y los dos renderizadores.
// Coordenadas del mapa (x, y en píxeles). La fachada abierta da al sur (puerta inferior del almacén).

import { SHELVES } from '../config/products.js';

export const WALL = 3;
export const SHELF_DEPTH = 12;
export const SHELF_HEIGHT = 30;
export const TABLE_HEIGHT = 8;
export const RACK_HEIGHT = 14;
export const BELT_HEIGHT = 7; // altura de la superficie de la cinta
export const BELT_WIDTH = 10;
export const BELT_SPEED = 16; // px/s a los que avanzan los productos
export const BIN_HEIGHT = 6;
export const CEILING = 60; // altura interior (el edificio mide 64)
export const OFFICE_HEIGHT = 30; // la oficina tiene su propio techo
export const OPENING_HEIGHT = 38; // altura del gran hueco de carga de la fachada

const cache = new WeakMap();

/** Distribución del interior del almacén (se calcula una vez por almacén). */
export function depotLayout(depot) {
  let layout = cache.get(depot);
  if (layout) return layout;

  const outer = { x0: depot.x + 3, y0: depot.y + 3, x1: depot.x + depot.pw - 3, y1: depot.y + depot.ph - 3 };
  const inner = { x0: outer.x0 + WALL, y0: outer.y0 + WALL, x1: outer.x1 - WALL, y1: outer.y1 - WALL };
  const doorX = depot.doorX;
  // Coordenadas relativas a la esquina noroeste del interior
  const ox = inner.x0;
  const oy = inner.y0;
  const R = (x0, y0, x1, y1, extra = {}) => ({ x0: ox + x0, y0: oy + y0, x1: ox + x1, y1: oy + y1, ...extra });
  const P = (x, y) => ({ x: ox + x, y: oy + y });

  const walls = [
    { x0: outer.x0, y0: outer.y0, x1: outer.x1, y1: inner.y0 }, // fondo
    { x0: outer.x0, y0: outer.y0, x1: inner.x0, y1: outer.y1 }, // izquierda
    { x0: inner.x1, y0: outer.y0, x1: outer.x1, y1: outer.y1 }, // derecha
  ];
  // Fachada abierta, sin valla: las personas entran por cualquier punto; los vehículos se quedan en el patio
  const vehicleBarrier = { x0: inner.x0, y0: inner.y1, x1: inner.x1, y1: outer.y1, vehicleOnly: true };

  // --- Oficina (esquina noroeste): tabiques con ventanas y una puerta en el tabique sur
  const office = {
    room: R(0, 0, 84, 64),
    walls: [
      R(84, 0, 86, 66, { glass: true }), // tabique este
      R(0, 64, 54, 66, { glass: true }), // tabique sur (izquierda de la puerta)
      R(70, 64, 86, 66, { glass: true }), // tabique sur (derecha de la puerta)
    ],
    door: { ...R(54, 63, 70, 67), x: ox + 62, y: oy + 65 },
    desk: R(20, 0, 50, 10),
    computer: P(34, 5), // pantalla sobre la mesa, mirando al sur
    computerStand: P(32, 22),
    chair: P(42, 17),
    cabinets: R(0, 20, 8, 54),
    bookcase: R(56, 0, 82, 7),
    plant: R(74, 52, 82, 60),
    whiteboard: { x: ox + 84, y0: oy + 18, y1: oy + 48 }, // en la cara interior del tabique este
  };

  // --- Estanterías de stock (decorado con colisión; los productos salen de aquí hacia la cinta)
  const shelves = [
    { id: SHELVES[0].id, rect: R(96, 0, 126, SHELF_DEPTH), face: { x: 0, y: 1 } },
    { id: SHELVES[1].id, rect: R(129, 0, 159, SHELF_DEPTH), face: { x: 0, y: 1 } },
    { id: SHELVES[2].id, rect: R(162, 0, 192, SHELF_DEPTH), face: { x: 0, y: 1 } },
    { id: SHELVES[3].id, rect: R(0, 80, SHELF_DEPTH, 112), face: { x: 1, y: 0 } },
    { id: SHELVES[4].id, rect: R(0, 116, SHELF_DEPTH, 148), face: { x: 1, y: 0 } },
    { id: SHELVES[5].id, rect: R(264, 46, 276, 82), face: { x: -1, y: 0 } },
  ];

  // --- Recepción (esquina noreste): palés con mercancía y puerta enrollable cerrada
  const reception = {
    area: R(198, 0, 276, 40),
    pallets: [R(202, 4, 224, 22), R(252, 4, 274, 22)],
    rollerDoor: { x0: ox + 226, x1: ox + 250, y: inner.y0 },
  };
  const columns = [R(118, 48, 124, 54), R(196, 48, 202, 54)];

  // --- Cinta transportadora en L (de recepción hacia el oeste) y cajón de fin de línea
  const beltPath = [P(240, 28), P(240, 96), P(106, 96)];
  const beltSegments = [];
  let length = 0;
  for (let i = 0; i < beltPath.length - 1; i++) {
    const a = beltPath[i];
    const b = beltPath[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    beltSegments.push({ a, b, start: length, len, dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } });
    length += len;
  }
  const half = BELT_WIDTH / 2;
  const belt = {
    path: beltPath,
    segments: beltSegments,
    length,
    colliders: [R(240 - half, 22, 240 + half, 96 + half), R(106, 96 - half, 240 + half, 96 + half)],
  };
  const bin = { rect: R(92, 89, 106, 103) };

  // --- Mesas: la 0 es la del jugador; 1-3 son de los preparadores (dos puestos por mesa, norte y sur)
  const tables = [
    { id: 0, rect: R(124, 116, 164, 130), player: true },
    { id: 1, rect: R(50, 118, 82, 130) },
    { id: 2, rect: R(190, 118, 222, 130) },
    { id: 3, rect: R(50, 154, 82, 166) },
  ];
  const stations = [];
  for (const table of tables.slice(1)) {
    const r = table.rect;
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    stations.push({ index: stations.length, table: table.id, side: 'north', stand: { x: cx, y: r.y0 - 7 }, surface: { x0: r.x0, y0: r.y0, x1: r.x1, y1: cy } });
    stations.push({ index: stations.length, table: table.id, side: 'south', stand: { x: cx, y: r.y1 + 7 }, surface: { x0: r.x0, y0: cy, x1: r.x1, y1: r.y1 } });
  }
  // Puntos junto al cajón donde los preparadores recogen los productos
  const pickupSpots = [P(99, 110), P(86, 99), P(110, 110), P(80, 104), P(104, 114), P(116, 106)];

  // --- Expedición: estantería baja junto a la fachada (las cajas listas para cargar)
  const rack = { rect: R(264, 128, 276, 170), face: { x: -1, y: 0 }, stand: P(256, 149) };

  layout = {
    outer, inner, doorX, walls, vehicleBarrier, office, shelves, reception, columns,
    belt, bin, tables, table: tables[0], stations, pickupSpots, rack,
    // Se empieza dentro, junto a la puerta, mirando hacia la cinta
    walkStart: { x: doorX, y: inner.y1 - 12, yaw: -Math.PI / 2 },
  };
  cache.set(depot, layout);
  return layout;
}

/** Punto de la cinta a "pos" px de su origen: { x, y, dir }. */
export function beltPoint(layout, pos) {
  const { segments, length } = layout.belt;
  const d = Math.max(0, Math.min(length, pos));
  const seg = segments.find((s) => d <= s.start + s.len) ?? segments[segments.length - 1];
  const t = d - seg.start;
  return { x: seg.a.x + seg.dir.x * t, y: seg.a.y + seg.dir.y * t, dir: seg.dir };
}

/** Obstáculos del almacén (rectángulos del mapa). "vehicleOnly" no frena a las personas. */
export function depotColliders(depot) {
  const L = depotLayout(depot);
  const o = L.office;
  return [
    ...L.walls,
    L.vehicleBarrier,
    ...o.walls,
    o.desk, o.cabinets, o.bookcase, o.plant,
    ...L.shelves.map((s) => s.rect),
    ...L.reception.pallets,
    ...L.columns,
    ...L.belt.colliders,
    L.bin.rect,
    ...L.tables.map((t) => t.rect),
    L.rack.rect,
  ].map((rect) => ({ ...rect }));
}

export function isInsideDepot(depot, x, y) {
  const { outer } = depotLayout(depot);
  return x >= outer.x0 && x <= outer.x1 && y >= outer.y0 && y <= outer.y1;
}

export function isInsideOffice(depot, x, y) {
  const { room } = depotLayout(depot).office;
  return x >= room.x0 && x <= room.x1 + 2 && y >= room.y0 && y <= room.y1 + 2;
}

/** Plaza de la furgoneta del jugador al empezar: en el patio, con la trasera mirando a la fachada. */
export function playerParkSpot(depot) {
  const { lot } = depot;
  return { x: Math.min(lot.x + lot.w - 20, depot.doorX + 56), y: lot.y + 30, angle: Math.PI / 2 };
}

/**
 * Plazas de los vehículos aparcados (a la izquierda de la entrada, para dejar libre el paso). La primera fila
 * deja hueco entre la fachada y la puerta del conductor para que quepa una persona, incluso con camiones.
 */
export const PARKED_SPOTS = 4;
export function parkedSpot(depot, index) {
  const { lot } = depot;
  return { x: lot.x + 22 + (index % 2) * 42, y: lot.y + 19 + Math.floor(index / 2) * 30, angle: 0 };
}
