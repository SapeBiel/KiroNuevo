// Materiales y texturas de superficie del modo 3D, generados por código y compartidos.
//
// · Texturas procedurales en escala de grises (se tiñen con el color de cada pieza): cartón, madera, metal
//   cepillado, tela, goma y un "borde" que oscurece suavemente los cantos de cada cara (simula el bisel y la
//   oclusión de las esquinas). Todas son repetibles sin costuras.
// · Texturas de color para superficies grandes: hormigón con juntas, paneles de nave, chapa del techo, tejas.
// · "Acabados" (FINISHES): mate, satinado, plástico, metal, pintura, madera, cartón, goma, tela, cristal…
//   Cada acabado es un MeshStandardMaterial compartido con su rugosidad y metalicidad; las piezas instanciadas
//   lo eligen por nombre (ver products3d.js). Los reflejos usan el cielo pre-calculado del renderizador.

import * as THREE from '../vendor/three.module.js';
import { createRng } from '../core/random.js';
import { makeCanvas, toTexture } from './textures3d.js';

// ------------------------------------------------------------ Reflejos ----

const envMaterials = new Set();
let envTexture = null;
let envLevel = 0.5;

/** El renderizador pasa aquí el cielo pre-calculado (y lo atenúa de noche). */
export function setSurfaceEnvironment(texture, level) {
  const changed = texture !== envTexture;
  envTexture = texture;
  envLevel = level;
  for (const material of envMaterials) applyEnv(material, changed);
}

function applyEnv(material, force) {
  if (force || material.envMap !== envTexture) {
    material.envMap = envTexture;
    material.needsUpdate = true;
  }
  material.envMapIntensity = envLevel * (material.userData.envBoost ?? 1);
}

/** Registra un material estándar para que reciba los reflejos del entorno. */
export function withEnvironment(material, boost = 1) {
  material.userData.envBoost = boost;
  envMaterials.add(material);
  applyEnv(material, true);
  return material;
}

export function releaseEnvironment(material) {
  envMaterials.delete(material);
}

// ------------------------------------------------------------ Ruido ----

const NOISE_TABLE = 256;

/**
 * Ruido de valor con interpolación suave. noise(x, y, px, py) se repite cada px celdas en x y py en y
 * (así las texturas no tienen costuras al repetirse).
 */
