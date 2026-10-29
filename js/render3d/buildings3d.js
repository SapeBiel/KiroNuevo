// Edificios en 3D: se extruyen a partir de los datos de la ciudad (huella, puerta, tipo y variante).
// Cada edificio es un grupo de mallas sencillas. Los materiales se comparten entre edificios;
// solo cuando un edificio tapa la vista se le asignan copias transparentes (ver setEntryFade).

import * as THREE from '../vendor/three.module.js';
import { TILE } from '../config/constants.js';
import { ZONES } from '../config/zones.js';
import { createRng } from '../core/random.js';
import { layoutLots } from '../world/cityMap.js';
import { houseLayout, villaLayout } from '../world/lotLayout.js';
import { OPENING_HEIGHT } from '../world/depotLayout.js';
import {
  getAwningTexture, getHazardTexture, getWallTextures, makeCanvas, makeDepotRoofTexture, makeDepotSignTexture, makeHelipadTexture,
  makeSignTexture, toTexture, wallWindowLayout,
} from './textures3d.js';
import { roofTileTexture } from './materials3d.js';
import { buildTreeMeshes } from './vegetation3d.js';
import { crownGeometry } from './geometries3d.js';

const HOUSE_ROOFS = ['#c8644f', '#5d6b82', '#8a5a44', '#5f8f6a', '#d9a441', '#7a5c8a'];
const APARTMENT_WALLS = ['#e3d5c6', '#d6dce8', '#e8d3d9', '#d8e4d2'];
const AWNINGS = ['#e5484d', '#2a9d8f', '#f4a261', '#4c6ef5', '#c05299'];
const WAREHOUSE_BANDS = ['#3d6fb6', '#d1603d', '#2f8f6b'];
const LOCKED_TINT = new THREE.Color('#1a2238');

// ------------------------------------------------------------ Recursos ----

const unitBox = new THREE.BoxGeometry(1, 1, 1);
// Cara que no se dibuja (la fachada abierta del almacén)
const HIDDEN_FACE = new THREE.MeshBasicMaterial({ visible: false });
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 14);
const unitPrism = makeUnitPrism();
const wallGeometries = new Map();
const plainMaterials = new Map();
const wallMaterials = new Map();

