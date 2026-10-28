// Modelos 3D de vehículos y drones.
// Cada vehículo tiene su propia carrocería (perfil lateral extruido con pasos de rueda), rotulación de la
// empresa, luces, llantas y una cabina interior con volante para la vista del conductor.
// Ejes locales: el vehículo mira hacia +x (ángulo 0 del juego), y es la altura y +z es su lado derecho.

import * as THREE from '../vendor/three.module.js';
import { roundRect } from '../render/sprites.js';
import { getBeamTexture, makeCanvas, toTexture } from './textures3d.js';

// ------------------------------------------------- Reflejos del entorno ----
// Los materiales de los vehículos reflejan un cielo pre-calculado. De noche se atenúa desde el renderizador.

const envMaterials = new Set();
let envTexture = null;
let envLevel = 0.6;

export function setVehicleEnvironment(texture, level) {
  const changed = texture !== envTexture;
  envTexture = texture;
  envLevel = level;
  for (const material of envMaterials) applyEnvironment(material, changed);
}

function applyEnvironment(material, force) {
  if (force || material.envMap !== envTexture) {
    material.envMap = envTexture;
    material.needsUpdate = true;
  }
  material.envMapIntensity = envLevel * (material.userData.envBoost ?? 1);
}

function std(params, envBoost = 1) {
  const material = new THREE.MeshStandardMaterial(params);
  material.userData.envBoost = envBoost;
  envMaterials.add(material);
  applyEnvironment(material, true);
  return material;
}

function releaseMaterial(material) {
  envMaterials.delete(material);
  material.dispose();
}

// ------------------------------------------------------- Recursos comunes ----

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const beamGeometry = new THREE.PlaneGeometry(96, 44);
const DECAL = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };

const SHARED = {
  tire: std({ color: '#18191d', roughness: 0.9, metalness: 0 }, 0.25),
  plastic: std({ color: '#24272d', roughness: 0.7, metalness: 0.05 }, 0.4),
  chrome: std({ color: '#eef1f4', roughness: 0.16, metalness: 1 }, 1.3),
  glass: std({ color: '#0f1a24', roughness: 0.05, metalness: 0.2, side: THREE.DoubleSide, ...DECAL }, 1.6),
  trim: std({ color: '#15171b', roughness: 0.6, metalness: 0.1 }, 0.3),
  interior: std({ color: '#2c3039', roughness: 0.85 }, 0.25),
  interiorSoft: std({ color: '#474d58', roughness: 0.95 }, 0.25),
  headliner: std({ color: '#9da2aa', roughness: 0.95 }, 0.25),
  glove: std({ color: '#1e2127', roughness: 0.8 }, 0.25),
  amber: std({ color: '#ffb000', emissive: '#ff9500', emissiveIntensity: 0.6, roughness: 0.4 }, 0.5),
  solar: std({ color: '#1b2f5c', roughness: 0.22, metalness: 0.6 }, 1.4),
  charge: std({ color: '#2be38b', emissive: '#2be38b', emissiveIntensity: 1.2, roughness: 0.4 }, 0.3),
};

const RIMS = {
  steel: std({ color: '#3b414b', roughness: 0.55, metalness: 0.5 }),
  alloy: std({ color: '#c6ccd4', roughness: 0.28, metalness: 0.9 }),
  aero: std({ color: '#e7ebef', roughness: 0.3, metalness: 0.25 }),
  truck: std({ color: '#d4d8de', roughness: 0.35, metalness: 0.7 }),
};

const geometryCache = new Map();
function cachedGeometry(key, create) {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = create();
    geometryCache.set(key, geometry);
  }
  return geometry;
}
const tireGeometry = (r) => cachedGeometry(`tire|${r}`, () => new THREE.CylinderGeometry(r, r, 4, 24).rotateX(Math.PI / 2));
const discGeometry = (r) => cachedGeometry(`disc|${r}`, () => new THREE.CylinderGeometry(r, r, 0.5, 20).rotateX(Math.PI / 2));
const hubGeometry = cachedGeometry('hub', () => new THREE.CylinderGeometry(0.8, 0.8, 0.9, 12).rotateX(Math.PI / 2));
const pipeGeometry = cachedGeometry('pipe', () => new THREE.CylinderGeometry(1, 1, 1, 12));

const textureCache = new Map();
function cachedTexture(key, create) {
  let texture = textureCache.get(key);
  if (!texture) {
    texture = create();
    textureCache.set(key, texture);
  }
  return texture;
}
const decalMaterials = new Map();
/** Material de calcomanía (transparente, sobre la carrocería) compartido por clave. */
function decalMaterial(key, texture) {
  let material = decalMaterials.get(key);
  if (!material) {
    material = std({ map: texture, transparent: true, alphaTest: 0.03, roughness: 0.38, metalness: 0.15, ...DECAL }, 0.8);
    decalMaterials.set(key, material);
  }
  return material;
}

// ------------------------------------------------------------- Estilos ----

const STYLES = {
  van_starter: {
    body: 'van', paint: '#f4b942', accent: '#2b2f38', accent2: '#c4581b', text: '#2b1a05', rims: 'steel',
    roofY: 26, wsTop: 0.17, wsBot: 0.31, hoodY: 16.5, noseY: 15, bumper: 'plastic', roof: 'none',
    tagline: 'Reparto local', plate: '4821 KZB',
  },
  van_basic: {
    body: 'van', paint: '#f5f3ee', accent: '#f4b942', accent2: '#fb8500', text: '#2b2f38', rims: 'alloy',
    roofY: 27, wsTop: 0.18, wsBot: 0.33, hoodY: 16.5, noseY: 14.5, bumper: 'plastic', roof: 'rails',
    tagline: 'Mensajería urgente', plate: '7305 LMC',
  },
  van_large: {
    body: 'van', paint: '#3f8fd0', accent: '#ffffff', accent2: '#ffb703', text: '#ffffff', rims: 'alloy',
    roofY: 32, cabTopY: 27.5, roofRamp: 6, wsTop: 0.2, wsBot: 0.33, hoodY: 17, noseY: 15.5, bumper: 'plastic',
    roof: 'markers', sideMarkers: true, tagline: 'Gran volumen · Toda la ciudad', plate: '1958 MRT',
  },
  van_electric: {
    body: 'van', paint: '#3fbf8a', accent: '#ffffff', accent2: '#0f6b4a', text: '#ffffff', rims: 'aero',
    roofY: 26, wsTop: 0.08, wsBot: 0.34, hoodY: 15, noseY: 12.5, bumper: 'body', roof: 'solar', electric: true,
    tagline: '100% eléctrica · cero emisiones', plate: '0420 NVE',
  },
  truck: {
    body: 'truck', paint: '#d94f48', boxPaint: '#f4f5f7', accent: '#d94f48', accent2: '#ffb703', text: '#1f2633',
    rims: 'truck', tagline: 'Logística y grandes envíos', web: 'parcelempire.es · 900 123 456', plate: '6612 PXT',
  },
};

