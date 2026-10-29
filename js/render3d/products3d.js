// Modelos 3D de los productos y de las cajas de los pedidos. Cada forma (libro, botella, bicicleta…) se
// describe como una lista de "piezas" (geometría base + matriz + color + acabado) con la base en y = 0,
// centrada en x/z y con las medidas de config/products.js. Con esas piezas se construyen:
//   · createProductModel / createBoxModel: grupos sueltos (lo que se lleva en las manos);
//   · PartBatch: mallas instanciadas que dibujan cientos de piezas con pocas llamadas (cinta, mesas…).
// Las geometrías tienen cantos redondeados y perfiles torneados (geometries3d.js); los acabados (cartón,
// madera, metal, plástico…) son materiales estándar compartidos (materials3d.js).

import * as THREE from '../vendor/three.module.js';
import { boxSizeFor, productInfo } from '../config/products.js';
import { bottleGeometry, roundedBoxGeometry, roundedCylinderGeometry, tireGeometry, vaseGeometry } from './geometries3d.js';
import { finishMaterial, ownFinishMaterial, releaseEnvironment } from './materials3d.js';

export const GEOMETRIES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  rbox: roundedBoxGeometry(0.12, 2), // caja con cantos redondeados (productos, cajas, muebles)
  bevel: roundedBoxGeometry(0.04, 1), // canto apenas matado (tableros, perfiles grandes)
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  rcyl: roundedCylinderGeometry(0.1, 20),
  cone: new THREE.CylinderGeometry(0.22, 0.5, 1, 16),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  torus: new THREE.TorusGeometry(0.5, 0.07, 8, 24),
  tire: tireGeometry(0.34, 24).rotateX(Math.PI / 2), // eje a lo largo de z
  bottle: bottleGeometry(),
  vase: vaseGeometry(),
};
export const PART_KINDS = Object.keys(GEOMETRIES);