function makeNoise(seed) {
  const rng = createRng(seed);
  const table = new Float32Array(NOISE_TABLE * NOISE_TABLE);
  for (let i = 0; i < table.length; i++) table[i] = rng();
  const wrap = (i, p) => ((((i % p) + p) % p) % NOISE_TABLE);
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y, px, py) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = smooth(x - xi);
    const fy = smooth(y - yi);
    const x0 = wrap(xi, px);
    const x1 = wrap(xi + 1, px);
    const y0 = wrap(yi, py) * NOISE_TABLE;
    const y1 = wrap(yi + 1, py) * NOISE_TABLE;
    const a = table[y0 + x0];
    const b = table[y0 + x1];
    const c = table[y1 + x0];
    const d = table[y1 + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/**
 * Ruido fractal repetible en [0, 1] para u, v en [0, 1): fx, fy = celdas (enteras) de la primera octava
 * en cada eje (distintas para vetas alargadas).
 */
function fbm(noise, u, v, fx, fy = fx, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let px = fx;
  let py = fy;
  for (let o = 0; o < octaves; o++) {
    sum += noise(u * px, v * py, px, py) * amp;
    norm += amp;
    amp *= 0.5;
    px *= 2;
    py *= 2;
  }
  return sum / norm;
}

/** Pinta una textura píxel a píxel: fn(u, v) → valor gris [0, 1] o [r, g, b] en [0, 1]. */
function paintPixels(size, fn, height = size) {
  const canvas = makeCanvas(size, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, height);
  const data = image.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < size; x++) {
      const value = fn(x / size, y / height, x, y);
      const i = (y * size + x) * 4;
      if (typeof value === 'number') {
        const g = Math.max(0, Math.min(255, Math.round(value * 255)));
        data[i] = g; data[i + 1] = g; data[i + 2] = g;
      } else {
        data[i] = Math.max(0, Math.min(255, Math.round(value[0] * 255)));
        data[i + 1] = Math.max(0, Math.min(255, Math.round(value[1] * 255)));
        data[i + 2] = Math.max(0, Math.min(255, Math.round(value[2] * 255)));
      }
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Oscurecimiento suave junto a los bordes de una cara (u, v en [0, 1]). */
function edgeShade(u, v, width = 0.07, depth = 0.24) {
  const d = Math.min(u, v, 1 - u, 1 - v);
  if (d >= width) return 1;
  const t = d / width;
  return 1 - depth * (1 - t * t * (3 - 2 * t));
}

// ------------------------------------------------------------ Texturas ----

const textureCache = new Map();

function cached(key, create) {
  let texture = textureCache.get(key);
  if (!texture) {
    texture = create();
    textureCache.set(key, texture);
  }
  return texture;
}

/** Texturas para caras de caja (u, v de 0 a 1 en cada cara). "edges" oscurece los cantos. */
const SURFACES = {
  plain(noise, u, v) {
    return 0.97 + (fbm(noise, u, v, 6, 6, 3) - 0.5) * 0.06;
  },
  cardboard(noise, u, v) {
    // Fibras alargadas, ondulación del cartón y alguna mancha
    const fibre = fbm(noise, u, v, 4, 36, 4);
    const flutes = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 22);
    const stain = fbm(noise, u + 0.37, v + 0.11, 3, 3, 3);
    return 0.8 + fibre * 0.16 + flutes * 0.025 - Math.max(0, stain - 0.62) * 0.35;
  },
  wood(noise, u, v) {
    // Tablero de listones: veta alargada en u y juntas entre listones
    const plank = Math.floor(v * 6);
    const local = v * 6 - plank;
    const grain = fbm(noise, u + plank * 0.173, local * 0.18 + plank * 0.31, 3, 24, 4);
    const rings = 0.5 + 0.5 * Math.sin((grain * 9 + u * 2) * Math.PI);
    const seam = local < 0.04 || local > 0.96 ? 0.8 : 1;
    const tone = 0.86 + ((plank * 37) % 7) * 0.016;
    return (tone - 0.08 + grain * 0.12 + rings * 0.05) * seam;
  },
  metal(noise, u, v) {
    // Cepillado horizontal fino
    const brushed = fbm(noise, u, v, 2, 48, 4);
    const scratch = fbm(noise, u + 0.5, v + 0.5, 12, 12, 2) > 0.78 ? 0.04 : 0;
    return 0.83 + brushed * 0.12 + scratch;
  },
  fabric(noise, u, v, x, y) {
    const weave = ((x >> 1) + (y >> 1)) % 2 === 0 ? 0.04 : -0.04;
    return 0.86 + weave + (fbm(noise, u, v, 8, 8, 3) - 0.5) * 0.1;
  },
  rubber(noise, u, v) {
    return 0.82 + (fbm(noise, u, v, 10, 10, 3) - 0.5) * 0.12;
  },
  plastic(noise, u, v) {
    return 0.95 + (fbm(noise, u, v, 5, 5, 2) - 0.5) * 0.04;
  },
};

/** Textura de superficie (gris, se tiñe con el color de la pieza). */
export function surfaceTexture(name, edges = false) {
  return cached(`surface|${name}|${edges}`, () => {
    const noise = makeNoise(name.length * 131 + 7);
    const fn = SURFACES[name] ?? SURFACES.plain;
    const size = name === 'plain' || name === 'plastic' ? 128 : 256;
    const canvas = paintPixels(size, (u, v, x, y) => fn(noise, u, v, x, y) * (edges ? edgeShade(u, v) : 1));
    const texture = toTexture(canvas, { repeat: true });
    texture.colorSpace = THREE.NoColorSpace; // es un factor de brillo, no un color
    return texture;
  });
}

/**
 * Hormigón pulido del almacén: manchas suaves, árido fino y juntas de corte cada "tile" px.
 * Se repite; un tile de textura cubre `tile` px del mapa.
 */
export function concreteTexture() {
  return cached('concrete', () => {
    const noise = makeNoise(9101);
    const canvas = paintPixels(512, (u, v, x, y) => {
      const blotch = fbm(noise, u, v, 3, 3, 4);
      const grit = fbm(noise, u + 0.5, v + 0.25, 48, 48, 2);
      const joint = (x < 2 || y < 2) ? 0.72 : (x < 3 || y < 3) ? 0.9 : 1;
      const wear = fbm(noise, u + 0.2, v, 2, 2, 3);
      const base = 0.66 + blotch * 0.12 + (grit - 0.5) * 0.07 + Math.max(0, wear - 0.6) * 0.12;
      return [base * 0.98 * joint, base * 0.97 * joint, base * 0.94 * joint];
    });
    return toTexture(canvas, { repeat: true });
  });
}

/** Paneles sándwich de la nave: chapa nervada vertical, juntas entre paneles y algo de suciedad abajo. */
export function wallPanelTexture() {
  return cached('wallPanel', () => {
    const noise = makeNoise(4242);
    const canvas = paintPixels(256, (u, v, x) => {
      const rib = 0.5 + 0.5 * Math.cos(u * Math.PI * 2 * 8);
      const seam = x < 2 ? 0.72 : x < 4 ? 0.9 : 1;
      const dirt = Math.max(0, v - 0.75) * 0.3 * fbm(noise, u, v, 6, 6, 3);
      const base = 0.9 + rib * 0.05 + (fbm(noise, u, v, 4, 4, 3) - 0.5) * 0.04 - dirt;
      return [base * 0.98 * seam, base * 0.97 * seam, base * 0.93 * seam];
    });
    return toTexture(canvas, { repeat: true });
  });
}

/** Chapa grecada del techo de la nave. */
export function corrugatedTexture() {
  return cached('corrugated', () => {
    const noise = makeNoise(777);
    const canvas = paintPixels(128, (u, v) => {
      const wave = Math.abs(Math.sin(u * Math.PI * 6));
      const base = 0.7 + wave * 0.18 + (fbm(noise, u, v, 4, 4, 2) - 0.5) * 0.05;
      return [base, base * 0.99, base * 0.97];
    });
    return toTexture(canvas, { repeat: true });
  });
}

/** Tejas cerámicas (gris, se tiñe con el color del tejado): filas con sombra bajo cada hilada. */
export function roofTileTexture() {
  return cached('roofTiles', () => {
    const noise = makeNoise(3131);
    const canvas = paintPixels(256, (u, v) => {
      const rows = 8;
      const row = Math.floor(v * rows);
      const local = v * rows - row;
      const cols = 10;
      const shifted = u * cols + (row % 2) * 0.5;
      const cu = shifted - Math.floor(shifted);
      const curve = 0.5 + 0.5 * Math.sin(cu * Math.PI);
      const shadow = local > 0.82 ? 0.62 : 1;
      const tone = 0.86 + ((row * 7 + Math.floor(shifted) * 13) % 5) * 0.025;
      return (tone * (0.82 + curve * 0.18) + (fbm(noise, u, v, 8, 8, 3) - 0.5) * 0.08) * shadow;
    });
    const texture = toTexture(canvas, { repeat: true });
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  });
}

/** Grano fino repetible para el suelo de la ciudad (asfalto, aceras): media ≈ 0,5 (no aclara ni oscurece). */
export function groundGrainTexture() {
  return cached('groundGrain', () => {
    const noise = makeNoise(6262);
    const canvas = paintPixels(256, (u, v, x, y) => {
      const grit = fbm(noise, u, v, 64, 64, 2);
      const blotch = fbm(noise, u + 0.3, v + 0.6, 4, 4, 3);
      // Áridos sueltos: algún píxel claro u oscuro
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const speck = h % 97 === 0 ? 0.18 : h % 89 === 0 ? -0.16 : 0;
      return 0.5 + (grit - 0.5) * 0.5 + (blotch - 0.5) * 0.25 + speck;
    });
    const texture = toTexture(canvas, { repeat: true });
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  });
}

/**
 * Añade a un material Lambert/Standard con "map" una textura de detalle que se repite `repeat` (vec2) veces
 * sobre sus UV y multiplica el color. Se desvanece con la distancia para no hacer moiré a lo lejos.
 */
export function addDetailMap(material, texture, repeat, strength = 0.35, far = 900) {
  const uniforms = {
    detailMap: { value: texture },
    detailRepeat: { value: new THREE.Vector2(repeat[0], repeat[1]) },
    detailStrength: { value: strength },
    detailFar: { value: far },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = `uniform sampler2D detailMap;\nuniform vec2 detailRepeat;\nuniform float detailStrength;\nuniform float detailFar;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  float detailFade = clamp(1.0 - length(vViewPosition) / detailFar, 0.0, 1.0);
  float detailValue = texture2D(detailMap, vMapUv * detailRepeat).r;
  diffuseColor.rgb *= mix(1.0, 0.55 + detailValue * 0.9, detailStrength * detailFade);
#endif`);
  };
  material.customProgramCacheKey = () => 'detailMap';
  material.needsUpdate = true;
  return material;
}

