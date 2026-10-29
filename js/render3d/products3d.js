// Modelos 3D de los productos y de las cajas de los pedidos. Cada forma (libro, botella, bicicleta…) se
// describe como una lista de "piezas" (geometría base + matriz + color) con la base en y = 0, centrada en x/z
// y con las medidas de config/products.js. Con esas piezas se construyen:
//   · createProductModel / createBoxModel: grupos sueltos (lo que se lleva en las manos);
//   · PartBatch: mallas instanciadas que dibujan decenas de productos con pocas llamadas (cinta, mesas…).
// Las geometrías y las piezas se calculan una vez por producto y se reutilizan.

import * as THREE from '../vendor/three.module.js';
import { boxSizeFor, productInfo } from '../config/products.js';

export const GEOMETRIES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  cone: new THREE.CylinderGeometry(0.22, 0.5, 1, 14),
  sphere: new THREE.SphereGeometry(0.5, 14, 10),
  torus: new THREE.TorusGeometry(0.5, 0.07, 6, 20),
};
export const PART_KINDS = Object.keys(GEOMETRIES);

const tmpObject = new THREE.Object3D();
const cardboard = '#c99a62';
const darker = (hex, k = 0.72) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;

/** Recoge piezas: p(kind, x, y, z, sx, sy, sz, color, rx, ry, rz) con (x, y, z) en el centro de la pieza. */
function collector() {
  const parts = [];
  const p = (kind, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) => {
    tmpObject.position.set(x, y, z);
    tmpObject.rotation.set(rx, ry, rz);
    tmpObject.scale.set(sx, sy, sz);
    tmpObject.updateMatrix();
    parts.push({ kind, matrix: tmpObject.matrix.clone(), color: new THREE.Color(color) });
  };
  return { parts, p };
}

