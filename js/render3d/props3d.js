// Elementos de la ciudad que no son edificios: árboles de los parques, farolas, barreras de zonas bloqueadas,
// fuentes y mobiliario urbano (bordillos, bancos, papeleras y señales).

import * as THREE from '../vendor/three.module.js';
import { TILE } from '../config/constants.js';
import { getGlowTexture, getHazardTexture } from './textures3d.js';
import { buildTreeMeshes } from './vegetation3d.js';
import { mergeGeometries } from './geometries3d.js';
import { releaseEnvironment, surfaceTexture, withEnvironment } from './materials3d.js';

/** Sólido de revolución a partir de un perfil [[radio, y], ...] en px (de abajo arriba). */
function lathe(profile, segments) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** Árboles de los parques (instanciados por tipo de copa, ver vegetation3d.js). */
export function buildTrees(city) {
  const group = new THREE.Group();
  const trees = city.parks.flatMap((park) => park.trees).map((tree) => ({ x: tree.x, z: tree.y, r: tree.r }));
  const handle = buildTreeMeshes(trees, 0);
  for (const mesh of handle.meshes) group.add(mesh);
  return { group, dispose: handle.dispose };
}

/** Farolas: postes, bombillas y halos. Devuelve también las posiciones para las luces reales. */
export function buildLamps(city) {
  const group = new THREE.Group();
  const lamps = city.lampPosts;
  // Poste torneado de altura 1 (se escala a poleHeight): zócalo, anillo decorativo y fuste cónico
  const poleGeometry = lathe([[2.5, 0], [2.5, 0.03], [1.9, 0.045], [1.35, 0.06], [1.25, 0.27], [1.55, 0.28], [1.55, 0.31],
    [1.15, 0.32], [0.95, 0.7], [0.75, 0.995], [0.01, 1]], 12);
  const metal = (color) => withEnvironment(new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.55 }), 0.8);
  const poles = new THREE.InstancedMesh(poleGeometry, metal('#3d434e'), lamps.length);
  // Luminaria tipo sombrero (centrada en poleHeight + 1): fondo plano, ala y cúpula con remate
  const headGeometry = lathe([[0.01, -1.85], [3.9, -1.85], [4.5, -1.3], [4.8, -0.5], [4.0, 0.4], [2.2, 1.2], [0.9, 1.6],
    [0.6, 2.4], [0.01, 2.6]], 18);
  const heads = new THREE.InstancedMesh(headGeometry, metal('#2f343d'), lamps.length);
  // Difusor bajo la luminaria (centrado en poleHeight - 1.2): cúpula invertida
  const bulbGeometry = lathe([[0.01, -1.1], [2.4, -0.95], [3.6, -0.5], [3.95, 0.1], [3.95, 0.42], [0.01, 0.42]], 16);
  const bulbMaterial = new THREE.MeshBasicMaterial({ color: '#8d93a0' });
  const bulbs = new THREE.InstancedMesh(bulbGeometry, bulbMaterial, lamps.length);
  const dummy = new THREE.Object3D();
  const glowPositions = new Float32Array(lamps.length * 3);
  const poleHeight = 38;

  lamps.forEach((lamp, index) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(lamp.x, 0, lamp.y);
    dummy.scale.set(1, poleHeight, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(index, dummy.matrix);

    dummy.position.set(lamp.x, poleHeight + 1, lamp.y);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    heads.setMatrixAt(index, dummy.matrix);

    dummy.position.set(lamp.x, poleHeight - 1.2, lamp.y);
    dummy.updateMatrix();
    bulbs.setMatrixAt(index, dummy.matrix);

    glowPositions[index * 3] = lamp.x;
    glowPositions[index * 3 + 1] = poleHeight - 1;
    glowPositions[index * 3 + 2] = lamp.y;
  });
  // Muñones que quedan en la acera cuando se derriba una farola (solo se pintan los que hagan falta)
  const stumps = new THREE.InstancedMesh(poleGeometry, poles.material, Math.max(1, lamps.length));
  stumps.count = 0;
  // Su esfera envolvente se calcularía con 0 instancias y Three.js no los pintaría nunca
  stumps.frustumCulled = false;
  poles.castShadow = true;
  heads.castShadow = true;
  stumps.castShadow = true;
  for (const mesh of [poles, heads, bulbs, stumps]) {
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  const glowGeometry = new THREE.BufferGeometry();
  glowGeometry.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));

  // Coloca una farola inclinada `tilt` rad hacia (dirX, dirZ), con la base desplazada `slide` px.
  // El poste gira alrededor de su base; la cabeza y la bombilla lo acompañan.
  const axis = new THREE.Vector3();
  const place = (index, tilt, dirX, dirZ, slide, intact) => {
    const lamp = lamps[index];
    const bx = lamp.x + dirX * slide;
    const bz = lamp.y + dirZ * slide;
    const s = Math.sin(tilt);
    const c = Math.cos(tilt);
    const lift = s * 1.8; // tumbada, que no se hunda en el suelo
    if (tilt > 1e-4) dummy.quaternion.setFromAxisAngle(axis.set(dirZ, 0, -dirX), tilt);
    else dummy.quaternion.identity();
    const at = (h) => dummy.position.set(bx + dirX * s * h, lift + c * h, bz + dirZ * s * h);
    at(0);
    dummy.scale.set(1, poleHeight, 1);
    dummy.updateMatrix();
    poles.setMatrixAt(index, dummy.matrix);
    at(poleHeight + 1);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    heads.setMatrixAt(index, dummy.matrix);
    // La bombilla se rompe con el golpe y vuelve a estar entera cuando la farola se levanta
    at(poleHeight - 1.2);
    if (!intact) dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    bulbs.setMatrixAt(index, dummy.matrix);
    glowPositions[index * 3] = lamp.x;
    glowPositions[index * 3 + 1] = intact ? poleHeight - 1 : -9999;
    glowPositions[index * 3 + 2] = lamp.y;
  };
  const animated = new Set();
  const glowMaterial = new THREE.PointsMaterial({
    map: getGlowTexture(), color: '#ffc477', size: 46, sizeAttenuation: true, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const glow = new THREE.Points(glowGeometry, glowMaterial);
  glow.frustumCulled = false;
  glow.visible = false;
  group.add(glow);

  const off = new THREE.Color('#8d93a0');
  const on = new THREE.Color('#ffe9a6');
  return {
    group,
    setNight(darkness) {
      bulbMaterial.color.copy(off).lerp(on, Math.min(1, darkness * 1.6));
      glowMaterial.opacity = Math.min(1, darkness * 1.1) * 0.85;
      glow.visible = darkness > 0.04;
    },
    /** Dibuja las farolas derribadas (mapa índice → estado de systems/streetLamps.js) y endereza las demás. */
    update(broken, poseOf) {
      if (!broken.size && !animated.size) return;
      for (const index of animated) {
        if (broken.has(index)) continue;
        place(index, 0, 0, 0, 0, true);
        animated.delete(index);
      }
      let stumpCount = 0;
      for (const [index, entry] of broken) {
        if (index >= lamps.length) continue;
        const pose = poseOf(entry);
        place(index, pose.tilt, pose.dirX, pose.dirY, pose.slide, false);
        animated.add(index);
        const lamp = lamps[index];
        dummy.quaternion.identity();
        dummy.position.set(lamp.x, 0, lamp.y);
        dummy.scale.set(1.15, 3.2, 1.15);
        dummy.updateMatrix();
        stumps.setMatrixAt(stumpCount++, dummy.matrix);
      }
      stumps.count = stumpCount;
      for (const mesh of [poles, heads, bulbs, stumps]) mesh.instanceMatrix.needsUpdate = true;
      glowGeometry.attributes.position.needsUpdate = true;
    },
    dispose() {
      for (const geometry of [poleGeometry, headGeometry, bulbGeometry, glowGeometry]) geometry.dispose();
      for (const mesh of [poles, heads, bulbs]) {
        releaseEnvironment(mesh.material);
        mesh.material.dispose();
        mesh.dispose();
      }
      stumps.dispose();
      glowMaterial.dispose();
    },
  };
}

/** Vallas a rayas en la frontera entre la zona desbloqueada y la bloqueada. */
export function buildBarriers(city) {
  const group = new THREE.Group();
  const alongX = [];
  const alongZ = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const MAP_TILES_X = city.width;
  const MAP_TILES_Y = city.height;
  for (let ty = 0; ty < MAP_TILES_Y; ty++) {
    for (let tx = 0; tx < MAP_TILES_X; tx++) {
      if (city.isZoneUnlocked(city.zoneIdAtTile(tx, ty)) || city.isSolidBuildingTile(tx, ty)) continue;
      for (const [dx, dy] of dirs) {
        const nx = tx + dx;
        const ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_TILES_X || ny >= MAP_TILES_Y) continue;
        if (!city.isZoneUnlocked(city.zoneIdAtTile(nx, ny)) || city.isSolidBuildingTile(nx, ny)) continue;
        if (dx !== 0) {
          alongZ.push({ x: dx > 0 ? (tx + 1) * TILE : tx * TILE, z: (ty + 0.5) * TILE });
        } else {
          alongX.push({ x: (tx + 0.5) * TILE, z: dy > 0 ? (ty + 1) * TILE : ty * TILE });
        }
      }
    }
  }
  if (!alongX.length && !alongZ.length) return { group, dispose() {} };

  const material = new THREE.MeshLambertMaterial({ map: getHazardTexture() });
  const geometries = [];
  const dummy = new THREE.Object3D();
  for (const [list, w, d] of [[alongX, TILE, 6], [alongZ, 6, TILE]]) {
    if (!list.length) continue;
    const geometry = new THREE.BoxGeometry(w, 14, d);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.3, uv.getY(i) * 1.1);
    geometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((item, index) => {
      dummy.position.set(item.x, 7, item.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return {
    group,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      material.dispose();
    },
  };
}

/** Fuentes de las plazas peatonales: pilón de piedra, agua y surtidor central. */
export function buildFountains(city) {
  const group = new THREE.Group();
  const plazas = city.plazas ?? [];
  if (!plazas.length) return { group, dispose() {} };
  const stone = new THREE.MeshLambertMaterial({ color: '#c9c1b2' });
  const water = new THREE.MeshPhongMaterial({ color: '#3fb6e0', specular: '#ffffff', shininess: 90, emissive: '#0b3b52', emissiveIntensity: 0.35 });
  const spray = new THREE.MeshBasicMaterial({ color: '#e9f6fb', transparent: true, opacity: 0.7, depthWrite: false });
  const geometries = [];
  for (const plaza of plazas) {
    const { x, y, r } = plaza.fountain;
    // Pilón torneado: zócalo, pared, borde con albardilla que vuela y pared interior (mismo radio exterior r)
    const basin = lathe([[r - 1, 0], [r, 0.6], [r, 6.4], [r + 1.2, 6.9], [r + 1.2, 8.4], [r - 3, 8.4], [r - 3, 1.5], [0.01, 1.5]], 32);
    const pool = new THREE.CylinderGeometry(r - 3, r - 3, 1, 32);
    // Columna central con taza superior y remate
    const column = lathe([[4.6, 0], [4.6, 2.2], [3.2, 3.2], [2.6, 12], [3.4, 13], [6.6, 14.6], [6.9, 16.2], [1.7, 16.8],
      [1.4, 21], [2.4, 22], [0.01, 23.5]], 20);
    const jet = new THREE.ConeGeometry(7, 16, 10, 1, true);
    geometries.push(basin, pool, column, jet);
    const add = (geometry, material, py) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, py, y);
      mesh.castShadow = material !== spray;
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    add(basin, stone, 0);
    add(pool, water, 6.6);
    add(column, stone, 1.5);
    add(jet, spray, 26);
  }
  return {
    group,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      stone.dispose();
      water.dispose();
      spray.dispose();
    },
  };
}