/** Corteza vertical para troncos. */
export function barkTexture() {
  return cached('bark', () => {
    const noise = makeNoise(5150);
    const canvas = paintPixels(128, (u, v) => {
      const ridges = fbm(noise, u, v, 12, 2, 4);
      return 0.55 + ridges * 0.45;
    });
    const texture = toTexture(canvas, { repeat: true });
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  });
}

/** Sombra de contacto: degradado rectangular difuso (centro oscuro) para el suelo bajo los muebles. */
export function contactShadowTexture() {
  return cached('contact', () => {
    const canvas = paintPixels(64, (u, v) => {
      const dx = Math.max(0, Math.abs(u - 0.5) * 2 - 0.45) / 0.55;
      const dy = Math.max(0, Math.abs(v - 0.5) * 2 - 0.45) / 0.55;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = (1 - d) * (1 - d);
      return [a, a, a];
    });
    const texture = toTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
  });
}

// ------------------------------------------------------------ Acabados ----

/**
 * Acabados de superficie. surface = textura gris (con bisel en las cajas); env = cuánto refleja el cielo.
 * Los colores salen de cada pieza (color por instancia).
 */
export const FINISHES = {
  matte: { roughness: 0.86, metalness: 0, surface: 'plain' },
  satin: { roughness: 0.6, metalness: 0, surface: 'plain', env: 0.3 },
  plastic: { roughness: 0.4, metalness: 0, surface: 'plastic', env: 0.55 },
  gloss: { roughness: 0.22, metalness: 0, surface: 'plastic', env: 0.9 },
  painted: { roughness: 0.48, metalness: 0.2, surface: 'plain', env: 0.5 }, // acero pintado
  metal: { roughness: 0.34, metalness: 0.85, surface: 'metal', env: 1.1 }, // acero galvanizado / inoxidable
  chrome: { roughness: 0.12, metalness: 1, surface: 'plastic', env: 1.5 },
  wood: { roughness: 0.7, metalness: 0, surface: 'wood', env: 0.15 },
  cardboard: { roughness: 0.94, metalness: 0, surface: 'cardboard' },
  rubber: { roughness: 0.96, metalness: 0, surface: 'rubber' },
  fabric: { roughness: 1, metalness: 0, surface: 'fabric' },
  skin: { roughness: 0.62, metalness: 0, surface: 'plastic', env: 0.15 },
  glass: { roughness: 0.06, metalness: 0.1, surface: null, env: 1.6, transparent: true, opacity: 0.42 },
  screen: { roughness: 0.18, metalness: 0.1, surface: null, env: 0.8 },
  reflective: { roughness: 0.4, metalness: 0, surface: 'plain', emissive: 0.18 }, // bandas reflectantes
};