/** Piezas de cada forma. w = ancho (x), h = alto (y), d = fondo (z). */
const SHAPES = {
  book(p, w, h, d, c, a) {
    const cover = h * 0.16;
    p('box', 0, cover / 2, 0, w, cover, d, c); // tapa inferior
    p('box', 0, h - cover / 2, 0, w, cover, d, c); // tapa superior
    p('box', -w / 2 + w * 0.05, h / 2, 0, w * 0.1, h, d, darker(c)); // lomo
    p('box', w * 0.04, h / 2, 0, w * 0.9, h - cover * 2, d * 0.95, a); // páginas
  },
  envelope(p, w, h, d, c, a) {
    p('box', 0, h / 2, 0, w, h, d, c);
    p('box', w * 0.3, h + 0.02, -d * 0.25, w * 0.2, 0.06, d * 0.25, a); // sello
    p('box', -w * 0.1, h + 0.02, d * 0.1, w * 0.5, 0.05, d * 0.08, '#8a8a8a'); // dirección
  },
  folder(p, w, h, d, c, a) {
    p('box', 0, h / 2, 0, w, h, d, c);
    p('box', 0, h / 2, d / 2 + 0.03, w * 0.7, h * 0.6, 0.06, a); // pestaña
    p('box', 0, h + 0.02, 0, w * 0.5, 0.05, d * 0.3, a); // etiqueta
  },
  box(p, w, h, d, c, a) {
    p('box', 0, h / 2, 0, w, h, d, c);
    p('box', 0, h + 0.02, 0, w * 0.22, 0.06, d * 1.01, a); // precinto
    p('box', w / 2 + 0.02, h * 0.55, 0, 0.05, h * 0.35, d * 0.4, '#ffffff'); // etiqueta
  },
  appliance(p, w, h, d, c, a) {
    p('box', 0, h / 2, 0, w, h, d, c);
    const r = Math.min(w, h) * 0.62;
    p('cyl', 0, h * 0.45, d / 2 + 0.05, r, 0.12, r, a, Math.PI / 2); // puerta / depósito
    p('cyl', 0, h * 0.45, d / 2 + 0.1, r * 0.7, 0.06, r * 0.7, darker(a, 0.55), Math.PI / 2);
    p('box', 0, h * 0.92, d / 2 + 0.04, w * 0.8, h * 0.1, 0.08, darker(c, 0.6)); // panel de mandos
  },
  toolbox(p, w, h, d, c, a) {
    p('box', 0, h * 0.36, 0, w, h * 0.72, d, c);
    p('box', 0, h * 0.78, 0, w * 1.02, h * 0.12, d * 1.02, darker(c, 0.8)); // tapa
    p('box', 0, h * 0.92, 0, w * 0.5, h * 0.16, d * 0.16, a); // asa
    p('box', w * 0.3, h * 0.55, d / 2 + 0.03, w * 0.08, h * 0.12, 0.06, '#d9d9d9'); // cierre
    p('box', -w * 0.3, h * 0.55, d / 2 + 0.03, w * 0.08, h * 0.12, 0.06, '#d9d9d9');
  },
  case(p, w, h, d, c, a) {
    p('box', 0, h / 2, 0, w, h, d, c);
    p('box', 0, h / 2, 0, w * 1.01, h * 0.12, d * 1.01, a); // cremallera
    p('box', 0, h + 0.02, 0, w * 0.5, 0.05, d * 0.5, darker(c, 1.4)); // logotipo
  },
  bottle(p, w, h, d, c, a) {
    p('cyl', 0, h * 0.34, 0, w, h * 0.68, d, c);
    p('cyl', 0, h * 0.75, 0, w * 0.45, h * 0.14, d * 0.45, c);
    p('cyl', 0, h * 0.9, 0, w * 0.5, h * 0.2, d * 0.5, a); // tapón
    p('cyl', 0, h * 0.36, 0, w * 1.02, h * 0.26, d * 1.02, '#ffffff'); // etiqueta
  },
  jar(p, w, h, d, c, a) {
    p('cyl', 0, h * 0.44, 0, w, h * 0.88, d, c);
    p('cyl', 0, h * 0.94, 0, w * 0.86, h * 0.12, d * 0.86, a); // tapa / rejilla
    p('cyl', 0, h * 0.05, 0, w * 1.04, h * 0.1, d * 1.04, darker(c, 0.6)); // base
  },
  vase(p, w, h, d, c, a) {
    p('sphere', 0, h * 0.34, 0, w, h * 0.64, d, c); // panza
    p('cyl', 0, h * 0.74, 0, w * 0.42, h * 0.4, d * 0.42, c); // cuello
    p('cyl', 0, h * 0.96, 0, w * 0.56, h * 0.08, d * 0.56, a); // boca
  },
  soft(p, w, h, d, c, a) {
    p('box', 0, h * 0.45, 0, w, h * 0.9, d, c);
    p('box', 0, h * 0.92, 0, w * 0.92, h * 0.12, d * 0.9, darker(c, 1.15)); // pliegue de arriba
    p('box', 0, h * 0.5, d / 2 + 0.02, w * 0.3, h * 0.4, 0.04, a); // etiqueta
  },
  backpack(p, w, h, d, c, a) {
    p('box', 0, h * 0.44, 0, w, h * 0.88, d * 0.7, c);
    p('sphere', 0, h * 0.86, 0, w, h * 0.22, d * 0.7, c); // parte de arriba redondeada
    p('box', 0, h * 0.3, d * 0.38, w * 0.74, h * 0.4, d * 0.22, a); // bolsillo
    p('box', 0, h * 0.99, 0, w * 0.3, h * 0.05, d * 0.1, a); // asa
  },
  shoebox(p, w, h, d, c, a) {
    p('box', 0, h * 0.4, 0, w, h * 0.8, d, c);
    p('box', 0, h * 0.89, 0, w * 1.03, h * 0.22, d * 1.03, a); // tapa
    p('box', w * 0.3, h * 0.89, d * 0.52, w * 0.2, h * 0.12, 0.04, c); // logotipo
  },
  flat(p, w, h, d, c, a) {
    p('box', 0, h / 2, 0, w, h, d * 0.7, c); // marco de la pantalla
    p('box', 0, h * 0.52, d * 0.36, w * 0.92, h * 0.84, 0.05, a); // pantalla
    p('box', 0, h * 0.04, -d * 0.1, w * 0.4, h * 0.08, d, darker(c, 1.5)); // peana
  },
  frame(p, w, h, d, c, a) {
    p('box', 0, h / 2, 0, w, h, d * 0.6, c);
    p('box', 0, h / 2, d * 0.31, w * 0.8, h * 0.76, 0.04, a); // lámina
    p('box', -w * 0.15, h * 0.42, d * 0.33, w * 0.3, h * 0.3, 0.04, darker(a, 0.6));
  },
  tube(p, w, h, d, c, a) {
    p('cyl', 0, h / 2, 0, w, d, h, c, Math.PI / 2); // tumbado a lo largo de z
    p('cyl', 0, h / 2, d / 2, w * 1.06, 0.2, h * 1.06, a, Math.PI / 2); // tapones
    p('cyl', 0, h / 2, -d / 2, w * 1.06, 0.2, h * 1.06, a, Math.PI / 2);
  },
  lamp(p, w, h, d, c, a) {
    p('cyl', 0, h * 0.04, 0, w * 0.6, h * 0.08, d * 0.6, darker(c, 0.6)); // pie
    p('cyl', 0, h * 0.35, 0, w * 0.1, h * 0.56, d * 0.1, '#b0b0b0'); // tubo
    p('cone', 0, h * 0.78, 0, w, h * 0.44, d, c); // pantalla
    p('sphere', 0, h * 0.68, 0, w * 0.3, w * 0.3, d * 0.3, a); // bombilla
  },
  bike(p, w, h, d, c, a) {
    const r = h * 0.36;
    for (const sx of [-1, 1]) {
      p('torus', sx * w * 0.3, r, 0, r * 2, r * 2, r * 2.4, a); // ruedas
      p('cyl', sx * w * 0.3, r, 0, 0.5, d * 0.5, 0.5, '#9a9a9a', Math.PI / 2); // bujes
    }
    const bar = (x0, y0, x1, y1) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      p('box', (x0 + x1) / 2, (y0 + y1) / 2, 0, len, 0.45, 0.45, c, 0, 0, Math.atan2(y1 - y0, x1 - x0));
    };
    const rear = -w * 0.3;
    const front = w * 0.3;
    const seatX = -w * 0.08;
    const top = h * 0.78;
    bar(rear, r, seatX, top); // tirante trasero
    bar(seatX, top, front * 0.8, top); // barra superior
    bar(seatX, r * 0.9, front * 0.8, top); // tubo diagonal
    bar(rear, r, seatX, r * 0.9); // vaina
    bar(front, r, front * 0.8, top + h * 0.1); // horquilla
    p('box', seatX, top + 0.4, 0, w * 0.12, 0.4, d * 0.5, '#222222'); // sillín
    p('box', front * 0.8, top + h * 0.1, 0, 0.4, 0.4, d, '#222222'); // manillar
  },
  pallet(p, w, h, d, c, a) {
    const base = h * 0.16;
    for (const z of [-0.4, 0, 0.4]) p('box', 0, base * 0.5, z * d, w, base, d * 0.16, darker(c, 0.85)); // largueros
    p('box', 0, base + 0.15, 0, w, 0.3, d, c); // tablero
    const load = h - base - 0.3;
    p('box', 0, base + 0.3 + load / 2, 0, w * 0.9, load, d * 0.9, cardboard); // mercancía
    p('box', 0, base + 0.3 + load / 2, 0, w * 0.92, load * 0.12, d * 0.92, a); // fleje
    p('box', 0, base + 0.3 + load * 0.5, 0, w * 0.08, load * 1.01, d * 0.92, a);
  },
  crate(p, w, h, d, c, a) {
    p('box', 0, h / 2, 0, w * 0.96, h * 0.96, d * 0.96, darker(c, 0.85));
    for (const y of [0.06, 0.5, 0.94]) p('box', 0, h * y, 0, w, h * 0.12, d, c); // listones
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p('box', sx * w * 0.46, h / 2, sz * d * 0.46, w * 0.1, h, d * 0.1, c);
    p('box', 0, h * 0.72, d / 2 + 0.02, w * 0.3, h * 0.18, 0.04, a); // placa
  },
  longbox(p, w, h, d, c, a) {
    p('box', 0, h / 2, 0, w, h, d, c);
    for (const x of [-0.42, 0, 0.42]) p('box', x * w, h / 2, 0, w * 0.05, h * 1.02, d * 1.02, a); // flejes
    p('box', w * 0.2, h + 0.02, 0, w * 0.18, 0.05, d * 0.5, '#ffffff'); // etiqueta
  },
  guitar(p, w, h, d, c, a) {
    // Tumbada: el cuerpo hacia +z y el mástil hacia -z
    p('sphere', 0, h * 0.4, d * 0.3, w, h * 0.8, d * 0.36, c);
    p('sphere', 0, h * 0.4, d * 0.06, w * 0.78, h * 0.8, d * 0.26, c);
    p('cyl', 0, h * 0.82, d * 0.16, w * 0.3, 0.1, w * 0.3, '#1a1a1a'); // boca
    p('box', 0, h * 0.5, -d * 0.24, w * 0.18, h * 0.3, d * 0.46, a); // mástil
    p('box', 0, h * 0.5, -d * 0.46, w * 0.28, h * 0.3, d * 0.08, darker(c, 0.6)); // pala
  },
};