function styleFor(type) {
  const base = STYLES[type.id]
    ?? (type.shape === 'truck' ? STYLES.truck : type.shape === 'electric' ? STYLES.van_electric : { ...STYLES.van_basic, paint: type.color });
  return { id: type.id, ...base };
}

// ------------------------------------------------------------ Texturas ----

const FONT = '"Segoe UI","Trebuchet MS",system-ui,sans-serif';

function fitFont(ctx, text, weight, size, maxWidth) {
  let s = Math.max(8, Math.round(size));
  for (; s > 8; s--) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
  }
  ctx.font = `${weight} ${s}px ${FONT}`;
  return s;
}

/** Logotipo: caja de cartón con cinta. */
function brandMark(ctx, x, y, s) {
  ctx.save();
  ctx.fillStyle = '#b9824a';
  roundRect(ctx, x, y, s, s, s * 0.14);
  ctx.fill();
  ctx.fillStyle = '#e8c48e';
  ctx.fillRect(x + s * 0.4, y, s * 0.2, s);
  ctx.lineWidth = Math.max(2, s * 0.06);
  ctx.strokeStyle = '#6b4423';
  roundRect(ctx, x, y, s, s, s * 0.14);
  ctx.stroke();
  ctx.restore();
}

function drawPlate(ctx, x, y, w, h, text) {
  ctx.fillStyle = '#f4f6f8';
  roundRect(ctx, x, y, w, h, 4);
  ctx.fill();
  ctx.strokeStyle = '#1b1f27';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#1f4fbf';
  ctx.fillRect(x + 2, y + 2, w * 0.13, h - 4);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(h * 0.36)}px ${FONT}`;
  ctx.fillText('E', x + 2 + w * 0.065, y + h * 0.62);
  ctx.fillStyle = '#111418';
  fitFont(ctx, text, 800, h * 0.62, w * 0.8);
  ctx.fillText(text, x + w * 0.56, y + h * 0.54);
}

/** Rotulación lateral: franjas con los colores del vehículo, logotipo y lema. Se adapta a la proporción del panel. */
function liveryTexture(style, w, h) {
  return cachedTexture(`livery|${style.id}|${w.toFixed(1)}|${h.toFixed(1)}`, () => {
    const cw = 512;
    const ch = Math.max(128, Math.min(640, Math.round((cw * h) / w)));
    const canvas = makeCanvas(cw, ch);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = style.accent;
    ctx.beginPath();
    ctx.moveTo(0, ch * 0.74);
    ctx.bezierCurveTo(cw * 0.4, ch * 0.84, cw * 0.7, ch * 0.6, cw, ch * 0.46);
    ctx.lineTo(cw, ch * 0.62);
    ctx.bezierCurveTo(cw * 0.7, ch * 0.76, cw * 0.4, ch * 0.98, 0, ch * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = style.accent2;
    ctx.beginPath();
    ctx.moveTo(0, ch * 0.94);
    ctx.bezierCurveTo(cw * 0.4, ch * 1.0, cw * 0.7, ch * 0.8, cw, ch * 0.67);
    ctx.lineTo(cw, ch * 0.74);
    ctx.bezierCurveTo(cw * 0.7, ch * 0.88, cw * 0.45, ch * 1.02, cw * 0.12, ch);
    ctx.lineTo(0, ch);
    ctx.closePath();
    ctx.fill();

    const mark = Math.round(Math.min(ch * 0.24, cw * 0.15));
    const mx = cw * 0.06;
    const my = ch * 0.1;
    brandMark(ctx, mx, my, mark);
    const tx = mx + mark * 1.25;
    const maxW = cw - tx - cw * 0.05;
    ctx.fillStyle = style.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    fitFont(ctx, 'PARCEL EMPIRE', 900, mark * 0.62, maxW);
    ctx.fillText('PARCEL EMPIRE', tx, my + mark * 0.36);
    fitFont(ctx, style.tagline, 700, mark * 0.3, maxW);
    ctx.globalAlpha = 0.9;
    ctx.fillText(style.tagline, tx, my + mark * 0.86);
    if (style.web) {
      fitFont(ctx, style.web, 600, mark * 0.26, cw * 0.85);
      ctx.fillText(style.web, mx, my + mark * 1.55);
    }
    ctx.globalAlpha = 1;
    return toTexture(canvas);
  });
}

/** Parte trasera: puertas con ventanillas o persiana enrollable (camión), logotipo y matrícula. */
function rearTexture(style, truck) {
  return cachedTexture(`rear|${style.id}`, () => {
    const s = 256;
    const canvas = makeCanvas(s, s);
    const ctx = canvas.getContext('2d');
    if (truck) {
      ctx.fillStyle = '#d9dde3';
      ctx.fillRect(14, 30, s - 28, s - 64);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      for (let y = 40; y < s - 34; y += 12) ctx.fillRect(14, y, s - 28, 2);
      ctx.fillStyle = '#4b5563';
      ctx.fillRect(s / 2 - 24, s - 52, 48, 7);
      for (let x = 0; x < s; x += 32) {
        ctx.fillStyle = (x / 32) % 2 === 0 ? '#e23b3b' : '#ffffff';
        ctx.fillRect(x, s - 32, 32, 8);
      }
      ctx.fillStyle = style.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      fitFont(ctx, 'PARCEL EMPIRE', 900, 22, s - 40);
      ctx.fillText('PARCEL EMPIRE', s / 2, 16);
      drawPlate(ctx, s / 2 - 46, s - 22, 92, 20, style.plate);
    } else {
      ctx.fillStyle = '#121b25';
      roundRect(ctx, 22, 16, 96, 72, 10);
      ctx.fill();
      roundRect(ctx, 138, 16, 96, 72, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.moveTo(30, 80); ctx.lineTo(70, 22); ctx.lineTo(90, 22); ctx.lineTo(50, 80);
      ctx.moveTo(146, 80); ctx.lineTo(186, 22); ctx.lineTo(206, 22); ctx.lineTo(166, 80);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(126.5, 0, 3, s);
      ctx.fillStyle = '#c9ced6';
      roundRect(ctx, 102, 126, 18, 7, 3);
      ctx.fill();
      roundRect(ctx, 136, 126, 18, 7, 3);
      ctx.fill();
      brandMark(ctx, 34, 152, 30);
      ctx.fillStyle = style.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      fitFont(ctx, 'PARCEL EMPIRE', 900, 22, 150);
      ctx.fillText('PARCEL EMPIRE', 74, 168);
      drawPlate(ctx, s / 2 - 50, 204, 100, 26, style.plate);
    }
    return toTexture(canvas);
  });
}

/** Frontal: calandra, emblema y matrícula. */
function frontTexture(style, truck) {
  return cachedTexture(`front|${style.id}`, () => {
    const cw = 256;
    const ch = truck ? 112 : 84;
    const canvas = makeCanvas(cw, ch);
    const ctx = canvas.getContext('2d');
    if (style.electric) {
      ctx.fillStyle = 'rgba(15,25,35,0.85)';
      roundRect(ctx, 70, 10, 116, 16, 8);
      ctx.fill();
      ctx.fillStyle = '#9ff5d0';
      ctx.fillRect(78, 16, 100, 4);
    } else {
      const gw = truck ? 170 : 128;
      const gh = truck ? 62 : 34;
      const gx = (cw - gw) / 2;
      ctx.fillStyle = '#111419';
      roundRect(ctx, gx, 6, gw, gh, 8);
      ctx.fill();
      ctx.fillStyle = truck ? '#e6eaee' : '#7d8590';
      for (let y = 12; y < 6 + gh - 4; y += truck ? 9 : 8) ctx.fillRect(gx + 6, y, gw - 12, 3);
    }
    ctx.fillStyle = '#f4f6f8';
    ctx.beginPath();
    ctx.arc(cw / 2, truck ? 37 : 23, truck ? 11 : 9, 0, Math.PI * 2);
    ctx.fill();
    brandMark(ctx, cw / 2 - (truck ? 7 : 6), (truck ? 30 : 17), truck ? 14 : 12);
    drawPlate(ctx, cw / 2 - 46, ch - 26, 92, 22, style.plate);
    return toTexture(canvas);
  });
}

/** Paneles solares del techo de la eléctrica. */
function solarTexture() {
  return cachedTexture('solar', () => {
    const canvas = makeCanvas(128, 64);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1b2f5c';
    ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = 'rgba(170,200,255,0.55)';
    ctx.lineWidth = 1.5;
    for (let x = 0; x <= 128; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 64); ctx.stroke(); }
    for (let y = 0; y <= 64; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke(); }
    return toTexture(canvas);
  });
}

// --------------------------------------------------------- Carrocería ----

/**
 * Perfil lateral de la carrocería (o de la cabina del camión) en el plano x/y.
 * s: { y0, rearX, frontX, roofY, cabTopY, roofRamp, wsTopX, wsBotX, hoodY, noseY, noHood, arches, archR }
 */
function profileShape(s) {
  const shape = new THREE.Shape();
  const ws = (t) => [s.wsTopX + (s.wsBotX - s.wsTopX) * t, s.cabTopY + (s.hoodY - s.cabTopY) * t];
  shape.moveTo(s.rearX, s.y0 + 2);
  shape.lineTo(s.rearX, s.roofY - 2.2);
  shape.quadraticCurveTo(s.rearX, s.roofY, s.rearX + 2.2, s.roofY);
  if (s.roofRamp > 0) {
    shape.lineTo(s.wsTopX - s.roofRamp, s.roofY);
    shape.quadraticCurveTo(s.wsTopX - s.roofRamp * 0.35, s.roofY, s.wsTopX - 1.2, s.cabTopY + 0.6);
    shape.quadraticCurveTo(s.wsTopX, s.cabTopY, ...ws(0.1));
  } else {
    shape.lineTo(s.wsTopX - 2.2, s.cabTopY);
    shape.quadraticCurveTo(s.wsTopX, s.cabTopY, ...ws(0.1));
  }
  shape.lineTo(...ws(0.9));
  if (s.noHood) {
    shape.quadraticCurveTo(s.wsBotX, s.hoodY, s.frontX, s.hoodY - 2.4);
  } else {
    shape.quadraticCurveTo(s.wsBotX, s.hoodY, s.wsBotX + 2, s.hoodY - 0.15);
    shape.lineTo(s.frontX - 2.6, s.noseY);
    shape.quadraticCurveTo(s.frontX, s.noseY - 0.3, s.frontX, s.noseY - 2.8);
  }
  shape.lineTo(s.frontX, s.y0 + 1.6);
  shape.quadraticCurveTo(s.frontX, s.y0, s.frontX - 1.6, s.y0);
  for (const ax of [...s.arches].sort((a, b) => b - a)) {
    shape.lineTo(ax + s.archR, s.y0);
    shape.absarc(ax, s.y0 + 0.5, s.archR, 0, Math.PI, false);
    shape.lineTo(ax - s.archR, s.y0);
  }
  shape.lineTo(s.rearX + 1.6, s.y0);
  shape.quadraticCurveTo(s.rearX, s.y0, s.rearX, s.y0 + 2);
  return shape;
}

function roundedRectShape(x0, y0, x1, y1, r) {
  const shape = new THREE.Shape();
  shape.moveTo(x0 + r, y0);
  shape.lineTo(x1 - r, y0);
  shape.quadraticCurveTo(x1, y0, x1, y0 + r);
  shape.lineTo(x1, y1 - r);
  shape.quadraticCurveTo(x1, y1, x1 - r, y1);
  shape.lineTo(x0 + r, y1);
  shape.quadraticCurveTo(x0, y1, x0, y1 - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  return shape;
}

const BEVEL = 0.8;

/** Extruye un perfil a lo ancho del vehículo con los cantos redondeados. Ancho total = W. */
function extrudeSide(shape, W, bevelSize = BEVEL) {
  const thickness = 1.2;
  const depth = W - thickness * 2;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelThickness: thickness, bevelSize, bevelSegments: 2, curveSegments: 8,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

// ------------------------------------------------------------- Modelo ----

/**
 * Crea el modelo de un vehículo según su tipo.
 * Devuelve el grupo y los controles de luces, ruedas, dirección y cabina interior.
 */
export function createVehicleModel(type) {
  const style = styleFor(type);
  const L = type.length;
  const W = type.width;
  const truck = style.body === 'truck';
  const group = new THREE.Group();
  const ownMaterials = [];
  const ownGeometries = [];
  const cabinGlass = [];
  const own = (material) => { ownMaterials.push(material); return material; };
  const ownGeo = (geometry) => { ownGeometries.push(geometry); return geometry; };

  const add = (geometry, material, x, y, z, cast = false) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  /** Caja con la base en "y". */
  const box = (w, h, d, x, y, z, material, cast = false) => {
    const mesh = add(unitBox, material, x, y + h / 2, z, cast);
    mesh.scale.set(w, h, d);
    return mesh;
  };
  /** Plano decorativo (rotulación, cristales). rotY orienta la cara visible. */
  const decal = (w, h, material, x, y, z, rotY = 0) => {
    const mesh = add(ownGeo(new THREE.PlaneGeometry(w, h)), material, x, y, z);
    mesh.rotation.y = rotY;
    return mesh;
  };
  const cylinder = (radius, length, x, y, z, material, axis = 'y') => {
    const mesh = add(pipeGeometry, material, x, y, z);
    mesh.scale.set(radius, length, radius);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    return mesh;
  };

  const paint = own(std({ color: style.paint, roughness: 0.32, metalness: 0.35 }));

  // --- Perfil según el tipo
  let spec;
  if (truck) {
    const cabRear = L / 2 - L * 0.33;
    spec = {
      y0: 4.5, rearX: cabRear, frontX: L / 2, roofY: 34, cabTopY: 34, roofRamp: 0,
      wsTopX: L / 2 - 4.5, wsBotX: L / 2 - 1.4, hoodY: 18, noseY: 17, noHood: true,
      arches: [L * 0.33], archR: 6.5, tire: 5.3, cabRear,
    };
  } else {
    spec = {
      y0: 3.6, rearX: -L / 2, frontX: L / 2, roofY: style.roofY, cabTopY: style.cabTopY ?? style.roofY,
      roofRamp: style.roofRamp ?? 0, wsTopX: L * style.wsTop, wsBotX: L * style.wsBot, hoodY: style.hoodY,
      noseY: style.noseY, noHood: false, arches: [L * 0.28, -L * 0.28], archR: 6.5, tire: 4.7,
    };
  }
  const { y0, hoodY } = spec;
  const bodyMesh = add(ownGeo(extrudeSide(profileShape(spec), W)), paint, 0, 0, 0, true);
  bodyMesh.castShadow = true;

  // --- Cristales: parabrisas inclinado y ventanillas de las puertas
  {
    const ax = spec.wsTopX;
    const ay = spec.cabTopY;
    const dx = spec.wsBotX - ax;
    const dy = hoodY - ay;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len;
    const ny = dx / len;
    const geometry = ownGeo(new THREE.PlaneGeometry(len * 0.86, W - 3.6).rotateX(-Math.PI / 2));
    const windshield = add(geometry, SHARED.glass, ax + dx / 2 + nx * (BEVEL + 0.12), ay + dy / 2 + ny * (BEVEL + 0.12), 0);
    windshield.rotation.z = Math.atan2(dy, dx);
    cabinGlass.push(windshield);

    const beltY = truck ? 21.5 : hoodY + 1.2;
    const topY = spec.cabTopY - 1.8;
    const bpX = truck ? spec.cabRear + 2.5 : spec.wsTopX - L * 0.17;
    const xw = (y) => spec.wsTopX + (spec.wsBotX - spec.wsTopX) * ((spec.cabTopY - y) / (spec.cabTopY - hoodY)) - 0.9;
    const windowShape = new THREE.Shape();
    windowShape.moveTo(bpX, beltY);
    windowShape.lineTo(xw(beltY), beltY);
    windowShape.lineTo(xw(topY), topY);
    windowShape.lineTo(bpX + 0.8, topY);
    windowShape.closePath();
    const windowGeometry = ownGeo(new THREE.ShapeGeometry(windowShape));
    for (const side of [-1, 1]) cabinGlass.push(add(windowGeometry, SHARED.glass, 0, 0, side * (W / 2 + 0.05)));
    spec.beltY = beltY;
    spec.bpX = bpX;
  }

  // --- Ruedas (las delanteras giran al torcer)
  const tires = [];
  const steerPivots = [];
  const wheelXs = truck ? [L * 0.33, -L * 0.18, -L * 0.33] : [L * 0.28, -L * 0.28];
  const R = spec.tire;
  wheelXs.forEach((wx, index) => {
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, R, side * (W / 2 - 2.1));
      group.add(pivot);
      const tire = new THREE.Mesh(tireGeometry(R), SHARED.tire);
      tire.castShadow = true;
      pivot.add(tire);
      buildRim(tire, style.rims, R, side);
      tires.push(tire);
      if (index === 0) steerPivots.push(pivot);
    }
  });

  // --- Paragolpes, retrovisores, manetas y limpiaparabrisas
  const bumperMaterial = style.bumper === 'body' ? paint : truck ? SHARED.chrome : SHARED.plastic;
  box(2.4, 3.6, W + 0.3, spec.frontX + 0.8, y0 - 1.3, 0, bumperMaterial, true);
  if (style.bumper === 'body') box(2.6, 1, W - 2, spec.frontX + 0.9, y0 - 1.5, 0, SHARED.plastic);
  for (const side of [-1, 1]) {
    const mx = spec.wsBotX - (truck ? 1.5 : 0.6);
    const my = hoodY + (truck ? 4 : 1.8);
    box(1.2, 0.6, 2.2, mx, my + 1.2, side * (W / 2 + 1), SHARED.plastic);
    box(1.6, truck ? 6 : 3.4, 2.2, mx - 0.2, my, side * (W / 2 + 2.5), truck ? SHARED.chrome : paint);
    box(2, 0.5, 0.3, spec.bpX + 1.8, spec.beltY - 1.8, side * (W / 2 + 0.12), SHARED.chrome);
    box(0.25, spec.beltY - y0 - 2, 0.12, spec.bpX, y0 + 2, side * (W / 2 + 0.05), SHARED.trim);
  }
  for (const wz of [-W * 0.16, W * 0.2]) {
    const wiper = box(0.35, 0.35, W * 0.34, spec.wsBotX - 0.4, hoodY + 0.9, wz, SHARED.trim);
    wiper.rotation.y = 0.12;
  }

  // --- Frontal: calandra, matrícula y faros
  const frontH = (truck ? hoodY - 2.6 : spec.noseY - 3.2) - (y0 + 1.8);
  decal(W - 3.4, frontH, decalMaterial(`front|${style.id}`, frontTexture(style, truck)),
    spec.frontX + BEVEL + 0.05, y0 + 1.8 + frontH / 2, 0, Math.PI / 2);
  const headlight = own(std({ color: '#f4f1d0', emissive: '#fff2b0', emissiveIntensity: 0.2, roughness: 0.2 }, 0.8));
  const taillight = own(std({ color: '#a31d1d', emissive: '#ff2a2a', emissiveIntensity: 0.3, roughness: 0.3 }, 0.6));
  const lightY = truck ? y0 + 6.2 : spec.noseY - 5.4;
  for (const side of [-1, 1]) box(1, truck ? 2.6 : 2.2, style.electric ? 3.6 : 4.6, spec.frontX + BEVEL + 0.2, lightY, side * (W / 2 - 3.6), headlight);
  if (style.electric) box(0.7, 0.9, W - 5, spec.frontX + BEVEL + 0.15, spec.noseY - 3.4, 0, headlight);

  // --- Carga: furgón o caja del camión, rotulación lateral y trasera
  let rearX = spec.rearX;
  if (truck) {
    const boxPaint = own(std({ color: style.boxPaint, roughness: 0.45, metalness: 0.1 }, 0.6));
    const boxFront = spec.cabRear - 2.2;
    const boxBottom = 11.6;
    const boxTop = 38;
    rearX = -L / 2;
    add(ownGeo(extrudeSide(roundedRectShape(rearX, boxBottom, boxFront, boxTop, 1.6), W, 0.6)), boxPaint, 0, 0, 0, true).castShadow = true;
    box(L * 0.94, 2.6, W - 7, -L * 0.02, 5.6, 0, SHARED.trim, true);
    box(boxFront - rearX, 1.6, W - 4, (boxFront + rearX) / 2, 10, 0, SHARED.trim);
    const lw = boxFront - rearX - 3;
    const lh = boxTop - boxBottom - 3;
    const livery = decalMaterial(`livery|${style.id}`, liveryTexture(style, lw, lh));
    decal(lw, lh, livery, (boxFront + rearX) / 2, (boxTop + boxBottom) / 2, W / 2 + 0.07);
    decal(lw, lh, livery, (boxFront + rearX) / 2, (boxTop + boxBottom) / 2, -W / 2 - 0.07, Math.PI);
    decal(W - 2, boxTop - boxBottom - 1, decalMaterial(`rear|${style.id}`, rearTexture(style, true)),
      rearX - 0.65, (boxTop + boxBottom) / 2, 0, -Math.PI / 2);
    for (const side of [-1, 1]) {
      box(0.8, 4.5, 2.6, rearX - 0.5, 12.5, side * (W / 2 - 2), taillight);
      cylinder(2.2, 7, 4, 6.6, side * (W / 2 - 2.4), SHARED.chrome, 'x');
      box(0.3, 4, 5, -L * 0.33 - 6.2, 1.5, side * (W / 2 - 3), SHARED.trim);
      box(5, 0.6, 1.4, spec.cabRear + 2.8, 4.2, side * (W / 2 + 0.5), SHARED.trim);
    }
    box(1.2, 1.4, W - 2, rearX + 0.4, 5.4, 0, SHARED.trim);
    cylinder(0.85, 31, spec.cabRear - 1.4, 9 + 15.5, W / 2 - 0.6, SHARED.chrome);
    box(2, 1.2, 5, spec.wsTopX - 3, spec.roofY + BEVEL, 0, SHARED.amber);
    for (const side of [-1, 1]) cylinder(0.5, 4, spec.wsTopX - 7, spec.roofY + BEVEL + 0.6, side * 2.5, SHARED.chrome, 'x');
    // Emblema en las puertas de la cabina
    const badge = decalMaterial(`badge|${style.id}`, liveryTexture({ ...style, accent: 'rgba(0,0,0,0)', accent2: 'rgba(0,0,0,0)', text: '#ffffff', tagline: '', web: '' }, 7, 3));
    decal(7, 3, badge, spec.cabRear + 6.5, 14.5, W / 2 + 0.07);
    decal(7, 3, badge, spec.cabRear + 6.5, 14.5, -W / 2 - 0.07, Math.PI);
  } else {
    const lx0 = spec.rearX + 1.2;
    const lx1 = spec.bpX - 1;
    const ly0 = 10.8;
    const ly1 = spec.roofY - 1.8;
    const livery = decalMaterial(`livery|${style.id}`, liveryTexture(style, lx1 - lx0, ly1 - ly0));
    decal(lx1 - lx0, ly1 - ly0, livery, (lx0 + lx1) / 2, (ly0 + ly1) / 2, W / 2 + 0.07);
    decal(lx1 - lx0, ly1 - ly0, livery, (lx0 + lx1) / 2, (ly0 + ly1) / 2, -W / 2 - 0.07, Math.PI);
    const rearH = spec.roofY - 2.4 - (y0 + 2.2);
    decal(W - 3, rearH, decalMaterial(`rear|${style.id}`, rearTexture(style, false)),
      spec.rearX - BEVEL - 0.05, y0 + 2.2 + rearH / 2, 0, -Math.PI / 2);
    box(2.2, 3.6, W + 0.3, spec.rearX - 0.7, y0 - 1.3, 0, bumperMaterial, true);
    for (const side of [-1, 1]) box(0.8, 7, 2.4, spec.rearX - BEVEL - 0.2, y0 + 6, side * (W / 2 - 1.9), taillight);
    if (!style.electric) cylinder(0.6, 3, spec.rearX + 1, y0 - 0.4, -W / 2 + 4, SHARED.chrome, 'x');
    const cargoLength = lx1 - spec.rearX;
    const roofTop = spec.roofY + BEVEL;
    if (style.roof === 'rails') {
      for (const side of [-1, 1]) box(cargoLength * 0.85, 0.8, 0.9, spec.rearX + cargoLength * 0.5, roofTop + 0.9, side * (W / 2 - 3), SHARED.trim);
      for (let i = 0; i < 3; i++) box(1, 0.6, W - 5, spec.rearX + cargoLength * (0.2 + i * 0.3), roofTop + 1.7, 0, SHARED.trim);
    } else if (style.roof === 'solar') {
      const panel = box(cargoLength * 0.8, 0.45, W - 6, spec.rearX + cargoLength * 0.48, roofTop + 0.2, 0, SHARED.solar);
      panel.material = decalMaterial('solar', solarTexture());
      box(cargoLength * 0.82, 0.3, W - 5.6, spec.rearX + cargoLength * 0.48, roofTop, 0, SHARED.trim);
      box(0.3, 1.6, 1.6, spec.wsBotX + 1.5, hoodY - 4, -W / 2 - 0.12, SHARED.charge);
    } else if (style.roof === 'markers') {
      for (const mz of [-4, 0, 4]) box(1.4, 0.9, 1.8, spec.wsTopX - spec.roofRamp - 0.5, roofTop, mz, SHARED.amber);
    }
    if (style.sideMarkers) {
      for (const side of [-1, 1]) for (const mx of [-L * 0.06, L * 0.06]) box(2, 1, 0.3, mx, y0 + 1.6, side * (W / 2 + 0.1), SHARED.amber);
    }
  }

  // --- Haz de luz de los faros sobre el suelo (solo de noche)
  const beamMaterial = own(new THREE.MeshBasicMaterial({
    map: getBeamTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(L / 2 + 48, 0.9, 0);
  beam.visible = false;
  group.add(beam);

  // --- Cabina interior (se crea la primera vez que se usa la vista del conductor)
  const eye = new THREE.Vector3(spec.wsTopX - (truck ? 6 : 4.5), spec.cabTopY - (truck ? 6.5 : 5.5), -W * 0.22);
  const cockpitSpec = {
    eye,
    wheel: new THREE.Vector3(eye.x + (truck ? 4.6 : 5.2), eye.y - 5.5, eye.z),
    wheelTilt: truck ? -0.8 : -0.45,
    dashBackX: eye.x + 7.2,
    dashFrontX: spec.wsBotX + 0.5,
    dashTopY: hoodY + 0.6,
    dashBottomY: hoodY - 5,
    innerHalfW: W / 2 - 1.4,
    wsTop: [spec.wsTopX, spec.cabTopY],
    wsBot: [spec.wsBotX, hoodY],
    floorY: y0 + 3,
    beltY: spec.beltY,
    roofY: spec.cabTopY,
    cabRearX: eye.x - 9,
  };
  let cockpit = null;
  const state = { braking: false, lights: false, interior: false, steer: 0 };

  return {
    group,
    wheels: tires,
    eye,
    setBraking(value) {
      if (value === state.braking) return;
      state.braking = value;
      taillight.emissiveIntensity = value ? 2.2 : 0.3;
    },
    setLights(on) {
      if (on === state.lights) return;
      state.lights = on;
      headlight.emissiveIntensity = on ? 2.4 : 0.2;
      beam.visible = on;
      beamMaterial.opacity = on ? 0.55 : 0;
    },
    spin(distance) {
      for (const tire of tires) tire.rotation.z -= distance / R;
    },
    /** value entre -1 (izquierda) y 1 (derecha): gira las ruedas delanteras y el volante. */
    setSteer(value) {
      state.steer = value;
      for (const pivot of steerPivots) pivot.rotation.y = -value * 0.42;
      if (cockpit) cockpit.spin.rotation.z = value * 2.3;
    },
    /** Vista del conductor: muestra la cabina y oculta los cristales que taparían la vista. */
    setInteriorView(on) {
      if (on === state.interior) return;
      state.interior = on;
      if (on && !cockpit) {
        cockpit = buildCockpit(cockpitSpec, style);
        group.add(cockpit.group);
        cockpit.spin.rotation.z = state.steer * 2.3;
      }
      if (cockpit) cockpit.group.visible = on;
      for (const glass of cabinGlass) glass.visible = !on;
    },
    /** Actualiza el cuadro de mandos y la pantalla de navegación (solo con la cabina visible). */
    updateCockpit(info) {
      if (!cockpit || !state.interior) return;
      drawGauge(cockpit.gauge.ctx, cockpit.gauge.canvas, info, style);
      cockpit.gauge.texture.needsUpdate = true;
      drawNavScreen(cockpit.screen.ctx, cockpit.screen.canvas, info);
      cockpit.screen.texture.needsUpdate = true;
    },
    dispose() {
      for (const material of ownMaterials) releaseMaterial(material);
      for (const geometry of ownGeometries) geometry.dispose();
      cockpit?.dispose();
    },
  };
}

/** Llanta según el estilo, pegada a la cara exterior del neumático. */
function buildRim(tire, kind, R, side) {
  const rim = new THREE.Group();
  rim.position.z = side * 1.95;
  tire.add(rim);
  const disc = (r, material) => rim.add(new THREE.Mesh(discGeometry(r), material));
  if (kind === 'alloy') {
    disc(+(R * 0.7).toFixed(2), SHARED.trim);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(unitBox, RIMS.alloy);
      spoke.scale.set(0.8, R * 0.62, 0.4);
      spoke.position.set(-Math.sin(a) * R * 0.33, Math.cos(a) * R * 0.33, side * 0.25);
      spoke.rotation.z = a;
      rim.add(spoke);
    }
  } else {
    disc(+(R * 0.68).toFixed(2), RIMS[kind] ?? RIMS.steel);
  }
  const hub = new THREE.Mesh(hubGeometry, kind === 'steel' ? RIMS.alloy : SHARED.chrome);
  hub.position.z = side * 0.2;
  rim.add(hub);
}

// ------------------------------------------------------- Cabina interior ----

const COCKPIT_GEOMETRY = {
  rim: new THREE.TorusGeometry(3.1, 0.42, 10, 32),
  column: new THREE.CylinderGeometry(0.45, 0.6, 3.4, 10).rotateX(Math.PI / 2),
  hub: new THREE.CylinderGeometry(1.15, 1.15, 0.7, 18).rotateX(Math.PI / 2),
  logo: new THREE.CircleGeometry(0.8, 20).rotateY(Math.PI),
  glove: new THREE.SphereGeometry(0.8, 12, 8),
  lever: new THREE.CylinderGeometry(0.22, 0.22, 2.2, 8),
  knob: new THREE.SphereGeometry(0.6, 10, 8),
  gauge: new THREE.PlaneGeometry(5.6, 2.8),
  screen: new THREE.PlaneGeometry(4.6, 2.9),
};

function buildCockpit(c, style) {
  const group = new THREE.Group();
  const materials = [];
  const textures = [];
  const add = (geometry, material, x, y, z, parent = group) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const box = (w, h, d, x, y, z, material) => {
    const mesh = add(unitBox, material, x, y + h / 2, z);
    mesh.scale.set(w, h, d);
    return mesh;
  };
  const width = c.innerHalfW * 2;

  // Suelo, salpicadero y visera del cuadro
  const floorLength = c.dashFrontX - c.cabRearX;
  box(floorLength, 0.6, width, c.cabRearX + floorLength / 2, c.floorY, 0, SHARED.interior);
  const dashLength = c.dashFrontX - c.dashBackX;
  box(dashLength, c.dashTopY - c.dashBottomY, width, c.dashBackX + dashLength / 2, c.dashBottomY, 0, SHARED.interior);
  box(2.2, 1.3, 7, c.dashBackX + 0.9, c.dashTopY, c.eye.z, SHARED.interior);
  box(0.4, 0.6, width, c.dashBackX - 0.1, c.dashTopY - 0.4, 0, SHARED.interiorSoft);

  // Pilares delanteros, techo, marco superior y retrovisor
  const [tx, ty] = c.wsTop;
  const [bx, by] = c.wsBot;
  const pillarLength = Math.hypot(tx - bx, ty - by);
  for (const side of [-1, 1]) {
    const pillar = add(unitBox, SHARED.trim, (tx + bx) / 2, (ty + by) / 2, side * (c.innerHalfW - 0.4));
    pillar.scale.set(pillarLength, 1.3, 1.3);
    pillar.rotation.z = Math.atan2(ty - by, tx - bx);
  }
  const roofLength = tx - c.cabRearX;
  box(roofLength, 0.7, width, c.cabRearX + roofLength / 2, c.roofY - 1.6, 0, SHARED.headliner);
  box(1.6, 1.4, width, tx - 0.4, c.roofY - 2.3, 0, SHARED.trim);
  box(0.6, 1.4, 3.8, tx - 1.6, c.roofY - 4, 0.5, SHARED.trim);

  // Paneles de las puertas
  const doorLength = c.dashFrontX - c.cabRearX;
  for (const side of [-1, 1]) {
    box(doorLength, c.beltY - c.floorY, 0.8, c.cabRearX + doorLength / 2, c.floorY, side * (c.innerHalfW + 0.2), SHARED.interiorSoft);
    box(doorLength, 0.5, 1.4, c.cabRearX + doorLength / 2, c.beltY, side * (c.innerHalfW - 0.1), SHARED.interior);
  }

  // Consola central y palanca de cambios
  box(5, 2.6, 3.2, c.eye.x + 2.5, c.floorY + 0.6, 0.3, SHARED.interior);
  add(COCKPIT_GEOMETRY.lever, SHARED.chrome, c.eye.x + 3.5, c.floorY + 4.3, 0.3);
  add(COCKPIT_GEOMETRY.knob, SHARED.trim, c.eye.x + 3.5, c.floorY + 5.5, 0.3);

  // Volante: mount (inclinación) → face (mira hacia el conductor) → spin (giro del volante)
  const accent = new THREE.MeshBasicMaterial({ color: style.electric ? '#2be38b' : '#ffb703' });
  materials.push(accent);
  const mount = new THREE.Group();
  mount.position.copy(c.wheel);
  mount.rotation.z = c.wheelTilt;
  group.add(mount);
  const face = new THREE.Group();
  face.rotation.y = Math.PI / 2;
  mount.add(face);
  add(COCKPIT_GEOMETRY.column, SHARED.interior, 0, 0, 2, face);
  const spin = new THREE.Group();
  face.add(spin);
  add(COCKPIT_GEOMETRY.rim, SHARED.trim, 0, 0, 0, spin);
  const spokeBottom = add(unitBox, SHARED.interior, 0, -1.5, 0, spin);
  spokeBottom.scale.set(0.6, 3, 0.3);
  for (const sx of [-1, 1]) {
    const spoke = add(unitBox, SHARED.interior, sx * 1.6, 0.1, 0, spin);
    spoke.scale.set(3, 0.6, 0.3);
  }
  add(COCKPIT_GEOMETRY.hub, SHARED.interior, 0, 0, 0, spin);
  add(COCKPIT_GEOMETRY.logo, accent, 0, 0, -0.42, spin);
  for (const sx of [-1, 1]) {
    const a = (50 * Math.PI) / 180;
    add(COCKPIT_GEOMETRY.glove, SHARED.glove, sx * 3.1 * Math.sin(a), 3.1 * Math.cos(a), -0.3, spin);
  }

  // Cuadro de mandos y pantalla de navegación (texturas dibujadas con canvas)
  const panel = (width, height) => {
    const canvas = makeCanvas(width, height);
    const texture = toTexture(canvas);
    textures.push(texture);
    const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
    materials.push(material);
    return { canvas, ctx: canvas.getContext('2d'), texture, material };
  };
  const gauge = panel(512, 256);
  const gaugeMesh = add(COCKPIT_GEOMETRY.gauge, gauge.material, c.dashBackX - 0.06, c.dashTopY - 1.75, c.eye.z);
  gaugeMesh.rotation.y = -Math.PI / 2;
  const screen = panel(384, 240);
  const screenMesh = add(COCKPIT_GEOMETRY.screen, screen.material, c.dashBackX - 0.5, c.dashTopY - 2, 0.6);
  screenMesh.rotation.y = -Math.PI / 2 - 0.25;

  // La cabina se ilumina sin sombras propias para que se lea bien
  group.traverse((object) => {
    object.castShadow = false;
    object.receiveShadow = false;
  });

  return {
    group,
    spin,
    gauge,
    screen,
    dispose() {
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
    },
  };
}

/** Cuadro de mandos: velocímetro, marcha y carga. info = { kmh, reverse, cargoUsed, capacity, clock } */
function drawGauge(ctx, canvas, info, style) {
  const w = canvas.width;
  const h = canvas.height;
  const accent = style.electric ? '#2be38b' : '#ffb703';
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#07090d';
  roundRect(ctx, 0, 0, w, h, 26);
  ctx.fill();

  const cx = w * 0.3;
  const cy = h * 0.6;
  const r = h * 0.4;
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const t = Math.min(1, info.kmh / 90);
  ctx.lineCap = 'round';
  ctx.lineWidth = 12;
  ctx.strokeStyle = '#232a36';
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep);
  ctx.stroke();
  ctx.strokeStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep * Math.max(0.001, t));
  ctx.stroke();
  ctx.fillStyle = '#9aa6bb';
  ctx.font = `600 14px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= 90; v += 30) {
    const a = start + sweep * (v / 90);
    ctx.fillText(String(v), cx + Math.cos(a) * (r - 26), cy + Math.sin(a) * (r - 26));
  }
  const needle = start + sweep * t;
  ctx.strokeStyle = '#ff4d4d';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(needle) * (r - 10), cy + Math.sin(needle) * (r - 10));
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 44px ${FONT}`;
  ctx.fillText(String(Math.round(info.kmh)), cx, cy + r * 0.55);
  ctx.font = `600 14px ${FONT}`;
  ctx.fillStyle = '#9aa6bb';
  ctx.fillText('km/h', cx, cy + r * 0.92);

  const rx = w * 0.72;
  ctx.font = `900 64px ${FONT}`;
  ctx.fillStyle = info.reverse ? '#ff8f8f' : accent;
  ctx.fillText(info.reverse ? 'R' : 'D', rx, h * 0.3);
  ctx.font = `700 22px ${FONT}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(info.clock, rx, h * 0.56);
  const used = info.capacity ? info.cargoUsed / info.capacity : 0;
  ctx.fillStyle = '#232a36';
  roundRect(ctx, rx - 80, h * 0.7, 160, 18, 9);
  ctx.fill();
  ctx.fillStyle = used >= 1 ? '#ff8f8f' : '#8ad7ff';
  roundRect(ctx, rx - 80, h * 0.7, Math.max(18, 160 * used), 18, 9);
  ctx.fill();
  ctx.fillStyle = '#9aa6bb';
  ctx.font = `600 15px ${FONT}`;
  ctx.fillText(`Carga ${info.cargoUsed}/${info.capacity}`, rx, h * 0.88);
}