/** Prisma triangular con la base en y=0, ancho 1, altura 1 y eje a lo largo de z. */
function makeUnitPrism() {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
  geometry.rotateX(-Math.PI / 2);
  geometry.scale(1 / 1.7320508, 1 / 1.5, 1);
  geometry.translate(0, 1 / 3, 0);
  const flat = geometry.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

const beaconGeometry = new THREE.SphereGeometry(2.6, 8, 6);
// Arbusto de varios lóbulos (no una esfera); pocos triángulos porque hay muchos en las afueras
const bushGeometry = crownGeometry(5, 4, 0);
const HOUSE_WALLS = ['#efe6d6', '#f3dcc6', '#e1ebef', '#f1e8c6', '#eadbe3', '#dce8d4'];
const DOOR_COLORS = ['#4a3b2f', '#2f4f7a', '#7a2f35', '#2f6b4f', '#3a3f47'];
const sharedMaterials = new Map();

/** Material compartido creado una sola vez por clave (toldos, balizas de antena…). */
function sharedMaterial(key, create) {
  let material = sharedMaterials.get(key);
  if (!material) {
    material = create();
    sharedMaterials.set(key, material);
  }
  return material;
}

const awningMaterial = (accent, locked) => sharedMaterial(`awning|${accent}|${locked}`,
  () => new THREE.MeshLambertMaterial({ map: getAwningTexture(accent), color: locked ? '#55607a' : '#ffffff' }));
const beaconMaterial = (locked) => sharedMaterial(`beacon|${locked}`,
  () => new THREE.MeshBasicMaterial({ color: locked ? '#5a2a2a' : '#ff4d4d' }));
const waterMaterial = (locked) => sharedMaterial(`water|${locked}`,
  () => new THREE.MeshPhongMaterial({ color: locked ? '#2c4a5a' : '#3fb6e0', specular: '#ffffff', shininess: 90, emissive: '#0b3b52', emissiveIntensity: locked ? 0 : 0.35 }));

function plain(color, { emissive = null, intensity = 0 } = {}) {
  const key = `${color}|${emissive}|${intensity}`;
  let material = plainMaterials.get(key);
  if (!material) {
    material = new THREE.MeshLambertMaterial({ color });
    if (emissive) {
      material.emissive = new THREE.Color(emissive);
      material.emissiveIntensity = intensity;
    }
    plainMaterials.set(key, material);
  }
  return material;
}

// Fachadas de cristal: material físico que refleja el cielo pre-calculado (se atenúa de noche)
const glassMaterials = new Set();
let buildingEnv = null;
let buildingEnvLevel = 0.8;

export function setBuildingEnvironment(texture, level) {
  const changed = texture !== buildingEnv;
  buildingEnv = texture;
  buildingEnvLevel = level;
  for (const material of glassMaterials) {
    if (changed) { material.envMap = texture; material.needsUpdate = true; }
    material.envMapIntensity = level;
  }
}

function wallMaterial(style, color, locked) {
  const key = `${style}|${color}|${locked}`;
  let material = wallMaterials.get(key);
  if (!material) {
    const textures = getWallTextures(style);
    const tint = new THREE.Color(color);
    if (locked) tint.lerp(LOCKED_TINT, 0.62);
    const params = {
      color: tint, map: textures.map, emissive: new THREE.Color('#ffd58a'), emissiveMap: textures.emissiveMap, emissiveIntensity: 0,
    };
    if (style === 'glass' && !locked) {
      material = new THREE.MeshStandardMaterial({ ...params, roughness: 0.16, metalness: 0.55, envMap: buildingEnv, envMapIntensity: buildingEnvLevel });
      glassMaterials.add(material);
    } else {
      material = new THREE.MeshLambertMaterial(params);
    }
    material.userData.lockedWall = locked;
    wallMaterials.set(key, material);
  }
  return material;
}

function wallGeometry(w, h, d, style) {
  const key = `${w}|${h}|${d}|${style}`;
  let geometry = wallGeometries.get(key);
  if (!geometry) {
    const tex = getWallTextures(style);
    geometry = new THREE.BoxGeometry(w, h, d);
    const uv = geometry.attributes.uv;
    const rv = Math.max(1, Math.round(h / tex.tileH));
    const spans = [d, d, 0, 0, w, w]; // +x, -x, techo, suelo, +z, -z
    for (let face = 0; face < 6; face++) {
      const span = spans[face];
      const ru = span ? Math.max(1, Math.round(span / tex.tileW)) : 1;
      for (let i = 0; i < 4; i++) {
        const index = face * 4 + i;
        uv.setXY(index, uv.getX(index) * ru, uv.getY(index) * (span ? rv : 1));
      }
    }
    uv.needsUpdate = true;
    wallGeometries.set(key, geometry);
  }
  return geometry;
}

const darkerHex = (hex, k = 0.72) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

function dimmed(hex, locked) {
  if (!locked) return hex;
  return `#${new THREE.Color(hex).lerp(LOCKED_TINT, 0.62).getHexString()}`;
}

// ------------------------------------------------------------ Tejados ----

const roofMaterials = new Map();
/** Teja cerámica: textura de hiladas teñida con el color del tejado (compartida). */
function roofMaterial(color, locked) {
  const key = `${color}|${locked}`;
  let material = roofMaterials.get(key);
  if (!material) {
    material = new THREE.MeshLambertMaterial({ color: dimmed(color, locked), map: roofTileTexture() });
    roofMaterials.set(key, material);
  }
  return material;
}

const gableCache = new Map();
/**
 * Tejado a dos aguas con la cumbrera a lo largo de z y la base en y = 0. Grupo 0: faldones (UV en px / "tile",
 * las hiladas de teja quedan paralelas al alero); grupo 1: hastiales y plano inferior.
 */
function gableRoofGeometry(w, h, d, tile = 24) {
  const key = `${w.toFixed(1)}|${h.toFixed(1)}|${d.toFixed(1)}`;
  let geometry = gableCache.get(key);
  if (geometry) return geometry;
  const hw = w / 2;
  const hd = d / 2;
  const slope = Math.hypot(hw, h);
  const positions = [];
  const uvs = [];
  const tri = (a, b, c, ua, ub, uc) => {
    positions.push(...a, ...b, ...c);
    uvs.push(...ua, ...ub, ...uc);
  };
  const s = slope / tile;
  const u0 = -hd / tile;
  const u1 = hd / tile;
  // Faldón izquierdo (mira a -x) y derecho (mira a +x)
  tri([-hw, 0, -hd], [-hw, 0, hd], [0, h, hd], [u0, 0], [u1, 0], [u1, s]);
  tri([-hw, 0, -hd], [0, h, hd], [0, h, -hd], [u0, 0], [u1, s], [u0, s]);
  tri([hw, 0, hd], [hw, 0, -hd], [0, h, -hd], [u1, 0], [u0, 0], [u0, s]);
  tri([hw, 0, hd], [0, h, -hd], [0, h, hd], [u1, 0], [u0, s], [u1, s]);
  // Hastiales y plano inferior
  tri([-hw, 0, hd], [hw, 0, hd], [0, h, hd], [0, 0], [1, 0], [0.5, 1]);
  tri([hw, 0, -hd], [-hw, 0, -hd], [0, h, -hd], [0, 0], [1, 0], [0.5, 1]);
  tri([-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [0, 0], [1, 0], [1, 1]);
  tri([-hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd], [0, 0], [1, 1], [0, 1]);
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.addGroup(0, 12, 0);
  geometry.addGroup(12, 12, 1);
  gableCache.set(key, geometry);
  return geometry;
}

/**
 * Junta en mallas por material todas las piezas sencillas de un edificio (pasa de decenas de llamadas de dibujo
 * a unas pocas). Los letreros y calcomanías con material propio se dejan aparte.
 */
function mergeEntry(entry) {
  const keep = [];
  const pool = [];
  for (const mesh of entry.meshes) (mesh.userData.own ? keep : pool).push(mesh);
  if (pool.length < 2) return;
  for (const mesh of pool) {
    mesh.updateMatrix();
    entry.group.remove(mesh);
  }
  const merged = mergeByMaterial(pool, true);
  for (const mesh of merged) {
    mesh.userData.shared = mesh.material;
    mesh.userData.own = false;
    mesh.userData.ownGeometry = true;
    entry.group.add(mesh);
  }
  entry.meshes = [...keep, ...merged];
}

// ------------------------------------------------------- Construcción ----

/**
 * Crea todos los edificios de la ciudad. Devuelve el grupo y las funciones para actualizarlos.
 * Las zonas bloqueadas se ven oscurecidas; al desbloquear una zona se vuelve a llamar a esta función.
 */
export function buildCity(city) {
  const group = new THREE.Group();
  const entries = [];
  const byId = new Map();
  const extraTextures = [];

  for (const b of [...city.buildings, city.depot]) {
    const locked = b.id !== 'depot' && !city.isZoneUnlocked(b.zoneId);
    const entry = buildOne(b, locked, extraTextures);
    group.add(entry.group);
    entries.push(entry);
    byId.set(b.id, entry);
  }

  return {
    group,
    entries,
    heightOf: (id) => byId.get(id)?.top ?? 40,
    /** Enciende las ventanas según lo oscuro que sea (0 = día, 1 = noche). */
    setNight(darkness) {
      for (const material of wallMaterials.values()) {
        material.emissiveIntensity = material.userData.lockedWall ? 0 : darkness * 1.15;
      }
    },
    dispose() {
      for (const texture of extraTextures) texture.dispose();
      for (const entry of entries) {
        for (const clone of entry.fadeCache.values()) clone.dispose();
        for (const mesh of entry.meshes) {
          if (mesh.userData.own || mesh.userData.ownGeometry) mesh.geometry.dispose();
          if (mesh.userData.own || mesh.userData.ownMaterial) {
            const shared = mesh.userData.shared;
            for (const material of Array.isArray(shared) ? shared : [shared]) material.dispose();
          }
        }
      }
    },
  };
}

/** "decor" = edificio de las afueras: sin letreros ni texturas propias (se fusiona con otros). */
function buildOne(b, locked, extraTextures, decor = false) {
  const group = new THREE.Group();
  group.position.set(b.centerX, 0, b.centerY);
  const entry = {
    id: b.id, group, meshes: [], top: 40, fade: 1, fading: false, fadeCache: new Map(),
    box: { minX: 0, maxX: 0, minZ: 0, maxZ: 0, height: 0 },
  };
  const fw = b.pw - 6;
  const fd = b.ph - 6;
  const side = b.door === 'top' ? -1 : 1;
  const doorOffset = b.doorX - b.centerX;

  /** Añade una malla; "own" indica que su geometría y material son exclusivos de este edificio. */
  const add = (geometry, material, x, y, z, sx = 1, sy = 1, sz = 1, { cast = true, own = false } = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.userData.shared = material;
    mesh.userData.own = own;
    group.add(mesh);
    entry.meshes.push(mesh);
    return mesh;
  };
  /** Plano plano (letrero, logotipo) con textura propia. */
  const decal = (width, height, material, x, y, z, { flat = false, flip = false } = {}) => {
    const mesh = add(new THREE.PlaneGeometry(width, height), material, x, y, z, 1, 1, 1, { cast: false, own: true });
    if (flat) mesh.rotation.x = -Math.PI / 2;
    if (flip) mesh.rotation.y = Math.PI;
    return mesh;
  };
  /** Caja con la base en "y". */
  const box = (w, h, d, x, y, z, color) => add(unitBox, plain(dimmed(color, locked)), x, y + h / 2, z, w, h, d);
  /** Pared con ventanas (la caja con material por cara: laterales, techo, suelo). */
  const walls = (w, h, d, style, color, roofColor, x = 0, y = 0, z = 0) => {
    const wall = wallMaterial(style, color, locked);
    const roof = plain(dimmed(roofColor, locked));
    return add(wallGeometry(w, h, d, style), [wall, wall, roof, roof, wall, wall], x, y + h / 2, z);
  };
  /** Césped de la parcela (encima del suelo de la manzana). */
  const lawn = () => box(b.pw - 1, 1, b.ph - 1, 0, 0, 0, '#86c472');
  const door = (w, h, color = '#4a3b2f') => {
    box(w, h, 2, doorOffset, 0, side * (fd / 2 + 0.6), color);
  };
  const sign = (text, y, width, bg = '#1c2536', fg = '#ffffff', ready = null, z = side * (fd / 2 + 0.7)) => {
    if (locked || decor) { ready?.dispose(); return; }
    const texture = ready ?? makeSignTexture(text, { bg, fg });
    extraTextures.push(texture);
    const material = new THREE.MeshLambertMaterial({ map: texture, emissive: new THREE.Color('#ffffff'), emissiveMap: texture, emissiveIntensity: 0.12 });
    decal(width, width * 48 / 256, material, doorOffset, y, z, { flip: side < 0 });
  };

  /**
   * Alféizares y dinteles en 3D sobre los huecos de ventana de una caja de fachada (en las mismas posiciones
   * que dibuja su textura). faces: 0 = +x, 1 = -x, 2 = +z, 3 = -z. Con "balconies", en la cara de la calle
   * se añaden balcones con barandilla en una de cada dos ventanas a partir de la primera planta.
   */
  const windowTrim = (w, h, d, style, cx, y0, cz, { sill = '#e9e4d8', faces = [0, 1, 2, 3], balconies = false, lintel = true } = {}) => {
    const layout = wallWindowLayout(style);
    if (!layout.window) return;
    const tex = getWallTextures(style);
    const [wx, wy, ww, wh] = layout.window;
    const floors = layout.rows * Math.max(1, Math.round(h / tex.tileH));
    const ch = h / floors;
    const faceDefs = [{ span: d, nx: 1, nz: 0 }, { span: d, nx: -1, nz: 0 }, { span: w, nx: 0, nz: 1 }, { span: w, nx: 0, nz: -1 }];
    for (const fi of faces) {
      const f = faceDefs[fi];
      const cells = layout.cols * Math.max(1, Math.round(f.span / tex.tileW));
      const cw = f.span / cells;
      const winW = (ww / layout.cellW) * cw;
      const street = f.nz === side;
      for (let i = 0; i < cells; i++) {
        const t = -f.span / 2 + (i + (wx + ww / 2) / layout.cellW) * cw;
        for (let k = 0; k < floors; k++) {
          const bottom = y0 + k * ch + ((layout.cellH - wy - wh) / layout.cellH) * ch;
          const topY = y0 + k * ch + ((layout.cellH - wy) / layout.cellH) * ch;
          const at = (out) => [cx + (f.nx ? f.nx * (w / 2 + out) : t), cz + (f.nz ? f.nz * (d / 2 + out) : t)];
          const along = (len, depth) => (f.nx ? [depth, len] : [len, depth]);
          if (balconies && street && k > 0 && i % 2 === 0) {
            const [bx, bz] = at(2.2);
            const [sw, sd] = along(winW + 5, 4.4);
            box(sw, 0.8, sd, bx, bottom - 0.8, bz, '#d8d4cc'); // losa del balcón
            const [rx, rz] = at(4.2);
            const [rw, rd] = along(winW + 5, 0.4);
            box(rw, 0.4, rd, rx, bottom + 3.4, rz, '#2f343c'); // pasamanos
            for (let p = -1; p <= 1; p += 0.25) {
              const [px, pz] = f.nx ? [rx, rz + p * (winW + 4.6) / 2] : [rx + p * (winW + 4.6) / 2, rz];
              box(0.25, 3.4, 0.25, px, bottom, pz, '#2f343c'); // barrotes
            }
            continue;
          }
          const [sx, sz] = at(0.55);
          const [lw, ld] = along(winW + 1.8, 1.2);
          box(lw, 0.65, ld, sx, bottom - 0.65, sz, sill); // alféizar
          if (lintel) {
            const [tx, tz] = at(0.25);
            const [tw, td] = along(winW + 1, 0.55);
            box(tw, 0.55, td, tx, topY + 0.15, tz, sill); // dintel
          }
        }
      }
    }
  };
  /** Canalones en los aleros de un tejado a dos aguas y bajantes en las esquinas de la calle. */
  const gutters = (cx, cz, eaveY, spanAcross, length, ridgeAlongZ, groundY) => {
    const color = '#8f959e';
    for (const s of [-1, 1]) {
      const g = ridgeAlongZ
        ? add(unitCylinder, plain(dimmed(color, locked)), cx + s * spanAcross / 2, eaveY - 0.6, cz, 0.85, length, 0.85)
        : add(unitCylinder, plain(dimmed(color, locked)), cx, eaveY - 0.6, cz + s * spanAcross / 2, 0.85, length, 0.85);
      if (ridgeAlongZ) g.rotation.x = Math.PI / 2;
      else g.rotation.z = Math.PI / 2;
      const px = ridgeAlongZ ? cx + s * spanAcross / 2 : cx + length / 2 - 1.5;
      const pz = ridgeAlongZ ? cz + side * (length / 2 - 1.5) : cz + s * spanAcross / 2;
      add(unitCylinder, plain(dimmed(color, locked)), px, (eaveY + groundY) / 2, pz, 0.5, eaveY - groundY, 0.5);
    }
  };

  const variant = b.variant;
  let top = 40;

  switch (b.kind) {
    case 'house': {
      // Parcela con jardín delantero: la casa se retira hacia el fondo y deja sitio a porche, camino y seto
      const h = 30;
      const roofH = 22;
      // Misma distribución que las colisiones (world/lotLayout.js)
      const { garage, bw, bd, bx, bz, front, gx, garageWidth, garageDepth, garageZ } = houseLayout(b);
      const wallColor = HOUSE_WALLS[variant % HOUSE_WALLS.length];
      const roofColor = HOUSE_ROOFS[variant % HOUSE_ROOFS.length];
      lawn();
      box(bw + 3, 3, bd + 3, bx, 1, bz, '#8f8679');
      walls(bw, h, bd, 'home', wallColor, '#d8cdb8', bx, 3, bz);
      windowTrim(bw, h, bd, 'home', bx, 3, bz);
      box(bw + 5, 1.6, bd + 5, bx, h + 2.2, bz, '#f7f4ee');
      // Tejado de teja a dos aguas con alero; la mitad de las casas tienen la cumbrera girada
      // (fachada con faldón en vez de hastial)
      const turned = variant % 4 >= 2;
      const roofW = bw + 9;
      const roofD = bd + 9;
      const roofMats = [roofMaterial(roofColor, locked), plain(dimmed(wallColor, locked))];
      const roof = add(gableRoofGeometry(turned ? roofD : roofW, roofH, turned ? roofW : roofD), roofMats, bx, h + 3, bz);
      if (turned) roof.rotation.y = Math.PI / 2;
      // Remate de la cumbrera y canalones con bajantes
      const ridge = add(unitCylinder, plain(dimmed(darkerHex(roofColor), locked)), bx, h + 3 + roofH, bz, 1.1, turned ? roofW : roofD, 1.1);
      if (turned) ridge.rotation.z = Math.PI / 2;
      else ridge.rotation.x = Math.PI / 2;
      gutters(bx, bz, h + 3, turned ? roofD : roofW, turned ? roofW : roofD, !turned, 3);
      const chimneyX = bx + bw * 0.26;
      box(8, 18, 8, chimneyX, h + 8, bz - bd * 0.12, '#8a5a44');
      box(9.4, 1.4, 9.4, chimneyX, h + 25.4, bz - bd * 0.12, '#cfc6b8');
      box(5, 2.4, 5, chimneyX, h + 26.8, bz - bd * 0.12, '#4b4f57');
      // Puerta con marco, porche con tejadillo y escalón
      box(19, 26, 1.4, doorOffset + bx, 3, front + side * 0.5, '#f7f4ee');
      box(13, 21, 1.6, doorOffset + bx, 3, front + side * 1.1, DOOR_COLORS[variant % DOOR_COLORS.length]);
      box(28, 2.6, 13, doorOffset + bx, 0.4, front + side * 6.5, '#cfc6b6');
      for (const px of [-11, 11]) box(2, 22, 2, doorOffset + bx + px, 3, front + side * 11.5, '#f7f4ee');
      const porch = box(32, 2.4, 15, doorOffset + bx, 25, front + side * 7, roofColor);
      porch.rotation.x = side * 0.18;
      // Camino hasta la acera
      const pathStart = front + side * 13;
      const pathEnd = side * (fd / 2);
      box(11, 0.6, Math.abs(pathEnd - pathStart), doorOffset + bx, 1.2, (pathStart + pathEnd) / 2, '#ddd2bd');
      // Garaje adosado con puerta basculante
      if (garage) {
        walls(garageWidth, 24, garageDepth, 'home', wallColor, '#b9b1a3', gx, 1, garageZ);
        box(garageWidth + 2, 2, garageDepth + 2, gx, 25, garageZ, '#6b6f78');
        box(22, 18, 1.2, gx, 1, bz + side * (bd * 0.5 + 0.6), '#d9dde3');
        for (let i = 1; i < 5; i++) box(22, 0.5, 1.4, gx, 1 + i * 3.6, bz + side * (bd * 0.5 + 0.7), '#aeb4bd');
        box(22, 0.6, Math.abs(pathEnd - (bz + side * bd * 0.5)), gx, 1.2, (pathEnd + bz + side * bd * 0.5) / 2, '#b8b2a6');
      }
      // Seto bajo en el frente (con hueco para el camino) y arbustos
      const hedgeZ = side * (fd / 2 - 3);
      const gapL = doorOffset + bx - 8;
      const gapR = garage ? gx + 14 : doorOffset + bx + 8;
      if (gapL > -fw / 2 + 4) box(gapL + fw / 2, 7, 5, (-fw / 2 + gapL) / 2, 1, hedgeZ, '#4f8f45');
      if (gapR < fw / 2 - 4) box(fw / 2 - gapR, 7, 5, (gapR + fw / 2) / 2, 1, hedgeZ, '#4f8f45');
      if (garage) {
        // Tramo entre el camino de la puerta y la entrada del garaje
        const midStart = doorOffset + bx + 8;
        const midEnd = gx - 13;
        if (midEnd - midStart > 4) box(midEnd - midStart, 7, 5, (midStart + midEnd) / 2, 1, hedgeZ, '#4f8f45');
      }
      for (const [ox, oz] of [[-bw * 0.32, 4], [bw * 0.3, 5]]) {
        add(bushGeometry, plain(dimmed('#5aa84f', locked)), bx + ox, 5, front + side * oz, 6, 5, 6);
      }
      if (variant % 3 === 0) {
        // Árbol en la esquina trasera, fuera de la casa y del garaje
        add(bushGeometry, plain(dimmed('#3f8a46', locked)), fw * 0.4, 13, -side * fd * 0.4, 8, 11, 8);
        box(2.4, 9, 2.4, fw * 0.4, 1, -side * fd * 0.4, '#6b4a32');
      }
      top = h + 3 + roofH;
      break;
    }
    case 'villa': {
      const h = 34;
      const { bw, bd, bz, front, doorX, pool } = villaLayout(b);
      lawn();
      box(bw + 3, 3, bd + 3, 0, 1, bz, '#a7a29a');
      walls(bw, h, bd, 'home', '#f6f3ec', '#d9d4c8', 0, 3, bz);
      windowTrim(bw, h, bd, 'home', 0, 3, bz, { sill: '#d9d4c8' });
      box(bw + 4, 3, bd + 4, 0, h + 3, bz, '#3d424b');
      box(bw + 4.6, 0.8, bd + 4.6, 0, h + 5.8, bz, '#2c3036'); // albardilla del pretil
      walls(bw * 0.6, 22, bd * 0.7, 'home', '#ebe5d9', '#c9c3b6', -bw * 0.16, h + 6, bz - side * bd * 0.12);
      windowTrim(bw * 0.6, 22, bd * 0.7, 'home', -bw * 0.16, h + 6, bz - side * bd * 0.12, { sill: '#d9d4c8' });
      box(bw * 0.6 + 4, 2.5, bd * 0.7 + 4, -bw * 0.16, h + 28, bz - side * bd * 0.12, '#3d424b');
      box(bw * 0.6 + 4.6, 0.7, bd * 0.7 + 4.6, -bw * 0.16, h + 30.5, bz - side * bd * 0.12, '#2c3036');
      // Terraza con barandilla de cristal sobre la planta baja
      const railZ = front - side * 1;
      box(bw * 0.36, 5, 0.8, bw * 0.3, h + 6, railZ, '#9fd0e8');
      // Placas solares dentro del tejado de la planta alta
      for (let i = 0; i < 3; i++) {
        const panel = box(12, 1.2, 10, -bw * 0.16 + (i - 1) * 13, h + 29.9, bz - side * bd * 0.12, '#243b66');
        panel.rotation.x = -0.25;
      }
      // Gran ventanal y puerta (con camino hasta la acera)
      box(bw * 0.4, 18, 1.2, bw * 0.18, 4, front + side * 0.7, '#6f95b8');
      box(14, 22, 1.6, doorX, 3, front + side * 0.9, '#3a3f47');
      const edge = side * (fd / 2);
      box(10, 0.6, Math.abs(edge - front), doorX, 1.2, (edge + front) / 2, '#ddd2bd');
      // Piscina con borde y agua, a un lado del camino
      box(pool.w, 1.6, pool.d, pool.x, 0.6, pool.z, '#e8e2d6');
      add(unitBox, waterMaterial(locked), pool.x, 2.3, pool.z, pool.waterW, 0.4, pool.waterD);
      // Seto delantero con hueco para el camino
      const hedgeZ = side * (fd / 2 - 3);
      const leftEnd = doorX - 6;
      const rightStart = doorX + 6;
      box(leftEnd + fw / 2, 8, 5, (-fw / 2 + leftEnd) / 2, 1, hedgeZ, '#3f7f3d');
      box(fw / 2 - rightStart, 8, 5, (rightStart + fw / 2) / 2, 1, hedgeZ, '#3f7f3d');
      add(bushGeometry, plain(dimmed('#4f9a4a', locked)), fw * 0.42, 7, front + side * 3, 6, 6, 6);
      top = h + 31;
      break;
    }
    case 'apartment': {
      const h = 92;
      walls(fw, h, fd, 'flats', APARTMENT_WALLS[variant % APARTMENT_WALLS.length], '#9aa0aa');
      windowTrim(fw, h, fd, 'flats', 0, 0, 0, { balconies: true, lintel: false });
      // Bajo comercial más oscuro, pretil con albardilla y cubierta con casetón, depósitos y antenas
      box(fw + 0.8, 10, fd + 0.8, 0, 0, 0, '#8d8579');
      box(fw + 3, 3, fd + 3, 0, h, 0, '#8d95a3');
      box(fw + 3.6, 0.8, fd + 3.6, 0, h + 3, 0, '#6f7682');
      box(28, 14, 22, fw * 0.25, h + 3, fd * 0.15, '#c1c8d6');
      box(30, 1.2, 24, fw * 0.25, h + 17, fd * 0.15, '#8d95a3');
      for (let i = 0; i < 3; i++) {
        add(unitCylinder, plain(dimmed('#a9b4c6', locked)), -fw * 0.3 + i * 18, h + 8, -fd * 0.2, 5, 9, 5);
        add(unitCylinder, plain(dimmed('#8e98aa', locked)), -fw * 0.3 + i * 18, h + 13, -fd * 0.2, 5.4, 1, 5.4);
      }
      add(unitCylinder, plain(dimmed('#59606e', locked)), -fw * 0.1, h + 14, fd * 0.3, 0.35, 22, 0.35); // antena
      door(20, 24);
      top = h + 17;
      break;
    }
    case 'shop': {
      const accent = AWNINGS[variant % AWNINGS.length];
      const h = 42;
      walls(fw, h, fd, 'shop', '#ffffff', accent);
      windowTrim(fw, h, fd, 'shop', 0, 0, 0, { sill: '#cfc6b6', lintel: false });
      box(fw + 4, 4, fd + 4, 0, h, 0, accent);
      box(fw + 5, 0.8, fd + 5, 0, h + 4, 0, darkerHex(accent)); // cornisa
      box(fw + 1.6, 1, fd + 1.6, 0, 11, 0, '#d9d0bf'); // imposta sobre la planta baja
      const awningWidth = Math.min(fw - 10, 70);
      const awning = add(unitBox, awningMaterial(accent, locked), doorOffset, 27, side * (fd / 2 + 6), awningWidth, 3, 13);
      awning.rotation.x = 0.25 * side;
      door(14, 22, '#5b4636');
      sign(b.name, 36, 72, accent);
      top = h + 4;
      break;
    }
    case 'office': {
      const h = 90 + (variant % 3) * 20;
      walls(fw, h, fd, 'glass', '#a9c8e0', '#6e8fa8');
      // Cantos de forjado que sobresalen del muro cortina y aletas verticales en las esquinas
      for (let y = 20; y < h - 2; y += 20) box(fw + 1.2, 0.9, fd + 1.2, 0, y - 0.45, 0, '#7f97ab');
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(2.4, h, 2.4, sx * (fw / 2 - 0.6), 0, sz * (fd / 2 - 0.6), '#7f97ab');
      box(fw + 2, 3, fd + 2, 0, h, 0, '#5d7a91');
      box(30, 12, 24, -fw * 0.2, h + 3, fd * 0.1, '#8aa0b3');
      box(14, 8, 14, fw * 0.25, h + 3, -fd * 0.2, '#9fb2c2');
      door(20, 24, '#2c3e50');
      sign(b.name, 36, Math.min(fw - 16, 100));
      top = h + 15;
      break;
    }
    case 'tower': {
      const baseH = 90 + (variant % 3) * 20;
      const midH = 50;
      const topH = 38;
      walls(fw, baseH, fd, 'glass', '#9fb6cf', '#7d93aa');
      walls(fw - 32, midH, fd - 32, 'glass', '#b3c7dc', '#8ea5bd', 0, baseH, 0);
      walls(fw - 68, topH, fd - 68, 'glass', '#cfdeec', '#a6bad0', 0, baseH + midH, 0);
      // Forjados vistos y coronación de cada cuerpo de la torre
      for (const [tw, td, y0, th] of [[fw, fd, 0, baseH], [fw - 32, fd - 32, baseH, midH], [fw - 68, fd - 68, baseH + midH, topH]]) {
        for (let y = y0 + 20; y < y0 + th - 2; y += 20) box(tw + 1.2, 0.9, td + 1.2, 0, y - 0.45, 0, '#7a8fa6');
        box(tw + 1.8, 1.6, td + 1.8, 0, y0 + th - 0.4, 0, '#6d8299');
      }
      const roofY = baseH + midH + topH;
      if (variant % 3 === 0 && !decor) {
        const texture = makeHelipadTexture();
        extraTextures.push(texture);
        const size = Math.min(fw - 68, fd - 68) - 6;
        decal(size, size, new THREE.MeshLambertMaterial({ map: texture }), 0, roofY + 0.4, 0, { flat: true });
        top = roofY + 2;
      } else {
        add(unitCylinder, plain('#59606e'), 0, roofY + 17, 0, 1.4, 34, 1.4);
        add(beaconGeometry, beaconMaterial(locked), 0, roofY + 35, 0, 1, 1, 1, { cast: false });
        top = roofY + 38;
      }
      door(22, 26, '#2c3e50');
      sign(b.name, 36, Math.min(fw - 16, 100));
      break;
    }
    case 'factory': {
      const h = 52;
      walls(fw, h, fd, 'industrial', '#c5cad2', '#8d939d');
      const bays = 3;
      for (let i = 0; i < bays; i++) {
        add(unitPrism, plain(dimmed('#8d939d', locked)), -fw / 2 + (fw / bays) * (i + 0.5), h, 0, fw / bays - 1, 14, fd - 2);
      }
      for (const fx of [-0.3, 0.3]) {
        add(unitCylinder, plain(dimmed('#7a4f43', locked)), fw * fx, h + 22, fd * 0.22, 5, 74, 5);
        add(unitCylinder, plain(dimmed('#2f3237', locked)), fw * fx, h + 60, fd * 0.22, 5.6, 6, 5.6);
      }
      door(24, 26, '#3b4048');
      sign(b.name, 40, Math.min(fw - 16, 130), '#3a3f47');
      top = h + 74;
      break;
    }
    case 'warehouse': {
      const h = 44;
      walls(fw, h, fd, 'metal', '#d3d8df', '#a9b0bc');
      box(fw + 0.8, 8, fd + 0.8, 0, h * 0.42, 0, WAREHOUSE_BANDS[variant % 3]);
      add(unitPrism, plain(dimmed('#b9c0cc', locked)), 0, h, 0, fw + 2, 12, fd + 2);
      const docks = 3;
      for (let i = 0; i < docks; i++) {
        box(20, 24, 2, -fw * 0.28 + i * fw * 0.28, 0, side * (fd / 2 + 0.6), '#4b5563');
      }
      sign(b.name, 36, Math.min(fw - 16, 120), '#2b3a55');
      top = h + 12;
      break;
    }
    case 'depot': {
      const h = 64;
      // Fachada abierta: un gran hueco de carga por el que se ve el interior y se entra a pie por cualquier punto
      // (el interior lo construye depotInterior3d.js con world/depotLayout.js)
      const wall = wallMaterial('depot', '#fff3c9', locked);
      const roof = plain(dimmed('#e8a000', locked));
      const faces = [wall, wall, roof, roof, wall, wall];
      faces[side > 0 ? 4 : 5] = HIDDEN_FACE;
      add(wallGeometry(fw, h, fd, 'depot'), faces, 0, h / 2, 0);
      box(fw + 4, 4, fd + 4, 0, h, 0, '#ffb703');
      const texture = makeDepotRoofTexture();
      extraTextures.push(texture);
      const logoW = fw - 24;
      decal(logoW, logoW * 192 / 512, new THREE.MeshLambertMaterial({ map: texture }), 0, h + 4.4, 0, { flat: true });
      const frontZ = side * (fd / 2 - 1.5);
      // Dintel sobre el hueco, viga y pilares de las esquinas
      box(fw, h - OPENING_HEIGHT, 3, 0, OPENING_HEIGHT, frontZ, '#fff3c9');
      box(fw + 0.5, 3, 3.6, 0, OPENING_HEIGHT - 3, frontZ, '#4b5563');
      for (const px of [-fw / 2 + 2, fw / 2 - 2]) box(4, OPENING_HEIGHT - 3, 4, px, 0, frontZ, '#d9dde4');
      // Sin valla: solo una franja amarilla en el suelo marca el borde de la nave (los vehículos no pasan de ahí)
      box(fw - 8, 0.4, 3, 0, 0.5, frontZ, '#ffb703');
      // Rótulo con el nombre y el color de la empresa (se repinta en el sitio si el jugador los cambia)
      sign('', 50, 130, '', '', makeDepotSignTexture());
      top = h + 4;
      break;
    }
    default:
      box(fw, 30, fd, 0, 0, 0, '#888888');
      top = 30;
  }

  entry.top = top;
  entry.box = {
    minX: b.centerX - fw / 2, maxX: b.centerX + fw / 2, minZ: b.centerY - fd / 2, maxZ: b.centerY + fd / 2, height: top,
  };
  // Las piezas sueltas de cada edificio se juntan por material (las de las afueras se fusionan luego todas juntas;
  // el almacén se deja como está porque su fachada usa una cara invisible y su rótulo se repinta)
  if (!decor && b.kind !== 'depot') mergeEntry(entry);
  return entry;
}

// ---------------------------------------------------- Transparencia ----

function fadeMaterialFor(entry, shared) {
  if (Array.isArray(shared)) return shared.map((m) => fadeMaterialFor(entry, m));
  let clone = entry.fadeCache.get(shared);
  if (!clone) {
    clone = shared.clone();
    clone.transparent = true;
    clone.depthWrite = false;
    entry.fadeCache.set(shared, clone);
  }
  return clone;
}

/** Acerca la opacidad de un edificio a "target" (se usa para que no tape al vehículo). */
export function updateEntryFade(entry, target, dt) {
  if (entry.fade === target && !entry.fading) return;
  const k = 1 - Math.exp(-9 * dt);
  entry.fade += (target - entry.fade) * k;
  if (Math.abs(entry.fade - target) < 0.012) entry.fade = target;

  if (entry.fade >= 1) {
    if (entry.fading) {
      for (const mesh of entry.meshes) mesh.material = mesh.userData.shared;
      entry.fading = false;
    }
    return;
  }
  if (!entry.fading) {
    for (const mesh of entry.meshes) mesh.material = fadeMaterialFor(entry, mesh.userData.shared);
    entry.fading = true;
  }
  for (const [shared, clone] of entry.fadeCache) {
    clone.opacity = entry.fade;
    if ('emissiveIntensity' in shared) clone.emissiveIntensity = shared.emissiveIntensity;
  }
}

/** ¿El segmento a→b atraviesa la caja del edificio? (método de las losas) */
export function segmentHitsBuilding(a, b, box, margin = 4) {
  const min = [box.minX - margin, 0, box.minZ - margin];
  const max = [box.maxX + margin, box.height + margin, box.maxZ + margin];
  const from = [a.x, a.y, a.z];
  const delta = [b.x - a.x, b.y - a.y, b.z - a.z];
  let t0 = 0;
  let t1 = 1;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(delta[axis]) < 1e-6) {
      if (from[axis] < min[axis] || from[axis] > max[axis]) return false;
      continue;
    }
    let ta = (min[axis] - from[axis]) / delta[axis];
    let tb = (max[axis] - from[axis]) / delta[axis];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// ------------------------------------------------------------ Afueras ----
// Manzanas decorativas alrededor del mapa: no se puede circular por ellas (el borde del mapa es sólido),
// pero evitan que la ciudad termine en un campo vacío. Todo se fusiona en una malla por material.

const OUTSKIRT_RINGS = 3;
const OUT_WEIGHTS = {
  residential: { quad: 80, park: 20 },
  downtown: { stack: 60, single: 40 },
  commercial: { quad: 50, stack: 50 },
  industrial: { stack: 60, single: 40 },
  metropolitan: { single: 45, quad: 25, stack: 30 },
};

function outskirtKind(zoneId, layoutId, rng) {
  switch (zoneId) {
    case 'residential': return rng() < 0.85 ? 'house' : 'villa';
    case 'downtown': return layoutId === 'single' ? (rng() < 0.6 ? 'office' : 'tower') : 'apartment';
    case 'commercial': return layoutId === 'stack' && rng() < 0.4 ? 'office' : 'shop';
    case 'industrial': return rng() < 0.55 ? 'factory' : 'warehouse';
    default:
      if (layoutId === 'single') return 'tower';
      return layoutId === 'quad' ? 'villa' : 'office';
  }
}

function pickWeighted(rng, weights) {
  const keys = Object.keys(weights);
  let roll = rng() * keys.reduce((sum, k) => sum + weights[k], 0);
  for (const key of keys) {
    roll -= weights[key];
    if (roll <= 0) return key;
  }
  return keys[keys.length - 1];
}

/**
 * Fusiona mallas en una malla por material. Usa su matrixWorld (ya calculada) o, con "local", su matriz
 * respecto al grupo padre (para juntar las piezas de un mismo edificio).
 */
function mergeByMaterial(meshes, local = false) {
  const buckets = new Map();
  const normalMatrix = new THREE.Matrix3();
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const matrix = local ? mesh.matrix : mesh.matrixWorld;
    const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const position = source.attributes.position;
    const normal = source.attributes.normal;
    const uv = source.attributes.uv;
    normalMatrix.getNormalMatrix(matrix);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const ranges = Array.isArray(mesh.material) && source.groups.length
      ? source.groups.map((g) => [g.start, g.count, materials[g.materialIndex]])
      : [[0, position.count, materials[0]]];
    for (const [start, count, material] of ranges) {
      if (!material) continue;
      let bucket = buckets.get(material);
      if (!bucket) {
        bucket = { p: [], n: [], u: [], cast: false };
        buckets.set(material, bucket);
      }
      // Proyecta sombra si alguna de sus piezas la proyectaba (las sueltas de las afueras no lo indican)
      bucket.cast ||= local ? mesh.castShadow : true;
      const end = Math.min(position.count, start + count);
      for (let i = start; i < end; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(matrix);
        bucket.p.push(v.x, v.y, v.z);
        v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
        bucket.n.push(v.x, v.y, v.z);
        if (uv) bucket.u.push(uv.getX(i), uv.getY(i));
        else bucket.u.push(0, 0);
      }
    }
    if (source !== mesh.geometry) source.dispose();
  }
  const merged = [];
  for (const [material, bucket] of buckets) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.p, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.n, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(bucket.u, 2));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = bucket.cast;
    mesh.receiveShadow = true;
    merged.push(mesh);
  }
  return merged;
}

