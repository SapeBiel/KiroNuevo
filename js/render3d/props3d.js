// Elementos de la ciudad que no son edificios: árboles de los parques, farolas y barreras de zonas bloqueadas.

import * as THREE from '../vendor/three.module.js';
import { TILE } from '../config/constants.js';
import { getGlowTexture, getHazardTexture } from './textures3d.js';

const TREE_COLORS = ['#3f9a54', '#4aa85f', '#5bb86b', '#388a4c', '#6cbf6e'];

/** Árboles de los parques (una sola malla instanciada para troncos y otra para copas). */
export function buildTrees(city) {
  const group = new THREE.Group();
  const trees = city.parks.flatMap((park) => park.trees);
  if (!trees.length) return { group, dispose() {} };

  const trunkGeometry = new THREE.CylinderGeometry(1.6, 2.2, 1, 6);
  trunkGeometry.translate(0, 0.5, 0);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  const trunks = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshLambertMaterial({ color: '#6b4a32' }), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }), trees.length);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  trees.forEach((tree, index) => {
    const trunkHeight = 8 + tree.r * 0.6;
    dummy.position.set(tree.x, 0, tree.y);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, trunkHeight, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(index, dummy.matrix);

    dummy.position.set(tree.x, trunkHeight + tree.r * 0.55, tree.y);
    dummy.rotation.set(0, index * 1.7, 0);
    dummy.scale.set(tree.r, tree.r * 0.95, tree.r);
    dummy.updateMatrix();
    crowns.setMatrixAt(index, dummy.matrix);
    color.set(TREE_COLORS[index % TREE_COLORS.length]);
    crowns.setColorAt(index, color);
  });
  for (const mesh of [trunks, crowns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  crowns.instanceColor.needsUpdate = true;

  return {
    group,
    dispose() {
      trunkGeometry.dispose();
      crownGeometry.dispose();
      trunks.material.dispose();
      crowns.material.dispose();
      trunks.dispose();
      crowns.dispose();
    },
  };
}

/** Farolas: postes, bombillas y halos. Devuelve también las posiciones para las luces reales. */
export function buildLamps(city) {
  const group = new THREE.Group();
  const lamps = city.lampPosts;
  const poleGeometry = new THREE.CylinderGeometry(1.1, 1.7, 1, 6);
  poleGeometry.translate(0, 0.5, 0);
  const poles = new THREE.InstancedMesh(poleGeometry, new THREE.MeshLambertMaterial({ color: '#4b5263' }), lamps.length);
  const headGeometry = new THREE.BoxGeometry(7, 2, 4);
  const heads = new THREE.InstancedMesh(headGeometry, new THREE.MeshLambertMaterial({ color: '#3b4252' }), lamps.length);
  const bulbGeometry = new THREE.SphereGeometry(2.2, 8, 6);
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
    const basin = new THREE.CylinderGeometry(r, r, 8, 24);
    const pool = new THREE.CylinderGeometry(r - 4, r - 4, 1, 24);
    const column = new THREE.CylinderGeometry(3, 4, 20, 10);
    const jet = new THREE.ConeGeometry(7, 16, 10, 1, true);
    geometries.push(basin, pool, column, jet);
    const add = (geometry, material, py) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, py, y);
      mesh.castShadow = material !== spray;
      mesh.receiveShadow = true;
      group.add(mesh);
    };
    add(basin, stone, 4);
    add(pool, water, 7.6);
    add(column, stone, 10);
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
