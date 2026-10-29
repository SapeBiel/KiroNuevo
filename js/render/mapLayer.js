// Capa estática del mapa: calles, manzanas, edificios y zonas bloqueadas.
// Se pinta una vez en un canvas fuera de pantalla y se vuelve a pintar al desbloquear zonas.

import { TILE } from '../config/constants.js';
import { ZONES } from '../config/zones.js';
import { createRng } from '../core/random.js';
import { drawBrandMark, roundRect, shade } from './sprites.js';
import { DEFAULT_COMPANY, brandTitle, contrastText } from '../systems/branding.js';
import { hasGarden, houseLayout, villaLayout } from '../world/lotLayout.js';

export const STATIC_SCALE = 1.5;
const MAX_CANVAS = 4096;

/** Escala del mapa estático: 1,5 si cabe, menos en ciudades grandes (límite de memoria del canvas). */
function staticScale(city, wanted = STATIC_SCALE) {
  return Math.min(wanted, MAX_CANVAS / Math.max(city.widthPx, city.heightPx));
}

const ASPHALT = '#434a59';
export const BUILDING_LIFT = { house: 8, villa: 9, apartment: 10, shop: 7, office: 12, tower: 20, factory: 9, warehouse: 8, depot: 10 };
const HOUSE_ROOFS = ['#c8644f', '#5d6b82', '#8a5a44', '#5f8f6a', '#d9a441', '#7a5c8a'];
const APARTMENT_ROOFS = ['#e3d5c6', '#d6dce8', '#e8d3d9', '#d8e4d2'];
const AWNINGS = ['#e5484d', '#2a9d8f', '#f4a261', '#4c6ef5', '#c05299'];

// Imagen de la empresa con la que se pinta el almacén en el mapa estático actual
let mapCompany = DEFAULT_COMPANY;

export function renderStaticMap(city, company = DEFAULT_COMPANY) {
  mapCompany = company ?? DEFAULT_COMPANY;
  const scale = staticScale(city);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(city.widthPx * scale);
  canvas.height = Math.ceil(city.heightPx * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  drawRoads(ctx, city);
  drawBlocks(ctx, city);
  drawRoadMarkings(ctx, city);
  drawPlazas(ctx, city, true);
  for (const park of city.parks) drawPark(ctx, park);
  drawDepotLot(ctx, city.depot);
  const sorted = [...city.buildings, city.depot].sort((a, b) => a.y - b.y);
  for (const b of sorted) drawBuilding(ctx, b);
  // Las farolas se pintan cada fotograma en renderer.js (se pueden derribar)
  drawStreetNames(ctx, city);
  drawLockedZones(ctx, city);
  return canvas;
}

/**
 * Suelo del mapa sin edificios, árboles ni farolas (para el modo 3D, que los modela en volumen).
 * Incluye calles, aceras, parques, aparcamiento del almacén, nombres de calle y zonas bloqueadas.
 */
export function renderGroundMap(city, wantedScale = STATIC_SCALE) {
  const scale = staticScale(city, wantedScale);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(city.widthPx * scale);
  canvas.height = Math.ceil(city.heightPx * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  drawRoads(ctx, city);
  drawAsphaltWear(ctx, city);
  drawBlocks(ctx, city);
  drawSidewalkJoints(ctx, city);
  drawRoadMarkings(ctx, city);
  drawStreetFixtures(ctx, city);
  drawPlazas(ctx, city, false); // en 3D la fuente es un modelo
  for (const park of city.parks) drawPark(ctx, park, false);
  drawDepotLot(ctx, city.depot);
  drawStreetNames(ctx, city);
  drawLockedZones(ctx, city);
  return canvas;
}

function drawRoads(ctx, city) {
  ctx.fillStyle = ASPHALT;
  ctx.fillRect(0, 0, city.widthPx, city.heightPx);
  // Textura sutil del asfalto
  const rng = createRng(77);
  const count = Math.round((city.widthPx * city.heightPx) / 1100);
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let i = 0; i < count; i++) ctx.fillRect(rng() * city.widthPx, rng() * city.heightPx, 2 + rng() * 3, 2);
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let i = 0; i < count; i++) ctx.fillRect(rng() * city.widthPx, rng() * city.heightPx, 2 + rng() * 3, 2);
}

function drawBlocks(ctx, city) {
  const rng = createRng(11);
  for (const block of city.blocks) {
    const zone = ZONES[block.zoneId];
    const x = block.ox * TILE;
    const y = block.oy * TILE;
    const w = block.w * TILE;
    const h = block.h * TILE;
    // Acera
    ctx.fillStyle = shade(zone.sidewalk, -8);
    roundRect(ctx, x - 7, y - 7, w + 14, h + 14, 9);
    ctx.fill();
    ctx.fillStyle = zone.sidewalk;
    roundRect(ctx, x - 5, y - 5, w + 10, h + 10, 8);
    ctx.fill();
    if (block.kind === 'plaza') continue; // la plaza dibuja su propio pavimento
    // Suelo de la manzana
    ctx.fillStyle = zone.ground;
    ctx.fillRect(x, y, w, h);
    if (block.zoneId === 'residential') {
      ctx.fillStyle = 'rgba(40,110,50,0.13)';
      const spots = Math.round((w * h) / 520);
      for (let i = 0; i < spots; i++) ctx.fillRect(x + rng() * w, y + rng() * h, 4, 3);
    }
  }
}

