// Interior del almacén en 3D, construido a partir de world/depotLayout.js (las mismas posiciones que usan
// las colisiones, la lógica y la navegación de los empleados):
//   · Fijo: suelo, paredes, techo, oficina acristalada (mesa, ordenador, silla, archivadores, librería,
//     planta, pizarra, ventanas), estanterías de stock con productos, recepción con palés y puerta
//     enrollable, columnas, cinta transportadora, cajón de fin de línea, mesas, expedición y señalización.
//     Casi todo va en un único lote instanciado (pocas llamadas de dibujo).
//   · Cada fotograma: la banda de la cinta se desplaza, y se recolocan los productos (cinta, cajón, mesas),
//     las cajas de expedición, los preparadores (con su animación y lo que llevan) y la pantalla del ordenador.

import * as THREE from '../vendor/three.module.js';
import { ORDER_KINDS } from '../config/packages.js';
import { PRODUCTS, boxSizeFor, getShelf, productInfo } from '../config/products.js';
import { createRng } from '../core/random.js';
import { distance, formatMoney } from '../core/util.js';
import {
  BELT_HEIGHT, BELT_SPEED, BELT_WIDTH, BIN_HEIGHT, CEILING, OFFICE_HEIGHT, OPENING_HEIGHT, RACK_HEIGHT, SHELF_HEIGHT,
  TABLE_HEIGHT, beltPoint, depotLayout, isInsideDepot,
} from '../world/depotLayout.js';
import { rackBoxes } from '../systems/handling.js';
import { pickerLoad, pickersOf } from '../systems/warehouseStaff.js';
import { getCompany, getCompanyName } from '../systems/branding.js';
import { makeCanvas, makeSignTexture, scaleSpriteToScreen, setLabelText, toTexture } from './textures3d.js';
import { PartBatch, boxParts, orderBoxParts, placement, productParts } from './products3d.js';
import { createCharacter } from './characters3d.js';

const BELT_TILE = 6; // px de banda por cada repetición de la textura
const LABEL_DISTANCE = 130;

const yawOf = (dir) => Math.atan2(-dir.y, dir.x); // giro para que el eje x local apunte a "dir" (mapa)
const grow = (r, k) => ({ x0: r.x0 - k, y0: r.y0 - k, x1: r.x1 + k, y1: r.y1 + k });
const centerOf = (r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 });

