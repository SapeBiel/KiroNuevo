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
import { ITEM_AT_LABELS, PRODUCTS, boxSizeFor, getShelf, productInfo } from '../config/products.js';
import { createRng } from '../core/random.js';
import { distance, formatDuration, formatMoney, pad } from '../core/util.js';
import {
  BELT_HEIGHT, BELT_SPEED, BELT_WIDTH, BIN_HEIGHT, CEILING, OFFICE_HEIGHT, OPENING_HEIGHT, RACK_HEIGHT, SHELF_HEIGHT,
  TABLE_HEIGHT, beltPoint, depotLayout, isInsideDepot,
} from '../world/depotLayout.js';
import { rackBoxes } from '../systems/handling.js';
import { compareOrders, describeOrderStatus } from '../systems/orders.js';
import { reservedOnRack } from '../systems/workers.js';
import { formatClock } from '../systems/dayCycle.js';
import { pickerLoad, pickersOf } from '../systems/warehouseStaff.js';
import { contrastText, getCompany, getCompanyName } from '../systems/branding.js';
import { makeCanvas, makeSignTexture, scaleSpriteToScreen, setLabelText, toTexture } from './textures3d.js';
import { PartBatch, boxParts, orderBoxParts, placement, productParts } from './products3d.js';
import {
  concreteTexture, contactShadowTexture, corrugatedTexture, wallPanelTexture, withEnvironment, releaseEnvironment,
} from './materials3d.js';
import { createCharacter } from './characters3d.js';

const BELT_TILE = 6; // px de banda por cada repetición de la textura
const LABEL_DISTANCE = 130;

// Pantalla de pedidos sobre la puerta (medidas en px del mapa y de la textura)
export const BOARD_W = 64;
export const BOARD_H = 20;
export const BOARD_TOP = OPENING_HEIGHT + 3; // cuelga de la viga de la fachada; abajo queda a 21 de altura
const BOARD_PX_W = 1024;
const BOARD_PX_H = 320;
const BOARD_ROWS = 6;
const BOARD_REDRAW = 0.5; // s entre repintados (la cuenta atrás de los urgentes va por segundos)
const BOARD_VIEW_DISTANCE = 520; // más lejos no merece la pena repintarla
const BOARD_FONT = '"Segoe UI","Trebuchet MS",system-ui,sans-serif';
const STATUS_COLORS = { pending: '#ffe19a', prep: '#8ad7ff', picked: '#8ce0b9', in_transit: '#8ce0b9' };

/** Recorta el texto con "…" para que quepa en maxWidth (con la fuente ya puesta en ctx). */
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