// ------------------------------------------------------ Mobiliario urbano ----
// Bordillos en volumen alrededor de las manzanas, bancos y papeleras en parques y plazas y señales de tráfico en
// las esquinas. Todo es decorativo (no cambia colisiones ni rutas) y va instanciado: pocas llamadas de dibujo.

/** Caja colocada (no indexada) para fusionar en una sola geometría. */
function boxAt(w, h, d, x, y, z, rotX = 0) {
  const geometry = new THREE.BoxGeometry(w, h, d);
  if (rotX) geometry.rotateX(rotX);
  return geometry.translate(x, y, z);
}

/** Banco de parque: listones de madera (asiento y respaldo) y dos patas de fundición. Mira hacia +z. */
function benchGeometries() {
  const wood = [];
  for (let i = 0; i < 3; i++) wood.push(boxAt(16, 0.7, 1.5, 0, 4.6, 1.9 - i * 1.8));
  for (let i = 0; i < 2; i++) wood.push(boxAt(16, 1.4, 0.5, 0, 6.6 + i * 2, -2.6 - i * 0.35, -0.22));
  const iron = [];
  for (const x of [-6.2, 6.2]) {
    iron.push(boxAt(0.8, 4.3, 0.8, x, 2.15, 2.2)); // pata delantera
    iron.push(boxAt(0.8, 9.2, 0.8, x, 4.6, -2.5, -0.12)); // pata trasera que sube al respaldo
    iron.push(boxAt(0.8, 0.6, 5.6, x, 4.0, -0.2)); // travesaño bajo el asiento
    iron.push(boxAt(0.8, 0.5, 4.2, x, 6.2, 0.4)); // reposabrazos
  }
  return { wood: mergeGeometries(wood), iron: mergeGeometries(iron) };
}