const partsCache = new Map();

/** Piezas de un producto (con la base en y = 0). */
export function productParts(name) {
  let parts = partsCache.get(name);
  if (parts) return parts;
  const info = productInfo(name);
  const [w, h, d] = info.size;
  const c = collector();
  (SHAPES[info.shape] ?? SHAPES.box)(c.p, w, h, d, info.color, info.accent);
  parts = c.parts;
  partsCache.set(name, parts);
  return parts;
}

/** Piezas de una caja cerrada de [largo, alto, ancho] con precinto y etiqueta. */
export function boxParts(size, tint = null) {
  const [w, h, d] = size;
  const key = `${w.toFixed(1)}|${h.toFixed(1)}|${d.toFixed(1)}|${tint ?? ''}`;
  let parts = partsCache.get(key);
  if (parts) return parts;
  const c = collector();
  const color = tint ? `#${new THREE.Color(cardboard).lerp(new THREE.Color(tint), 0.16).getHexString()}` : cardboard;
  c.p('box', 0, h / 2, 0, w, h, d, color);
  c.p('box', 0, h + 0.02, 0, w * 1.005, 0.06, Math.min(1.4, d * 0.24), '#e8c48e'); // precinto de la tapa
  c.p('box', w / 2 + 0.02, h / 2, 0, 0.06, h * 1.005, Math.min(1.4, d * 0.24), '#e8c48e');
  c.p('box', -w / 2 - 0.02, h / 2, 0, 0.06, h * 1.005, Math.min(1.4, d * 0.24), '#e8c48e');
  c.p('box', -w * 0.18, h * 0.6, d / 2 + 0.03, Math.min(2.4, w * 0.36), Math.min(1.6, h * 0.36), 0.05, '#ffffff'); // etiqueta
  parts = c.parts;
  partsCache.set(key, parts);
  return parts;
}