// Piezas con caras planas y UV 0..1 por cara: llevan la versión con cantos oscurecidos
const BOXY = new Set(['box', 'rbox', 'bevel']);

const finishCache = new Map();

/**
 * Material compartido de un acabado para piezas instanciadas de un tipo de geometría ("box", "cyl"…).
 * "basic": sin iluminación (paneles de luz, pantallas). Estos materiales no se liberan nunca.
 */
export function finishMaterial(finish, kind = 'box', basic = false) {
  const spec = FINISHES[finish] ?? FINISHES.matte;
  const boxy = BOXY.has(kind);
  const key = `${basic ? 'basic' : finish}|${boxy}`;
  let material = finishCache.get(key);
  if (material) return material;
  if (basic) {
    material = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  } else {
    material = new THREE.MeshStandardMaterial({
      color: '#ffffff',
      roughness: spec.roughness,
      metalness: spec.metalness,
      map: spec.surface ? surfaceTexture(spec.surface, boxy) : null,
      transparent: Boolean(spec.transparent),
      opacity: spec.opacity ?? 1,
      depthWrite: !spec.transparent,
    });
    if (spec.emissive) {
      material.emissive = new THREE.Color('#ffffff');
      material.emissiveIntensity = spec.emissive;
    }
    if (spec.env) withEnvironment(material, spec.env);
  }
  material.userData.shared = true;
  finishCache.set(key, material);
  return material;
}

/** Material propio (no compartido) de un acabado con un color: para modelos sueltos (lo que se lleva en las manos). */
export function ownFinishMaterial(finish, color, kind = 'box') {
  const spec = FINISHES[finish] ?? FINISHES.matte;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    map: spec.surface ? surfaceTexture(spec.surface, BOXY.has(kind)) : null,
    transparent: Boolean(spec.transparent),
    opacity: spec.opacity ?? 1,
  });
  if (spec.emissive) {
    material.emissive = new THREE.Color(color);
    material.emissiveIntensity = spec.emissive;
  }
  if (spec.env) withEnvironment(material, spec.env);
  return material;
}

/** Material estándar sencillo y compartido por color + acabado (para mallas sueltas que no se liberan). */
const solidCache = new Map();
export function solidMaterial(color, finish = 'matte', kind = 'cyl') {
  const key = `${color}|${finish}|${BOXY.has(kind)}`;
  let material = solidCache.get(key);
  if (!material) {
    material = ownFinishMaterial(finish, color, kind);
    material.userData.shared = true;
    solidCache.set(key, material);
  }
  return material;
}