/** Pantalla central: flecha hacia el destino, distancia y dirección. */
function drawNavScreen(ctx, canvas, info) {
  const w = canvas.width;
  const h = canvas.height;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#13213f');
  g.addColorStop(1, '#0a1226');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 0, w, 34);
  ctx.fillStyle = '#ffd166';
  ctx.font = `800 17px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('PARCEL NAV', 14, 17);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(info.clock, w - 14, 17);

  ctx.textAlign = 'center';
  if (!info.target) {
    ctx.fillStyle = '#b9c3da';
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText('Sin destino', w / 2, h * 0.5);
    ctx.font = `600 15px ${FONT}`;
    ctx.fillText('Espera nuevos pedidos', w / 2, h * 0.68);
    return;
  }
  const ax = w * 0.27;
  const ay = h * 0.58;
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(info.target.relAngle);
  ctx.fillStyle = info.target.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -52);
  ctx.lineTo(36, 12);
  ctx.lineTo(10, 4);
  ctx.lineTo(10, 46);
  ctx.lineTo(-10, 46);
  ctx.lineTo(-10, 4);
  ctx.lineTo(-36, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = `900 40px ${FONT}`;
  ctx.fillText(`${info.target.meters} m`, w * 0.5, h * 0.48);
  ctx.fillStyle = '#b9c3da';
  fitFont(ctx, info.target.label, 700, 18, w * 0.47);
  ctx.fillText(info.target.label, w * 0.5, h * 0.7);
}

// ------------------------------------------------------------------ Drones ----

function phong(hex) {
  return new THREE.MeshPhongMaterial({ color: new THREE.Color(hex), specular: '#4a4f5a', shininess: 45 });
}

const DRONE_SCALE = { drone_basic: 1, drone_advanced: 1.1, drone_heavy: 1.4 };
const armGeometry = new THREE.BoxGeometry(31, 1.5, 2);
const rotorDiscGeometry = new THREE.CircleGeometry(8.5, 18).rotateX(-Math.PI / 2);
const bladeGeometry = new THREE.BoxGeometry(15, 0.5, 1.6);
const bodyGeometry = new THREE.SphereGeometry(5.5, 12, 8);
const shadowGeometry = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
const packageGeometry = new THREE.BoxGeometry(7, 6, 7);
const tapeGeometry = new THREE.BoxGeometry(7.3, 1.3, 7.3);
const ledGeometry = new THREE.SphereGeometry(1.3, 6, 4);

/** Dron: "root" va sobre el suelo (con su sombra) y "air" sube y baja con la altitud. */
export function createDroneModel(type) {
  const root = new THREE.Group();
  const air = new THREE.Group();
  root.add(air);
  air.scale.setScalar((DRONE_SCALE[type.id] ?? 1) * 1.15);

  const bodyMaterial = phong(type.color);
  const armMaterial = new THREE.MeshLambertMaterial({ color: '#2b303b' });
  const discMaterial = new THREE.MeshBasicMaterial({ color: '#d2e1f0', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const bladeMaterial = new THREE.MeshBasicMaterial({ color: '#1f2430' });
  const ledMaterial = new THREE.MeshBasicMaterial({ color: '#ff4d4d' });
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false });
  const packageMaterial = new THREE.MeshLambertMaterial({ color: '#c99a62' });
  const tapeMaterial = new THREE.MeshLambertMaterial({ color: '#e8c48e' });

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.scale.set(1, 0.62, 1);
  body.castShadow = true;
  air.add(body);
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const arm = new THREE.Mesh(armGeometry, armMaterial);
    arm.rotation.y = angle;
    arm.castShadow = true;
    air.add(arm);
  }
  const blades = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const rotor = new THREE.Group();
    rotor.position.set(sx * 11, 2.2, sz * 11);
    rotor.add(new THREE.Mesh(rotorDiscGeometry, discMaterial));
    const blade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    rotor.add(blade);
    blades.push(blade);
    air.add(rotor);
  }
  const led = new THREE.Mesh(ledGeometry, ledMaterial);
  led.position.set(5, 0.5, 0);
  air.add(led);

  const cargo = new THREE.Group();
  cargo.position.set(0, -6.5, 0);
  cargo.add(new THREE.Mesh(packageGeometry, packageMaterial));
  cargo.add(new THREE.Mesh(tapeGeometry, tapeMaterial));
  cargo.visible = false;
  air.add(cargo);

  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadow.position.y = 0.7;
  root.add(shadow);

  return {
    root,
    altitude: 5,
    /** altitude = altura objetivo; blob = si se dibuja la sombra redonda sobre el suelo. */
    update(dt, time, { altitude, carrying, lightsOn, rotating, blob }) {
      this.altitude += (altitude - this.altitude) * (1 - Math.exp(-3 * dt));
      air.position.y = this.altitude;
      const spin = rotating ? 38 : 4;
      for (const blade of blades) blade.rotation.y += spin * dt;
      cargo.visible = carrying;
      ledMaterial.color.set(lightsOn || Math.floor(time * 3) % 2 === 0 ? '#ff4d4d' : '#7a1f1f');
      shadow.visible = blob;
      const spread = 9 + this.altitude * 0.12;
      shadow.scale.set(spread, 1, spread);
      shadowMaterial.opacity = Math.max(0.1, 0.3 - this.altitude * 0.002);
    },
    setHeading(angle) {
      air.rotation.y = -angle;
    },
    dispose() {
      for (const material of [bodyMaterial, armMaterial, discMaterial, bladeMaterial, ledMaterial, shadowMaterial, packageMaterial, tapeMaterial]) material.dispose();
    },
  };
}