/** Papelera: cubo cilíndrico con aro superior y poste. */
function binGeometry() {
  const parts = [
    new THREE.CylinderGeometry(2.3, 2.0, 6.5, 14, 1, true).translate(0, 4.0, 0),
    new THREE.CylinderGeometry(2.0, 2.0, 0.3, 14).translate(0, 0.9, 0),
    new THREE.TorusGeometry(2.3, 0.28, 6, 14).rotateX(Math.PI / 2).translate(0, 7.25, 0),
    new THREE.CylinderGeometry(0.45, 0.45, 7.6, 6).translate(0, 3.8, -2.6),
  ];
  return mergeGeometries(parts);
}

/** Cara de una señal con fondo transparente (se recorta con alphaTest). */
function signTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const c = 64;
  const polygon = (n, r, rot) => {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
    }
    ctx.closePath();
  };
  if (kind === 'stop') {
    ctx.fillStyle = '#ffffff';
    polygon(8, 62, Math.PI / 8);
    ctx.fill();
    ctx.fillStyle = '#c8202a';
    polygon(8, 56, Math.PI / 8);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 34px "Segoe UI",Arial,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STOP', c, c + 2);
  } else if (kind === 'yield') {
    // Ceda el paso: triángulo con el vértice abajo
    // (el triángulo queda bajo el centro: se sube 16 px para centrarlo en la placa)
    ctx.translate(0, -16);
    ctx.fillStyle = '#c8202a';
    polygon(3, 62, Math.PI / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    polygon(3, 38, Math.PI / 2);
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    // Paso de peatones: cuadrado azul con triángulo blanco y figura
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 4, 120, 120);
    ctx.fillStyle = '#1f5fbf';
    ctx.fillRect(9, 9, 110, 110);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(c, 18); ctx.lineTo(112, 108); ctx.lineTo(16, 108);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1b1f27';
    for (let i = 0; i < 4; i++) ctx.fillRect(34 + i * 16, 96, 10, 6);
    ctx.beginPath(); ctx.arc(c + 2, 50, 6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#1b1f27';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(c, 60); ctx.lineTo(c - 4, 76); ctx.lineTo(c - 12, 90);
    ctx.moveTo(c - 4, 76); ctx.lineTo(c + 8, 90);
    ctx.moveTo(c - 1, 64); ctx.lineTo(c - 12, 72);
    ctx.moveTo(c - 1, 64); ctx.lineTo(c + 10, 70);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Cuarto de bordillo para las esquinas redondeadas (centro en el origen, cuadrante -x / -z, altura h). */
function curbCornerGeometry(inner, outer, h) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, Math.PI / 2, Math.PI, false);
  shape.absarc(0, 0, inner, Math.PI, Math.PI / 2, true);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 6 });
  // La extrusión va a lo largo de z: se tumba para que sea la altura (y de la forma → -z del mundo)
  geometry.rotateX(-Math.PI / 2);
  // Sin textura: todas las UV al centro (la textura de los tramos rectos tiene los cantos oscurecidos)
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5, 0.5);
  return geometry;
}