/** Piezas de la caja de un pedido (el tamaño depende de lo que lleva dentro). */
export const orderBoxParts = (order, tint = null) => boxParts(boxSizeFor(order), tint);

/** Construye un grupo a partir de piezas. "overlay": siempre por delante (lo que se lleva en las manos). */
export function buildPartsModel(parts, { overlay = false } = {}) {
  const group = new THREE.Group();
  const materials = [];
  for (const part of parts) {
    const material = new THREE.MeshLambertMaterial({ color: part.color });
    if (overlay) { material.depthTest = false; material.depthWrite = false; }
    materials.push(material);
    const mesh = new THREE.Mesh(GEOMETRIES[part.kind], material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(part.matrix);
    if (overlay) mesh.renderOrder = 30;
    mesh.castShadow = !overlay;
    mesh.receiveShadow = !overlay;
    group.add(mesh);
  }
  group.userData.dispose = () => { for (const m of materials) m.dispose(); };
  return group;
}

export const createProductModel = (name, opts) => buildPartsModel(productParts(name), opts);
export const createBoxModel = (order, opts) => buildPartsModel(orderBoxParts(order), opts);

/**
 * Lote de piezas instanciadas: una malla por geometría base con color por instancia. begin() vacía el lote,
 * add(parts, matrix) añade un modelo colocado con "matrix" y end() sube los cambios a la GPU.
 */
export class PartBatch {
  constructor(capacity = 512, { shadows = true, basic = false } = {}) {
    // "basic": sin iluminación (paneles de luz, pantallas)
    this.material = basic ? new THREE.MeshBasicMaterial({ color: '#ffffff' }) : new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.meshes = {};
    this.counts = {};
    this.group = new THREE.Group();
    const white = new THREE.Color('#ffffff');
    const caps = typeof capacity === 'number' ? Object.fromEntries(PART_KINDS.map((k) => [k, capacity])) : capacity;
    for (const kind of PART_KINDS) {
      const cap = caps[kind] ?? 0;
      if (!cap) continue;
      const mesh = new THREE.InstancedMesh(GEOMETRIES[kind], this.material, cap);
      for (let i = 0; i < cap; i++) mesh.setColorAt(i, white);
      mesh.count = 0;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes[kind] = mesh;
      this.counts[kind] = 0;
      this.group.add(mesh);
    }
    this.tmp = new THREE.Matrix4();
  }

  begin() {
    for (const kind in this.counts) this.counts[kind] = 0;
  }

  add(parts, matrix) {
    for (const part of parts) {
      const mesh = this.meshes[part.kind];
      if (!mesh) continue;
      const i = this.counts[part.kind];
      if (i >= mesh.instanceMatrix.count) continue;
      mesh.setMatrixAt(i, this.tmp.multiplyMatrices(matrix, part.matrix));
      mesh.setColorAt(i, part.color);
      this.counts[part.kind] = i + 1;
    }
  }

  /** Una pieza suelta (matriz ya en coordenadas del lote). */
  addPart(kind, matrix, color) {
    const mesh = this.meshes[kind];
    if (!mesh) return;
    const i = this.counts[kind];
    if (i >= mesh.instanceMatrix.count) return;
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, color);
    this.counts[kind] = i + 1;
  }

  end() {
    for (const kind in this.meshes) {
      const mesh = this.meshes[kind];
      mesh.count = this.counts[kind];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    for (const kind in this.meshes) this.meshes[kind].dispose();
    this.material.dispose();
  }
}

const placeObject = new THREE.Object3D();
/** Matriz para colocar un modelo en (x, y, z) del mapa girado "yaw" (rad, alrededor de la vertical). */
export function placement(x, y, z, yaw = 0, target = new THREE.Matrix4(), tilt = 0) {
  placeObject.position.set(x, y, z);
  placeObject.rotation.set(0, yaw, tilt);
  placeObject.scale.set(1, 1, 1);
  placeObject.updateMatrix();
  return target.copy(placeObject.matrix);
}