/** Malla suelta ya colocada (para fusionarla después). */
function placed(geometry, material, x, y, z, sx = 1, sy = 1, sz = 1, rotY = 0) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.rotation.y = rotY;
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Caja con las UV multiplicadas (para texturas que se repiten a lo largo). */
function repeatedBox(w, h, d, repeatU) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeatU, uv.getY(i));
  return geometry;
}

function makeDashTexture() {
  const canvas = makeCanvas(64, 8);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e9c46a';
  ctx.fillRect(0, 0, 34, 8);
  return toTexture(canvas, { repeat: true });
}

export function buildOutskirts(city) {
  const rng = createRng((city.seed ?? 1) + 991);
  const group = new THREE.Group();
  const meshes = [];
  const temporary = [];
  const trees = [];
  const W = city.widthPx;
  const H = city.heightPx;
  const R = OUTSKIRT_RINGS;
  let count = 0;

  // Columnas y filas de manzanas: las de la ciudad más R anillos exteriores de 6 casillas con calles de 3
  const OUT_BLOCK = 6;
  const OUT_ROAD = 3;
  const extend = (inner, start, size, key) => {
    const before = [];
    const after = [];
    let cursor = 0;
    for (let i = 0; i < R; i++) {
      before.unshift({ [key]: cursor - OUT_BLOCK, [size]: OUT_BLOCK, outside: true, near: 0, road: { at: cursor - OUT_BLOCK - OUT_ROAD, w: OUT_ROAD } });
      cursor -= OUT_BLOCK + OUT_ROAD;
    }
    cursor = start;
    for (let i = 0; i < R; i++) {
      after.push({ [key]: cursor, [size]: OUT_BLOCK, outside: true, near: inner.length - 1, road: { at: cursor + OUT_BLOCK, w: OUT_ROAD } });
      cursor += OUT_BLOCK + OUT_ROAD;
    }
    return [...before, ...inner.map((item, i) => ({ ...item, outside: false, near: i })), ...after];
  };
  const extCols = extend(city.cols, city.width, 'w', 'x');
  const extRows = extend(city.rows, city.height, 'h', 'y');
  const extent = R * (OUT_BLOCK + OUT_ROAD) * TILE + 160;
  // Bloques de la ciudad (por columna y fila) para saber qué zona tiene cerca cada manzana exterior
  const innerZone = (c, r) => city.zoneIdAtTile(city.cols[c].x, city.rows[r].y);

  // Asfalto alrededor del mapa (cuatro franjas que no se solapan con el suelo del juego)
  const asphalt = new THREE.MeshLambertMaterial({ color: '#434a59' });
  const ownMaterials = [asphalt];
  const ownGeometries = [];
  const strips = [
    [W / 2, -extent / 2, W + extent * 2, extent], [W / 2, H + extent / 2, W + extent * 2, extent],
    [-extent / 2, H / 2, extent, H], [W + extent / 2, H / 2, extent, H],
  ];
  for (const [cx, cz, sw, sd] of strips) {
    const geometry = new THREE.PlaneGeometry(sw, sd).rotateX(-Math.PI / 2);
    temporary.push(geometry);
    meshes.push(placed(geometry, asphalt, cx, -0.3, cz));
  }

  for (const row of extRows) {
    for (const col of extCols) {
      if (!col.outside && !row.outside) continue;
      const zoneId = innerZone(col.near, row.near);
      const zone = ZONES[zoneId];
      const ox = col.x;
      const oy = row.y;
      const bw = col.w;
      const bh = row.h;
      const x = ox * TILE;
      const z = oy * TILE;
      const sw = bw * TILE;
      const sh = bh * TILE;
      // Acera y suelo de la manzana
      meshes.push(placed(unitBox, plain(zone.sidewalk), x + sw / 2, 0.6, z + sh / 2, sw + 12, 1.2, sh + 12));
      const layoutId = pickWeighted(rng, OUT_WEIGHTS[zoneId]);
      if (layoutId === 'park') {
        meshes.push(placed(unitBox, plain('#8ccf84'), x + sw / 2, 0.75, z + sh / 2, sw - 4, 1.5, sh - 4));
        for (let i = 0; i < 12; i++) trees.push({ x: x + 20 + rng() * (sw - 40), z: z + 20 + rng() * (sh - 40), r: 9 + rng() * 7 });
        continue;
      }
      meshes.push(placed(unitBox, plain(zone.ground), x + sw / 2, 0.75, z + sh / 2, sw, 1.5, sh));
      for (const rect of layoutLots(layoutId, bw, bh)) {
        const bx = (ox + rect.dx) * TILE;
        const by = (oy + rect.dy) * TILE;
        const pw = rect.w * TILE;
        const ph = rect.h * TILE;
        const b = {
          id: `out${count++}`, kind: outskirtKind(zoneId, layoutId, rng), pw, ph, door: rect.door,
          doorX: bx + pw / 2, centerX: bx + pw / 2, centerY: by + ph / 2, variant: Math.floor(rng() * 1000), name: '',
        };
        const entry = buildOne(b, false, [], true);
        entry.group.position.y = 1.5;
        entry.group.updateMatrixWorld(true);
        meshes.push(...entry.meshes);
      }
    }
  }

  // Líneas centrales de las calles exteriores
  const dashTexture = makeDashTexture();
  const dashMaterial = new THREE.MeshLambertMaterial({ map: dashTexture, transparent: true, alphaTest: 0.4, depthWrite: false });
  ownMaterials.push(dashMaterial);
  // Geometría de línea central por longitud (las manzanas tienen tamaños distintos)
  const dashGeometries = new Map();
  const dashGeometry = (length) => {
    let geometry = dashGeometries.get(length);
    if (!geometry) {
      geometry = new THREE.PlaneGeometry(length, 2.6).rotateX(-Math.PI / 2);
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (length / 30), uv.getY(i));
      dashGeometries.set(length, geometry);
      temporary.push(geometry);
    }
    return geometry;
  };
  // Calles horizontales exteriores: las de la ciudad que siguen hacia fuera y las de los anillos
  const extHRoads = [...city.hRoads.map((r) => ({ at: r.y, w: r.w, inside: true })), ...extRows.filter((r) => r.outside).map((r) => ({ ...r.road, inside: false }))];
  const extVRoads = [...city.vRoads.map((r) => ({ at: r.x, w: r.w, inside: true })), ...extCols.filter((c) => c.outside).map((c) => ({ ...c.road, inside: false }))];
  for (const road of extHRoads) {
    for (const col of extCols) {
      if (road.inside && !col.outside) continue; // tramo dentro del mapa: lo dibuja el suelo del juego
      const length = col.w * TILE;
      meshes.push(placed(dashGeometry(length), dashMaterial, col.x * TILE + length / 2, 0.05, (road.at + road.w / 2) * TILE));
    }
  }
  for (const road of extVRoads) {
    for (const row of extRows) {
      if (road.inside && !row.outside) continue;
      const length = row.h * TILE;
      meshes.push(placed(dashGeometry(length), dashMaterial, (road.at + road.w / 2) * TILE, 0.05, row.y * TILE + length / 2, 1, 1, 1, Math.PI / 2));
    }
  }
  // Vallas donde las calles del mapa salían hacia las afueras: ahí termina la zona jugable
  const barrierMaterial = new THREE.MeshLambertMaterial({ map: getHazardTexture() });
  ownMaterials.push(barrierMaterial);
  const barrierGeometries = new Map();
  const barrierGeometry = (tiles) => {
    let geometry = barrierGeometries.get(tiles);
    if (!geometry) {
      const length = tiles * TILE;
      geometry = repeatedBox(length, 14, 6, length / 14);
      barrierGeometries.set(tiles, geometry);
      temporary.push(geometry);
    }
    return geometry;
  };
  for (const road of city.hRoads) {
    const cz = (road.y + road.w / 2) * TILE;
    meshes.push(placed(barrierGeometry(road.w), barrierMaterial, -3, 7, cz, 1, 1, 1, Math.PI / 2));
    meshes.push(placed(barrierGeometry(road.w), barrierMaterial, W + 3, 7, cz, 1, 1, 1, Math.PI / 2));
  }
  for (const road of city.vRoads) {
    const cx = (road.x + road.w / 2) * TILE;
    meshes.push(placed(barrierGeometry(road.w), barrierMaterial, cx, 7, -3));
    meshes.push(placed(barrierGeometry(road.w), barrierMaterial, cx, 7, H + 3));
  }

  for (const mesh of mergeByMaterial(meshes)) {
    ownGeometries.push(mesh.geometry);
    if (mesh.material === asphalt || mesh.material === dashMaterial) mesh.castShadow = false;
    group.add(mesh);
  }
  for (const geometry of temporary) geometry.dispose();

  // Árboles de los parques exteriores
  const treeHandle = buildTreeMeshes(trees, 1.5, { detail: 0 });
  for (const mesh of treeHandle.meshes) group.add(mesh);

  return {
    group,
    dispose() {
      for (const geometry of ownGeometries) geometry.dispose();
      for (const material of ownMaterials) material.dispose();
      dashTexture.dispose();
      treeHandle.dispose();
    },
  };
}