/** Tramos de calle que existen: { x0, y0, x1, y1, w (px), horizontal }. */
function openSegments(city) {
  const list = [];
  city.hRoads.forEach((road, j) => {
    const y = (road.y + road.w / 2) * TILE;
    city.cols.forEach((col, c) => {
      if (city.segmentOpen.h(j, c)) list.push({ x0: col.x * TILE, y0: y, x1: (col.x + col.w) * TILE, y1: y, w: road.w * TILE, horizontal: true });
    });
  });
  city.vRoads.forEach((road, k) => {
    const x = (road.x + road.w / 2) * TILE;
    city.rows.forEach((row, r) => {
      if (city.segmentOpen.v(k, r)) list.push({ x0: x, y0: row.y * TILE, x1: x, y1: (row.y + row.h) * TILE, w: road.w * TILE, horizontal: false });
    });
  });
  return list;
}

/** Solo 3D: rodadas más oscuras, parches de asfalto nuevo, grietas y manchas de aceite. */
function drawAsphaltWear(ctx, city) {
  const rng = createRng(4343);
  for (const s of openSegments(city)) {
    const len = s.horizontal ? s.x1 - s.x0 : s.y1 - s.y0;
    // Rodadas: dos bandas por carril, donde pisan las ruedas
    ctx.fillStyle = 'rgba(10,12,18,0.07)';
    for (const lane of [-0.25, 0.25]) {
      for (const wheel of [-0.09, 0.09]) {
        const o = (lane + wheel) * s.w;
        if (s.horizontal) ctx.fillRect(s.x0, s.y0 + o - 2.5, len, 5);
        else ctx.fillRect(s.x0 + o - 2.5, s.y0, 5, len);
      }
    }
    // Parches rectangulares de asfalto más nuevo (oscuro) o gastado (claro)
    const patches = Math.floor(rng() * 3);
    for (let i = 0; i < patches; i++) {
      const along = rng() * Math.max(0, len - 40) + 10;
      const across = (rng() - 0.5) * s.w * 0.6;
      const pl = 14 + rng() * 26;
      const pw = 8 + rng() * 12;
      ctx.fillStyle = rng() < 0.6 ? 'rgba(20,22,30,0.16)' : 'rgba(255,255,255,0.05)';
      if (s.horizontal) ctx.fillRect(s.x0 + along, s.y0 + across - pw / 2, pl, pw);
      else ctx.fillRect(s.x0 + across - pw / 2, s.y0 + along, pw, pl);
    }
    // Grietas finas en zigzag
    ctx.strokeStyle = 'rgba(12,14,20,0.28)';
    ctx.lineWidth = 0.8;
    const cracks = Math.floor(rng() * 3);
    for (let i = 0; i < cracks; i++) {
      let px = s.horizontal ? s.x0 + rng() * len : s.x0 + (rng() - 0.5) * s.w * 0.8;
      let py = s.horizontal ? s.y0 + (rng() - 0.5) * s.w * 0.8 : s.y0 + rng() * len;
      ctx.beginPath();
      ctx.moveTo(px, py);
      for (let k = 0; k < 5; k++) {
        px += (rng() - 0.5) * 9;
        py += (rng() - 0.5) * 9;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // Mancha de aceite en algún tramo
    if (rng() < 0.35) {
      const along = rng() * len;
      const across = (rng() < 0.5 ? -0.25 : 0.25) * s.w;
      const cx = s.horizontal ? s.x0 + along : s.x0 + across;
      const cy = s.horizontal ? s.y0 + across : s.y0 + along;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 7);
      g.addColorStop(0, 'rgba(8,10,14,0.3)');
      g.addColorStop(1, 'rgba(8,10,14,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - 7, cy - 7, 14, 14);
    }
  }
}

/** Solo 3D: juntas de las baldosas de la acera (cuadrícula recortada al anillo de la acera) y bordillo. */
function drawSidewalkJoints(ctx, city) {
  for (const block of city.blocks) {
    const x = block.ox * TILE;
    const y = block.oy * TILE;
    const w = block.w * TILE;
    const h = block.h * TILE;
    ctx.save();
    roundRect(ctx, x - 5, y - 5, w + 10, h + 10, 8);
    if (block.kind !== 'plaza') ctx.rect(x, y, w, h);
    ctx.clip('evenodd');
    ctx.strokeStyle = 'rgba(60,55,50,0.13)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let gx = x - 5; gx <= x + w + 5; gx += 8) { ctx.moveTo(gx, y - 6); ctx.lineTo(gx, y + h + 6); }
    for (let gy = y - 5; gy <= y + h + 5; gy += 8) { ctx.moveTo(x - 6, gy); ctx.lineTo(x + w + 6, gy); }
    ctx.stroke();
    ctx.restore();
    // Sombra del bordillo sobre el asfalto (el bordillo en volumen lo pone props3d.js)
    ctx.strokeStyle = 'rgba(8,10,16,0.22)';
    ctx.lineWidth = 2.5;
    roundRect(ctx, x - 8.2, y - 8.2, w + 16.4, h + 16.4, 10);
    ctx.stroke();
  }
}

/** Solo 3D: tapas de alcantarilla en el centro de los carriles y rejillas de desagüe junto al bordillo. */
function drawStreetFixtures(ctx, city) {
  const rng = createRng(5151);
  const manhole = (cx, cy) => {
    ctx.fillStyle = '#2f343d';
    ctx.beginPath(); ctx.arc(cx, cy, 5.2, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#5a606b';
    ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.arc(cx, cy, 4.4, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let k = -3; k <= 3; k += 1.5) { ctx.moveTo(cx - 3.6, cy + k); ctx.lineTo(cx + 3.6, cy + k); }
    ctx.stroke();
  };
  const grate = (cx, cy, horizontal) => {
    const w = horizontal ? 9 : 3.6;
    const h = horizontal ? 3.6 : 9;
    ctx.fillStyle = '#272b33';
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.fillStyle = '#4a505b';
    for (let k = -3; k <= 3; k += 1.5) {
      if (horizontal) ctx.fillRect(cx + k - 0.3, cy - h / 2 + 0.5, 0.6, h - 1);
      else ctx.fillRect(cx - w / 2 + 0.5, cy + k - 0.3, w - 1, 0.6);
    }
  };
  for (const s of openSegments(city)) {
    const len = s.horizontal ? s.x1 - s.x0 : s.y1 - s.y0;
    if (len < 60) continue;
    // Alcantarilla en mitad del tramo, en uno de los carriles
    const along = len * (0.35 + rng() * 0.3);
    const across = (rng() < 0.5 ? -0.25 : 0.25) * s.w;
    if (s.horizontal) manhole(s.x0 + along, s.y0 + across);
    else manhole(s.x0 + across, s.y0 + along);
    // Rejillas pegadas al bordillo a ambos lados (el bordillo está a 7 px de la manzana)
    for (const t of [0.22, 0.78]) {
      for (const edge of [-1, 1]) {
        const o = edge * (s.w / 2 - 9.5);
        const a = len * t;
        if (s.horizontal) grate(s.x0 + a, s.y0 + o, true);
        else grate(s.x0 + o, s.y0 + a, false);
      }
    }
  }
}

/** Líneas centrales en cada tramo de calle que existe y pasos de cebra en los cruces. */
function drawRoadMarkings(ctx, city) {
  const { vRoads, hRoads, cols, rows } = city;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#e9c46a';
  ctx.setLineDash([16, 14]);
  const centerLine = (x1, y1, x2, y2, double) => {
    const offsets = double ? [-3.5, 3.5] : [0];
    for (const o of offsets) {
      ctx.beginPath();
      if (y1 === y2) { ctx.moveTo(x1, y1 + o); ctx.lineTo(x2, y2 + o); } else { ctx.moveTo(x1 + o, y1); ctx.lineTo(x2 + o, y2); }
      ctx.stroke();
    }
  };
  hRoads.forEach((road, j) => {
    const y = (road.y + road.w / 2) * TILE;
    cols.forEach((col, c) => {
      if (city.segmentOpen.h(j, c)) centerLine(col.x * TILE, y, (col.x + col.w) * TILE, y, road.w >= 4);
    });
  });
  vRoads.forEach((road, k) => {
    const x = (road.x + road.w / 2) * TILE;
    rows.forEach((row, r) => {
      if (city.segmentOpen.v(k, r)) centerLine(x, row.y * TILE, x, (row.y + row.h) * TILE, road.w >= 4);
    });
  });
  ctx.setLineDash([]);

  // Pasos de cebra: a cada lado del cruce por el que sigue la calle
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  vRoads.forEach((vr, k) => {
    hRoads.forEach((hr, j) => {
      const ix = vr.x * TILE;
      const iy = hr.y * TILE;
      const wv = vr.w * TILE;
      const wh = hr.w * TILE;
      const left = k > 0 && city.segmentOpen.h(j, k - 1);
      const right = k < vRoads.length - 1 && city.segmentOpen.h(j, k);
      const up = j > 0 && city.segmentOpen.v(k, j - 1);
      const down = j < hRoads.length - 1 && city.segmentOpen.v(k, j);
      for (let o = 7; o + 6 <= wh - 4; o += 12) {
        if (left) ctx.fillRect(ix - 16, iy + o, 10, 6);
        if (right) ctx.fillRect(ix + wv + 6, iy + o, 10, 6);
      }
      for (let o = 7; o + 6 <= wv - 4; o += 12) {
        if (up) ctx.fillRect(ix + o, iy - 16, 6, 10);
        if (down) ctx.fillRect(ix + o, iy + wh + 6, 6, 10);
      }
    });
  });
}

/** Plazas peatonales: adoquines, bancos y (en 2D) la fuente. */
function drawPlazas(ctx, city, withFountain) {
  for (const plaza of city.plazas ?? []) {
    ctx.fillStyle = '#d8cdb6';
    ctx.fillRect(plaza.x, plaza.y, plaza.pw, plaza.ph);
    ctx.strokeStyle = 'rgba(120,100,70,0.18)';
    ctx.lineWidth = 1;
    for (let gx = plaza.x + 16; gx < plaza.x + plaza.pw; gx += 16) {
      ctx.beginPath(); ctx.moveTo(gx, plaza.y); ctx.lineTo(gx, plaza.y + plaza.ph); ctx.stroke();
    }
    for (let gy = plaza.y + 16; gy < plaza.y + plaza.ph; gy += 16) {
      ctx.beginPath(); ctx.moveTo(plaza.x, gy); ctx.lineTo(plaza.x + plaza.pw, gy); ctx.stroke();
    }
    const f = plaza.fountain;
    // Círculo decorativo alrededor de la fuente
    ctx.strokeStyle = 'rgba(150,120,80,0.45)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r + 26, 0, Math.PI * 2);
    ctx.stroke();
    if (withFountain) {
      ctx.fillStyle = '#b9b2a4';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6fb9d8';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r - 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e9f6fb';
      ctx.beginPath(); ctx.arc(f.x, f.y, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
}

/** Nombre de cada calle repetido cada dos manzanas, sobre los tramos que existen. */
function drawStreetNames(ctx, city) {
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.font = '700 11px "Segoe UI",system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  city.hRoads.forEach((road, j) => {
    const y = (road.y + road.w / 2) * TILE + Math.min(14, road.w * 5);
    city.cols.forEach((col, c) => {
      if (c % 2 || !city.segmentOpen.h(j, c)) return;
      ctx.fillText(road.name.toUpperCase(), (col.x + col.w / 2) * TILE, y);
    });
  });
  city.vRoads.forEach((road, k) => {
    const x = (road.x + road.w / 2) * TILE + Math.min(14, road.w * 5);
    city.rows.forEach((row, r) => {
      if (r % 2 || !city.segmentOpen.v(k, r)) return;
      ctx.save();
      ctx.translate(x, (row.y + row.h / 2) * TILE);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(road.name.toUpperCase(), 0, 0);
      ctx.restore();
    });
  });
}

function drawPark(ctx, park, withTrees = true) {
  const pw = park.w ?? park.size;
  const ph = park.h ?? park.size;
  ctx.fillStyle = '#8ccf84';
  roundRect(ctx, park.x + 2, park.y + 2, pw - 4, ph - 4, 10);
  ctx.fill();
  // Caminos en diagonal
  ctx.strokeStyle = '#eadfc2';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(park.x + 14, park.y + 14);
  ctx.lineTo(park.x + pw - 14, park.y + ph - 14);
  ctx.moveTo(park.x + pw - 14, park.y + 14);
  ctx.lineTo(park.x + 14, park.y + ph - 14);
  ctx.stroke();
  // Estanque
  ctx.fillStyle = '#6fb9d8';
  ctx.beginPath();
  ctx.ellipse(park.pond.x, park.pond.y, park.pond.rx, park.pond.ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.ellipse(park.pond.x - 10, park.pond.y - 6, park.pond.rx * 0.45, park.pond.ry * 0.3, -0.2, 0, Math.PI * 2);
  ctx.fill();
  if (!withTrees) return;
  // Árboles
  for (const tree of park.trees) {
    ctx.fillStyle = 'rgba(10,40,20,0.25)';
    ctx.beginPath();
    ctx.arc(tree.x + 4, tree.y + 6, tree.r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const tree of park.trees) {
    ctx.fillStyle = '#3f9a54';
    ctx.beginPath();
    ctx.arc(tree.x, tree.y, tree.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5bb86b';
    ctx.beginPath();
    ctx.arc(tree.x - tree.r * 0.25, tree.y - tree.r * 0.3, tree.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDepotLot(ctx, depot) {
  const { lot } = depot;
  ctx.fillStyle = '#5b6376';
  ctx.fillRect(lot.x, lot.y, lot.w, lot.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const lx = lot.x + (lot.w / 4) * i;
    ctx.beginPath();
    ctx.moveTo(lx, lot.y + 2);
    ctx.lineTo(lx, lot.y + lot.h / 2 - 2);
    ctx.moveTo(lx, lot.y + lot.h / 2 + 2);
    ctx.lineTo(lx, lot.y + lot.h - 2);
    ctx.stroke();
  }
  ctx.strokeStyle = '#ffb703';
  ctx.setLineDash([10, 8]);
  ctx.lineWidth = 3;
  ctx.strokeRect(lot.x + 1.5, lot.y + 1.5, lot.w - 3, lot.h - 3);
  ctx.setLineDash([]);
}

// ---------------------------------------------------------------- Edificios ----

/** Huella del cuerpo del edificio. Casas y villas se retiran al fondo de la parcela (ver world/lotLayout.js). */
function buildingFootprint(b) {
  if (b.kind === 'house') {
    const L = houseLayout(b);
    return { x: b.centerX + L.bx - L.bw / 2, y: b.centerY + L.bz - L.bd / 2, w: L.bw, h: L.bd };
  }
  if (b.kind === 'villa') {
    const L = villaLayout(b);
    return { x: b.centerX - L.bw / 2, y: b.centerY + L.bz - L.bd / 2, w: L.bw, h: L.bd };
  }
  return { x: b.x + 3, y: b.y + 3, w: b.pw - 6, h: b.ph - 6 };
}

/** Jardín delantero en 2D: césped, camino, seto, arbustos, porche, garaje y piscina (sin colisión salvo porche y piscina). */
function drawGardenLot(ctx, b) {
  const cx = b.centerX;
  const cy = b.centerY;
  ctx.fillStyle = '#9fd08a';
  ctx.fillRect(b.x + 1, b.y + 1, b.pw - 2, b.ph - 2);

  const L = b.kind === 'house' ? houseLayout(b) : villaLayout(b);
  const { fw, fd, side, front } = L;
  const doorX = b.kind === 'house' ? L.bx : L.doorX;
  const edge = side * (fd / 2 + 3); // borde de la parcela del lado de la calle
  const span = (z0, z1) => [cy + Math.min(z0, z1), Math.abs(z1 - z0)];

  // Camino desde la puerta hasta la acera
  ctx.fillStyle = '#e7dec9';
  {
    const [y, h] = span(front, edge);
    ctx.fillRect(cx + doorX - 5.5, y, 11, h);
  }

  if (b.kind === 'house') {
    // Escalón del porche y garaje con su entrada
    ctx.fillStyle = '#cfc6b6';
    const [py, ph] = span(front, front + side * L.porch.depth);
    ctx.fillRect(cx + L.porch.x - L.porch.w / 2, py, L.porch.w, ph);
    if (L.garage) {
      const [dy, dh] = span(L.garageZ + side * L.garageDepth / 2, edge);
      ctx.fillStyle = '#c4beb2';
      ctx.fillRect(cx + L.gx - 11, dy, 22, dh);
      const gy = cy + L.garageZ - L.garageDepth / 2;
      ctx.fillStyle = 'rgba(10,15,30,0.22)';
      ctx.fillRect(cx + L.gx - L.garageWidth / 2 + 4, gy + 4, L.garageWidth, L.garageDepth);
      ctx.fillStyle = '#7d828c';
      roundRect(ctx, cx + L.gx - L.garageWidth / 2, gy - 5, L.garageWidth, L.garageDepth, 3);
      ctx.fill();
    }
  } else {
    // Piscina
    const { pool } = L;
    ctx.fillStyle = '#e8e2d6';
    ctx.fillRect(cx + pool.x - pool.w / 2, cy + pool.z - pool.d / 2, pool.w, pool.d);
    ctx.fillStyle = '#5fb4dc';
    ctx.fillRect(cx + pool.x - pool.waterW / 2, cy + pool.z - pool.waterD / 2, pool.waterW, pool.waterD);
  }

  // Seto bajo junto a la acera, con hueco para el camino (y la entrada del garaje)
  const hedgeY = cy + side * (fd / 2 - 3) - 2.5;
  const gapL = doorX - 8;
  const gapR = b.kind === 'house' && L.garage ? L.gx + 14 : doorX + 8;
  ctx.fillStyle = '#4f8f45';
  if (gapL > -fw / 2 + 4) ctx.fillRect(cx - fw / 2, hedgeY, gapL + fw / 2, 5);
  if (gapR < fw / 2 - 4) ctx.fillRect(cx + gapR, hedgeY, fw / 2 - gapR, 5);
  if (b.kind === 'house' && L.garage && L.gx - 13 - (doorX + 8) > 4) ctx.fillRect(cx + doorX + 8, hedgeY, L.gx - 13 - (doorX + 8), 5);

  // Arbustos delante de la fachada
  ctx.fillStyle = '#5aa84f';
  const bushes = b.kind === 'house' ? [[L.bx - L.bw * 0.32, 4], [L.bx + L.bw * 0.3, 5]] : [[fw * 0.42, 3]];
  for (const [ox, oz] of bushes) {
    ctx.beginPath();
    ctx.arc(cx + ox, cy + front + side * (oz + 3), 4.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBuilding(ctx, b) {
  const lift = BUILDING_LIFT[b.kind] ?? 8;
  const garden = hasGarden(b);
  if (garden) drawGardenLot(ctx, b);
  const { x, y, w, h } = buildingFootprint(b);
  const roof = { x, y: y - lift, w, h };

  // Sombra proyectada
  ctx.fillStyle = 'rgba(10,15,30,0.24)';
  roundRect(ctx, x + lift * 0.9, y + lift * 0.9 - 2, w, h, 4);
  ctx.fill();

  // Pared visible (franja inferior) + tejado
  const palette = paletteFor(b);
  ctx.fillStyle = palette.wall;
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  if (garden) drawGardenDoor(ctx, b, { x, y, w, h }, lift);
  else drawDoorAndPath(ctx, b, roof, lift, palette);
  ctx.fillStyle = palette.roof;
  roundRect(ctx, roof.x, roof.y, roof.w, roof.h, 4);
  ctx.fill();
  ctx.strokeStyle = shade(palette.roof, -35);
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.save();
  roundRect(ctx, roof.x, roof.y, roof.w, roof.h, 4);
  ctx.clip();
  switch (b.kind) {
    case 'house': drawHouseRoof(ctx, roof, palette, false); break;
    case 'villa': drawHouseRoof(ctx, roof, palette, true); break;
    case 'apartment': drawApartmentRoof(ctx, roof, b); break;
    case 'shop': drawShopRoof(ctx, roof, b); break;
    case 'office': drawOfficeRoof(ctx, roof); break;
    case 'tower': drawTowerRoof(ctx, roof, b); break;
    case 'factory': drawFactoryRoof(ctx, roof); break;
    case 'warehouse': drawWarehouseRoof(ctx, roof, b); break;
    case 'depot': drawDepotRoof(ctx, roof); break;
    default: break;
  }
  ctx.restore();
  if (b.kind === 'shop') drawAwning(ctx, b, roof, lift);
}

function paletteFor(b) {
  switch (b.kind) {
    case 'house': case 'villa': return { roof: HOUSE_ROOFS[b.variant % HOUSE_ROOFS.length], wall: '#efe6d6' };
    case 'apartment': return { roof: APARTMENT_ROOFS[b.variant % APARTMENT_ROOFS.length], wall: '#b9b3a6' };
    case 'shop': return { roof: '#f4eee2', wall: '#d8c9ae' };
    case 'office': return { roof: '#7fb4d8', wall: '#4f7a99' };
    case 'tower': return { roof: '#9fb2c8', wall: '#5c6f86' };
    case 'factory': return { roof: '#8d939d', wall: '#585d66' };
    case 'warehouse': return { roof: '#c8cdd6', wall: '#7b8290' };
    case 'depot': return { roof: mapCompany.primary, wall: shade(mapCompany.primary, -70) };
    default: return { roof: '#aaa', wall: '#777' };
  }
}

function drawDoorAndPath(ctx, b, roof, lift, palette) {
  const doorW = b.kind === 'house' || b.kind === 'villa' || b.kind === 'shop' ? 14 : 20;
  // Caminito de entrada hacia la acera
  ctx.fillStyle = '#e7dec9';
  if (b.door === 'bottom') {
    ctx.fillRect(b.doorX - 6, b.y + b.ph - 3, 12, 9);
    ctx.fillStyle = '#4a3b2f';
    ctx.fillRect(b.doorX - doorW / 2, b.y + b.ph - 3 - lift + 1, doorW, lift);
  } else {
    ctx.fillRect(b.doorX - 6, b.y - 9, 12, 9);
  }
  void roof; void palette;
}

/** Puerta en la fachada retirada de casas y villas (el camino ya lo pinta drawGardenLot). */
function drawGardenDoor(ctx, b, body, lift) {
  if (b.door !== 'bottom') return; // vista cenital: la fachada superior queda bajo el tejado
  const doorX = b.centerX + (b.kind === 'house' ? houseLayout(b).bx : villaLayout(b).doorX);
  ctx.fillStyle = '#4a3b2f';
  ctx.fillRect(doorX - 7, body.y + body.h - lift + 1, 14, lift);
}

function drawHouseRoof(ctx, r, palette, solar) {
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(r.x, r.y, r.w, r.h / 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 1.2;
  for (let i = 1; i < 8; i++) {
    const yy = r.y + (r.h / 8) * i;
    ctx.beginPath();
    ctx.moveTo(r.x, yy);
    ctx.lineTo(r.x + r.w, yy);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(r.x, r.y + r.h / 2);
  ctx.lineTo(r.x + r.w, r.y + r.h / 2);
  ctx.stroke();
  ctx.fillStyle = '#6a5d57';
  ctx.fillRect(r.x + r.w * 0.68, r.y + 6, 9, 9);
  if (solar) {
    ctx.fillStyle = '#243b66';
    ctx.fillRect(r.x + 8, r.y + r.h / 2 + 6, r.w - 30, r.h / 2 - 14);
    ctx.strokeStyle = 'rgba(160,200,255,0.6)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(r.x + 8 + ((r.w - 30) / 4) * i, r.y + r.h / 2 + 6);
      ctx.lineTo(r.x + 8 + ((r.w - 30) / 4) * i, r.y + r.h - 8);
      ctx.stroke();
    }
  }
  void palette;
}

function drawApartmentRoof(ctx, r, b) {
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 3;
  ctx.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
  ctx.fillStyle = '#8f9bb0';
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      ctx.fillRect(r.x + 14 + i * 22, r.y + 12 + j * 30, 14, 10);
      ctx.fillStyle = '#a9b4c6';
      ctx.fillRect(r.x + 14 + i * 22, r.y + 12 + j * 30, 14, 3);
      ctx.fillStyle = '#8f9bb0';
    }
  }
  ctx.fillStyle = '#c1c8d6';
  ctx.fillRect(r.x + r.w - 38 - (b.variant % 3) * 6, r.y + r.h - 28, 28, 18);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(r.x + r.w - 38 - (b.variant % 3) * 6, r.y + r.h - 28, 28, 18);
}

function drawShopRoof(ctx, r, b) {
  const accent = AWNINGS[b.variant % AWNINGS.length];
  ctx.fillStyle = accent;
  ctx.fillRect(r.x, r.y, r.w, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.fillRect(r.x + 8, r.y + 20, r.w - 16, r.h - 34);
  ctx.fillStyle = '#b6bcc8';
  ctx.beginPath();
  ctx.arc(r.x + r.w * 0.3, r.y + r.h * 0.55, 6, 0, Math.PI * 2);
  ctx.arc(r.x + r.w * 0.7, r.y + r.h * 0.5, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  roundRect(ctx, r.x + r.w / 2 - 14, r.y + r.h / 2 - 6, 28, 12, 4);
  ctx.fill();
}

function drawAwning(ctx, b, roof, lift) {
  const aw = Math.min(roof.w - 10, 70);
  const ax = b.doorX - aw / 2;
  const ay = b.door === 'top' ? roof.y - 9 : roof.y + roof.h - 2 + 0;
  const accent = AWNINGS[b.variant % AWNINGS.length];
  const stripes = 7;
  const stripeWidth = aw / stripes;
  const yy = b.door === 'top' ? ay : b.y + b.ph - 4;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? accent : '#ffffff';
    ctx.fillRect(ax + i * stripeWidth, yy, stripeWidth, 11);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ax, yy, aw, 11);
  void lift;
}

function drawOfficeRoof(ctx, r) {
  const gradient = ctx.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  gradient.addColorStop(0, '#9ccbea');
  gradient.addColorStop(1, '#5f98c2');
  ctx.fillStyle = gradient;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.2;
  for (let xx = r.x + 14; xx < r.x + r.w; xx += 14) {
    ctx.beginPath(); ctx.moveTo(xx, r.y); ctx.lineTo(xx, r.y + r.h); ctx.stroke();
  }
  for (let yy = r.y + 14; yy < r.y + r.h; yy += 14) {
    ctx.beginPath(); ctx.moveTo(r.x, yy); ctx.lineTo(r.x + r.w, yy); ctx.stroke();
  }
  ctx.fillStyle = '#3f6785';
  ctx.fillRect(r.x + r.w - 40, r.y + 10, 26, 18);
}

function drawTowerRoof(ctx, r, b) {
  const steps = [['#9fb2c8', 0], ['#b6c6d9', 16], ['#d0deec', 34]];
  for (const [color, inset] of steps) {
    if (r.w - inset * 2 < 30 || r.h - inset * 2 < 30) continue;
    ctx.fillStyle = color;
    ctx.fillRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2);
  }
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (b.variant % 3 === 0) {
    ctx.fillStyle = '#4a5568';
    ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 22px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('H', cx, cy + 1);
  } else {
    ctx.strokeStyle = '#59606e'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 10, cy - 14); ctx.stroke();
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath(); ctx.arc(cx + 10, cy - 14, 3.5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawFactoryRoof(ctx, r) {
  for (let i = 0; i < Math.ceil(r.w / 18); i++) {
    ctx.fillStyle = i % 2 === 0 ? '#9aa0ab' : '#7d838e';
    ctx.fillRect(r.x + i * 18, r.y, 18, r.h);
  }
  for (const fx of [0.18, 0.78]) {
    ctx.fillStyle = 'rgba(10,15,30,0.25)';
    ctx.beginPath(); ctx.arc(r.x + r.w * fx + 3, r.y + r.h * 0.5 + 4, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5b5f66';
    ctx.beginPath(); ctx.arc(r.x + r.w * fx, r.y + r.h * 0.5, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2f3237';
    ctx.beginPath(); ctx.arc(r.x + r.w * fx, r.y + r.h * 0.5, 5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawWarehouseRoof(ctx, r, b) {
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  for (let yy = r.y + 5; yy < r.y + r.h; yy += 5) {
    ctx.beginPath(); ctx.moveTo(r.x, yy); ctx.lineTo(r.x + r.w, yy); ctx.stroke();
  }
  ctx.fillStyle = ['#3d6fb6', '#d1603d', '#2f8f6b'][b.variant % 3];
  ctx.fillRect(r.x, r.y + r.h / 2 - 5, r.w, 10);
  ctx.fillStyle = '#a7aebb';
  ctx.fillRect(r.x + 12, r.y + 10, 20, 14);
}

function drawDepotRoof(ctx, r) {
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  for (let i = -r.h; i < r.w; i += 24) {
    ctx.beginPath();
    ctx.moveTo(r.x + i, r.y + r.h);
    ctx.lineTo(r.x + i + 12, r.y + r.h);
    ctx.lineTo(r.x + i + 12 + r.h, r.y);
    ctx.lineTo(r.x + i + r.h, r.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(r.x, r.y, r.w, 10);
  // Logotipo y nombre de la empresa
  const bx = r.x + 18;
  const by = r.y + r.h / 2 - 17;
  drawBrandMark(ctx, bx, by, 34, mapCompany);
  const ink = contrastText(mapCompany.primary);
  const title = brandTitle(mapCompany);
  const maxW = r.w - (bx - r.x) - 56;
  let size = 17;
  ctx.font = `800 ${size}px "Segoe UI","Trebuchet MS",sans-serif`;
  while (size > 9 && ctx.measureText(title).width > maxW) {
    size -= 1;
    ctx.font = `800 ${size}px "Segoe UI","Trebuchet MS",sans-serif`;
  }
  ctx.fillStyle = ink;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(title, bx + 46, by + 12);
  ctx.font = '700 11px "Segoe UI",sans-serif';
  ctx.globalAlpha = 0.8;
  ctx.fillText(mapCompany.slogan ? mapCompany.slogan.toLocaleUpperCase('es-ES') : 'ALMACÉN CENTRAL · REPARTO', bx + 46, by + 31, maxW);
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------ Zonas bloqueadas ----

function drawLockedZones(ctx, city) {
  const hatch = document.createElement('canvas');
  hatch.width = 16; hatch.height = 16;
  const hctx = hatch.getContext('2d');
  hctx.strokeStyle = 'rgba(255,255,255,0.08)';
  hctx.lineWidth = 3;
  hctx.beginPath(); hctx.moveTo(-2, 18); hctx.lineTo(18, -2); hctx.stroke();
  const pattern = ctx.createPattern(hatch, 'repeat');
  const MAP_TILES_X = city.width;
  const MAP_TILES_Y = city.height;

  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    let runStart = -1;
    for (let tx = 0; tx <= MAP_TILES_X; tx++) {
      const locked = tx < MAP_TILES_X && !city.isZoneUnlocked(city.zoneIdAtTile(tx, ty));
      if (locked && runStart < 0) runStart = tx;
      if (!locked && runStart >= 0) {
        ctx.fillStyle = 'rgba(14,20,38,0.62)';
        ctx.fillRect(runStart * TILE, ty * TILE, (tx - runStart) * TILE, TILE);
        ctx.fillStyle = pattern;
        ctx.fillRect(runStart * TILE, ty * TILE, (tx - runStart) * TILE, TILE);
        runStart = -1;
      }
    }
  }

  // Barreras con franjas amarillas y negras en la frontera de la zona desbloqueada
  const stripe = document.createElement('canvas');
  stripe.width = 14; stripe.height = 14;
  const sctx = stripe.getContext('2d');
  sctx.fillStyle = '#ffc233';
  sctx.fillRect(0, 0, 14, 14);
  sctx.fillStyle = '#1d2230';
  sctx.beginPath();
  sctx.moveTo(0, 7); sctx.lineTo(7, 0); sctx.lineTo(14, 0); sctx.lineTo(0, 14);
  sctx.moveTo(7, 14); sctx.lineTo(14, 7); sctx.lineTo(14, 14);
  sctx.fill();
  const barrier = ctx.createPattern(stripe, 'repeat');
  ctx.fillStyle = barrier;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (city.isZoneUnlocked(city.zoneIdAtTile(tx, ty)) || city.isSolidBuildingTile(tx, ty)) continue;
      for (const [dx, dy] of dirs) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_TILES_X || ny >= MAP_TILES_Y) continue;
        if (!city.isZoneUnlocked(city.zoneIdAtTile(nx, ny)) || city.isSolidBuildingTile(nx, ny)) continue;
        const ex = dx > 0 ? (tx + 1) * TILE : dx < 0 ? tx * TILE : tx * TILE;
        const ey = dy > 0 ? (ty + 1) * TILE : dy < 0 ? ty * TILE : ty * TILE;
        if (dx !== 0) ctx.fillRect(ex - 4, ey, 8, TILE);
        else ctx.fillRect(ex, ey - 4, TILE, 8);
      }
    }
  }
}