function hashOf(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Coloca productos en filas sobre una superficie sin que se solapen: de izquierda a derecha, la siguiente fila
 * hacia el fondo y, si no caben, encima. Cada producto se gira para que su lado largo vaya a lo largo de x.
 */
export function layoutOnSurface(names, area, baseY) {
  const gap = 0.5;
  const out = [];
  let cursorX = area.x0;
  let rowZ = area.y0;
  let rowDepth = 0;
  let layerY = baseY;
  let layerHeight = 0;
  for (const name of names) {
    const [w, h, d] = productInfo(name).size;
    const turned = d > w;
    const fx = turned ? d : w;
    const fz = turned ? w : d;
    if (cursorX > area.x0 && cursorX + fx > area.x1) {
      cursorX = area.x0;
      rowZ += rowDepth + gap;
      rowDepth = 0;
    }
    if (rowZ > area.y0 && rowZ + fz > area.y1) {
      rowZ = area.y0;
      cursorX = area.x0;
      layerY += layerHeight;
      layerHeight = 0;
    }
    out.push({ name, x: cursorX + fx / 2, y: layerY, z: rowZ + fz / 2, yaw: turned ? Math.PI / 2 : 0 });
    cursorX += fx + gap;
    rowDepth = Math.max(rowDepth, fz);
    layerHeight = Math.max(layerHeight, h);
  }
  return out;
}

export function buildDepotInterior(depot) {
  const L = depotLayout(depot);
  const { inner } = L;
  const ox = inner.x0;
  const oy = inner.y0;
  const group = new THREE.Group();
  const ownMaterials = [];
  const ownGeometries = [];
  const textures = [];
  const disposables = [];

  // ------------------------------------------------------------------ Ayudas de construcción ----
  const S = new PartBatch({ box: 3600, cyl: 320, sphere: 160, torus: 24, cone: 24 }, { shadows: false });
  const G = new PartBatch({ box: 64, cyl: 8, sphere: 8, torus: 0, cone: 0 }, { shadows: false, basic: true }); // luces
  const obj = new THREE.Object3D();
  const color = new THREE.Color();
  const M = new THREE.Matrix4();
  const piece = (batch, kind, cx, cy, cz, sx, sy, sz, hex, rx = 0, ry = 0, rz = 0) => {
    obj.position.set(cx, cy, cz);
    obj.rotation.set(rx, ry, rz);
    obj.scale.set(sx, sy, sz);
    obj.updateMatrix();
    batch.addPart(kind, obj.matrix, color.set(hex));
  };
  /** Caja con la base en y0 (x, z del mapa). */
  const block = (cx, cz, w, d, y0, h, hex, ry = 0) => piece(S, 'box', cx, y0 + h / 2, cz, w, h, d, hex, 0, ry);
  const rectBlock = (r, y0, h, hex, inset = 0) => {
    const c = centerOf(r);
    block(c.x, c.y, r.x1 - r.x0 - inset * 2, r.y1 - r.y0 - inset * 2, y0, h, hex);
  };
  const cyl = (cx, cy, cz, sx, sy, sz, hex, rx = 0, ry = 0, rz = 0) => piece(S, 'cyl', cx, cy, cz, sx, sy, sz, hex, rx, ry, rz);
  const sphere = (cx, cy, cz, sx, sy, sz, hex) => piece(S, 'sphere', cx, cy, cz, sx, sy, sz, hex);
  const glow = (cx, cy, cz, sx, sy, sz, hex) => piece(G, 'box', cx, cy, cz, sx, sy, sz, hex);
  const model = (parts, x, y, z, yaw = 0) => S.add(parts, placement(x, y, z, yaw, M));
  const tapeLine = (x0, z0, x1, z1, hex = '#e8a000', width = 1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    block((x0 + x1) / 2, (z0 + z1) / 2, len, width, 0.6, 0.12, hex, -Math.atan2(z1 - z0, x1 - x0));
  };
  const tapeRect = (r, hex = '#e8a000') => {
    tapeLine(r.x0, r.y0, r.x1, r.y0, hex);
    tapeLine(r.x0, r.y1, r.x1, r.y1, hex);
    tapeLine(r.x0, r.y0, r.x0, r.y1, hex);
    tapeLine(r.x1, r.y0, r.x1, r.y1, hex);
  };
  const plane = (w, h, material, x, y, z, rotY = 0, rotX = 0) => {
    const geometry = new THREE.PlaneGeometry(w, h);
    ownGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotX, rotY, 0, 'YXZ');
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const lambert = (opts) => {
    const material = new THREE.MeshLambertMaterial(opts);
    ownMaterials.push(material);
    return material;
  };
  /** Cartel con texto (de una o dos caras). */
  const sign = (text, x, y, z, rotY, width, { bg = '#ffb703', fg = '#10131c', double = false } = {}) => {
    const texture = makeSignTexture(text, { bg, fg });
    textures.push(texture);
    const material = lambert({ map: texture, emissive: new THREE.Color('#ffffff'), emissiveMap: texture, emissiveIntensity: 0.25 });
    if (double) material.side = THREE.DoubleSide;
    return plane(width, (width * 48) / 256, material, x, y, z, rotY);
  };
  const rng = createRng(Math.round(depot.x * 7 + depot.y * 13));

  const W = inner.x1 - inner.x0;
  const D = inner.y1 - inner.y0;
  const midX = (inner.x0 + inner.x1) / 2;
  const midZ = (inner.y0 + inner.y1) / 2;

  // ------------------------------------------------------------------ Nave: suelo, paredes y techo ----
  block(midX, midZ, W + 6, D + 6, 0, 0.6, '#cfc8b8');
  const wallMaterial = lambert({ color: '#efe9da' });
  plane(W, CEILING, wallMaterial, midX, CEILING / 2, inner.y0); // fondo (mira al sur)
  plane(D, CEILING, wallMaterial, inner.x0, CEILING / 2, midZ, Math.PI / 2); // izquierda
  plane(D, CEILING, wallMaterial, inner.x1, CEILING / 2, midZ, -Math.PI / 2); // derecha
  plane(W, CEILING - OPENING_HEIGHT, wallMaterial, midX, (CEILING + OPENING_HEIGHT) / 2, inner.y1, Math.PI); // sobre el hueco
  plane(W, D, lambert({ color: '#d9d5cb' }), midX, CEILING, midZ, 0, Math.PI / 2); // techo
  // Zócalo de color de la empresa
  block(midX, inner.y0 + 0.6, W, 1.2, 0.6, 5, '#ffb703');
  block(inner.x0 + 0.6, midZ, 1.2, D, 0.6, 5, '#ffb703');
  block(inner.x1 - 0.6, midZ, 1.2, D, 0.6, 5, '#ffb703');
  // Vigas del techo
  for (let x = inner.x0 + 40; x < inner.x1 - 10; x += 48) block(x, midZ, 2.4, D, CEILING - 3, 3, '#a9aeb6');

  // Paneles de luz (fuera de la oficina) y la luz real de la nave (sin sombras: es barato)
  for (const fx of [0.38, 0.56, 0.74, 0.92]) {
    for (const fz of [0.2, 0.5, 0.8]) glow(ox + W * fx, CEILING - 0.8, oy + D * fz, 22, 0.8, 5, '#fff3d6');
  }
  for (const fz of [0.55, 0.85]) glow(ox + 40, CEILING - 0.8, oy + D * fz, 22, 0.8, 5, '#fff3d6');
  const light = new THREE.PointLight('#fff1d6', 1.25, Math.max(W, D) * 1.8, 0);
  light.position.set(midX + 30, CEILING - 8, midZ + 10);
  group.add(light);

  // ------------------------------------------------------------------ Señalización del suelo ----
  const T = L.table.rect;
  tapeRect(grow(T, 8));
  const rk = L.rack.rect;
  tapeRect({ x0: rk.x0 - 20, y0: rk.y0 - 4, x1: rk.x0 - 1, y1: rk.y1 + 4 });
  for (let z = rk.y0; z < rk.y1; z += 6) tapeLine(rk.x0 - 19, z, rk.x0 - 13, z + 6, '#ffb703', 0.8); // rayado
  tapeLine(L.doorX - 12, inner.y1 - 2, L.doorX - 12, T.y1 + 12, '#f4f1ea');
  tapeLine(L.doorX + 12, inner.y1 - 2, L.doorX + 12, T.y1 + 12, '#f4f1ea');
  for (const c of L.belt.colliders) tapeRect(grow(c, 3), '#ffb703');
  for (const spot of L.pickupSpots) tapeRect({ x0: spot.x - 3, y0: spot.y - 3, x1: spot.x + 3, y1: spot.y + 3 }, '#4cc9f0');
  tapeRect(grow(L.reception.area, -1), '#90be6d');

  // ------------------------------------------------------------------ Oficina ----
  const office = L.office;
  const room = office.room;
  const steel = '#5c6673';
  const glassMaterial = lambert({ color: '#cfe8ff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const glassBox = (cx, cz, w, d, y0, h) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    ownGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, glassMaterial);
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.renderOrder = 2;
    group.add(mesh);
  };
  block((room.x0 + room.x1) / 2, (room.y0 + room.y1) / 2, room.x1 - room.x0, room.y1 - room.y0, 0.6, 0.12, '#56677d'); // moqueta
  for (const wall of office.walls) {
    const c = centerOf(wall);
    const w = wall.x1 - wall.x0;
    const d = wall.y1 - wall.y0;
    const along = w >= d;
    const len = along ? w : d;
    block(c.x, c.y, w, d, 0, 7, '#c9d0d8'); // zócalo opaco
    block(c.x, c.y, w + 0.1, d + 0.1, 7, 0.6, steel);
    block(c.x, c.y, w + 0.1, d + 0.1, OFFICE_HEIGHT - 1.5, 1.5, steel);
    glassBox(c.x, c.y, along ? w : w * 0.3, along ? d * 0.3 : d, 7.6, OFFICE_HEIGHT - 9.1);
    const posts = Math.max(1, Math.ceil(len / 16));
    for (let i = 0; i <= posts; i++) {
      const t = -len / 2 + (len * i) / posts;
      block(along ? c.x + t : c.x, along ? c.y : c.y + t, along ? 1 : w + 0.2, along ? d + 0.2 : 1, 0, OFFICE_HEIGHT, steel);
    }
  }
  // Puerta: hueco con dintel y una hoja corredera de cristal (abierta, sobre el tabique)
  const door = office.door;
  block(door.x, door.y, door.x1 - door.x0, 2, 22, OFFICE_HEIGHT - 22, '#c9d0d8');
  block(door.x, door.y, door.x1 - door.x0, 2.2, 21.4, 0.6, steel);
  block(door.x0 - 8, door.y - 2.2, 18, 0.5, 22, 0.6, steel); // guía
  glassBox(door.x0 - 7.5, door.y - 2.2, 15, 0.3, 0.8, 20.6);
  for (const x of [door.x0 - 15, door.x0]) block(x, door.y - 2.2, 0.8, 0.6, 0.6, 21.4, steel);
  block(door.x0 - 7.5, door.y - 2.2, 15, 0.6, 0.6, 0.8, steel);
  block(door.x0 - 1.4, door.y - 2.6, 0.4, 0.4, 9, 4, '#d0d4da'); // tirador
  sign('OFICINA', door.x, 25.4, door.y + 1.15, 0, 14, { bg: '#2b2f38', fg: '#ffd166' });
  // Techo propio y luz
  block((room.x0 + room.x1 + 2) / 2, (room.y0 + room.y1 + 2) / 2, room.x1 - room.x0 + 2, room.y1 - room.y0 + 2, OFFICE_HEIGHT, 1.2, '#e6e2d8');
  glow(room.x0 + 26, OFFICE_HEIGHT - 0.3, room.y0 + 34, 18, 0.5, 5, '#fff6e0');
  glow(room.x0 + 60, OFFICE_HEIGHT - 0.3, room.y0 + 34, 18, 0.5, 5, '#fff6e0');
  const officeLight = new THREE.PointLight('#fff4e0', 0.45, 80, 0);
  officeLight.position.set((room.x0 + room.x1) / 2, OFFICE_HEIGHT - 4, (room.y0 + room.y1) / 2);
  group.add(officeLight);

  // Mesa de trabajo
  const desk = office.desk;
  const dc = centerOf(desk);
  rectBlock(desk, TABLE_HEIGHT - 0.8, 0.8, '#b98b5e');
  block(desk.x0 + 0.5, dc.y, 1, desk.y1 - desk.y0, 0, TABLE_HEIGHT - 0.8, '#8a6a4a');
  block(desk.x1 - 0.5, dc.y, 1, desk.y1 - desk.y0, 0, TABLE_HEIGHT - 0.8, '#8a6a4a');
  block(dc.x, desk.y0 + 0.8, desk.x1 - desk.x0 - 2, 0.6, 2, TABLE_HEIGHT - 2.8, '#8a6a4a');
  block(desk.x1 - 4.5, dc.y, 7, desk.y1 - desk.y0 - 1, 0, TABLE_HEIGHT - 0.8, '#9c7652'); // cajonera
  for (const y of [1.2, 3.6]) {
    block(desk.x1 - 4.5, desk.y1 - 0.45, 6.4, 0.1, y, 2.2, '#a98260');
    block(desk.x1 - 4.5, desk.y1 - 0.3, 2, 0.3, y + 1.6, 0.3, '#d0d4da');
  }
  // Ordenador: peana, pantalla (con textura viva), teclado, ratón, taza y papeles
  const pc = office.computer;
  cyl(pc.x, TABLE_HEIGHT + 0.15, pc.y - 0.6, 2.6, 0.3, 1.8, '#1d2230');
  block(pc.x, pc.y - 0.9, 0.6, 0.6, TABLE_HEIGHT, 3.2, '#1d2230');
  block(pc.x, pc.y - 0.6, 9.4, 0.6, TABLE_HEIGHT + 1.8, 5.8, '#1d2230');
  const monitorCanvas = makeCanvas(256, 160);
  const monitorTexture = toTexture(monitorCanvas);
  textures.push(monitorTexture);
  const monitorMaterial = new THREE.MeshBasicMaterial({ map: monitorTexture });
  ownMaterials.push(monitorMaterial);
  plane(8.8, 5.2, monitorMaterial, pc.x, TABLE_HEIGHT + 4.7, pc.y - 0.28);
  block(pc.x, pc.y + 2.4, 6.4, 2, TABLE_HEIGHT, 0.35, '#2b2f38');
  block(pc.x + 4.6, pc.y + 2.6, 0.9, 1.3, TABLE_HEIGHT, 0.4, '#2b2f38');
  cyl(pc.x - 8, TABLE_HEIGHT + 0.9, pc.y + 1.2, 1.3, 1.8, 1.3, '#e63946');
  block(pc.x + 9, pc.y + 0.5, 3.4, 4.4, TABLE_HEIGHT, 0.3, '#f4f1ea', 0.2);
  // Silla de oficina (mirando a la mesa)
  const ch = office.chair;
  for (let k = 0; k < 5; k++) {
    const a = (k * Math.PI * 2) / 5;
    block(ch.x + Math.cos(a) * 1.4, ch.y + Math.sin(a) * 1.4, 2.8, 0.5, 0.6, 0.4, '#3a3f47', -a);
    sphere(ch.x + Math.cos(a) * 2.8, 0.9, ch.y + Math.sin(a) * 2.8, 0.7, 0.7, 0.7, '#1f1f1f');
  }
  cyl(ch.x, 2.8, ch.y, 0.7, 3.4, 0.7, '#4a4a4a');
  block(ch.x, ch.y, 5, 5, 4.4, 0.9, '#2b2f38');
  block(ch.x, ch.y + 2.5, 5, 0.7, 5.3, 6.4, '#2b2f38');
  for (const s of [-1, 1]) {
    block(ch.x + s * 2.7, ch.y + 0.4, 0.5, 3.4, 6.6, 0.4, '#3a3f47');
    block(ch.x + s * 2.7, ch.y + 1.6, 0.4, 0.4, 5.3, 1.3, '#3a3f47');
  }
  // Archivadores
  const cab = office.cabinets;
  const cabCount = 4;
  const cabLen = (cab.y1 - cab.y0) / cabCount;
  for (let i = 0; i < cabCount; i++) {
    const z = cab.y0 + cabLen * (i + 0.5);
    block((cab.x0 + cab.x1) / 2, z, cab.x1 - cab.x0, cabLen - 0.3, 0, 13, '#7d8794');
    for (const y of [0.8, 4.8, 8.8]) {
      block(cab.x1 + 0.05, z, 0.12, cabLen - 1.4, y, 3.6, '#8f99a6');
      block(cab.x1 + 0.3, z, 0.4, 2.2, y + 2.6, 0.4, '#d0d4da');
    }
    if (i % 2 === 0) block((cab.x0 + cab.x1) / 2, z, 4.6, 2.2, 13, 3.2, ['#e63946', '#4cc9f0', '#90be6d'][i % 3]); // carpetas
  }
  // Librería con libros
  const bk = office.bookcase;
  const bc = centerOf(bk);
  const bookColors = ['#2a6f97', '#d62828', '#ffb703', '#2a9d8f', '#6a4c93', '#f4a261', '#264653', '#e9c46a'];
  block(bk.x0 + 0.5, bc.y, 1, bk.y1 - bk.y0, 0, 22, '#8a6a4a');
  block(bk.x1 - 0.5, bc.y, 1, bk.y1 - bk.y0, 0, 22, '#8a6a4a');
  block(bc.x, bk.y0 + 0.3, bk.x1 - bk.x0, 0.6, 0, 22, '#7a5c40');
  const bookBoards = [0.4, 5.8, 11.2, 16.6, 21.4];
  for (const y of bookBoards) block(bc.x, bc.y, bk.x1 - bk.x0, bk.y1 - bk.y0, y, 0.6, '#8a6a4a');
  for (const y of bookBoards.slice(0, 4)) {
    let x = bk.x0 + 1.3;
    while (x < bk.x1 - 2.2) {
      const w = 0.7 + rng() * 0.8;
      const h = 3 + rng() * 1.7;
      if (rng() < 0.08) { x += 2.5; continue; }
      block(x + w / 2, bk.y0 + 0.6 + 2.6, w, 4.6 + rng() * 0.8, y + 0.6, h, bookColors[Math.floor(rng() * bookColors.length)]);
      x += w + 0.1;
    }
  }
  // Planta
  const pl = centerOf(office.plant);
  cyl(pl.x, 2.5, pl.y, 6, 5, 6, '#b5653a');
  cyl(pl.x, 5, pl.y, 5.4, 0.2, 5.4, '#4a3426');
  cyl(pl.x, 6.5, pl.y, 0.6, 3, 0.6, '#5b4636');
  sphere(pl.x, 8.6, pl.y, 6.4, 5.6, 6.4, '#3a7d44');
  sphere(pl.x + 1.5, 11, pl.y - 1, 4, 4, 4, '#4c9a52');
  sphere(pl.x - 1.6, 10.4, pl.y + 1.2, 4.2, 3.8, 4.2, '#2f6b3a');
  // Pizarra en la cara interior del tabique este
  const wb = office.whiteboard;
  const wbz = (wb.y0 + wb.y1) / 2;
  const wbLen = wb.y1 - wb.y0;
  block(wb.x - 0.3, wbz, 0.5, wbLen + 1, 9.5, 11, '#b0b6be');
  block(wb.x - 1.1, wbz, 1.2, wbLen * 0.6, 9.2, 0.4, '#b0b6be');
  const boardCanvas = makeCanvas(256, 96);
  {
    const ctx = boardCanvas.getContext('2d');
    ctx.fillStyle = '#fbfbf8';
    ctx.fillRect(0, 0, 256, 96);
    ctx.font = '700 15px "Segoe UI",sans-serif';
    ctx.fillStyle = '#1d3557';
    ctx.fillText('Objetivos de la semana', 12, 22);
    ctx.strokeStyle = '#e63946';
    ctx.lineWidth = 3;
    ctx.beginPath();
    [[14, 84], [60, 66], [104, 72], [150, 46], [196, 40], [240, 24]].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.fillStyle = '#2a9d8f';
    ctx.font = '600 12px "Segoe UI",sans-serif';
    ctx.fillText('✔ Cinta  ✔ Expedición  ☐ Más clientes', 12, 42);
  }
  const boardTexture = toTexture(boardCanvas);
  textures.push(boardTexture);
  plane(wbLen, 10, lambert({ map: boardTexture }), wb.x - 0.6, 15, wbz, -Math.PI / 2);
  // Ventanas (oeste y norte de la oficina)
  const windowMaterial = new THREE.MeshBasicMaterial({ color: '#cfe9ff' });
  ownMaterials.push(windowMaterial);
  const winZ = (cab.y0 + cab.y1) / 2;
  plane(cab.y1 - cab.y0 - 2, 10, windowMaterial, inner.x0 + 0.06, 21, winZ, Math.PI / 2);
  block(inner.x0 + 0.4, winZ, 0.8, cab.y1 - cab.y0, 15.6, 0.6, steel);
  block(inner.x0 + 0.4, winZ, 0.8, cab.y1 - cab.y0, 26, 0.6, steel);
  for (const t of [-0.5, -0.17, 0.17, 0.5]) block(inner.x0 + 0.4, winZ + t * (cab.y1 - cab.y0 - 1), 0.8, 0.6, 15.6, 11, steel);
  const nwX0 = desk.x0 - 10;
  const nwX1 = desk.x1;
  plane(nwX1 - nwX0, 9, windowMaterial, (nwX0 + nwX1) / 2, 21.5, inner.y0 + 0.06);
  block((nwX0 + nwX1) / 2, inner.y0 + 0.4, nwX1 - nwX0, 0.8, 16.5, 0.6, steel);
  block((nwX0 + nwX1) / 2, inner.y0 + 0.4, nwX1 - nwX0, 0.8, 26, 0.6, steel);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) block(nwX0 + t * (nwX1 - nwX0), inner.y0 + 0.4, 0.6, 0.8, 16.5, 10, steel);

  // ------------------------------------------------------------------ Estanterías de stock ----
  const frame = '#4d5463';
  const boardColor = '#9aa1ad';
  for (const shelf of L.shelves) {
    const r = shelf.rect;
    const info = getShelf(shelf.id);
    const along = r.x1 - r.x0 >= r.y1 - r.y0;
    const len = along ? r.x1 - r.x0 : r.y1 - r.y0;
    const depth = along ? r.y1 - r.y0 : r.x1 - r.x0;
    const c = centerOf(r);
    for (const [px, pz] of [[r.x0 + 0.6, r.y0 + 0.6], [r.x1 - 0.6, r.y0 + 0.6], [r.x0 + 0.6, r.y1 - 0.6], [r.x1 - 0.6, r.y1 - 0.6]]) {
      block(px, pz, 1.2, 1.2, 0, SHELF_HEIGHT, frame);
    }
    const levels = [0.8, 10.4, 20];
    for (const y of [...levels, SHELF_HEIGHT - 1]) block(c.x, c.y, r.x1 - r.x0, r.y1 - r.y0, y, 0.8, boardColor);
    // Productos de verdad de esa categoría, mezclados con cajas de stock
    const names = Object.keys(PRODUCTS).filter((n) => PRODUCTS[n].shelf === shelf.id);
    const place = (parts, offset, sideOffset, y, turned) => {
      const x = along ? c.x + offset : c.x + sideOffset;
      const z = along ? c.y + sideOffset : c.y + offset;
      // Eje x local a lo largo de la estantería (o girado 90° si el producto es más hondo que ancho)
      const yaw = (along ? 0 : Math.PI / 2) + (turned ? Math.PI / 2 : 0);
      model(parts, x, y, z, yaw);
    };
    for (const y of levels) {
      let cursor = 1.4;
      while (cursor < len - 2) {
        let parts;
        let fa;
        let fd;
        let h;
        let turned = false;
        if (rng() < 0.28 || !names.length) {
          fa = 3 + rng() * 4;
          fd = depth * (0.5 + rng() * 0.3);
          h = 3 + rng() * 4.5;
          parts = boxParts([fa, h, fd], info.color);
        } else {
          const name = names[Math.floor(rng() * names.length)];
          const [w, ph, d] = productInfo(name).size;
          turned = d > depth - 1 && w <= depth - 1;
          fa = turned ? d : w;
          fd = turned ? w : d;
          h = ph;
          if (h > 8.6 || fd > depth) { cursor += 1; continue; }
          parts = productParts(name);
        }
        if (cursor + fa > len - 1.2) break;
        const offset = -len / 2 + cursor + fa / 2;
        const side = (rng() - 0.5) * Math.max(0, depth - fd - 1);
        place(parts, offset, side, y + 0.8, turned);
        if (h < 2.6 && rng() < 0.5) place(parts, offset, side, y + 0.8 + h, turned); // apilado
        cursor += fa + 0.6 + rng() * 1.2;
      }
    }
    // Cajas de reserva encima
    for (let k = 0; k < 3; k++) {
      const offset = -len / 2 + len * (0.2 + k * 0.3);
      const size = [6 + rng() * 2, 4 + rng() * 2, depth * 0.7];
      model(boxParts(size, info.color), along ? c.x + offset : c.x, SHELF_HEIGHT - 0.2, along ? c.y : c.y + offset, along ? 0 : Math.PI / 2);
    }
    const fx = shelf.face.x;
    const fz = shelf.face.y;
    const rotY = fz > 0 ? 0 : fx > 0 ? Math.PI / 2 : -Math.PI / 2;
    sign(`${shelf.id} · ${info.name}`, c.x + fx * (depth / 2 + 0.3), SHELF_HEIGHT + 3.5, c.y + fz * (depth / 2 + 0.3), rotY, Math.min(len, 40), { bg: info.color });
  }

  // ------------------------------------------------------------------ Recepción y columnas ----
  const rec = L.reception;
  L.reception.pallets.forEach((r, i) => {
    const c = centerOf(r);
    const w = r.x1 - r.x0;
    const d = r.y1 - r.y0;
    for (const k of [0.08, 0.5, 0.92]) block(c.x, r.y0 + d * k, w, 1.8, 0, 1.2, '#a07a4f');
    block(c.x, c.y, w, d, 1.2, 0.5, '#c99a62');
    const layers = i === 0 ? 2 : 1;
    for (let layer = 0; layer < layers; layer++) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          model(boxParts([w / 2 - 0.8, 5, d / 2 - 0.8], layer ? '#2a9d8f' : null), c.x + sx * w / 4, 1.7 + layer * 5.1, c.y + sz * d / 4);
        }
      }
    }
    if (i === 1) {
      model(productParts('Lavadora'), c.x - w / 4, 6.8, c.y - d / 4);
      model(productParts('Maquinaria ligera'), c.x + w / 4, 6.8, c.y + d / 4, 0.3);
    }
  });
  const rd = rec.rollerDoor;
  const rdc = (rd.x0 + rd.x1) / 2;
  const rdw = rd.x1 - rd.x0;
  block(rdc, rd.y + 0.4, rdw, 0.8, 0, 30, '#9aa3ad');
  for (let y = 1.5; y < 30; y += 2) block(rdc, rd.y + 0.9, rdw, 0.3, y, 0.35, '#7f8893');
  block(rdc, rd.y + 1.6, rdw + 2, 3.2, 30, 3.4, '#6c757d');
  for (const x of [rd.x0 - 0.7, rd.x1 + 0.7]) {
    block(x, rd.y + 0.8, 1.4, 1.6, 0, 33.4, '#ffb703');
    for (let y = 2; y < 32; y += 6) block(x, rd.y + 0.8, 1.5, 1.7, y, 3, '#1f1f1f');
  }
  for (let i = 0; i < 6; i++) block(rd.x0 + 2 + i * 4, rd.y + 3.2, 2, 3, 0.6, 0.1, i % 2 ? '#1f1f1f' : '#ffb703');
  sign('RECEPCIÓN', rdc, 37.5, rd.y + 0.3, 0, 24, { bg: '#90be6d' });
  for (const col of L.columns) {
    rectBlock(col, 0, CEILING, '#b8bec7');
    rectBlock(grow(col, 0.15), 0.6, 3.5, '#ffb703');
    rectBlock(grow(col, 0.15), 4.1, 1, '#1f1f1f');
  }

  // ------------------------------------------------------------------ Cinta transportadora ----
  const half = BELT_WIDTH / 2;
  const segs = L.belt.segments;
  const beltCanvas = makeCanvas(32, 32);
  {
    const ctx = beltCanvas.getContext('2d');
    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#414852';
    ctx.fillRect(0, 0, 32, 5);
    ctx.fillStyle = '#353a42';
    for (let x = 3; x < 32; x += 8) ctx.fillRect(x, 14, 3, 3);
  }
  const beltTexture = toTexture(beltCanvas, { repeat: true });
  textures.push(beltTexture);
  const surfaces = [];
  segs.forEach((seg, i) => {
    const prev = segs[i - 1];
    const next = segs[i + 1];
    const yaw = yawOf(seg.dir);
    const n = { x: -seg.dir.y, y: seg.dir.x };
    // Banda móvil: incluye el cuadrado de la esquina al final del tramo (el siguiente empieza después)
    const s0 = prev ? half : 0;
    const s1 = seg.len + (next ? half : 0);
    const len = s1 - s0;
    const mid = (s0 + s1) / 2;
    const cx = seg.a.x + seg.dir.x * mid;
    const cz = seg.a.y + seg.dir.y * mid;
    const texture = beltTexture.clone();
    texture.needsUpdate = true;
    texture.repeat.set(1, len / BELT_TILE);
    textures.push(texture);
    const surface = plane(BELT_WIDTH - 1.6, len, lambert({ map: texture }), cx, BELT_HEIGHT, cz, Math.atan2(seg.dir.x, seg.dir.y), -Math.PI / 2);
    surfaces.push({ texture, mesh: surface });
    // Bastidor bajo la banda
    const b0 = prev ? -half : 0;
    const b1 = seg.len + (next ? half : 0);
    const bm = (b0 + b1) / 2;
    piece(S, 'box', seg.a.x + seg.dir.x * bm, BELT_HEIGHT - 1.15, seg.a.y + seg.dir.y * bm, b1 - b0, 2.1, BELT_WIDTH, '#4a515c', 0, yaw);
    // Barandillas laterales (en las esquinas, la interior se acorta y la exterior se alarga)
    for (const s of [-1, 1]) {
      const ns = { x: n.x * s, y: n.y * s };
      const startExt = prev ? ((ns.x * -prev.dir.x + ns.y * -prev.dir.y) > 0 ? -half : half) : 0;
      const endExt = next ? ((ns.x * next.dir.x + ns.y * next.dir.y) > 0 ? -half : half) : 0;
      const r0 = -startExt;
      const r1 = seg.len + endExt;
      const rm = (r0 + r1) / 2;
      const off = half - 0.35;
      const rx = seg.a.x + seg.dir.x * rm + ns.x * off;
      const rz = seg.a.y + seg.dir.y * rm + ns.y * off;
      piece(S, 'box', rx, BELT_HEIGHT + 0.1, rz, r1 - r0, 2.6, 0.7, '#ffb703', 0, yaw);
      for (let t = r0 + 2; t < r1 - 1; t += 16) {
        block(seg.a.x + seg.dir.x * t + ns.x * off, seg.a.y + seg.dir.y * t + ns.y * off, 0.9, 0.9, 0, BELT_HEIGHT - 2.2, '#3a3f47');
      }
      block(seg.a.x + seg.dir.x * (r1 - 1) + ns.x * off, seg.a.y + seg.dir.y * (r1 - 1) + ns.y * off, 0.9, 0.9, 0, BELT_HEIGHT - 2.2, '#3a3f47');
    }
  });
  // Tambores de los extremos
  const first = segs[0];
  const last = segs[segs.length - 1];
  cyl(first.a.x, BELT_HEIGHT - 1, first.a.y, 2.2, BELT_WIDTH - 1.2, 2.2, '#8d939c', 0, yawOf(first.dir) + Math.PI / 2, Math.PI / 2);
  cyl(last.b.x, BELT_HEIGHT - 1, last.b.y, 2.2, BELT_WIDTH - 1.2, 2.2, '#8d939c', 0, yawOf(last.dir) + Math.PI / 2, Math.PI / 2);
  // Tolva de entrada desde recepción, con cortina de tiras
  {
    const a = first.a;
    const dx = first.dir.x;
    const dz = first.dir.y;
    const back = { x: a.x - dx * 3, y: a.y - dz * 3 };
    const nx = -dz;
    const nz = dx;
    for (const s of [-1, 1]) {
      piece(S, 'box', back.x + nx * s * (half - 0.35), BELT_HEIGHT + 3.5, back.y + nz * s * (half - 0.35), 6, 9.4, 0.7, '#6c757d', 0, yawOf(first.dir));
    }
    piece(S, 'box', back.x, BELT_HEIGHT + 8.4, back.y, 6, 0.8, BELT_WIDTH, '#6c757d', 0, yawOf(first.dir));
    for (let k = 0; k < 5; k++) {
      const t = -half + 1.6 + k * 1.7;
      piece(S, 'box', a.x + nx * t, BELT_HEIGHT + 4.2, a.y + nz * t, 0.15, 7.6, 1.5, '#5a8fb0', 0, yawOf(first.dir));
    }
  }
  // Seta de emergencia en la esquina
  {
    const corner = segs[0].b;
    const cxp = corner.x + (segs[0].dir.x - segs[1].dir.x) * (half + 0.6);
    const czp = corner.y + (segs[0].dir.y - segs[1].dir.y) * (half + 0.6);
    block(cxp, czp, 1.6, 1.6, 0, BELT_HEIGHT + 1.6, '#ffb703');
    cyl(cxp, BELT_HEIGHT + 1.9, czp, 1.3, 0.6, 1.3, '#e63946');
  }

  // Cajón de fin de línea
  const bin = L.bin.rect;
  const binC = centerOf(bin);
  const bw = bin.x1 - bin.x0;
  const bd = bin.y1 - bin.y0;
  const plastic = '#2f6db5';
  rectBlock(bin, 0, 0.7, '#25578f', 0.6);
  block(binC.x, bin.y0 + 0.4, bw, 0.8, 0, BIN_HEIGHT, plastic);
  block(binC.x, bin.y1 - 0.4, bw, 0.8, 0, BIN_HEIGHT, plastic);
  block(bin.x0 + 0.4, binC.y, 0.8, bd, 0, BIN_HEIGHT, plastic);
  block(bin.x1 - 0.4, binC.y, 0.8, bd, 0, BIN_HEIGHT - 2.5, plastic); // lado de la cinta, más bajo
  for (const x of [bin.x0 + 1, bin.x1 - 1]) block(x, bin.y1 + 0.3, 0.5, 0.5, BIN_HEIGHT, 6.4, '#3a3f47');
  sign('FIN DE LÍNEA', binC.x, BIN_HEIGHT + 5.4, bin.y1 + 0.6, 0, 14, { bg: '#4cc9f0' });

  // ------------------------------------------------------------------ Mesas ----
  const table = (r) => {
    const c = centerOf(r);
    rectBlock(r, TABLE_HEIGHT - 1.2, 1.2, '#a87a4f');
    for (const [px, pz] of [[r.x0 + 1.5, r.y0 + 1.5], [r.x1 - 1.5, r.y0 + 1.5], [r.x0 + 1.5, r.y1 - 1.5], [r.x1 - 1.5, r.y1 - 1.5]]) {
      block(px, pz, 1.4, 1.4, 0, TABLE_HEIGHT - 1.2, frame);
    }
    rectBlock(r, 2, 0.6, '#8a6a4a', 1.2); // balda inferior
    return c;
  };
  const playerArea = { x0: T.x0 + 1, y0: T.y0 + 1, x1: T.x1 - 10, y1: T.y1 - 1 };
  {
    table(T);
    // Material de embalar en el extremo derecho: cartones plegados y el portarrollos de precinto
    block(T.x1 - 5, T.y0 + 4.5, 8, 7, TABLE_HEIGHT, 1.4, '#d8b07c');
    block(T.x1 - 5, T.y0 + 4.5, 8, 7, TABLE_HEIGHT + 1.4, 1.2, '#c99a62');
    block(T.x1 - 5, T.y1 - 3, 3.4, 2.4, TABLE_HEIGHT, 1.6, '#3a3f47');
    cyl(T.x1 - 5, TABLE_HEIGHT + 2.2, T.y1 - 3, 2, 1.6, 2, '#e8c48e', Math.PI / 2);
    const tc = centerOf(T);
    for (const x of [tc.x - 10, tc.x + 10]) block(x, tc.y, 0.2, 0.2, 26, CEILING - 26, '#3a3f47');
    sign('TU MESA · EMPAQUETADO', tc.x, 24.5, tc.y, 0, 26, { double: true });
  }
  for (const t of L.tables.slice(1)) {
    const c = table(t.rect);
    block(t.rect.x1 - 2, c.y, 2.6, 2, TABLE_HEIGHT, 1.4, '#3a3f47');
    cyl(t.rect.x1 - 2, TABLE_HEIGHT + 2, c.y, 1.6, 1.4, 1.6, '#e8c48e', Math.PI / 2);
    tapeLine(t.rect.x0, c.y, t.rect.x1 - 4, c.y, '#f4f1ea', 0.3); // separa los dos puestos
  }
  const stationAreas = L.stations.map((s) => ({ x0: s.surface.x0 + 1, y0: s.surface.y0 + 0.6, x1: s.surface.x1 - 4, y1: s.surface.y1 - 0.6 }));

  // ------------------------------------------------------------------ Expedición ----
  const rackC = centerOf(rk);
  for (const [px, pz] of [[rk.x0 + 0.6, rk.y0 + 0.6], [rk.x1 - 0.6, rk.y0 + 0.6], [rk.x0 + 0.6, rk.y1 - 0.6], [rk.x1 - 0.6, rk.y1 - 0.6]]) {
    block(px, pz, 1.2, 1.2, 0, RACK_HEIGHT, frame);
  }
  for (const y of [0.8, RACK_HEIGHT - 0.8]) block(rackC.x, rackC.y, rk.x1 - rk.x0, rk.y1 - rk.y0, y, 0.8, boardColor);
  sign('EXPEDICIÓN · cajas listas', rk.x0 - 0.4, RACK_HEIGHT + 12, rackC.y, -Math.PI / 2, 30);

  S.end();
  G.end();
  group.add(S.group, G.group);
  disposables.push(S, G);

  // ------------------------------------------------------------------ Parte dinámica ----
  const dyn = new PartBatch({ box: 1400, cyl: 260, sphere: 160, torus: 32, cone: 32 });
  group.add(dyn.group);
  disposables.push(dyn);
  const charLayer = new THREE.Group();
  group.add(charLayer);
  const characters = new Map();
  const rel = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const inv = new THREE.Matrix4();
  let monitorTimer = 0;

  const drawMonitor = (game) => {
    const { state } = game;
    const ctx = monitorCanvas.getContext('2d');
    const company = getCompany(state);
    ctx.fillStyle = '#0f1a2b';
    ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = company.primary;
    ctx.fillRect(0, 0, 256, 28);
    ctx.fillStyle = '#10131c';
    ctx.font = '700 15px "Segoe UI",sans-serif';
    ctx.fillText(getCompanyName(company).slice(0, 24), 10, 19);
    const toPack = state.orders.filter((o) => o.status === 'pending' && o.prep > 0).length;
    const lines = [
      ['Pedidos activos', String(state.orders.length)],
      ['Por preparar', String(toPack)],
      ['En expedición', String(rackBoxes(state).length)],
      ['Caja', formatMoney(state.money)],
      ['Nivel', String(state.level)],
    ];
    ctx.font = '600 13px "Segoe UI",sans-serif';
    lines.forEach(([k, v], i) => {
      ctx.fillStyle = '#8fb3d9';
      ctx.fillText(k, 12, 50 + i * 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(v, 150, 50 + i * 18);
    });
    ctx.fillStyle = '#ffd166';
    ctx.font = '700 12px "Segoe UI",sans-serif';
    ctx.fillText('Pulsa E · panel de gestión', 12, 150);
    monitorTexture.needsUpdate = true;
  };

  const syncWorkers = (game, dt, camera, cssH) => {
    const { state, city } = game;
    const f = state.player.foot;
    const inside = state.player.mode === 'foot' && isInsideDepot(city.depot, f.x, f.y);
    const company = getCompany(state);
    const seen = new Set();
    group.updateMatrixWorld(true);
    inv.copy(group.matrixWorld).invert();
    for (const worker of pickersOf(state)) {
      const rt = game.runtime.pickers?.[worker.id];
      if (!rt) continue;
      seen.add(worker.id);
      let c = characters.get(worker.id);
      if (!c) {
        c = createCharacter({ id: worker.id, name: worker.name, cap: company.primary });
        characters.set(worker.id, c);
        charLayer.add(c.group);
      }
      c.group.position.set(rt.x, 0.6, rt.y);
      c.group.rotation.y = -rt.yaw;
      const load = pickerLoad(game, worker);
      const carrying = Boolean(load.box) || load.items.length > 0;
      c.update(rt.phase === 'walking' ? 'walk' : rt.anim, rt.animTime, { carrying, speed: rt.moving, dt });
      setLabelText(c.label, worker.name, { size: 11, color: '#ffe6b0' });
      c.label.visible = inside && distance(f.x, f.y, rt.x, rt.y) < LABEL_DISTANCE;
      if (c.label.visible) scaleSpriteToScreen(c.label, camera, cssH, c.label.userData.label.pxHeight);
      if (!carrying) continue;
      c.group.updateMatrixWorld(true);
      rel.multiplyMatrices(inv, c.anchor.matrixWorld);
      if (load.box) {
        const [, bh, bs] = boxSizeFor(load.box);
        placement(bs / 2 - 0.6, -bh * 0.4, 0, Math.PI / 2, local);
        dyn.add(orderBoxParts(load.box, ORDER_KINDS[load.box.kind]?.color ?? null), local.premultiply(rel));
      } else {
        let y = -1.2;
        for (const item of load.items) {
          const [, h, d] = productInfo(item.name).size;
          placement(d / 2 - 0.4, y, 0, Math.PI / 2, local);
          dyn.add(productParts(item.name), local.premultiply(rel));
          y += h;
        }
      }
    }
    for (const [id, c] of characters) {
      if (seen.has(id)) continue;
      charLayer.remove(c.group);
      c.dispose();
      characters.delete(id);
    }
  };

  return {
    group,
    light,
    update(game, dt = 0, camera = null, cssH = 720) {
      const { state } = game;
      for (const s of surfaces) s.texture.offset.y = (s.texture.offset.y + (BELT_SPEED * dt) / BELT_TILE) % 1;

      dyn.begin();
      const bins = [];
      const playerTable = [];
      const stations = new Map();
      for (const order of state.orders) {
        for (const item of order.items ?? []) {
          if (item.at === 'belt') {
            const p = beltPoint(L, item.pos ?? 0);
            dyn.add(productParts(item.name), placement(p.x, BELT_HEIGHT + 0.05, p.y, yawOf(p.dir), M));
          } else if (item.at === 'bin') {
            bins.push(item);
          } else if (item.at === 'table') {
            if (Number.isInteger(item.station) && item.table !== 0) {
              if (!stations.has(item.station)) stations.set(item.station, []);
              stations.get(item.station).push(item.name);
            } else {
              playerTable.push(item.name);
            }
          }
        }
      }
      // Cajón: montón ordenado por llegada, en cuatro columnas
      bins.sort((a, b) => (a.binAt ?? 0) - (b.binAt ?? 0));
      bins.slice(0, 20).forEach((item, i) => {
        const col = i % 4;
        const layer = Math.floor(i / 4);
        const x = binC.x + (col % 2 ? 2.8 : -2.8);
        const z = binC.y + (col > 1 ? 2.8 : -2.8);
        dyn.add(productParts(item.name), placement(x, 0.7 + layer * 2.2, z, (hashOf(item.name) % 7) * 0.45 + i, M));
      });
      // Mesas: la del jugador y los puestos de los preparadores
      for (const p of layoutOnSurface(playerTable, playerArea, TABLE_HEIGHT)) {
        dyn.add(productParts(p.name), placement(p.x, p.y, p.z, p.yaw, M));
      }
      for (const [index, names] of stations) {
        const area = stationAreas[index];
        if (!area) continue;
        for (const p of layoutOnSurface(names, area, TABLE_HEIGHT)) dyn.add(productParts(p.name), placement(p.x, p.y, p.z, p.yaw, M));
      }
      // Expedición: cajas a lo largo de la estantería, primero abajo y luego encima
      const levels = [1.6, RACK_HEIGHT];
      let level = 0;
      let cursor = rk.y0 + 1;
      for (const order of rackBoxes(state)) {
        const [bl, , bs] = boxSizeFor(order);
        if (cursor + bl > rk.y1 - 1) {
          level++;
          cursor = rk.y0 + 1;
          if (level >= levels.length) break;
        }
        const x = Math.min(rk.x1 - bs / 2 - 0.5, rackC.x);
        dyn.add(orderBoxParts(order, ORDER_KINDS[order.kind]?.color ?? null), placement(x, levels[level], cursor + bl / 2, Math.PI / 2, M));
        cursor += bl + 0.6;
      }
      if (camera) syncWorkers(game, dt, camera, cssH);
      dyn.end();

      monitorTimer -= dt;
      if (monitorTimer <= 0) {
        monitorTimer = 1;
        drawMonitor(game);
      }
    },
    dispose() {
      for (const material of ownMaterials) material.dispose();
      for (const geometry of ownGeometries) geometry.dispose();
      for (const texture of textures) texture.dispose();
      for (const d of disposables) d.dispose();
      for (const c of characters.values()) c.dispose();
      characters.clear();
    },
  };
}
