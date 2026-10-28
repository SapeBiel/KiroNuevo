// Texturas, etiquetas y marcadores del modo 3D, todo generado por código (sin imágenes externas).

import * as THREE from '../vendor/three.module.js';
import { createRng } from '../core/random.js';
import { drawOutlinedText, drawPin } from '../render/sprites.js';

let maxAnisotropy = 1;

export function setMaxAnisotropy(value) {
  maxAnisotropy = Math.max(1, value || 1);
}

export function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function toTexture(canvas, { repeat = false, color = true } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// ------------------------------------------------------------- Etiquetas ----

const scratch = makeCanvas(8, 8).getContext('2d');
const tmpVec = new THREE.Vector3();

/** Sprite con texto. Su tamaño en pantalla se fija con scaleSpriteToScreen(). */
export function createLabel(text, opts = {}) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    transparent: true, depthTest: false, depthWrite: false, fog: false,
  }));
  sprite.renderOrder = 20;
  sprite.userData.label = { key: null, aspect: 1, pxHeight: 16 };
  setLabelText(sprite, text, opts);
  return sprite;
}

export function setLabelText(sprite, text, opts = {}) {
  const info = sprite.userData.label;
  const size = opts.size ?? 28;
  const color = opts.color ?? '#ffffff';
  const weight = opts.weight ?? '700';
  const key = `${text}|${size}|${color}|${weight}`;
  if (info.key === key) return;
  info.key = key;

  scratch.font = `${weight} ${size}px "Segoe UI","Trebuchet MS",system-ui,sans-serif`;
  const lines = String(text).split('\n');
  const textWidth = Math.max(...lines.map((line) => scratch.measureText(line).width));
  const pad = Math.ceil(size * 0.45);
  const lineHeight = Math.ceil(size * 1.3);
  const width = Math.max(8, Math.ceil(textWidth + pad * 2));
  const height = lineHeight * lines.length + pad;
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  lines.forEach((line, i) => {
    drawOutlinedText(ctx, line, width / 2, pad / 2 + lineHeight * (i + 0.5), { size, color, weight });
  });

  sprite.material.map?.dispose();
  sprite.material.map = toTexture(canvas);
  sprite.material.needsUpdate = true;
  info.aspect = width / height;
  info.pxHeight = height;
}

export function disposeSprite(sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

/** Escala un sprite para que ocupe "pxHeight" píxeles de pantalla sea cual sea la distancia. */
export function scaleSpriteToScreen(sprite, camera, viewHeight, pxHeight, aspect) {
  sprite.getWorldPosition(tmpVec);
  const dist = Math.max(1, camera.position.distanceTo(tmpVec));
  const unit = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * dist) / Math.max(1, viewHeight);
  const h = pxHeight * unit;
  const a = aspect ?? sprite.userData.label?.aspect ?? sprite.userData.aspect ?? 1;
  sprite.scale.set(h * a, h, 1);
}

// ----------------------------------------------------------------- Pins ----

const pinMaterials = new Map();

export function getPinMaterial(color, icon) {
  const key = `${color}|${icon}`;
  let material = pinMaterials.get(key);
  if (!material) {
    const canvas = makeCanvas(96, 112);
    drawPin(canvas.getContext('2d'), 48, 104, { color, icon, size: 3 });
    material = new THREE.SpriteMaterial({
      map: toTexture(canvas), transparent: true, depthTest: false, depthWrite: false, fog: false,
    });
    pinMaterials.set(key, material);
  }
  return material;
}

export const PIN_ASPECT = 96 / 112;
// La punta del pin está a 8 px del borde inferior de la textura (fracción desde abajo).
export const PIN_ANCHOR_Y = 8 / 112;

// ------------------------------------------------- Zonas, brillos y haces ----

const zoneTextures = new Map();