const tmpObject = new THREE.Object3D();
const cardboard = '#c39461';
const tapeColor = '#d8b47c';
const darker = (hex, k = 0.72) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`;
const mix = (a, b, t) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;

/**
 * Recoge piezas: p(kind, x, y, z, sx, sy, sz, color, rx, ry, rz) con (x, y, z) en el centro de la pieza.
 * use(finish) cambia el acabado de las piezas siguientes.
 */
function collector() {
  const parts = [];
  let finish = 'matte';
  const p = (kind, x, y, z, sx, sy, sz, color, rx = 0, ry = 0, rz = 0) => {
    tmpObject.position.set(x, y, z);
    tmpObject.rotation.set(rx, ry, rz);
    tmpObject.scale.set(sx, sy, sz);
    tmpObject.updateMatrix();
    parts.push({ kind, matrix: tmpObject.matrix.clone(), color: new THREE.Color(color), finish });
  };
  const use = (name) => { finish = name; };
  return { parts, p, use };
}

/** Barra cilíndrica entre dos puntos del plano x/y (cuadros de bicicleta, asas…). */
function bar(p, x0, y0, x1, y1, z, thickness, color) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  p('rcyl', (x0 + x1) / 2, (y0 + y1) / 2, z, thickness, len, thickness, color, 0, 0, Math.atan2(y1 - y0, x1 - x0) - Math.PI / 2);
}

/** Etiqueta blanca con un código de barras (en la cara +z). */
function label(p, use, x, y, z, w, h) {
  use('matte');
  p('box', x, y, z, w, h, 0.05, '#f6f5ef');
  const bars = 5;
  for (let i = 0; i < bars; i++) {
    p('box', x - w * 0.32 + (i * w * 0.64) / (bars - 1), y - h * 0.12, z + 0.03, w * (i % 2 ? 0.05 : 0.09), h * 0.42, 0.02, '#2b2b2b');
  }
}

/** Piezas de cada forma. w = ancho (x), h = alto (y), d = fondo (z). */
const SHAPES = {
  book(p, w, h, d, c, a, use) {
    const cover = Math.max(0.12, h * 0.14);
    use('matte');
    p('rbox', w * 0.03, h / 2, 0, w * 0.93, h - cover * 1.6, d * 0.95, a); // páginas
    for (let i = 1; i < 4; i++) p('box', w * 0.03, cover + ((h - cover * 2) * i) / 4, d * 0.476, w * 0.92, 0.04, 0.02, darker(a, 0.86)); // canto de las hojas
    use('satin');
    p('rbox', 0, cover / 2, 0, w, cover, d, c); // tapa inferior
    p('rbox', 0, h - cover / 2, 0, w, cover, d, c); // tapa superior
    p('rcyl', -w / 2 + w * 0.05, h / 2, 0, w * 0.14, d, h, darker(c, 0.85), Math.PI / 2); // lomo redondeado
    use('gloss');
    p('box', w * 0.1, h + 0.01, d * 0.1, w * 0.5, 0.03, d * 0.36, mix(c, '#ffffff', 0.55)); // título
  },
  envelope(p, w, h, d, c, a, use) {
    use('matte');
    p('rbox', 0, h / 2, 0, w, h, d, c);
    // Solapa: dos pliegues en diagonal sobre la cara superior
    const len = Math.hypot(w / 2, d * 0.45);
    const ang = Math.atan2(d * 0.45, w / 2);
    p('box', -w / 4, h + 0.02, -d * 0.27, len, 0.03, 0.08, darker(c, 0.82), 0, ang);
    p('box', w / 4, h + 0.02, -d * 0.27, len, 0.03, 0.08, darker(c, 0.82), 0, -ang);
    p('box', w * 0.32, h + 0.03, d * 0.22, w * 0.18, 0.05, d * 0.24, a); // sello
    for (let i = 0; i < 3; i++) p('box', -w * 0.08, h + 0.025, d * (0.08 + i * 0.1), w * 0.42, 0.03, 0.12, '#7a7a7a'); // dirección
  },
  folder(p, w, h, d, c, a, use) {
    use('satin');
    p('rbox', 0, h / 2, 0, w, h, d, c);
    use('matte');
    p('rbox', 0, h * 0.5, d / 2 + 0.03, w * 0.72, h * 0.62, 0.08, a); // pestaña
    p('box', 0, h + 0.02, -d * 0.18, w * 0.52, 0.04, d * 0.26, '#f4f2ea'); // etiqueta
    use('rubber');
    for (const x of [-w * 0.38, w * 0.38]) p('box', x, h / 2, 0, 0.18, h * 1.04, d * 1.02, '#222222'); // gomas
  },
  box(p, w, h, d, c, a, use) {
    const raw = new THREE.Color(c).getHSL({ h: 0, s: 0, l: 0 });
    use(raw.s < 0.5 && raw.l > 0.35 && raw.l < 0.6 ? 'cardboard' : 'satin');
    p('rbox', 0, h / 2, 0, w, h, d, c);
    use('satin');
    p('box', 0, h * 0.5, 0, w * 1.01, h * 0.16, d * 1.01, a); // banda impresa
    use('plastic');
    p('box', 0, h + 0.02, 0, w * 0.98, 0.05, Math.min(1.2, d * 0.24), tapeColor); // precinto
    label(p, use, w * 0.18, h * 0.72, d / 2 + 0.03, Math.min(1.8, w * 0.36), Math.min(1.1, h * 0.26));
  },
  appliance(p, w, h, d, c, a, use) {
    use('gloss');
    p('rbox', 0, h / 2 + h * 0.02, 0, w, h * 0.96, d, c);
    use('rubber');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p('rcyl', sx * w * 0.38, h * 0.02, sz * d * 0.36, w * 0.1, h * 0.04, w * 0.1, '#222222'); // patas
    const r = Math.min(w, h) * 0.62;
    use('chrome');
    p('torus', 0, h * 0.45, d / 2 + 0.06, r * 1.08, r * 1.08, r * 1.6, '#c9ced6'); // aro de la puerta
    use('glass');
    p('cyl', 0, h * 0.45, d / 2 + 0.04, r, 0.1, r, mix(a, '#0a1520', 0.5), Math.PI / 2); // cristal
    use('plastic');
    p('rbox', 0, h * 0.9, d / 2 + 0.04, w * 0.84, h * 0.12, 0.14, darker(c, 0.62)); // panel de mandos
    use('chrome');
    p('rcyl', w * 0.28, h * 0.9, d / 2 + 0.14, h * 0.07, 0.12, h * 0.07, '#d0d4da', Math.PI / 2); // mando
    use('screen');
    p('box', -w * 0.18, h * 0.9, d / 2 + 0.12, w * 0.24, h * 0.05, 0.02, '#19b4ff'); // display
  },
  toolbox(p, w, h, d, c, a, use) {
    use('painted');
    p('rbox', 0, h * 0.36, 0, w, h * 0.72, d, c);
    p('rbox', 0, h * 0.78, 0, w * 1.02, h * 0.14, d * 1.02, darker(c, 0.82)); // tapa
    use('plastic');
    bar(p, -w * 0.25, h * 0.86, -w * 0.25, h * 1.0, 0, h * 0.06, a);
    bar(p, w * 0.25, h * 0.86, w * 0.25, h * 1.0, 0, h * 0.06, a);
    bar(p, -w * 0.25, h * 0.99, w * 0.25, h * 0.99, 0, h * 0.08, a); // asa
    use('chrome');
    for (const x of [-w * 0.3, w * 0.3]) p('rbox', x, h * 0.62, d / 2 + 0.04, w * 0.09, h * 0.14, 0.1, '#d9dce0'); // cierres
  },
  case(p, w, h, d, c, a, use) {
    use('plastic');
    p('rbox', 0, h / 2, 0, w, h, d, c);
    use('matte');
    p('box', 0, h / 2, 0, w * 1.005, h * 0.08, d * 1.005, a); // cremallera
    use('chrome');
    p('rbox', w * 0.5, h / 2, d * 0.3, 0.2, h * 0.16, 0.36, '#c9ced6'); // tirador
    use('gloss');
    p('box', 0, h + 0.02, 0, w * 0.42, 0.03, d * 0.42, darker(c, 1.5)); // logotipo
  },
  bottle(p, w, h, d, c, a, use) {
    use('gloss');
    p('bottle', 0, h * 0.44, 0, w, h * 0.88, d, c);
    use('plastic');
    p('rcyl', 0, h * 0.94, 0, w * 0.4, h * 0.12, d * 0.4, a); // tapón
    use('matte');
    p('cyl', 0, h * 0.32, 0, w * 1.015, h * 0.28, d * 1.015, '#f7f5ee'); // etiqueta
    p('cyl', 0, h * 0.32, 0, w * 1.02, h * 0.06, d * 1.02, a); // franja
  },
  jar(p, w, h, d, c, a, use) {
    use('satin');
    p('rcyl', 0, h * 0.46, 0, w, h * 0.86, d, c);
    use('fabric');
    p('cyl', 0, h * 0.5, 0, w * 1.01, h * 0.5, d * 1.01, darker(a, 0.75)); // rejilla
    use('plastic');
    p('rcyl', 0, h * 0.94, 0, w * 0.88, h * 0.1, d * 0.88, a); // tapa
    p('rcyl', 0, h * 0.04, 0, w * 1.04, h * 0.08, d * 1.04, darker(c, 0.55)); // base
  },
  vase(p, w, h, d, c, a, use) {
    use('gloss');
    p('vase', 0, h / 2, 0, w, h, d, c);
    use('matte');
    p('cyl', 0, h * 0.37, 0, w * 0.98, h * 0.04, d * 0.98, a); // filete decorativo
  },
  soft(p, w, h, d, c, a, use) {
    use('fabric');
    const layers = h > 1.4 ? 3 : 2;
    const lh = h / layers;
    for (let i = 0; i < layers; i++) {
      const inset = i * 0.08;
      p('rbox', (i % 2 ? 0.08 : -0.06), lh * (i + 0.5), 0, w * (1 - inset), lh * 0.98, d * (1 - inset * 0.6), i % 2 ? darker(c, 0.94) : c);
    }
    use('glass');
    p('rbox', 0, h / 2, 0, w * 1.03, h * 1.02, d * 1.03, '#e8f0f4'); // bolsa de plástico
    label(p, use, -w * 0.2, h * 0.55, d / 2 + 0.06, Math.min(1.4, w * 0.3), Math.min(0.8, h * 0.5));
  },
  backpack(p, w, h, d, c, a, use) {
    use('fabric');
    p('rbox', 0, h * 0.44, 0, w, h * 0.88, d * 0.72, c);
    p('sphere', 0, h * 0.84, 0, w, h * 0.28, d * 0.72, c); // parte superior redondeada
    p('rbox', 0, h * 0.3, d * 0.4, w * 0.74, h * 0.38, d * 0.24, a); // bolsillo
    p('rbox', -w * 0.25, h * 0.5, -d * 0.4, w * 0.16, h * 0.7, d * 0.1, darker(c, 0.7)); // tirantes
    p('rbox', w * 0.25, h * 0.5, -d * 0.4, w * 0.16, h * 0.7, d * 0.1, darker(c, 0.7));
    use('chrome');
    p('box', 0, h * 0.62, d * 0.37, w * 0.7, 0.08, 0.06, '#c9ced6'); // cremallera
    use('plastic');
    bar(p, -w * 0.15, h * 0.98, w * 0.15, h * 0.98, 0, 0.22, '#222222'); // asa
  },
  shoebox(p, w, h, d, c, a, use) {
    use('satin');
    p('rbox', 0, h * 0.4, 0, w, h * 0.8, d, c);
    p('rbox', 0, h * 0.88, 0, w * 1.03, h * 0.24, d * 1.03, a); // tapa
    use('gloss');
    p('box', w * 0.28, h * 0.88, d * 0.52, w * 0.22, h * 0.12, 0.04, c); // logotipo
  },
  flat(p, w, h, d, c, a, use) {
    use('plastic');
    p('rbox', 0, h * 0.55, 0, w, h * 0.9, d * 0.5, c); // marco de la pantalla
    use('screen');
    p('box', 0, h * 0.56, d * 0.26, w * 0.94, h * 0.82, 0.04, darker(a, 0.35)); // pantalla
    use('plastic');
    p('rbox', 0, h * 0.06, 0, w * 0.06, h * 0.12, d * 0.3, darker(c, 1.4)); // cuello
    p('rbox', 0, h * 0.015, 0, w * 0.36, h * 0.03, d, darker(c, 1.3)); // peana
  },
  frame(p, w, h, d, c, a, use) {
    use('wood');
    p('rbox', 0, h / 2, 0, w, h, d * 0.6, c);
    use('matte');
    p('box', 0, h / 2, d * 0.31, w * 0.84, h * 0.8, 0.04, '#f2efe6'); // paspartú
    p('box', 0, h / 2, d * 0.33, w * 0.62, h * 0.56, 0.04, a); // lámina
    p('box', -w * 0.12, h * 0.42, d * 0.35, w * 0.26, h * 0.24, 0.03, darker(a, 0.6));
    use('glass');
    p('box', 0, h / 2, d * 0.36, w * 0.86, h * 0.82, 0.02, '#dfeef6');
  },
  tube(p, w, h, d, c, a, use) {
    use('cardboard');
    p('rcyl', 0, h / 2, 0, w, d, h, c, Math.PI / 2); // tumbado a lo largo de z
    use('plastic');
    p('rcyl', 0, h / 2, d / 2, w * 1.08, 0.3, h * 1.08, a, Math.PI / 2); // tapones
    p('rcyl', 0, h / 2, -d / 2, w * 1.08, 0.3, h * 1.08, a, Math.PI / 2);
  },
  lamp(p, w, h, d, c, a, use) {
    use('painted');
    p('rcyl', 0, h * 0.03, 0, w * 0.62, h * 0.06, d * 0.62, darker(c, 0.6)); // pie
    use('chrome');
    p('cyl', 0, h * 0.34, 0, w * 0.07, h * 0.6, d * 0.07, '#c8ccd2'); // tubo
    use('fabric');
    p('cone', 0, h * 0.78, 0, w, h * 0.44, d, c); // pantalla
    use('gloss');
    p('sphere', 0, h * 0.68, 0, w * 0.26, w * 0.3, d * 0.26, a); // bombilla
  },
  bike(p, w, h, d, c, a, use) {
    const r = h * 0.36;
    for (const sx of [-1, 1]) {
      use('rubber');
      p('tire', sx * w * 0.3, r, 0, r * 2, r * 2, d * 0.32, '#1c1c1c'); // neumáticos
      use('chrome');
      p('torus', sx * w * 0.3, r, 0, r * 1.36, r * 1.36, r * 1.6, '#c0c5cc'); // llanta
      p('rcyl', sx * w * 0.3, r, 0, 0.5, d * 0.36, 0.5, '#9a9fa6', Math.PI / 2); // buje
      for (let k = 0; k < 3; k++) p('box', sx * w * 0.3, r, 0, 0.08, r * 1.3, 0.08, '#b8bdc4', 0, 0, (k * Math.PI) / 3); // radios
    }
    use('painted');
    const rear = -w * 0.3;
    const front = w * 0.3;
    const seatX = -w * 0.08;
    const top = h * 0.78;
    bar(p, rear, r, seatX, top, 0, 0.4, c); // tirante trasero
    bar(p, seatX, top, front * 0.8, top, 0, 0.42, c); // barra superior
    bar(p, seatX, r * 0.9, front * 0.8, top, 0, 0.48, c); // tubo diagonal
    bar(p, rear, r, seatX, r * 0.9, 0, 0.34, c); // vaina
    bar(p, front, r, front * 0.8, top + h * 0.1, 0, 0.38, c); // horquilla
    bar(p, seatX, r * 0.9, seatX, top + 0.3, 0, 0.42, c); // tubo del sillín
    use('chrome');
    p('cyl', seatX, r * 0.9, 0, r * 0.5, d * 0.2, r * 0.5, '#a9aeb5', Math.PI / 2); // plato
    use('rubber');
    p('rbox', seatX - 0.2, top + 0.5, 0, w * 0.14, 0.36, d * 0.42, '#1e1e1e'); // sillín
    p('rcyl', front * 0.8, top + h * 0.1, 0, 0.32, d, 0.32, '#1e1e1e', Math.PI / 2); // manillar
  },
  pallet(p, w, h, d, c, a, use) {
    const base = h * 0.16;
    use('wood');
    for (const z of [-0.42, 0, 0.42]) p('box', 0, base * 0.12, z * d, w, base * 0.24, d * 0.14, darker(c, 0.85)); // patines
    for (const x of [-0.42, 0, 0.42]) for (const z of [-0.42, 0, 0.42]) p('bevel', x * w, base * 0.5, z * d, w * 0.14, base * 0.55, d * 0.14, darker(c, 0.8)); // tacos
    for (let i = 0; i < 5; i++) p('bevel', 0, base * 0.88, (-0.4 + i * 0.2) * d, w, base * 0.24, d * 0.15, c); // tablas
    const load = h - base;
    use('cardboard');
    const cols = 2;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < cols; j++) {
        p('rbox', (i - 0.5) * w * 0.45, base + load * 0.5, (j - 0.5) * d * 0.45, w * 0.44, load * 0.98, d * 0.44, cardboard);
      }
    }
    use('glass');
    p('rbox', 0, base + load * 0.5, 0, w * 0.93, load * 1.01, d * 0.93, '#eef6f8'); // film estirable
    use('plastic');
    p('box', 0, base + load * 0.5, 0, w * 0.08, load * 1.03, d * 0.95, a); // fleje
  },
  crate(p, w, h, d, c, a, use) {
    use('wood');
    p('box', 0, h / 2, 0, w * 0.94, h * 0.94, d * 0.94, darker(c, 0.62));
    for (const y of [0.08, 0.5, 0.92]) {
      p('bevel', 0, h * y, d * 0.48, w, h * 0.14, d * 0.05, c); // listones delanteros y traseros
      p('bevel', 0, h * y, -d * 0.48, w, h * 0.14, d * 0.05, c);
      p('bevel', w * 0.48, h * y, 0, w * 0.05, h * 0.14, d, c);
      p('bevel', -w * 0.48, h * y, 0, w * 0.05, h * 0.14, d, c);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p('bevel', sx * w * 0.46, h / 2, sz * d * 0.46, w * 0.1, h, d * 0.1, darker(c, 0.9));
    p('bevel', 0, h * 0.5, d * 0.5, Math.hypot(w, h) * 0.9, h * 0.1, d * 0.05, darker(c, 0.92), 0, 0, Math.atan2(h, w)); // aspa
    use('painted');
    p('box', 0, h * 0.74, d / 2 + 0.05, w * 0.3, h * 0.16, 0.04, a); // placa
  },
  longbox(p, w, h, d, c, a, use) {
    use('cardboard');
    p('rbox', 0, h / 2, 0, w, h, d, c);
    use('plastic');
    for (const x of [-0.4, 0, 0.4]) p('box', x * w, h / 2, 0, w * 0.04, h * 1.02, d * 1.02, a); // flejes
    p('box', 0, h + 0.02, 0, w * 0.98, 0.05, Math.min(1.2, d * 0.22), tapeColor);
    label(p, use, w * 0.22, h * 0.6, d / 2 + 0.03, Math.min(2.2, w * 0.18), Math.min(1.2, h * 0.4));
  },
  guitar(p, w, h, d, c, a, use) {
    // Tumbada: el cuerpo hacia +z y el mástil hacia -z
    use('gloss');
    p('sphere', 0, h * 0.42, d * 0.3, w, h * 0.8, d * 0.36, c);
    p('sphere', 0, h * 0.42, d * 0.08, w * 0.8, h * 0.8, d * 0.26, c);
    use('matte');
    p('cyl', 0, h * 0.82, d * 0.17, w * 0.3, 0.06, w * 0.3, '#151515'); // boca
    p('box', 0, h * 0.84, d * 0.36, w * 0.36, 0.08, d * 0.04, '#2a1a10'); // puente
    use('wood');
    p('rbox', 0, h * 0.55, -d * 0.24, w * 0.18, h * 0.24, d * 0.46, a); // mástil
    p('rbox', 0, h * 0.55, -d * 0.47, w * 0.3, h * 0.24, d * 0.08, darker(c, 0.6)); // pala
    use('chrome');
    for (let i = 0; i < 3; i++) p('box', (i - 1) * w * 0.04, h * 0.68, d * 0.0, 0.03, 0.03, d * 0.7, '#d6d9de'); // cuerdas
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
  (SHAPES[info.shape] ?? SHAPES.box)(c.p, w, h, d, info.color, info.accent, c.use);
  parts = c.parts;
  partsCache.set(name, parts);
  return parts;
}

/**
 * Piezas de una caja de cartón cerrada de [largo, alto, ancho]: cantos redondeados, junta de las solapas,
 * precinto que baja por los extremos y etiqueta de envío con código de barras.
 */
export function boxParts(size, tint = null) {
  const [w, h, d] = size;
  const key = `${w.toFixed(1)}|${h.toFixed(1)}|${d.toFixed(1)}|${tint ?? ''}`;
  let parts = partsCache.get(key);
  if (parts) return parts;
  const c = collector();
  const color = tint ? mix(cardboard, tint, 0.14) : cardboard;
  const tw = Math.min(1.4, d * 0.24);
  c.use('cardboard');
  c.p('rbox', 0, h / 2, 0, w, h, d, color);
  c.use('matte');
  c.p('box', 0, h + 0.005, 0, w * 0.96, 0.03, 0.1, darker(color, 0.55)); // junta de las solapas
  c.use('plastic');
  c.p('box', 0, h + 0.03, 0, w * 0.99, 0.05, tw, tapeColor); // precinto de la tapa
  c.p('box', w / 2 + 0.02, h * 0.78, 0, 0.05, h * 0.44, tw, tapeColor); // y por los extremos
  c.p('box', -w / 2 - 0.02, h * 0.78, 0, 0.05, h * 0.44, tw, tapeColor);
  if (tint) {
    c.use('matte');
    c.p('box', w * 0.3, h * 0.22, d / 2 + 0.03, Math.min(1.2, w * 0.18), Math.min(1.2, h * 0.2), 0.04, tint); // pegatina de tipo
  }
  label(c.p, c.use, -w * 0.18, h * 0.6, d / 2 + 0.03, Math.min(2.4, w * 0.36), Math.min(1.6, h * 0.34));
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
    const material = ownFinishMaterial(part.finish ?? 'matte', part.color, part.kind);
    if (overlay) { material.depthTest = false; material.depthWrite = false; }
    materials.push(material);
    const mesh = new THREE.Mesh(GEOMETRIES[part.kind] ?? GEOMETRIES.box, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(part.matrix);
    if (overlay) mesh.renderOrder = 30;
    mesh.castShadow = !overlay && part.finish !== 'glass';
    mesh.receiveShadow = !overlay;
    group.add(mesh);
  }
  group.userData.dispose = () => {
    for (const m of materials) {
      releaseEnvironment(m);
      m.dispose();
    }
  };
  return group;
}

export const createProductModel = (name, opts) => buildPartsModel(productParts(name), opts);
export const createBoxModel = (order, opts) => buildPartsModel(orderBoxParts(order), opts);

/**
 * Lote de piezas instanciadas: una malla por geometría y acabado, con color por instancia. begin() vacía el
 * lote, add(parts, matrix) añade un modelo colocado con "matrix" y end() sube los cambios a la GPU.
 * Cada malla crece sola si se queda sin sitio (la capacidad inicial es solo una estimación).
 */
export class PartBatch {
  constructor(capacity = 512, { shadows = true, basic = false } = {}) {
    this.basic = basic; // sin iluminación (paneles de luz, pantallas)
    this.shadows = shadows;
    this.caps = typeof capacity === 'number' ? null : capacity;
    this.defaultCap = typeof capacity === 'number' ? capacity : 64;
    this.entries = new Map();
    this.group = new THREE.Group();
    this.tmp = new THREE.Matrix4();
  }

  entry(kind, finish) {
    const key = `${kind}|${finish}`;
    let e = this.entries.get(key);
    if (e) return e;
    const geometry = GEOMETRIES[kind];
    if (!geometry) return null;
    const estimate = this.caps ? (this.caps[kind] ?? 48) : this.defaultCap;
    const cap = Math.max(16, Math.ceil(finish === 'matte' ? estimate : estimate / 3));
    e = { kind, finish, count: 0, mesh: this.makeMesh(geometry, finishMaterial(finish, kind, this.basic), cap, finish) };
    this.group.add(e.mesh);
    this.entries.set(key, e);
    return e;
  }

  makeMesh(geometry, material, cap, finish) {
    const mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.count = 0;
    mesh.castShadow = this.shadows && !this.basic && finish !== 'glass';
    mesh.receiveShadow = !this.basic;
    mesh.frustumCulled = false;
    if (finish === 'glass') mesh.renderOrder = 3;
    return mesh;
  }

  grow(e) {
    const old = e.mesh;
    const mesh = this.makeMesh(old.geometry, old.material, old.instanceMatrix.count * 2, e.finish);
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    mesh.instanceColor.array.set(old.instanceColor.array);
    this.group.remove(old);
    old.dispose();
    this.group.add(mesh);
    e.mesh = mesh;
  }

  push(e, matrix, color) {
    if (e.count >= e.mesh.instanceMatrix.count) this.grow(e);
    e.mesh.setMatrixAt(e.count, matrix);
    e.mesh.setColorAt(e.count, color);
    e.count += 1;
  }

  begin() {
    for (const e of this.entries.values()) e.count = 0;
  }

  add(parts, matrix) {
    for (const part of parts) {
      const e = this.entry(part.kind, part.finish ?? 'matte');
      if (e) this.push(e, this.tmp.multiplyMatrices(matrix, part.matrix), part.color);
    }
  }

  /** Una pieza suelta (matriz ya en coordenadas del lote). */
  addPart(kind, matrix, color, finish = 'matte') {
    const e = this.entry(kind, finish);
    if (e) this.push(e, matrix, color);
  }

  end() {
    for (const e of this.entries.values()) {
      e.mesh.count = e.count;
      e.mesh.instanceMatrix.needsUpdate = true;
      e.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    // Las geometrías y los materiales son compartidos (no se liberan aquí)
    for (const e of this.entries.values()) e.mesh.dispose();
    this.entries.clear();
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