export function buildStreetFurniture(city) {
  const group = new THREE.Group();
  const geometries = [];
  const materials = [];
  const textures = [];
  const dummy = new THREE.Object3D();
  const instanced = (geometry, material, items, { cast = true } = {}) => {
    if (!items.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    items.forEach((item, i) => {
      dummy.position.set(item.x, item.y ?? 0, item.z);
      dummy.rotation.set(0, item.rot ?? 0, 0);
      dummy.scale.set(item.sx ?? 1, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  };

  // --- Bordillos: el borde exterior de la acera (rectángulo redondeado a 7 px de la manzana, radio 9)
  const CURB_H = 1.3;
  const CURB_W = 2;
  const straight = [];
  const corners = [];
  for (const block of city.blocks) {
    const x0 = block.ox * TILE - 7;
    const z0 = block.oy * TILE - 7;
    const x1 = (block.ox + block.w) * TILE + 7;
    const z1 = (block.oy + block.h) * TILE + 7;
    const r = 9;
    const half = CURB_W / 2;
    const lenX = x1 - x0 - r * 2;
    const lenZ = z1 - z0 - r * 2;
    const midX = (x0 + x1) / 2;
    const midZ = (z0 + z1) / 2;
    straight.push({ x: midX, z: z0 + half, sx: lenX });
    // Por el frente del almacén entran y salen las furgonetas: ahí no hay bordillo (vado)
    if (block.kind !== 'depot') straight.push({ x: midX, z: z1 - half, sx: lenX });
    straight.push({ x: x0 + half, z: midZ, sx: lenZ, rot: Math.PI / 2 });
    straight.push({ x: x1 - half, z: midZ, sx: lenZ, rot: Math.PI / 2 });
    corners.push({ x: x0 + r, z: z0 + r, rot: 0 });
    corners.push({ x: x1 - r, z: z0 + r, rot: -Math.PI / 2 });
    corners.push({ x: x1 - r, z: z1 - r, rot: Math.PI });
    corners.push({ x: x0 + r, z: z1 - r, rot: Math.PI / 2 });
  }
  const curbGeometry = new THREE.BoxGeometry(1, CURB_H, CURB_W).translate(0, CURB_H / 2, 0);
  const cornerGeometry = curbCornerGeometry(9 - CURB_W, 9, CURB_H);
  const curbMaterial = new THREE.MeshLambertMaterial({ color: '#c9c5bc', map: surfaceTexture('plain', true) });
  geometries.push(curbGeometry, cornerGeometry);
  materials.push(curbMaterial);
  instanced(curbGeometry, curbMaterial, straight, { cast: false });
  instanced(cornerGeometry, curbMaterial, corners, { cast: false });

  // --- Bancos y papeleras
  const benches = [];
  const bins = [];
  const trees = city.parks.flatMap((park) => park.trees);
  const clearOfTrees = (x, z, margin) => trees.every((t) => Math.hypot(t.x - x, t.y - z) > t.r + margin);
  for (const park of city.parks) {
    const { pond } = park;
    if (!pond) continue;
    const px0 = park.x + 12;
    const px1 = park.x + (park.w ?? park.size) - 12;
    for (const s of [-1, 1]) {
      const x = pond.x + s * (pond.rx + 14);
      const z = pond.y;
      if (x < px0 || x > px1 || !clearOfTrees(x, z, 10)) continue;
      benches.push({ x, z, rot: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
      const bz = z + 13;
      if (clearOfTrees(x, bz, 5)) bins.push({ x, z: bz, rot: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
  }
  for (const plaza of city.plazas ?? []) {
    const f = plaza.fountain;
    const reach = Math.min(f.r + 44, plaza.pw / 2 - 14, plaza.ph / 2 - 14);
    if (reach < f.r + 16) continue;
    // Cuatro bancos mirando a la fuente y papeleras en las diagonales
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      benches.push({ x: f.x + dx * reach, z: f.y + dz * reach, rot: Math.atan2(-dx, -dz) });
    }
    for (const [dx, dz] of [[1, 1], [-1, -1]]) {
      bins.push({ x: f.x + dx * reach * 0.72, z: f.y + dz * reach * 0.72, rot: Math.atan2(-dx, -dz) });
    }
  }
  if (benches.length) {
    const { wood, iron } = benchGeometries();
    const woodMaterial = withEnvironment(new THREE.MeshStandardMaterial({ color: '#9b6c45', map: surfaceTexture('wood'), roughness: 0.78 }), 0.3);
    const ironMaterial = withEnvironment(new THREE.MeshStandardMaterial({ color: '#2d3530', roughness: 0.45, metalness: 0.6 }), 0.8);
    geometries.push(wood, iron);
    materials.push(woodMaterial, ironMaterial);
    instanced(wood, woodMaterial, benches);
    instanced(iron, ironMaterial, benches);
  }
  if (bins.length) {
    const geometry = binGeometry();
    const material = withEnvironment(new THREE.MeshStandardMaterial({ color: '#2f5a3c', roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }), 0.6);
    geometries.push(geometry);
    materials.push(material);
    instanced(geometry, material, bins);
  }

  // --- Señales de tráfico en algunas esquinas, en la acera, mirando al tráfico que llega al cruce
  const signs = { stop: [], yield: [], walk: [] };
  const poles = [];
  const hash = (n) => {
    let t = (n * 2654435761) >>> 0;
    t ^= t >>> 15;
    t = Math.imul(t, 2246822519) >>> 0;
    return ((t ^ (t >>> 13)) >>> 0) / 4294967296;
  };
  city.blocks.forEach((block, bi) => {
    if (block.kind === 'depot') return;
    const x0 = block.ox * TILE;
    const z0 = block.oy * TILE;
    const x1 = (block.ox + block.w) * TILE;
    const z1 = (block.oy + block.h) * TILE;
    // Esquinas con su dirección hacia el interior de la manzana
    const cornerList = [[x0, z0, 1, 1], [x1, z0, -1, 1], [x1, z1, -1, -1], [x0, z1, 1, -1]];
    cornerList.forEach(([cx, cz, ix, iz], ci) => {
      const roll = hash(bi * 7 + ci * 131 + 17);
      if (roll > 0.42) return;
      const kind = roll < 0.16 ? 'stop' : roll < 0.28 ? 'yield' : 'walk';
      // En la acera de la calle vertical, a 18 px de la esquina, de cara a los coches que se acercan
      const x = cx - ix * 3.2;
      const z = cz + iz * 18;
      const rot = iz > 0 ? 0 : Math.PI;
      poles.push({ x, z });
      signs[kind].push({ x, z, rot, y: 0 });
    });
  });
  if (poles.length) {
    const POLE_H = 22;
    const poleGeometry = new THREE.CylinderGeometry(0.42, 0.42, POLE_H, 8).translate(0, POLE_H / 2, 0);
    const poleMaterial = withEnvironment(new THREE.MeshStandardMaterial({ color: '#9aa1ab', roughness: 0.4, metalness: 0.7 }), 0.8);
    geometries.push(poleGeometry);
    materials.push(poleMaterial);
    instanced(poleGeometry, poleMaterial, poles);
    // Placa: cara delantera con la señal y trasera gris, separadas del poste
    const plate = new THREE.PlaneGeometry(9, 9).translate(0, POLE_H - 4.2, 0.55);
    const back = new THREE.PlaneGeometry(9, 9).rotateY(Math.PI).translate(0, POLE_H - 4.2, 0.45);
    geometries.push(plate, back);
    for (const kind of Object.keys(signs)) {
      if (!signs[kind].length) continue;
      const texture = signTexture(kind);
      textures.push(texture);
      const front = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.5 });
      // La trasera usa la misma silueta (canal alfa de la textura) en gris metálico
      const rear = new THREE.MeshLambertMaterial({ color: '#7d848e', map: texture, alphaTest: 0.5 });
      rear.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
          '#include <map_fragment>\n  diffuseColor.rgb = vec3(0.49, 0.52, 0.56);');
      };
      rear.customProgramCacheKey = () => 'signBack';
      materials.push(front, rear);
      instanced(plate, front, signs[kind]);
      instanced(back, rear, signs[kind]);
    }
  }

  return {
    group,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) {
        releaseEnvironment(material);
        material.dispose();
      }
      for (const texture of textures) texture.dispose();
      for (const child of group.children) child.dispose?.();
    },
  };
}