/** Círculo de almacén o de entrega (relleno suave y borde discontinuo o sólido). */
export function getZoneTexture(color, solid) {
  const key = `${color}|${solid}`;
  let texture = zoneTextures.get(key);
  if (!texture) {
    const canvas = makeCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = hexToRgba(color, solid ? 0.34 : 0.16);
    ctx.beginPath();
    ctx.arc(128, 128, 118, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = solid ? 9 : 6;
    ctx.setLineDash(solid ? [] : [28, 20]);
    ctx.beginPath();
    ctx.arc(128, 128, 118, 0, Math.PI * 2);
    ctx.stroke();
    texture = toTexture(canvas);
    zoneTextures.set(key, texture);
  }
  return texture;
}

let glow = null;
export function getGlowTexture() {
  if (!glow) {
    const canvas = makeCanvas(64, 64);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glow = toTexture(canvas);
  }
  return glow;
}

let beam = null;
/** Haz de los faros: se extiende hacia +x desde el origen del plano. */
export function getBeamTexture() {
  if (!beam) {
    const canvas = makeCanvas(128, 64);
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, 'rgba(255,246,200,0.95)');
    g.addColorStop(1, 'rgba(255,246,200,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 26);
    ctx.lineTo(128, 0);
    ctx.lineTo(128, 64);
    ctx.lineTo(0, 38);
    ctx.closePath();
    ctx.fill();
    beam = toTexture(canvas);
  }
  return beam;
}

const stripeTextures = new Map();
/** Toldo de tienda a rayas. */
export function getAwningTexture(accent) {
  let texture = stripeTextures.get(accent);
  if (!texture) {
    const canvas = makeCanvas(140, 20);
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = i % 2 === 0 ? accent : '#ffffff';
      ctx.fillRect(i * 20, 0, 20, 20);
    }
    texture = toTexture(canvas);
    stripeTextures.set(accent, texture);
  }
  return texture;
}

let hazard = null;
/** Franjas amarillas y negras de las barreras de zonas bloqueadas. */
export function getHazardTexture() {
  if (!hazard) {
    const canvas = makeCanvas(28, 28);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffc233';
    ctx.fillRect(0, 0, 28, 28);
    ctx.fillStyle = '#1d2230';
    ctx.beginPath();
    ctx.moveTo(0, 14); ctx.lineTo(14, 0); ctx.lineTo(28, 0); ctx.lineTo(0, 28);
    ctx.moveTo(14, 28); ctx.lineTo(28, 14); ctx.lineTo(28, 28);
    ctx.fill();
    hazard = toTexture(canvas, { repeat: true });
  }
  return hazard;
}

// ------------------------------------------------------ Fachadas de edificio ----

const PX = 2; // píxeles de textura por unidad de mundo

/**
 * Estilos de fachada. cell = tamaño de una celda (unidades de mundo); tile = celdas por repetición.
 * La textura base es clara para que el color del material tiñe la pared.
 */
const WALL_STYLES = {
  home: { cell: [30, 34], tile: [3, 1], draw: drawHomeCell },
  flats: { cell: [24, 23], tile: [4, 1], draw: drawFlatsCell },
  glass: { cell: [16, 20], tile: [6, 1], draw: drawGlassCell },
  shop: { cell: [48, 42], tile: [2, 1], draw: drawShopCell },
  industrial: { cell: [20, 58], tile: [4, 1], draw: drawIndustrialCell },
  metal: { cell: [16, 44], tile: [6, 1], draw: drawMetalCell },
  depot: { cell: [32, 64], tile: [3, 1], draw: drawDepotCell },
};

const wallCache = new Map();

export function getWallTextures(style) {
  let entry = wallCache.get(style);
  if (entry) return entry;
  const spec = WALL_STYLES[style] ?? WALL_STYLES.home;
  const [cw, ch] = spec.cell;
  const [cols, rows] = spec.tile;
  const width = cw * cols * PX;
  const height = ch * rows * PX;
  const rng = createRng(1000 + style.length * 37 + style.charCodeAt(0));
  const day = makeCanvas(width, height);
  const lit = makeCanvas(width, height);
  const dctx = day.getContext('2d');
  const lctx = lit.getContext('2d');
  lctx.fillStyle = '#000';
  lctx.fillRect(0, 0, width, height);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = rng() < 0.55;
      for (const [ctx, isLit] of [[dctx, false], [lctx, true]]) {
        ctx.save();
        ctx.translate(c * cw * PX, r * ch * PX);
        ctx.scale(PX, PX);
        spec.draw(ctx, cw, ch, { lit: isLit, on, c, r });
        ctx.restore();
      }
    }
  }
  entry = {
    map: toTexture(day, { repeat: true }),
    emissiveMap: toTexture(lit, { repeat: true }),
    tileW: cw * cols,
    tileH: ch * rows,
  };
  wallCache.set(style, entry);
  return entry;
}

const GLASS = '#6f95b8';
const GLASS_DARK = '#3f607d';

function paintWall(ctx, w, h, lit, base = '#f4f1ea') {
  if (lit) return;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
}

function windowRect(ctx, x, y, w, h, { lit, on, glass = GLASS, frame = '#c9c3b8' }) {
  if (lit) {
    if (on) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, w, h);
    }
    return;
  }
  ctx.fillStyle = frame;
  ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
  ctx.fillStyle = glass;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(x, y, w, h * 0.35);
}