/** Pinta el panel de salidas: cabecera con la empresa, columnas y una fila por pedido (urgentes primero). */
export function drawOrdersBoard(ctx, game, { width = BOARD_PX_W, height = BOARD_PX_H, blink = false } = {}) {
  const { state, city } = game;
  const company = getCompany(state);
  const orders = [...state.orders].sort(compareOrders);
  const text = (value, x, y, { size = 16, weight = 600, color = '#e5ecff', align = 'left', max = 0 } = {}) => {
    ctx.font = `${weight} ${size}px ${BOARD_FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(max ? fitText(ctx, value, max) : value, x, y);
  };
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#070b16';
  ctx.fillRect(0, 0, width, height);

  // Cabecera
  const ink = contrastText(company.primary);
  ctx.fillStyle = company.primary;
  ctx.fillRect(0, 0, width, 46);
  text('📦 PEDIDOS', 16, 24, { size: 24, weight: 800, color: ink });
  text(getCompanyName(company), 190, 24, { size: 18, weight: 700, color: ink, max: 400 });
  text(`${state.orders.length}/${game.derived.maxActiveOrders} activos · Día ${state.day} · ${formatClock(state)}`, width - 16, 24, {
    size: 18, weight: 700, color: ink, align: 'right',
  });

  // Columnas
  const cols = { num: 22, kind: 122, items: 262, dest: 556, status: 760, time: width - 18 };
  ctx.fillStyle = '#111a33';
  ctx.fillRect(0, 46, width, 26);
  const head = { size: 13, weight: 800, color: '#7f8fb3' };
  text('Nº', cols.num, 59, head);
  text('TIPO', cols.kind, 59, head);
  text('PRODUCTOS', cols.items, 59, head);
  text('DESTINO', cols.dest, 59, head);
  text('ESTADO', cols.status, 59, head);
  text('TIEMPO', cols.time, 59, { ...head, align: 'right' });

  const top = 74;
  const rowH = Math.floor((height - top) / BOARD_ROWS);
  if (!orders.length) {
    text('Sin pedidos activos · los clientes llaman enseguida', width / 2, top + (height - top) / 2, {
      size: 22, weight: 700, color: '#7f8fb3', align: 'center',
    });
    return;
  }
  const overflow = orders.length > BOARD_ROWS;
  const shown = overflow ? orders.slice(0, BOARD_ROWS - 1) : orders;
  shown.forEach((order, i) => {
    const y = top + i * rowH;
    const mid = y + rowH / 2;
    const kind = ORDER_KINDS[order.kind] ?? { icon: '📦', short: order.kind, color: '#9aa8c9' };
    const building = city.getBuilding(order.buildingId);
    const status = describeOrderStatus(game, order);
    ctx.fillStyle = order.priority === 'urgent' ? '#2a0f1c' : i % 2 ? '#0a1020' : '#0e1529';
    ctx.fillRect(0, y, width, rowH - 2);
    ctx.fillStyle = kind.color;
    ctx.fillRect(0, y, 7, rowH - 2);
    text(`#${pad(order.number)}`, cols.num, mid, { size: 21, weight: 800, color: '#ffffff' });
    text(`${kind.icon} ${kind.short}`, cols.kind, mid, { size: 18, weight: 700, color: kind.color, max: 132 });
    const items = (order.items ?? []).map((item) => `${(ITEM_AT_LABELS[item.at] ?? ['⬜'])[0]} ${item.name}`).join('   ');
    text(items || order.contents || '', cols.items, mid, { size: 17, weight: 600, max: cols.dest - cols.items - 14 });
    const dest = building ? `${building.name} · ${building.address}` : '';
    text(dest, cols.dest, mid, { size: 16, weight: 600, color: '#cfd8f2', max: cols.status - cols.dest - 12 });
    text(status.text, cols.status, mid, { size: 16, weight: 700, color: STATUS_COLORS[status.cls] ?? '#e5ecff', max: cols.time - cols.status - 70 });
    if (order.timeLeft === null) {
      text('—', cols.time, mid, { size: 20, weight: 700, color: '#56637f', align: 'right' });
    } else if (order.late) {
      text('TARDE', cols.time, mid, { size: 19, weight: 800, color: '#ff6b6b', align: 'right' });
    } else {
      const hurry = order.timeLeft < 15;
      text(formatDuration(order.timeLeft), cols.time, mid, {
        size: 22, weight: 800, color: hurry ? (blink ? '#ff6b6b' : '#ffb3b3') : '#ffb703', align: 'right',
      });
    }
  });
  if (overflow) {
    const y = top + (BOARD_ROWS - 1) * rowH;
    ctx.fillStyle = '#0a1020';
    ctx.fillRect(0, y, width, rowH - 2);
    text(`+${orders.length - shown.length} pedidos más · los ves todos en el ordenador de la oficina`, width / 2, y + rowH / 2, {
      size: 17, weight: 700, color: '#9aa8c9', align: 'center',
    });
  }
}

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
  // Casi todo el mobiliario va en un lote instanciado por geometría y acabado (metal pintado, acero, madera,
  // cartón, plástico…): cientos de piezas con muy pocas llamadas de dibujo.
  const S = new PartBatch({ box: 3000, rbox: 600, bevel: 900, cyl: 400, rcyl: 200, sphere: 120 }, { shadows: false });
  const G = new PartBatch({ box: 64, cyl: 32 }, { shadows: false, basic: true }); // luces y pantallas
  const obj = new THREE.Object3D();
  const color = new THREE.Color();
  const M = new THREE.Matrix4();
  const UP = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const piece = (batch, kind, cx, cy, cz, sx, sy, sz, hex, rx = 0, ry = 0, rz = 0, finish = 'matte') => {
    obj.position.set(cx, cy, cz);
    obj.rotation.set(rx, ry, rz);
    obj.scale.set(sx, sy, sz);
    obj.updateMatrix();
    batch.addPart(kind, obj.matrix, color.set(hex), finish);
  };
  /** Caja con la base en y0 (x, z del mapa). "finish": acabado; "kind": box (arista viva), bevel o rbox. */
  const block = (cx, cz, w, d, y0, h, hex, ry = 0, finish = 'matte', kind = 'box') => piece(S, kind, cx, y0 + h / 2, cz, w, h, d, hex, 0, ry, 0, finish);
  /** Pieza con los cantos redondeados (muebles, cajas, carcasas). */
  const rblock = (cx, cz, w, d, y0, h, hex, finish = 'satin', ry = 0) => block(cx, cz, w, d, y0, h, hex, ry, finish, 'rbox');
  /** Perfil de acero pintado (estructuras, patas, largueros) con el canto apenas matado. */
  const steel = (cx, cz, w, d, y0, h, hex, ry = 0) => block(cx, cz, w, d, y0, h, hex, ry, 'painted', 'bevel');
  const rectBlock = (r, y0, h, hex, inset = 0, finish = 'matte', kind = 'box') => {
    const c = centerOf(r);
    block(c.x, c.y, r.x1 - r.x0 - inset * 2, r.y1 - r.y0 - inset * 2, y0, h, hex, 0, finish, kind);
  };
  const cyl = (cx, cy, cz, sx, sy, sz, hex, rx = 0, ry = 0, rz = 0, finish = 'matte', kind = 'cyl') => piece(S, kind, cx, cy, cz, sx, sy, sz, hex, rx, ry, rz, finish);
  const sphere = (cx, cy, cz, sx, sy, sz, hex, finish = 'satin') => piece(S, 'sphere', cx, cy, cz, sx, sy, sz, hex, 0, 0, 0, finish);
  const glow = (cx, cy, cz, sx, sy, sz, hex, kind = 'box') => piece(G, kind, cx, cy, cz, sx, sy, sz, hex);
  const model = (parts, x, y, z, yaw = 0) => S.add(parts, placement(x, y, z, yaw, M));
  /** Tubo (cilindro) entre dos puntos 3D: barras, tirantes, cables. */
  const tube = (x0, y0, z0, x1, y1, z1, radius, hex, finish = 'painted', kind = 'cyl') => {
    dir.set(x1 - x0, y1 - y0, z1 - z0);
    const len = dir.length();
    if (len < 1e-4) return;
    obj.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    obj.quaternion.setFromUnitVectors(UP, dir.normalize());
    obj.scale.set(radius * 2, len, radius * 2);
    obj.updateMatrix();
    S.addPart(kind, obj.matrix, color.set(hex), finish);
    obj.rotation.set(0, 0, 0);
  };
  const tapeLine = (x0, z0, x1, z1, hex = '#e8a000', width = 1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    block((x0 + x1) / 2, (z0 + z1) / 2, len, width, 0.6, 0.1, hex, -Math.atan2(z1 - z0, x1 - x0), 'satin');
  };
  // Sombras de contacto (oclusión) bajo muebles y estanterías: planos difuminados instanciados
  // ("strength" agranda o encoge un poco la mancha; y = altura del suelo debajo)
  const contactShadows = [];
  const shadowUnder = (x0, z0, x1, z1, strength = 0.5, spread = 3, y = 0.66) => {
    const k = 0.7 + strength * 0.6;
    contactShadows.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: (x1 - x0) * k + spread * 2, d: (z1 - z0) * k + spread * 2, y });
  };
  const shadowRect = (r, strength = 0.5, spread = 3, y = 0.66) => shadowUnder(r.x0, r.y0, r.x1, r.y1, strength, spread, y);
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
  const standard = (opts, envBoost = 0) => {
    const material = new THREE.MeshStandardMaterial(opts);
    ownMaterials.push(material);
    if (envBoost) withEnvironment(material, envBoost);
    return material;
  };
  /** Textura compartida repetida "ru" × "rv" veces (cada superficie lleva su propia copia de los ajustes). */
  const repeated = (texture, ru, rv) => {
    const copy = texture.clone();
    copy.wrapS = THREE.RepeatWrapping;
    copy.wrapT = THREE.RepeatWrapping;
    copy.repeat.set(ru, rv);
    copy.needsUpdate = true;
    textures.push(copy);
    return copy;
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
  // Solera de hormigón pulido con juntas de retracción cada 48 px (textura repetida)
  const floor = plane(W + 6, D + 6, standard({ map: repeated(concreteTexture(), (W + 6) / 48, (D + 6) / 48), roughness: 0.74, metalness: 0 }),
    midX, 0.6, midZ, 0, -Math.PI / 2);
  floor.receiveShadow = true;
  // Paneles sándwich nervados: cada tramo de pared lleva su repetición (un panel cada 32 px)
  const wallMat = (len, height) => standard({ map: repeated(wallPanelTexture(), len / 32, 1), roughness: 0.82, metalness: 0.05, color: '#f4f1ea' });
  plane(W, CEILING, wallMat(W, CEILING), midX, CEILING / 2, inner.y0); // fondo (mira al sur)
  plane(D, CEILING, wallMat(D, CEILING), inner.x0, CEILING / 2, midZ, Math.PI / 2); // izquierda
  plane(D, CEILING, wallMat(D, CEILING), inner.x1, CEILING / 2, midZ, -Math.PI / 2); // derecha
  plane(W, CEILING - OPENING_HEIGHT, wallMat(W, CEILING - OPENING_HEIGHT), midX, (CEILING + OPENING_HEIGHT) / 2, inner.y1, Math.PI); // sobre el hueco
  // Cubierta de chapa grecada (vista desde abajo)
  plane(W, D, standard({ map: repeated(corrugatedTexture(), W / 12, D / 60), roughness: 0.62, metalness: 0.35, color: '#d6d8dc' }, 0.2),
    midX, CEILING, midZ, 0, Math.PI / 2);
  // Zócalo de hormigón con banda de color de la empresa
  for (const [cx, cz, w, d] of [[midX, inner.y0 + 0.7, W, 1.4], [inner.x0 + 0.7, midZ, 1.4, D], [inner.x1 - 0.7, midZ, 1.4, D]]) {
    block(cx, cz, w, d, 0.6, 3.2, '#a7a49c', 0, 'matte', 'bevel');
    block(cx, cz, w + (w > d ? 0 : 0.2), d + (d > w ? 0 : 0.2), 3.8, 1.6, '#ffb703', 0, 'painted');
  }
  // Cerchas de acero: cordón superior e inferior, montantes y diagonales; correas a lo largo de la nave
  const truss = '#8e959f';
  const trussXs = [];
  for (let x = inner.x0 + 40; x < inner.x1 - 10; x += 48) trussXs.push(x);
  for (const x of trussXs) {
    const top = CEILING - 1;
    const bottom = CEILING - 7;
    steel(x, midZ, 1.4, D, top - 0.7, 1.4, truss);
    steel(x, midZ, 1.4, D, bottom - 0.7, 1.4, truss);
    const step = 12;
    for (let z = inner.y0; z < inner.y1 - 1; z += step) {
      tube(x, bottom, z, x, top, z, 0.35, truss);
      tube(x, bottom, z, x, top, Math.min(inner.y1, z + step), 0.3, truss);
    }
  }
  for (let z = inner.y0 + 20; z < inner.y1 - 5; z += 30) steel(midX, z, W, 1, CEILING - 1.6, 1, '#a3a9b2');
  // Bajantes de pluviales y canaleta de cables por las paredes
  for (const x of [inner.x0 + 18, inner.x1 - 18]) tube(x, 0.6, inner.y0 + 1, x, CEILING, inner.y0 + 1, 0.8, '#9aa1aa');
  steel(midX, inner.y0 + 0.9, W, 1.2, CEILING - 12, 1.6, '#c3c7cd');

  // Campanas industriales colgadas de las cerchas: cable, reflector y difusor encendido
  const lampSpots = [];
  for (const fx of [0.38, 0.56, 0.74, 0.92]) for (const fz of [0.2, 0.5, 0.8]) lampSpots.push([ox + W * fx, oy + D * fz]);
  for (const fz of [0.55, 0.85]) lampSpots.push([ox + 40, oy + D * fz]);
  const LAMP_Y = 45;
  for (const [x, z] of lampSpots) {
    tube(x, LAMP_Y + 3, z, x, CEILING - 1, z, 0.12, '#2b2f36', 'metal');
    cyl(x, LAMP_Y + 2.6, z, 1.6, 1.4, 1.6, '#3a3f47', 0, 0, 0, 'painted', 'rcyl'); // driver
    cyl(x, LAMP_Y + 1, z, 6.4, 2.2, 6.4, '#d4d8de', 0, 0, 0, 'painted', 'cone'); // reflector
    glow(x, LAMP_Y - 0.15, z, 5.2, 0.3, 5.2, '#fff6e2', 'cyl'); // difusor
  }
  // Luz real: cuatro focos sobre las zonas de trabajo (mesas, estanterías, cinta y expedición), sin sombras
  const light = new THREE.Group();
  const lightSpots = [
    [L.table.rect.x0 + 20, 40, L.table.rect.y0 + 4, 1.0], // mesas y puestos
    [ox + W * 0.45, 44, oy + 18, 0.75], // estanterías del fondo
    [ox + W * 0.8, 44, oy + 70, 0.75], // cinta y recepción
    [L.rack.rect.x0 - 14, 40, (L.rack.rect.y0 + L.rack.rect.y1) / 2, 0.7], // expedición
  ];
  for (const [x, y, z, intensity] of lightSpots) {
    const point = new THREE.PointLight('#fff0d8', intensity, 190, 0);
    point.position.set(x, y, z);
    light.add(point);
  }
  group.add(light);

  // ------------------------------------------------------------------ Señalización del suelo ----
  const T = L.table.rect;
  tapeRect(grow(T, 8));
  const rk = L.rack.rect;
  tapeRect({ x0: rk.x0 - 20, y0: rk.y0 - 4, x1: rk.x0 - 1, y1: rk.y1 + 4 });
  for (let z = rk.y0; z < rk.y1; z += 6) tapeLine(rk.x0 - 19, z, rk.x0 - 13, z + 6, '#ffb703', 0.8); // rayado
  for (const c of L.belt.colliders) tapeRect(grow(c, 3), '#ffb703');
  for (const spot of L.pickupSpots) tapeRect({ x0: spot.x - 3, y0: spot.y - 3, x1: spot.x + 3, y1: spot.y + 3 }, '#4cc9f0');
  tapeRect(grow(L.reception.area, -1), '#90be6d');
  // Pasillo peatonal pintado desde la entrada hasta las mesas (verde, con bordes blancos)
  block(L.doorX, (T.y1 + inner.y1) / 2 + 4, 18, inner.y1 - T.y1 - 18, 0.6, 0.06, '#5f8f6a', 0, 'satin');
  tapeLine(L.doorX - 9, T.y1 + 13, L.doorX - 9, inner.y1 - 1, '#f4f1ea', 0.8);
  tapeLine(L.doorX + 9, T.y1 + 13, L.doorX + 9, inner.y1 - 1, '#f4f1ea', 0.8);
  // Extintores y cuadro eléctrico en las paredes (no estorban: van colgados)
  for (const [x, z] of [[inner.x0 + 1.4, oy + 160], [inner.x1 - 1.4, oy + 110], [ox + 195, inner.y0 + 1.4]]) {
    cyl(x, 9, z, 2, 6, 2, '#d62828', 0, 0, 0, 'gloss', 'rcyl');
    cyl(x, 12.6, z, 0.9, 1.2, 0.9, '#2b2b2b', 0, 0, 0, 'plastic', 'rcyl');
    block(x, z, 2.6, 2.6, 15.5, 2, '#d62828', 0, 'painted');
  }
  // Cuadro eléctrico en la pared izquierda, entre la oficina y las estanterías
  rblock(inner.x0 + 1.2, oy + 73, 2.2, 10, 14, 16, '#c6cbd2', 'painted');
  block(inner.x0 + 2.35, oy + 73, 0.3, 6, 26, 1.4, '#ffb703', 0, 'satin');

  // ------------------------------------------------------------------ Oficina ----
  const office = L.office;
  const room = office.room;
  const alu = '#b9c0c9'; // perfilería de aluminio
  const glassMaterial = standard({
    color: '#dcefff', transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide,
  }, 1.4);
  const glassBox = (cx, cz, w, d, y0, h) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    ownGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, glassMaterial);
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.renderOrder = 2;
    group.add(mesh);
  };
  // Moqueta de losetas (tela) con un rodapié claro
  block((room.x0 + room.x1) / 2, (room.y0 + room.y1) / 2, room.x1 - room.x0, room.y1 - room.y0, 0.6, 0.14, '#55667c', 0, 'fabric');
  for (const wall of office.walls) {
    const c = centerOf(wall);
    const w = wall.x1 - wall.x0;
    const d = wall.y1 - wall.y0;
    const along = w >= d;
    const len = along ? w : d;
    block(c.x, c.y, w, d, 0, 7, '#d3d8de', 0, 'painted', 'bevel'); // zócalo opaco
    block(c.x, c.y, w + 0.2, d + 0.2, 7, 0.7, alu, 0, 'metal', 'bevel');
    block(c.x, c.y, w + 0.2, d + 0.2, OFFICE_HEIGHT - 1.6, 1.6, alu, 0, 'metal', 'bevel');
    block(c.x, c.y, along ? w : w * 0.4, along ? d * 0.4 : d, 18.2, 0.35, alu, 0, 'metal'); // travesaño intermedio
    glassBox(c.x, c.y, along ? w : w * 0.3, along ? d * 0.3 : d, 7.7, OFFICE_HEIGHT - 9.3);
    const posts = Math.max(1, Math.ceil(len / 16));
    for (let i = 0; i <= posts; i++) {
      const t = -len / 2 + (len * i) / posts;
      block(along ? c.x + t : c.x, along ? c.y : c.y + t, along ? 1 : w + 0.3, along ? d + 0.3 : 1, 0, OFFICE_HEIGHT, alu, 0, 'metal', 'bevel');
    }
  }
  // Puerta: hueco con dintel y una hoja corredera de cristal (abierta, sobre el tabique)
  const door = office.door;
  block(door.x, door.y, door.x1 - door.x0, 2, 22, OFFICE_HEIGHT - 22, '#d3d8de', 0, 'painted', 'bevel');
  block(door.x, door.y, door.x1 - door.x0, 2.2, 21.4, 0.6, alu, 0, 'metal');
  block(door.x0 - 8, door.y - 2.2, 18, 0.5, 22, 0.6, alu, 0, 'metal'); // guía
  glassBox(door.x0 - 7.5, door.y - 2.2, 15, 0.3, 0.8, 20.6);
  for (const x of [door.x0 - 15, door.x0]) block(x, door.y - 2.2, 0.8, 0.6, 0.6, 21.4, alu, 0, 'metal', 'bevel');
  block(door.x0 - 7.5, door.y - 2.2, 15, 0.6, 0.6, 0.8, alu, 0, 'metal');
  cyl(door.x0 - 1.4, 11, door.y - 2.7, 0.35, 5, 0.35, '#e1e4e8', 0, 0, 0, 'chrome'); // tirador
  sign('OFICINA', door.x, 25.4, door.y + 1.15, 0, 14, { bg: '#2b2f38', fg: '#ffd166' });
  // Techo propio con paneles LED empotrados y luz cálida
  block((room.x0 + room.x1 + 2) / 2, (room.y0 + room.y1 + 2) / 2, room.x1 - room.x0 + 2, room.y1 - room.y0 + 2, OFFICE_HEIGHT, 1.2, '#ece9e2', 0, 'matte');
  for (const [lx, lz] of [[26, 22], [60, 22], [26, 46], [60, 46]]) {
    block(room.x0 + lx, room.y0 + lz, 13, 9, OFFICE_HEIGHT - 0.25, 0.25, '#c7ccd3', 0, 'metal');
    glow(room.x0 + lx, OFFICE_HEIGHT - 0.3, room.y0 + lz, 12, 0.12, 8, '#fff7e8');
  }
  const officeLight = new THREE.PointLight('#fff2dc', 0.6, 90, 0);
  officeLight.position.set((room.x0 + room.x1) / 2, OFFICE_HEIGHT - 4, (room.y0 + room.y1) / 2);
  group.add(officeLight);
  // Sobre la moqueta (que está algo más alta que el suelo de la nave)
  shadowRect(office.desk, 0.45, 3, 0.8);
  shadowRect(office.cabinets, 0.45, 2.5, 0.8);
  shadowRect(office.bookcase, 0.45, 2.5, 0.8);
  shadowRect(office.plant, 0.35, 2, 0.8);

  // Mesa de trabajo
  const desk = office.desk;
  const dc = centerOf(desk);
  const dw = desk.x1 - desk.x0;
  const dd = desk.y1 - desk.y0;
  // Mesa de oficina: tablero de madera con canto, estructura de acero en "T" y buc de cajones
  rblock(dc.x, dc.y, dw, dd, TABLE_HEIGHT - 0.9, 0.9, '#b98b5e', 'wood');
  for (const x of [desk.x0 + 1.2, desk.x1 - 9.5]) {
    steel(x, dc.y, 1.2, dd - 1.6, 0.6, 0.5, '#3a3f47'); // pie
    steel(x, dc.y, 1.2, 1.2, 0.6, TABLE_HEIGHT - 1.5, '#3a3f47'); // columna
    steel(x, dc.y, 1.2, dd - 2, TABLE_HEIGHT - 1.6, 0.7, '#3a3f47'); // brazo bajo el tablero
  }
  block(dc.x - 2, desk.y0 + 1.2, dw - 10, 0.4, 2.4, TABLE_HEIGHT - 3.4, '#8f7a63', 0, 'wood'); // faldón
  rblock(desk.x1 - 4.4, dc.y, 7, dd - 1.2, 0.6, TABLE_HEIGHT - 1.6, '#e7e3dc', 'painted'); // buc
  for (const y of [1.0, 3.2, 5.4]) {
    block(desk.x1 - 4.4, desk.y1 - 0.62, 6.4, 0.12, y, 2, '#f1eee8', 0, 'painted', 'bevel');
    cyl(desk.x1 - 4.4, y + 1.5, desk.y1 - 0.45, 0.35, 2.2, 0.35, '#c8ccd2', 0, 0, Math.PI / 2, 'chrome');
  }
  // Ordenador: monitor fino con peana, teclado, ratón, altavoz, taza, papeles y lámpara de mesa
  const pc = office.computer;
  rblock(pc.x, pc.y - 0.7, 3.2, 2.2, TABLE_HEIGHT, 0.3, '#2a2e36', 'plastic'); // pie
  rblock(pc.x, pc.y - 0.95, 0.9, 0.5, TABLE_HEIGHT + 0.2, 2.8, '#3a3f47', 'metal'); // brazo
  rblock(pc.x, pc.y - 0.62, 9.6, 0.5, TABLE_HEIGHT + 1.85, 5.9, '#1b1e24', 'plastic'); // marco
  const monitorCanvas = makeCanvas(256, 160);
  const monitorTexture = toTexture(monitorCanvas);
  textures.push(monitorTexture);
  const monitorMaterial = new THREE.MeshBasicMaterial({ map: monitorTexture });
  ownMaterials.push(monitorMaterial);
  plane(8.8, 5.2, monitorMaterial, pc.x, TABLE_HEIGHT + 4.7, pc.y - 0.28);
  rblock(pc.x, pc.y + 2.4, 6.8, 2.2, TABLE_HEIGHT, 0.32, '#2b2f38', 'plastic'); // teclado
  for (let r = 0; r < 3; r++) block(pc.x, pc.y + 1.8 + r * 0.55, 6, 0.38, TABLE_HEIGHT + 0.32, 0.08, '#454b56', 0, 'plastic');
  rblock(pc.x + 4.9, pc.y + 2.6, 0.95, 1.4, TABLE_HEIGHT, 0.42, '#2b2f38', 'plastic'); // ratón
  rblock(pc.x + 4.9, pc.y + 2.6, 2.6, 2.6, TABLE_HEIGHT, 0.05, '#3a4a5c', 'fabric'); // alfombrilla
  cyl(pc.x - 8, TABLE_HEIGHT + 0.95, pc.y + 1.2, 1.4, 1.9, 1.4, '#e63946', 0, 0, 0, 'gloss', 'rcyl'); // taza
  piece(S, 'torus', pc.x - 8.75, TABLE_HEIGHT + 1, pc.y + 1.2, 0.9, 0.9, 1.6, '#e63946', 0, 0, 0, 'gloss'); // asa
  block(pc.x + 9, pc.y + 0.5, 3.4, 4.4, TABLE_HEIGHT, 0.25, '#f4f1ea', 0.2, 'matte');
  block(pc.x + 9.3, pc.y + 0.3, 3.4, 4.4, TABLE_HEIGHT + 0.25, 0.08, '#fbfaf6', -0.1, 'matte');
  // Lámpara de flexo en el extremo de la mesa
  cyl(desk.x0 + 3, TABLE_HEIGHT + 0.2, desk.y0 + 3, 2.2, 0.4, 2.2, '#2b2f38', 0, 0, 0, 'painted', 'rcyl');
  tube(desk.x0 + 3, TABLE_HEIGHT + 0.4, desk.y0 + 3, desk.x0 + 3.6, TABLE_HEIGHT + 6.5, desk.y0 + 3.4, 0.22, '#c8ccd2', 'chrome');
  tube(desk.x0 + 3.6, TABLE_HEIGHT + 6.5, desk.y0 + 3.4, desk.x0 + 6.5, TABLE_HEIGHT + 7.2, desk.y0 + 4.6, 0.2, '#c8ccd2', 'chrome');
  cyl(desk.x0 + 7, TABLE_HEIGHT + 6.6, desk.y0 + 4.8, 2, 1.6, 2, '#2b2f38', 0.5, 0, 0.2, 'painted', 'cone');
  // Silla de oficina giratoria (mirando a la mesa): base de cinco radios con ruedas, pistón y respaldo
  const ch = office.chair;
  for (let k = 0; k < 5; k++) {
    const a = (k * Math.PI * 2) / 5;
    block(ch.x + Math.cos(a) * 1.5, ch.y + Math.sin(a) * 1.5, 3, 0.55, 0.9, 0.45, '#2e3239', -a, 'plastic', 'rbox');
    sphere(ch.x + Math.cos(a) * 2.9, 0.95, ch.y + Math.sin(a) * 2.9, 0.75, 0.75, 0.6, '#151515', 'rubber');
  }
  cyl(ch.x, 2.9, ch.y, 0.7, 3.2, 0.7, '#c8ccd2', 0, 0, 0, 'chrome');
  cyl(ch.x, 1.7, ch.y, 1.0, 1.6, 1.0, '#2e3239', 0, 0, 0, 'plastic', 'rcyl');
  rblock(ch.x, ch.y, 5.4, 5.2, 4.4, 1.1, '#2b3a4a', 'fabric'); // asiento
  rblock(ch.x, ch.y + 2.6, 5, 0.9, 5.5, 6.6, '#2b3a4a', 'fabric', 0); // respaldo
  rblock(ch.x, ch.y + 2.9, 2.2, 0.6, 4.7, 1.4, '#2e3239', 'plastic'); // soporte del respaldo
  for (const s of [-1, 1]) {
    rblock(ch.x + s * 2.8, ch.y + 0.6, 0.7, 3.4, 6.6, 0.45, '#1f2228', 'rubber');
    rblock(ch.x + s * 2.8, ch.y + 1.6, 0.45, 0.45, 5.4, 1.3, '#2e3239', 'plastic');
  }
  // Archivadores metálicos con cajones, tiradores y portaetiquetas
  const cab = office.cabinets;
  const cabCount = 4;
  const cabLen = (cab.y1 - cab.y0) / cabCount;
  for (let i = 0; i < cabCount; i++) {
    const z = cab.y0 + cabLen * (i + 0.5);
    rblock((cab.x0 + cab.x1) / 2, z, cab.x1 - cab.x0, cabLen - 0.4, 0, 13, '#8a939f', 'painted');
    for (const y of [0.8, 4.8, 8.8]) {
      block(cab.x1 + 0.06, z, 0.14, cabLen - 1.4, y, 3.6, '#98a1ad', 0, 'painted', 'bevel');
      block(cab.x1 + 0.3, z, 0.42, 2.3, y + 2.6, 0.42, '#d0d4da', 0, 'chrome', 'rbox');
      block(cab.x1 + 0.16, z, 0.1, 1.6, y + 1.2, 0.8, '#f4f2ea', 0, 'matte');
    }
    if (i % 2 === 0) {
      for (let k = 0; k < 3; k++) rblock((cab.x0 + cab.x1) / 2, z - 1 + k * 1, 4.6, 0.85, 13, 3.4, ['#e63946', '#4cc9f0', '#90be6d'][(i + k) % 3], 'satin');
    }
  }
  // Librería de madera con libros de distintos tamaños, archivadores y una caja
  const bk = office.bookcase;
  const bc = centerOf(bk);
  const bookColors = ['#2a6f97', '#b23a3a', '#d9a441', '#2a9d8f', '#6a4c93', '#d98a52', '#264653', '#c9b26a'];
  block(bk.x0 + 0.5, bc.y, 1, bk.y1 - bk.y0, 0, 22, '#8a6a4a', 0, 'wood', 'bevel');
  block(bk.x1 - 0.5, bc.y, 1, bk.y1 - bk.y0, 0, 22, '#8a6a4a', 0, 'wood', 'bevel');
  block(bc.x, bk.y0 + 0.3, bk.x1 - bk.x0, 0.6, 0, 22, '#6f523a', 0, 'wood');
  const bookBoards = [0.4, 5.8, 11.2, 16.6, 21.4];
  for (const y of bookBoards) block(bc.x, bc.y, bk.x1 - bk.x0, bk.y1 - bk.y0, y, 0.6, '#8a6a4a', 0, 'wood', 'bevel');
  for (const y of bookBoards.slice(0, 4)) {
    let x = bk.x0 + 1.3;
    while (x < bk.x1 - 2.2) {
      const w = 0.7 + rng() * 0.8;
      const h = 3 + rng() * 1.7;
      if (rng() < 0.08) { x += 2.5; continue; }
      const lean = rng() < 0.06 ? 0.25 : 0;
      piece(S, 'rbox', x + w / 2, y + 0.6 + h / 2, bk.y0 + 0.6 + 2.6, w, h, 4.6 + rng() * 0.8,
        bookColors[Math.floor(rng() * bookColors.length)], 0, 0, lean, 'satin');
      x += w + 0.1 + lean * 2;
    }
  }
  // Planta en maceta: tierra, tallos y hojas alargadas en abanico
  const pl = centerOf(office.plant);
  cyl(pl.x, 2.7, pl.y, 6.2, 5.2, 6.2, '#b86a42', 0, 0, 0, 'satin', 'rcyl');
  cyl(pl.x, 5.2, pl.y, 5.6, 0.3, 5.6, '#3e2c20', 0, 0, 0, 'matte');
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + rng() * 0.4;
    const tilt = 0.45 + rng() * 0.35;
    const len = 6 + rng() * 3;
    const lx = pl.x + Math.cos(a) * Math.sin(tilt) * len * 0.5;
    const lz = pl.y + Math.sin(a) * Math.sin(tilt) * len * 0.5;
    const ly = 5.4 + Math.cos(tilt) * len * 0.5;
    piece(S, 'sphere', lx, ly, lz, 1.6, len, 0.5, k % 2 ? '#3f8a46' : '#2f6b3a', Math.sin(a) * tilt, -a, -Math.cos(a) * tilt, 'satin');
  }
  // Pizarra en la cara interior del tabique este
  const wb = office.whiteboard;
  const wbz = (wb.y0 + wb.y1) / 2;
  const wbLen = wb.y1 - wb.y0;
  block(wb.x - 0.3, wbz, 0.5, wbLen + 1, 9.5, 11, alu, 0, 'metal', 'bevel');
  block(wb.x - 1.1, wbz, 1.2, wbLen * 0.6, 9.2, 0.4, alu, 0, 'metal');
  for (const [k, c] of [[0, '#1d3557'], [1, '#e63946'], [2, '#2a9d8f']]) cyl(wb.x - 1.2, 9.85, wbz - 4 + k * 1.6, 0.4, 2.4, 0.4, c, 0, 0, Math.PI / 2, 'plastic');
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
  block(inner.x0 + 0.5, winZ, 1, cab.y1 - cab.y0, 15.4, 0.8, alu, 0, 'metal', 'bevel');
  block(inner.x0 + 0.5, winZ, 1, cab.y1 - cab.y0, 26, 0.7, alu, 0, 'metal', 'bevel');
  block(inner.x0 + 1, winZ, 2, cab.y1 - cab.y0 + 1, 14.9, 0.5, '#e9e6df', 0, 'satin', 'bevel'); // alféizar
  for (const t of [-0.5, -0.17, 0.17, 0.5]) block(inner.x0 + 0.5, winZ + t * (cab.y1 - cab.y0 - 1), 0.9, 0.7, 15.4, 11.2, alu, 0, 'metal', 'bevel');
  const nwX0 = desk.x0 - 10;
  const nwX1 = desk.x1;
  plane(nwX1 - nwX0, 9, windowMaterial, (nwX0 + nwX1) / 2, 21.5, inner.y0 + 0.06);
  block((nwX0 + nwX1) / 2, inner.y0 + 0.5, nwX1 - nwX0, 1, 16.3, 0.8, alu, 0, 'metal', 'bevel');
  block((nwX0 + nwX1) / 2, inner.y0 + 0.5, nwX1 - nwX0, 1, 26, 0.7, alu, 0, 'metal', 'bevel');
  for (const t of [0, 0.25, 0.5, 0.75, 1]) block(nwX0 + t * (nwX1 - nwX0), inner.y0 + 0.5, 0.7, 0.9, 16.3, 10.4, alu, 0, 'metal', 'bevel');

  // ------------------------------------------------------------------ Estanterías de stock ----
  const UPRIGHT = '#2c5aa0'; // bastidores azules
  const BEAM = '#e2711d'; // largueros naranjas
  const DECK = '#b9bfc7'; // bandeja de malla galvanizada
  /**
   * Estantería de carga: bastidores con placas de anclaje y celosía en los laterales, largueros delante y
   * detrás de cada nivel, bandejas de malla y etiquetas de ubicación. "levels": alturas de cada bandeja
   * (su cara superior queda en y + 0.8, donde se apoya la mercancía).
   */
  const rackFrame = (r, levels, height, { uprightColor = UPRIGHT, beamColor = BEAM, labels = true } = {}) => {
    const along = r.x1 - r.x0 >= r.y1 - r.y0;
    const len = along ? r.x1 - r.x0 : r.y1 - r.y0;
    const depth = along ? r.y1 - r.y0 : r.x1 - r.x0;
    const c = centerOf(r);
    // Coordenadas locales: a = a lo largo, s = fondo (de -depth/2 a +depth/2)
    const at = (a, s) => (along ? [c.x + a, c.y + s] : [c.x + s, c.y + a]);
    const frames = len > 26 ? [-len / 2 + 0.7, 0, len / 2 - 0.7] : [-len / 2 + 0.7, len / 2 - 0.7];
    for (const a of frames) {
      for (const s of [-depth / 2 + 0.7, depth / 2 - 0.7]) {
        const [px, pz] = at(a, s);
        steel(px, pz, 1.3, 1.3, 0, height, uprightColor);
        block(px, pz, 2.2, 2.2, 0.6, 0.25, '#7d848d', 0, 'metal'); // placa de anclaje
      }
      // Celosía del bastidor (en el plano del fondo)
      const [fx0, fz0] = at(a, -depth / 2 + 0.7);
      const [fx1, fz1] = at(a, depth / 2 - 0.7);
      const ys = [];
      for (let y = 2; y < height - 3; y += 7) ys.push(y);
      ys.push(height - 1.5);
      for (let i = 0; i < ys.length - 1; i++) {
        const [x0, z0, x1, z1] = i % 2 ? [fx1, fz1, fx0, fz0] : [fx0, fz0, fx1, fz1];
        tube(x0, ys[i], z0, x1, ys[i + 1], z1, 0.22, uprightColor);
        tube(fx0, ys[i], fz0, fx1, ys[i], fz1, 0.22, uprightColor);
      }
    }
    for (const y of levels) {
      // Largueros delantero y trasero (su cara de arriba enrasa con la bandeja)
      for (const s of [-depth / 2 + 0.55, depth / 2 - 0.55]) {
        const [bx, bz] = at(0, s);
        block(bx, bz, along ? len - 0.4 : 1.1, along ? 1.1 : len - 0.4, y - 0.5, 1.3, beamColor, 0, 'painted', 'bevel');
      }
      const [dx, dz] = at(0, 0);
      block(dx, dz, along ? len - 1.6 : depth - 2, along ? depth - 2 : len - 1.6, y + 0.5, 0.3, DECK, 0, 'metal');
      for (let k = -len / 2 + 3; k < len / 2 - 1; k += 5) {
        const [mx, mz] = at(k, 0);
        block(mx, mz, along ? 0.4 : depth - 2, along ? depth - 2 : 0.4, y + 0.2, 0.3, '#8f969f', 0, 'metal'); // refuerzos
      }
      if (labels) {
        for (const k of [-len / 4, len / 4]) {
          const [lx, lz] = at(k, depth / 2 - 0.02);
          block(lx, lz, along ? 3 : 0.1, along ? 0.1 : 3, y - 0.2, 0.8, '#f4f2ea', 0, 'matte');
        }
      }
    }
    shadowRect(r, 0.55, 3);
  };
  for (const shelf of L.shelves) {
    const r = shelf.rect;
    const info = getShelf(shelf.id);
    const along = r.x1 - r.x0 >= r.y1 - r.y0;
    const len = along ? r.x1 - r.x0 : r.y1 - r.y0;
    const depth = along ? r.y1 - r.y0 : r.x1 - r.x0;
    const c = centerOf(r);
    const levels = [0.8, 10.4, 20];
    rackFrame(r, [...levels, SHELF_HEIGHT - 1], SHELF_HEIGHT);
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
    // Palé europeo: patines, tacos y tablas de madera (la mercancía va encima a 1,7 de altura)
    for (const k of [0.08, 0.5, 0.92]) block(c.x, r.y0 + d * k, w, 1.8, 0.6, 0.35, '#9b7448', 0, 'wood', 'bevel');
    for (const kx of [0.06, 0.5, 0.94]) for (const kz of [0.08, 0.5, 0.92]) block(r.x0 + w * kx, r.y0 + d * kz, 1.8, 1.8, 0.95, 0.4, '#8a6640', 0, 'wood', 'bevel');
    for (let k = 0; k < 7; k++) block(c.x, r.y0 + 0.9 + k * ((d - 1.8) / 6), w, 1.5, 1.35, 0.35, k % 3 ? '#c49a68' : '#b78a5a', 0, 'wood', 'bevel');
    shadowRect(r, 0.5, 2.5);
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
  // Puerta seccional de recepción: lamas de chapa, guías, cajón del motor y botonera
  const rd = rec.rollerDoor;
  const rdc = (rd.x0 + rd.x1) / 2;
  const rdw = rd.x1 - rd.x0;
  block(rdc, rd.y + 0.4, rdw, 0.8, 0, 30, '#a9b1bb', 0, 'metal');
  for (let y = 1.5; y < 30; y += 2) block(rdc, rd.y + 0.9, rdw, 0.35, y, 0.45, '#8c949e', 0, 'metal', 'bevel');
  block(rdc, rd.y + 0.95, rdw - 2, 0.3, 0.6, 1.2, '#2b2b2b', 0, 'rubber'); // burlete
  rblock(rdc, rd.y + 1.8, rdw + 3, 3.6, 30, 3.6, '#6c757d', 'painted');
  for (const x of [rd.x0 - 0.8, rd.x1 + 0.8]) {
    steel(x, rd.y + 0.8, 1.5, 1.7, 0, 33.4, '#ffb703');
    for (let y = 2; y < 32; y += 6) block(x, rd.y + 0.8, 1.6, 1.8, y, 3, '#1f1f1f', 0, 'painted');
  }
  rblock(rd.x1 + 4, rd.y + 0.9, 2.4, 1.2, 11, 4, '#e8e8e8', 'plastic'); // botonera
  for (const [k, c] of [[0, '#2bb24c'], [1, '#e63946']]) cyl(rd.x1 + 4, 13.8 - k * 1.6, rd.y + 1.6, 0.8, 0.5, 0.8, c, Math.PI / 2, 0, 0, 'plastic');
  for (let i = 0; i < 6; i++) block(rd.x0 + 2 + i * 4, rd.y + 3.2, 2, 3, 0.6, 0.08, i % 2 ? '#1f1f1f' : '#ffb703', 0, 'satin');
  sign('RECEPCIÓN', rdc, 37.5, rd.y + 0.3, 0, 24, { bg: '#90be6d' });
  // Pilares de hormigón con protectores de impacto a rayas
  for (const col of L.columns) {
    rectBlock(col, 0, CEILING, '#bfc3c8', 0, 'matte', 'bevel');
    rectBlock(grow(col, 0.3), 0.6, 3.2, '#ffb703', 0, 'painted', 'rbox');
    rectBlock(grow(col, 0.32), 3.8, 1.2, '#1f1f1f', 0, 'painted', 'rbox');
    rectBlock(grow(col, 0.3), 5, 2.6, '#ffb703', 0, 'painted', 'rbox');
    shadowRect(col, 0.45, 2);
  }

  // ------------------------------------------------------------------ Cinta transportadora ----
  const half = BELT_WIDTH / 2;
  const segs = L.belt.segments;
  // Banda de goma negra con tacos transversales y el desgaste del centro (se desplaza cada fotograma)
  const beltCanvas = makeCanvas(64, 64);
  {
    const ctx = beltCanvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, '#1d2025');
    g.addColorStop(0.5, '#2a2e35');
    g.addColorStop(1, '#1d2025');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 0; y < 64; y += 4) ctx.fillRect(0, y, 64, 1);
    ctx.fillStyle = '#3a3f47';
    ctx.fillRect(0, 0, 64, 6);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 6, 64, 2);
  }
  const beltTexture = toTexture(beltCanvas, { repeat: true });
  textures.push(beltTexture);
  const beltMaterialFor = (texture) => standard({ map: texture, roughness: 0.88, metalness: 0 });
  const surfaces = [];
  const FRAME = '#5f6b7a';
  const along = (seg, t, side = 0) => ({ x: seg.a.x + seg.dir.x * t - seg.dir.y * side, z: seg.a.y + seg.dir.y * t + seg.dir.x * side });
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
    const surface = plane(BELT_WIDTH - 1.6, len, beltMaterialFor(texture), cx, BELT_HEIGHT, cz, Math.atan2(seg.dir.x, seg.dir.y), -Math.PI / 2);
    surfaces.push({ texture, mesh: surface });
    // Cama de deslizamiento bajo la banda y rodillos de retorno a la vista por debajo
    const b0 = prev ? -half : 0;
    const b1 = seg.len + (next ? half : 0);
    const bm = (b0 + b1) / 2;
    const bc = along(seg, bm);
    piece(S, 'box', bc.x, BELT_HEIGHT - 0.3, bc.z, b1 - b0, 0.5, BELT_WIDTH - 1.2, '#9aa1aa', 0, yaw, 0, 'metal');
    for (let t = b0 + 3; t < b1 - 1; t += 6) {
      const a = along(seg, t, -(half - 0.9));
      const b = along(seg, t, half - 0.9);
      tube(a.x, BELT_HEIGHT - 3.2, a.z, b.x, BELT_HEIGHT - 3.2, b.z, 0.5, '#b4bac2', 'metal'); // cuelgan bajo el larguero
    }
    // Largueros laterales en "C" y barandillas de guiado (en las esquinas la interior se acorta)
    for (const s of [-1, 1]) {
      const ns = { x: n.x * s, y: n.y * s };
      const startExt = prev ? ((ns.x * -prev.dir.x + ns.y * -prev.dir.y) > 0 ? -half : half) : 0;
      const endExt = next ? ((ns.x * next.dir.x + ns.y * next.dir.y) > 0 ? -half : half) : 0;
      const r0 = -startExt;
      const r1 = seg.len + endExt;
      const rm = (r0 + r1) / 2;
      const off = half - 0.35;
      const rp = along(seg, rm, s * off);
      piece(S, 'bevel', rp.x, BELT_HEIGHT - 1.15, rp.z, r1 - r0, 2.9, 0.6, FRAME, 0, yaw, 0, 'painted');
      const lip = along(seg, rm, s * (off - 0.45));
      piece(S, 'box', lip.x, BELT_HEIGHT + 0.25, lip.z, r1 - r0, 0.3, 0.5, '#7a8594', 0, yaw, 0, 'painted');
      // Barandilla amarilla sobre soportes
      const rail = along(seg, rm, s * (off + 0.1));
      piece(S, 'rcyl', rail.x, BELT_HEIGHT + 2.1, rail.z, 0.7, r1 - r0, 0.7, '#ffb703', 0, yaw, Math.PI / 2, 'painted');
      for (let t = r0 + 1; t <= r1 - 0.5; t += 8) {
        const p = along(seg, t, s * (off + 0.1));
        block(p.x, p.z, 0.45, 0.45, BELT_HEIGHT + 0.3, 1.6, '#8f969f', 0, 'metal');
      }
    }
    // Patas en "H" con travesaño, tirante en cruz y pies niveladores
    const legAt = (t) => {
      const l = along(seg, t, -(half - 0.6));
      const r = along(seg, t, half - 0.6);
      for (const p of [l, r]) {
        steel(p.x, p.z, 1, 1, 0.6, BELT_HEIGHT - 3.2, FRAME);
        cyl(p.x, 0.85, p.z, 1.6, 0.5, 1.6, '#2b2b2b', 0, 0, 0, 'rubber', 'rcyl');
      }
      tube(l.x, 2.6, l.z, r.x, 2.6, r.z, 0.35, FRAME);
      tube(l.x, 1.2, l.z, r.x, BELT_HEIGHT - 2.8, r.z, 0.22, FRAME);
    };
    const legStart = prev ? -half + 1 : 1.5;
    const legEnd = seg.len + (next ? half - 1 : -1.5);
    for (let t = legStart; t < legEnd - 4; t += 16) legAt(t);
    legAt(legEnd);
    shadowUnder(Math.min(seg.a.x, seg.b.x) - half, Math.min(seg.a.y, seg.b.y) - half, Math.max(seg.a.x, seg.b.x) + half, Math.max(seg.a.y, seg.b.y) + half, 0.35, 2);
  });
  // Tambores de los extremos (motriz en la entrada, de reenvío al final)
  const first = segs[0];
  const last = segs[segs.length - 1];
  cyl(first.a.x, BELT_HEIGHT - 1, first.a.y, 2.4, BELT_WIDTH - 1.2, 2.4, '#a7adb5', 0, yawOf(first.dir) + Math.PI / 2, Math.PI / 2, 'metal', 'rcyl');
  cyl(last.b.x, BELT_HEIGHT - 1, last.b.y, 2.4, BELT_WIDTH - 1.2, 2.4, '#a7adb5', 0, yawOf(last.dir) + Math.PI / 2, Math.PI / 2, 'metal', 'rcyl');
  // Motorreductor junto al tambor motriz, por el lado exterior
  {
    const side = -(half + 2.2);
    const m = along(first, 4, side);
    // El eje del motor va en línea con el del tambor (atravesado a la cinta)
    cyl(m.x, BELT_HEIGHT - 2, m.z, 3, 5, 3, '#2f62a8', 0, yawOf(first.dir) + Math.PI / 2, Math.PI / 2, 'painted', 'rcyl');
    const gb = along(first, 4, -(half + 0.6));
    block(gb.x, gb.z, 3.2, 1.8, BELT_HEIGHT - 3.6, 3.4, '#2a4f86', yawOf(first.dir), 'painted', 'rbox');
    const fan = along(first, 4, side - 2.6);
    cyl(fan.x, BELT_HEIGHT - 2, fan.z, 2.6, 0.5, 2.6, '#1f2a3a', 0, yawOf(first.dir) + Math.PI / 2, Math.PI / 2, 'painted');
    steel(m.x, m.z, 3, 3, 0.6, BELT_HEIGHT - 4, FRAME, yawOf(first.dir));
  }
  // Tolva de entrada desde recepción, con cortina de tiras
  {
    const a = first.a;
    const dx = first.dir.x;
    const dz = first.dir.y;
    const back = { x: a.x - dx * 3, y: a.y - dz * 3 };
    const nx = -dz;
    const nz = dx;
    for (const s of [-1, 1]) {
      piece(S, 'bevel', back.x + nx * s * (half - 0.35), BELT_HEIGHT + 3.5, back.y + nz * s * (half - 0.35), 6, 9.4, 0.7, '#6c757d', 0, yawOf(first.dir), 0, 'painted');
    }
    piece(S, 'bevel', back.x, BELT_HEIGHT + 8.4, back.y, 6, 0.8, BELT_WIDTH, '#6c757d', 0, yawOf(first.dir), 0, 'painted');
    // Cortina de lamas de PVC translúcido
    for (let k = 0; k < 5; k++) {
      const t = -half + 1.6 + k * 1.7;
      piece(S, 'box', a.x + nx * t, BELT_HEIGHT + 4.2, a.y + nz * t, 0.12, 7.6, 1.6, '#a9d3e8', 0, yawOf(first.dir), 0, 'glass');
    }
  }
  // Seta de emergencia en la esquina
  {
    const corner = segs[0].b;
    const cxp = corner.x + (segs[0].dir.x - segs[1].dir.x) * (half + 0.6);
    const czp = corner.y + (segs[0].dir.y - segs[1].dir.y) * (half + 0.6);
    steel(cxp, czp, 1.2, 1.2, 0.6, BELT_HEIGHT, '#5f6b7a');
    rblock(cxp, czp, 2, 2, BELT_HEIGHT, 1.8, '#ffb703', 'plastic');
    cyl(cxp, BELT_HEIGHT + 2.1, czp, 1.4, 0.6, 1.4, '#e63946', 0, 0, 0, 'gloss', 'rcyl');
  }

  // Cajón de fin de línea
  const bin = L.bin.rect;
  const binC = centerOf(bin);
  const bw = bin.x1 - bin.x0;
  const bd = bin.y1 - bin.y0;
  const plastic = '#2f6db5';
  // Contenedor de plástico rígido con borde reforzado y ruedas
  rectBlock(bin, 0.6, 0.1, '#25578f', 0.6, 'plastic'); // fondo (los productos se apoyan a 0,7)
  block(binC.x, bin.y0 + 0.4, bw, 0.8, 0.6, BIN_HEIGHT - 0.6, plastic, 0, 'plastic', 'rbox');
  block(binC.x, bin.y1 - 0.4, bw, 0.8, 0.6, BIN_HEIGHT - 0.6, plastic, 0, 'plastic', 'rbox');
  block(bin.x0 + 0.4, binC.y, 0.8, bd, 0.6, BIN_HEIGHT - 0.6, plastic, 0, 'plastic', 'rbox');
  block(bin.x1 - 0.4, binC.y, 0.8, bd, 0.6, BIN_HEIGHT - 3.1, plastic, 0, 'plastic', 'rbox'); // lado de la cinta, más bajo
  block(binC.x, bin.y0 + 0.4, bw + 0.4, 1.2, BIN_HEIGHT - 0.3, 0.6, '#285f9f', 0, 'plastic', 'rbox'); // borde
  block(binC.x, bin.y1 - 0.4, bw + 0.4, 1.2, BIN_HEIGHT - 0.3, 0.6, '#285f9f', 0, 'plastic', 'rbox');
  for (const x of [bin.x0 + 1, bin.x1 - 1]) block(x, bin.y1 + 0.3, 0.5, 0.5, BIN_HEIGHT, 6.4, '#3a3f47', 0, 'painted', 'bevel');
  shadowRect(bin, 0.5, 2);
  sign('FIN DE LÍNEA', binC.x, BIN_HEIGHT + 5.4, bin.y1 + 0.6, 0, 14, { bg: '#4cc9f0' });

  // ------------------------------------------------------------------ Mesas ----
  // Banco de trabajo: tablero de madera maciza, estructura de tubo de acero con faldones, balda inferior
  // de chapa, travesaños y pies niveladores
  const BENCH = '#4a5260';
  const table = (r) => {
    const c = centerOf(r);
    const w = r.x1 - r.x0;
    const d = r.y1 - r.y0;
    rectBlock(r, TABLE_HEIGHT - 1.2, 1.2, '#c48d58', 0, 'wood', 'bevel');
    const legs = [[r.x0 + 1.5, r.y0 + 1.5], [r.x1 - 1.5, r.y0 + 1.5], [r.x0 + 1.5, r.y1 - 1.5], [r.x1 - 1.5, r.y1 - 1.5]];
    for (const [px, pz] of legs) {
      steel(px, pz, 1.4, 1.4, 1.1, TABLE_HEIGHT - 2.3, BENCH);
      cyl(px, 0.85, pz, 1.4, 0.5, 1.4, '#222222', 0, 0, 0, 'rubber', 'rcyl');
    }
    for (const z of [r.y0 + 1.5, r.y1 - 1.5]) steel(c.x, z, w - 3, 0.6, TABLE_HEIGHT - 2.1, 0.9, BENCH); // faldones
    for (const x of [r.x0 + 1.5, r.x1 - 1.5]) steel(x, c.y, 0.6, d - 3, 2.6, 0.7, BENCH); // travesaños
    rectBlock(r, 2.0, 0.5, '#8f969f', 1.6, 'metal'); // balda inferior
    shadowRect(r, 0.5, 2.5);
    return c;
  };
  const playerArea = { x0: T.x0 + 1, y0: T.y0 + 1, x1: T.x1 - 10, y1: T.y1 - 1 };
  {
    table(T);
    // Material de embalar en el extremo derecho: cartones plegados, portarrollos de precinto y cúter
    rblock(T.x1 - 5, T.y0 + 4.5, 8, 7, TABLE_HEIGHT, 1.4, '#d8b07c', 'cardboard');
    rblock(T.x1 - 5.2, T.y0 + 4.3, 8, 7, TABLE_HEIGHT + 1.4, 1.2, '#c99a62', 'cardboard');
    rblock(T.x1 - 5, T.y1 - 3, 3.4, 2.4, TABLE_HEIGHT, 1.6, '#3a3f47', 'painted');
    cyl(T.x1 - 5, TABLE_HEIGHT + 2.2, T.y1 - 3, 2, 1.6, 2, '#e0bb7f', Math.PI / 2, 0, 0, 'plastic', 'rcyl');
    rblock(T.x1 - 2, T.y1 - 6, 0.8, 2.4, TABLE_HEIGHT, 0.5, '#f2c200', 'plastic'); // cúter
    // Panel perforado al fondo con herramientas, balda con impresora de etiquetas y luz de trabajo
    for (const x of [T.x0 + 1.2, T.x1 - 1.2]) steel(x, T.y1 - 0.6, 1, 1, TABLE_HEIGHT, 13, BENCH);
    block((T.x0 + T.x1) / 2, T.y1 - 0.5, T.x1 - T.x0 - 2.4, 0.3, TABLE_HEIGHT + 1.5, 9.5, '#d9dde2', 0, 'painted');
    for (let x = T.x0 + 3; x < T.x1 - 2; x += 2) {
      for (let y = TABLE_HEIGHT + 2.5; y < TABLE_HEIGHT + 10.5; y += 2) block(x, T.y1 - 0.66, 0.35, 0.05, y, 0.35, '#7d848d', 0, 'matte');
    }
    rblock(T.x0 + 6, T.y1 - 1.2, 3, 1.1, TABLE_HEIGHT + 5, 2, '#d62828', 'plastic'); // pistola de precinto
    cyl(T.x0 + 6.6, TABLE_HEIGHT + 6.8, T.y1 - 1.2, 2.2, 1.2, 2.2, '#e0bb7f', Math.PI / 2, 0, 0, 'plastic', 'rcyl');
    rblock(T.x0 + 11, T.y1 - 1, 0.8, 0.5, TABLE_HEIGHT + 4, 3.5, '#2b2f38', 'plastic'); // tijeras
    for (const [k, c] of [[0, '#1d3557'], [1, '#e63946']]) cyl(T.x0 + 14 + k, TABLE_HEIGHT + 6, T.y1 - 0.9, 0.5, 3, 0.5, c, 0, 0, 0, 'plastic'); // rotuladores
    block((T.x0 + T.x1) / 2, T.y1 - 2, T.x1 - T.x0 - 2.4, 3.4, TABLE_HEIGHT + 11, 0.5, '#8f969f', 0, 'metal', 'bevel'); // balda
    rblock(T.x1 - 9, T.y1 - 2.2, 4, 3, TABLE_HEIGHT + 11.5, 2.6, '#e9e9e9', 'plastic'); // impresora
    block(T.x1 - 9, T.y1 - 3.75, 2.4, 0.1, TABLE_HEIGHT + 12, 1.2, '#f8f8f4', 0, 'matte');
    glow((T.x0 + T.x1) / 2, TABLE_HEIGHT + 10.85, T.y1 - 2, T.x1 - T.x0 - 6, 0.25, 0.8, '#fff6e2'); // regleta LED
    const tc = centerOf(T);
    for (const x of [tc.x - 10, tc.x + 10]) block(x, tc.y, 0.2, 0.2, 26, CEILING - 26, '#3a3f47');
    sign('TU MESA · EMPAQUETADO', tc.x, 24.5, tc.y, 0, 26, { double: true });
  }
  for (const t of L.tables.slice(1)) {
    const c = table(t.rect);
    // Portarrollos compartido al final y una franja blanca que separa los dos puestos sobre el tablero
    rblock(t.rect.x1 - 2, c.y, 2.6, 2, TABLE_HEIGHT, 1.4, '#3a3f47', 'painted');
    cyl(t.rect.x1 - 2, TABLE_HEIGHT + 2, c.y, 1.6, 1.4, 1.6, '#e0bb7f', Math.PI / 2, 0, 0, 'plastic', 'rcyl');
    block((t.rect.x0 + t.rect.x1 - 4) / 2, c.y, t.rect.x1 - t.rect.x0 - 4, 0.3, TABLE_HEIGHT, 0.04, '#f4f1ea', 0, 'satin');
  }
  const stationAreas = L.stations.map((s) => ({ x0: s.surface.x0 + 1, y0: s.surface.y0 + 0.6, x1: s.surface.x1 - 4, y1: s.surface.y1 - 0.6 }));

  // ------------------------------------------------------------------ Expedición ----
  const rackC = centerOf(rk);
  // Estantería baja de expedición: bastidores grises y largueros amarillos de seguridad (dos niveles)
  rackFrame(rk, [0.8, RACK_HEIGHT - 0.8], RACK_HEIGHT + 1, { uprightColor: '#3a3f47', beamColor: '#ffb703', labels: false });
  // Bandera colgante y cartel; cinta antigolpes en las esquinas
  sign('EXPEDICIÓN · cajas listas', rk.x0 - 0.4, RACK_HEIGHT + 12, rackC.y, -Math.PI / 2, 30);
  for (const z of [rk.y0 + 3, rk.y1 - 3]) tube(rk.x0 - 0.4, RACK_HEIGHT + 15, z, rk.x0 - 0.4, CEILING - 7, z, 0.1, '#2b2f36', 'metal');
  for (const z of [rk.y0 - 0.2, rk.y1 + 0.2]) block(rk.x0 - 0.2, z, 1.4, 1.4, 0.6, 3, '#ffb703', 0, 'painted', 'rbox');
  // Transpaleta aparcada junto a la pared, detrás de la estantería (decorado, fuera del paso)
  {
    const px = rk.x1 - 6;
    const pz = rk.y0 - 7;
    for (const s of [-1.6, 1.6]) block(px - 3, pz + s, 9, 1.4, 0.6, 0.8, '#d62828', 0, 'painted', 'bevel'); // horquillas
    rblock(px + 2.6, pz, 2.6, 5, 0.6, 3.2, '#d62828', 'painted');
    tube(px + 3, 3.4, pz, px + 6, 11, pz, 0.35, '#2b2f36', 'painted');
    rblock(px + 6.2, pz, 1, 3.6, 10.6, 1, '#2b2f36', 'rubber');
    for (const s of [-1.6, 1.6]) cyl(px - 6.5, 0.95, pz + s, 0.8, 1, 0.8, '#3a3a3a', Math.PI / 2, 0, 0, 'rubber');
  }

  // ------------------------------------------------------------------ Pantalla de pedidos (puerta) ----
  // Panel de salidas colgado por dentro sobre la entrada, mirando a la nave: se lee al volver hacia la salida
  // y desde las mesas. Su borde inferior queda por encima de la cabeza incluso saltando.
  const boardBottom = BOARD_TOP - BOARD_H;
  const boardZ = inner.y1 - 2.2; // delante de la carcasa, que a su vez queda por delante de la viga de la fachada
  block(L.doorX, inner.y1 - 1.25, BOARD_W + 2, 1.6, boardBottom - 1, BOARD_H + 2, '#1d2230', 0, 'plastic', 'rbox'); // carcasa
  block(L.doorX, inner.y1 - 2.15, BOARD_W + 2.2, 0.2, boardBottom - 1.3, 0.5, '#3a3f47', 0, 'metal'); // repisa inferior
  for (const dx of [-BOARD_W / 2 + 6, BOARD_W / 2 - 6]) block(L.doorX + dx, inner.y1 - 0.25, 2, 0.5, BOARD_TOP - 1.5, 2.5, '#5c6673', 0, 'painted'); // soportes
  const ordersCanvas = makeCanvas(BOARD_PX_W, BOARD_PX_H);
  const ordersTexture = toTexture(ordersCanvas);
  textures.push(ordersTexture);
  const ordersMaterial = new THREE.MeshBasicMaterial({ map: ordersTexture }); // sin iluminar: siempre se lee
  ownMaterials.push(ordersMaterial);
  plane(BOARD_W, BOARD_H, ordersMaterial, L.doorX, boardBottom + BOARD_H / 2, boardZ, Math.PI);

  // Sombras de contacto: una sola malla instanciada de planos con un degradado difuso (oclusión barata)
  if (contactShadows.length) {
    const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    ownGeometries.push(geometry);
    const material = new THREE.MeshBasicMaterial({
      color: '#000000', alphaMap: contactShadowTexture(), transparent: true, opacity: 0.42, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    });
    ownMaterials.push(material);
    const mesh = new THREE.InstancedMesh(geometry, material, contactShadows.length);
    contactShadows.forEach((s, i) => {
      obj.position.set(s.x, s.y, s.z);
      obj.rotation.set(0, 0, 0);
      obj.scale.set(s.w, 1, s.d);
      obj.updateMatrix();
      mesh.setMatrixAt(i, obj.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  S.end();
  G.end();
  group.add(S.group, G.group);
  disposables.push(S, G);

  // ------------------------------------------------------------------ Parte dinámica ----
  const dyn = new PartBatch({ box: 900, rbox: 500, bevel: 120, cyl: 260, rcyl: 160, sphere: 120, torus: 32, cone: 32, tire: 16, bottle: 16, vase: 16 });
  group.add(dyn.group);
  disposables.push(dyn);
  const charLayer = new THREE.Group();
  group.add(charLayer);
  const characters = new Map();
  const rel = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const inv = new THREE.Matrix4();
  let monitorTimer = 0;
  let boardTimer = 0;
  let boardBlink = false;
  let boardDrawn = false;
  const boardCenter = { x: L.doorX, y: inner.y1 };

  /** Repinta la pantalla de pedidos si la persona o el vehículo están lo bastante cerca para verla. */
  const updateBoard = (game, dt) => {
    boardTimer -= dt;
    if (boardTimer > 0) return;
    boardTimer = BOARD_REDRAW;
    const focus = game.getFocus?.() ?? game.state.player;
    if (boardDrawn && distance(focus.x, focus.y, boardCenter.x, boardCenter.y) > BOARD_VIEW_DISTANCE) return;
    boardBlink = !boardBlink;
    drawOrdersBoard(ordersCanvas.getContext('2d'), game, { blink: boardBlink });
    ordersTexture.needsUpdate = true;
    boardDrawn = true;
  };

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
      // (también las que ya ha reservado un repartidor que viene a por ellas)
      for (const order of [...rackBoxes(state), ...reservedOnRack(game)]) {
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
      updateBoard(game, dt);
    },
    dispose() {
      for (const material of ownMaterials) {
        releaseEnvironment(material);
        material.dispose();
      }
      for (const geometry of ownGeometries) geometry.dispose();
      for (const texture of textures) texture.dispose();
      for (const d of disposables) d.dispose();
      for (const c of characters.values()) c.dispose();
      characters.clear();
    },
  };
}