function drawHomeCell(ctx, w, h, o) {
  paintWall(ctx, w, h, o.lit);
  windowRect(ctx, w / 2 - 6, 9, 12, 14, o);
  if (!o.lit) {
    ctx.fillStyle = 'rgba(0,0,0,0.07)';
    ctx.fillRect(0, h - 3, w, 3);
  }
}

function drawFlatsCell(ctx, w, h, o) {
  paintWall(ctx, w, h, o.lit, '#eee9df');
  windowRect(ctx, 6, 5, 12, 11, o);
  if (!o.lit) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, h - 2, w, 2);
  }
}

function drawGlassCell(ctx, w, h, o) {
  if (o.lit) {
    if (o.on) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(1, 2, w - 2, h - 5);
    }
    return;
  }
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#bfd2e2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(40,70,100,0.55)';
  ctx.fillRect(0, 0, 1.2, h);
  ctx.fillRect(0, h - 3, w, 3);
}

function drawShopCell(ctx, w, h, o) {
  paintWall(ctx, w, h, o.lit, '#f1e7d3');
  windowRect(ctx, 6, 13, w - 12, 20, { ...o, glass: '#9cc3dc', frame: '#8b7a61' });
  if (!o.lit) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, 0, w, 8);
  }
}

function drawIndustrialCell(ctx, w, h, o) {
  if (o.lit) {
    if (o.on) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(3, 8, w - 6, 6);
    }
    return;
  }
  ctx.fillStyle = '#eceef0';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 0; x < w; x += 4) ctx.fillRect(x, 0, 1.2, h);
  ctx.fillStyle = GLASS_DARK;
  ctx.fillRect(3, 8, w - 6, 6);
}

function drawMetalCell(ctx, w, h, o) {
  if (o.lit) return;
  ctx.fillStyle = '#eef0f3';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for (let x = 0; x < w; x += 3) ctx.fillRect(x, 0, 1, h);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, h - 4, w, 4);
}

function drawDepotCell(ctx, w, h, o) {
  paintWall(ctx, w, h, o.lit, '#f3ecd9');
  windowRect(ctx, 8, 10, w - 16, 9, { ...o, glass: GLASS });
  if (!o.lit) {
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(0, h - 5, w, 5);
    ctx.fillStyle = 'rgba(255,183,3,0.45)';
    ctx.fillRect(0, h - 12, w, 3);
  }
}

// ------------------------------------------------------- Letreros y suelos ----

/** Letrero rectangular con texto (nombres de tienda, rótulo del almacén…). */
export function makeSignTexture(text, { bg = '#1c2536', fg = '#ffffff', width = 256, height = 48, size = 24 } = {}) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, width - 3, height - 3);
  ctx.fillStyle = fg;
  ctx.font = `800 ${size}px "Segoe UI","Trebuchet MS",system-ui,sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let fontSize = size;
  while (ctx.measureText(text).width > width - 16 && fontSize > 9) {
    fontSize -= 1;
    ctx.font = `800 ${fontSize}px "Segoe UI","Trebuchet MS",system-ui,sans-serif`;
  }
  ctx.fillText(text, width / 2, height / 2 + 1);
  return toTexture(canvas);
}

/** Logo del tejado del almacén (visto desde arriba). */
export function makeDepotRoofTexture() {
  const canvas = makeCanvas(512, 192);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffb703';
  ctx.fillRect(0, 0, 512, 192);
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  for (let i = -192; i < 512; i += 48) {
    ctx.beginPath();
    ctx.moveTo(i, 192); ctx.lineTo(i + 24, 192); ctx.lineTo(i + 24 + 192, 0); ctx.lineTo(i + 192, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#b9824a';
  ctx.fillRect(34, 56, 80, 80);
  ctx.fillStyle = '#e8c48e';
  ctx.fillRect(66, 56, 16, 80);
  ctx.strokeStyle = '#7d5430';
  ctx.lineWidth = 4;
  ctx.strokeRect(34, 56, 80, 80);
  ctx.fillStyle = '#4a2f10';
  ctx.textBaseline = 'middle';
  ctx.font = '800 44px "Segoe UI","Trebuchet MS",sans-serif';
  ctx.fillText('PARCEL EMPIRE', 134, 80);
  ctx.font = '700 22px "Segoe UI",sans-serif';
  ctx.fillStyle = 'rgba(74,47,16,0.85)';
  ctx.fillText('ALMACÉN CENTRAL · REPARTO', 134, 124);
  return toTexture(canvas);
}

/** Helipuerto de las torres. */
export function makeHelipadTexture() {
  const canvas = makeCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#4a5568';
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', 64, 68);
  return toTexture(canvas);
}
