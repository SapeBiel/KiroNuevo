// Renderizador 3D (Three.js). Lee el mismo estado que el renderizador 2D y escucha los mismos eventos,
// así que la lógica del juego no cambia. Coordenadas: x del juego = x 3D, y del juego = z 3D, la altura es y.

import * as THREE from '../vendor/three.module.js';
import { DEPOT_RADIUS, DROP_RADIUS, METERS_PER_TILE, TILE } from '../config/constants.js';
import { ZONES, ZONE_ORDER } from '../config/zones.js';
import { ORDER_KINDS } from '../config/packages.js';
import { DRONE_TYPES } from '../config/drones.js';
import { getVehicleType } from '../config/vehicles.js';
import { clamp, distance, formatInt, normalizeAngle } from '../core/util.js';
import { clockHour, darknessAt, formatClock } from '../systems/dayCycle.js';
import { getOrder } from '../systems/orders.js';
import { getBrokenLamps, lampPose } from '../systems/streetLamps.js';
import { renderGroundMap } from '../render/mapLayer.js';
import { drawOutlinedText, roundRect } from '../render/sprites.js';
import { buildCity, buildOutskirts, segmentHitsBuilding, updateEntryFade } from './buildings3d.js';
import { buildBarriers, buildFountains, buildLamps, buildStreetFurniture, buildTrees } from './props3d.js';
import { createDroneModel, createVehicleModel, setVehicleBranding, setVehicleEnvironment } from './vehicles3d.js';
import { getCompany } from '../systems/branding.js';
import { cargoSlotsUsed, playerCapacity } from '../systems/orders.js';
import { getDrift, rearWheelPositions } from '../systems/playerVehicle.js';
import { Effects3D } from './effects3d.js';
import {
  OVERLAY_LAYER, PIN_ANCHOR_Y, PIN_ASPECT, createLabel, disposeSprite, getCloudTexture, getPinMaterial, getZoneTexture, makeCanvas,
  scaleSpriteToScreen, setDepotBranding, setLabelText, setMaxAnisotropy, toTexture,
} from './textures3d.js';
import { PostFX } from './postfx.js';
import { setBuildingEnvironment } from './buildings3d.js';
import { buildDepotInterior } from './depotInterior3d.js';
import { boxSizeFor, productInfo } from '../config/products.js';
import { createBoxModel, createProductModel } from './products3d.js';
import { EYE_HEIGHT, parkedVehicles, vehicleOnRoad } from '../systems/onFoot.js';
import { courierLoad } from '../systems/workers.js';
import { createCharacter } from './characters3d.js';
import { addDetailMap, groundGrainTexture, setSurfaceEnvironment } from './materials3d.js';
import { roundedBoxGeometry } from './geometries3d.js';
import { DOOR_RADIUS, heldBox, heldItems } from '../systems/handling.js';
import { deliveryDoorPoint } from '../world/lotLayout.js';
import { nearestLockedZone, signOpacity, signPosition } from '../world/zoneBorder.js';
import { isInsideDepot } from '../world/depotLayout.js';

/**
 * Niveles de calidad: alta = post-procesado con brillo, sombras finas y resolución completa;
 * media = post-procesado sin brillo y sombras normales; baja = sin post-procesado (equipos modestos).
 */
export const QUALITY = {
  alta: { post: true, bloom: true, shadow: 4096, soft: true, maxPixelRatio: 2, clouds: true },
  media: { post: true, bloom: false, shadow: 2048, soft: true, maxPixelRatio: 1.5, clouds: true },
  baja: { post: false, bloom: false, shadow: 1024, soft: false, maxPixelRatio: 1, clouds: false },
};

// Corrección de color por momento del día (día, atardecer, noche)
const GRADING = {
  // Algo menos saturado y con un poco más de contraste: aspecto de simulador, no de dibujo animado
  exposure: [0.97, 1.0, 1.28],
  saturation: [1.03, 1.1, 0.94],
  contrast: [1.09, 1.07, 1.1],
  tint: [[1.02, 1.0, 0.97], [1.08, 0.96, 0.86], [0.86, 0.94, 1.12]],
  vignette: [0.24, 0.3, 0.38],
  bloomStrength: [0.35, 0.7, 1.25],
  bloomThreshold: [1.05, 0.85, 0.55],
};
const CLOUD_DAY = new THREE.Color('#ffffff');
const CLOUD_DUSK = new THREE.Color('#ffc9a6');
const CLOUD_NIGHT = new THREE.Color('#3a4466');

// Paleta del cielo según la hora: día → atardecer/amanecer → noche.
const SKY_DAY = new THREE.Color('#8fd0f5');
const SKY_DUSK = new THREE.Color('#f0a068');
const SKY_NIGHT = new THREE.Color('#070c22');
const SUN_DAY = new THREE.Color('#fff2dc');
const SUN_DUSK = new THREE.Color('#ff9d5c');
const SUN_NIGHT = new THREE.Color('#7f9be0');
const HEMI_SKY_DAY = new THREE.Color('#d6ebff');
const HEMI_SKY_DUSK = new THREE.Color('#ffc9a0');
const HEMI_SKY_NIGHT = new THREE.Color('#2a3870');
const HEMI_GROUND_DAY = new THREE.Color('#8f8a78');
const HEMI_GROUND_DUSK = new THREE.Color('#6b5a50');
const HEMI_GROUND_NIGHT = new THREE.Color('#1a2038');
const OUTER_DAY = new THREE.Color('#86b877');
const OUTER_DUSK = new THREE.Color('#8a7a62');
const OUTER_NIGHT = new THREE.Color('#141c2c');

// Cúpula del cielo: color en lo alto y en el horizonte (la niebla usa el del horizonte)
const SKY_TOP_DAY = new THREE.Color('#3f86d6');
const SKY_TOP_DUSK = new THREE.Color('#2c3f7a');
const SKY_TOP_NIGHT = new THREE.Color('#02040f');

const CAMERA_MODES = ['chase', 'driver', 'aerial'];
const LAMP_LIGHTS = 6;
const MOON_DIRECTION = new THREE.Vector3(-0.35, 0.8, -0.3).normalize();

function rampColor(out, d, day, dusk, night) {
  if (d < 0.5) out.copy(day).lerp(dusk, d * 2);
  else out.copy(dusk).lerp(night, (d - 0.5) * 2);
  return out;
}

function rampNumber(d, day, dusk, night) {
  return d < 0.5 ? day + (dusk - day) * d * 2 : dusk + (night - dusk) * (d - 0.5) * 2;
}

export class Renderer3D {
  constructor({ canvas, game, cameraMode = 'chase', quality = 'alta', onContextLost = null }) {
    this.quality = QUALITY[quality] ? quality : 'alta';
    this.grading = {
      exposure: 1, saturation: 1, contrast: 1, tint: [1, 1, 1], vignette: 0.25, bloomStrength: 0.4, bloomThreshold: 1, time: 0,
    };
    this.canvas = canvas;
    this.game = game;
    this.onContextLost = onContextLost;
    this.cameraMode = cameraMode;
    this.zoomFactor = 1;
    this.aspectBoost = 1;
    this.time = 0;
    this.cssW = 800;
    this.cssH = 600;
    this.pixelRatio = 1;
    this.smokeTimer = 0;
    this.lampTimer = 0;
    this.labelTimer = 0;
    this.labelKey = '';
    this.lastDarkness = -1;
    this.cityVersion = -1;
    this.lost = false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());
    try {
      this.postfx = new PostFX(this.renderer);
    } catch (error) {
      console.warn('Post-procesado no disponible:', error);
      this.postfx = null;
    }

    this.scene = new THREE.Scene();
    this.scene.background = SKY_DAY.clone();
    this.scene.fog = new THREE.Fog(SKY_DAY.clone(), 520, 1900);
    this.camera = new THREE.PerspectiveCamera(52, 1.6, 2, 4200);
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camAngle = 0;
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.tmp = new THREE.Vector3();
    this.tmpEnd = new THREE.Vector3();
    this.tmpFocus = new THREE.Vector3();

    this.steerSmooth = 0;
    this.cockpitTimer = 0;
    this.envLevel = -1;
    // A pie la cámara va en los ojos del repartidor (primera persona), sea cual sea la cámara del vehículo
    this.footView = game.state.player.mode === 'foot';
    this.bobPhase = 0;

    // La imagen de la empresa tiene que estar lista antes de crear el almacén y los vehículos
    this.applyBranding(getCompany(game.state));
    this.createLights();
    this.createSky();
    this.createClouds();
    this.createEnvironmentMap();
    this.applyProjection();
    this.applyQuality();

    this.effects = new Effects3D();
    this.scene.add(this.effects.group);
    this.vehicleLayer = new THREE.Group();
    this.pinLayer = new THREE.Group();
    this.markerLayer = new THREE.Group();
    this.scene.add(this.vehicleLayer, this.pinLayer, this.markerLayer);
    this.vehicles = new Map();
    this.couriers = new Map(); // repartidores a pie: personaje y cajas en las manos
    this.drones = new Map();
    this.pins = new Map();
    this.markers = new Map();
    this.zoneLabels = [];
    this.world = null;

    this.createNavigationArrow();
    this.createViewModel();
    this.buildWorld();
    this.bindEvents();
    this.bindCanvas();
    this.resize();
    this.update(0);
    this.snapCamera();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
  }

  // ------------------------------------------------------------ Escena ----

  createLights() {
    this.hemi = new THREE.HemisphereLight('#d6ebff', '#8f8a78', 1.3);
    this.sun = new THREE.DirectionalLight('#fff2dc', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.left = -340; cam.right = 340; cam.top = 340; cam.bottom = -340; cam.near = 10; cam.far = 2200;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.5;
    this.sun.shadow.radius = 3; // bordes de sombra algo más suaves con PCF
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.headlight = new THREE.SpotLight('#fff3c8', 0, 380, 0.55, 0.6, 0);
    this.headlight.position.set(0, 12, 0);
    this.headlight.target.position.set(120, 0, 0);

    this.lampLights = [];
    for (let i = 0; i < LAMP_LIGHTS; i++) {
      const light = new THREE.PointLight('#ffc477', 0, 170, 0);
      light.position.set(0, -100, 0);
      this.lampLights.push(light);
      this.scene.add(light);
    }
  }

  createSky() {
    const count = 520;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      // Solo el hemisferio superior
      positions[i * 3] = Math.cos(a) * r * 3300;
      positions[i * 3 + 1] = Math.abs(u) * 3300 * 0.9 + 80;
      positions[i * 3 + 2] = Math.sin(a) * r * 3300;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.starMaterial = new THREE.PointsMaterial({
      color: '#ffffff', size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false,
    });
    this.stars = new THREE.Points(geometry, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.visible = false;
    this.scene.add(this.stars);
    this.createSkyDome();
  }

  /** Cúpula con degradado y resplandor del sol; sigue a la cámara. */
  createSkyDome() {
    this.skyUniforms = {
      topColor: { value: SKY_TOP_DAY.clone() },
      horizonColor: { value: SKY_DAY.clone() },
      sunColor: { value: SUN_DAY.clone() },
      sunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      sunStrength: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunColor;
        uniform vec3 sunDir;
        uniform float sunStrength;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 color = mix(horizonColor, topColor, pow(h, 0.55));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          color += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 14.0) * 0.32) * sunStrength;
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(3600, 32, 16), material);
    this.skyDome.renderOrder = -10;
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);
  }

  /** Nubes: sprites suaves y altos que se desplazan despacio con el viento. */
  createClouds() {
    const { city } = this.game;
    this.cloudMaterial = new THREE.SpriteMaterial({
      map: getCloudTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.85,
    });
    this.clouds = new THREE.Group();
    const span = 1800;
    for (let i = 0; i < 26; i++) {
      const sprite = new THREE.Sprite(this.cloudMaterial);
      const width = 420 + Math.random() * 520;
      sprite.scale.set(width, width * 0.42, 1);
      sprite.position.set(
        -span + Math.random() * (city.widthPx + span * 2),
        620 + Math.random() * 320,
        -span + Math.random() * (city.heightPx + span * 2),
      );
      sprite.renderOrder = -5;
      this.clouds.add(sprite);
    }
    this.cloudSpan = { minX: -span, maxX: city.widthPx + span };
    this.scene.add(this.clouds);
  }

  updateClouds(dt, darkness) {
    if (!this.clouds.visible) return;
    for (const cloud of this.clouds.children) {
      cloud.position.x += dt * (8 + (cloud.scale.x % 7));
      if (cloud.position.x > this.cloudSpan.maxX) cloud.position.x = this.cloudSpan.minX;
    }
    rampColor(this.cloudMaterial.color, darkness, CLOUD_DAY, CLOUD_DUSK, CLOUD_NIGHT);
    this.cloudMaterial.opacity = rampNumber(darkness, 0.85, 0.8, 0.35);
  }

  /** Aplica el nivel de calidad gráfica (sombras, resolución, post-procesado, nubes). */
  applyQuality() {
    const q = QUALITY[this.quality];
    this.renderer.shadowMap.type = q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.sun.shadow.mapSize.x !== q.shadow) {
      this.sun.shadow.mapSize.set(q.shadow, q.shadow);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (this.postfx) this.postfx.bloomEnabled = q.bloom;
    if (this.clouds) this.clouds.visible = q.clouds;
    // Cambiar el tipo de sombra obliga a recompilar los materiales
    this.scene.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) material.needsUpdate = true;
    });
  }

  setQuality(quality) {
    if (!QUALITY[quality] || quality === this.quality) return;
    this.quality = quality;
    this.applyQuality();
    this.resize();
  }

  /** Corrección de color según lo oscuro que esté (0 = día, 1 = noche). */
  updateGrading(darkness) {
    const g = this.grading;
    for (const key of ['exposure', 'saturation', 'contrast', 'vignette', 'bloomStrength', 'bloomThreshold']) {
      const [day, dusk, night] = GRADING[key];
      g[key] = rampNumber(darkness, day, dusk, night);
    }
    for (let i = 0; i < 3; i++) g.tint[i] = rampNumber(darkness, GRADING.tint[0][i], GRADING.tint[1][i], GRADING.tint[2][i]);
    g.time = this.time;
  }

  /** Cielo pre-calculado para los reflejos de carrocerías y cristales de los vehículos. */
  createEnvironmentMap() {
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      const geometry = new THREE.SphereGeometry(10, 32, 16);
      const material = new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: `
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            vec3 sky = mix(vec3(0.75, 0.86, 0.97), vec3(0.25, 0.48, 0.82), clamp(d.y * 1.6, 0.0, 1.0));
            vec3 ground = mix(vec3(0.36, 0.37, 0.39), vec3(0.2, 0.21, 0.23), clamp(-d.y * 2.0, 0.0, 1.0));
            vec3 color = d.y > 0.0 ? sky : ground;
            color += vec3(1.0, 0.95, 0.85) * pow(max(dot(d, normalize(vec3(0.5, 0.6, 0.3))), 0.0), 48.0) * 4.0;
            gl_FragColor = vec4(color, 1.0);
          }`,
      });
      envScene.add(new THREE.Mesh(geometry, material));
      this.envTarget = pmrem.fromScene(envScene, 0.02);
      pmrem.dispose();
      geometry.dispose();
      material.dispose();
      setVehicleEnvironment(this.envTarget.texture, 0.7);
      setBuildingEnvironment(this.envTarget.texture, 0.8);
      setSurfaceEnvironment(this.envTarget.texture, 0.55);
    } catch (error) {
      console.warn('Sin reflejos de entorno:', error);
      this.envTarget = null;
    }
  }

  createNavigationArrow() {
    const group = new THREE.Group();
    this.arrowMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 20, 8).rotateZ(-Math.PI / 2), this.arrowMaterial);
    shaft.position.x = -5;
    const head = new THREE.Mesh(new THREE.ConeGeometry(8, 17, 10).rotateZ(-Math.PI / 2), this.arrowMaterial);
    head.position.x = 13;
    group.add(shaft, head);
    group.visible = false;
    this.arrow = group;
    this.arrowLabel = createLabel('0 m', { size: 13 });
    this.arrowLabel.visible = false;
    this.scene.add(group, this.arrowLabel);
  }

  /** (Re)crea el suelo, los edificios, los árboles, las farolas, las barreras y los carteles de zona. */
  buildWorld() {
    const { city } = this.game;
    this.disposeWorld();
    this.world = new THREE.Group();
    this.scene.add(this.world);

    const maxTexture = this.renderer.capabilities.maxTextureSize;
    const scale = Math.min(1.5, maxTexture / Math.max(city.widthPx, city.heightPx));
    this.groundTexture = toTexture(renderGroundMap(city, scale));
    // Grano fino repetido cada 90 px encima del mapa del suelo (asfalto y aceras no se ven lisos de cerca)
    const groundMaterial = addDetailMap(new THREE.MeshLambertMaterial({ map: this.groundTexture }), groundGrainTexture(),
      [city.widthPx / 90, city.heightPx / 90], 0.4);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(city.widthPx, city.heightPx).rotateX(-Math.PI / 2), groundMaterial);
    ground.position.set(city.widthPx / 2, 0, city.heightPx / 2);
    ground.receiveShadow = true;
    this.world.add(ground);

    this.outerMaterial = new THREE.MeshLambertMaterial({ color: '#86b877' });
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), this.outerMaterial);
    outer.position.set(city.widthPx / 2, -1.5, city.heightPx / 2);
    outer.receiveShadow = true;
    this.world.add(outer);

    this.cityHandle = buildCity(city);
    this.trees = buildTrees(city);
    this.lamps = buildLamps(city);
    this.barriers = buildBarriers(city);
    this.fountains = buildFountains(city);
    this.furniture = buildStreetFurniture(city);
    // Las afueras no cambian al desbloquear zonas: se crean una sola vez
    if (!this.outskirts) {
      this.outskirts = buildOutskirts(city);
      this.scene.add(this.outskirts.group);
    }
    this.depotInterior = buildDepotInterior(city.depot);
    this.world.add(this.cityHandle.group, this.trees.group, this.lamps.group, this.barriers.group, this.fountains.group, this.furniture.group,
      this.depotInterior.group);
    this.worldParts = { ground, outer };

    this.cityVersion = city.version;
    this.lastDarkness = -1;
    this.buildZoneLabels();
  }

  disposeWorld() {
    if (!this.world) return;
    this.scene.remove(this.world);
    this.cityHandle?.dispose();
    this.trees?.dispose();
    this.lamps?.dispose();
    this.barriers?.dispose();
    this.fountains?.dispose();
    this.furniture?.dispose();
    this.depotInterior?.dispose();
    this.groundTexture?.dispose();
    this.worldParts.ground.geometry.dispose();
    this.worldParts.ground.material.dispose();
    this.worldParts.outer.geometry.dispose();
    this.outerMaterial.dispose();
    for (const sprite of this.zoneLabels) { this.scene.remove(sprite); disposeSprite(sprite); }
    this.zoneLabels = [];
    this.world = null;
  }

  /** Carteles flotantes sobre las zonas aún bloqueadas. */
  buildZoneLabels() {
    for (const sprite of this.zoneLabels) { this.scene.remove(sprite); disposeSprite(sprite); }
    this.zoneLabels = [];
    const { state, city } = this.game;
    for (const id of ZONE_ORDER) {
      if (state.zones[id]) continue;
      const zone = ZONES[id];
      const bounds = city.zoneBounds(id);
      const canvas = makeCanvas(360, 124);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'rgba(15,22,41,0.9)';
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 3;
      roundRect(ctx, 3, 3, 354, 118, 18);
      ctx.fill();
      ctx.stroke();
      drawOutlinedText(ctx, `🔒 ${zone.name}`, 180, 33, { size: 24, color: '#ffffff' });
      drawOutlinedText(ctx, `Nivel ${zone.unlockLevel} · ${formatInt(zone.unlockCost)} €`, 180, 66, { size: 19, color: '#ffd166' });
      drawOutlinedText(ctx, state.level >= zone.unlockLevel ? 'Desbloquéala en el ordenador (Empresa)' : 'Sigue creciendo para abrirla', 180, 97, { size: 13, color: '#b9c3da', weight: '600' });
      const material = new THREE.SpriteMaterial({ map: toTexture(canvas), transparent: true, depthTest: false, depthWrite: false, fog: false });
      const sprite = new THREE.Sprite(material);
      sprite.renderOrder = 18;
      sprite.layers.set(OVERLAY_LAYER);
      sprite.position.set(bounds.centerX, 120, bounds.centerY);
      sprite.userData.aspect = 360 / 124;
      sprite.userData.zoneId = id;
      sprite.visible = false; // solo se enseña al acercarse mucho a su borde (updateZoneLabels)
      this.scene.add(sprite);
      this.zoneLabels.push(sprite);
    }
    this.labelKey = this.zoneLabelKey();
  }

  zoneLabelKey() {
    const { state } = this.game;
    return `${state.level}|${ZONE_ORDER.map((id) => (state.zones[id] ? 1 : 0)).join('')}`;
  }

  // ----------------------------------------------------------- Eventos ----

  bindEvents() {
    const { events, state, city } = this.game;
    const fx = this.effects;
    this.unsubscribe = [
      events.on('orderDelivered', ({ building, reward, xp, by }) => {
        const manual = by.type === 'player';
        // A pie se entrega en la puerta; empleados y drones, en la calle
        const at = by.at ?? { x: building.dropX, y: building.dropY };
        fx.addConfetti(at.x, at.y, manual ? 40 : 14, manual ? 1 : 0.6);
        fx.addRing(at.x, at.y, '#7CFC9A', manual ? 60 : 90);
        fx.addText(at.x, at.y, `+${formatInt(reward)} €`, { size: manual ? 26 : 18, y: manual ? 22 : 46 });
        if (manual && xp) fx.addText(at.x, at.y, `+${xp} XP`, { color: '#8ad7ff', size: 15, life: 1.3, rise: 30, y: 14 });
      }),
      events.on('orderLoaded', ({ from }) => {
        // La caja vuela desde las manos del repartidor hasta el vehículo
        const depot = city.depot;
        const start = from ?? { x: depot.doorX + (Math.random() - 0.5) * 30, y: depot.doorY - 6 };
        fx.addBox(start.x, start.y, () => ({ x: state.player.x, z: state.player.y }), 0);
      }),
      events.on('crash', ({ impact, x, y }) => {
        fx.addSparks(x, y, Math.min(16, 4 + impact / 12));
        fx.addShake(Math.min(6, impact / 30));
      }),
      // Farola derribada: chispas y cristales de la bombilla, y un pequeño temblor
      events.on('lampHit', ({ x, y, speed }) => {
        fx.addSparks(x, y, Math.min(14, 6 + speed / 25));
        fx.addShake(Math.min(3, 0.8 + speed / 120));
      }),
      events.on('zoneUnlocked', () => fx.addRing(state.player.x, state.player.y, '#ffd166', 260)),
      // Nueva imagen de empresa: se repinta el almacén y se vuelven a crear los vehículos con la rotulación nueva
      events.on('companyChanged', ({ company }) => this.applyBranding(company, true)),
      events.on('levelUp', () => {
        fx.addConfetti(state.player.x, state.player.y, 60, 1.3);
        fx.addRing(state.player.x, state.player.y, '#ffd166', 200);
      }),
      events.on('upgradePurchased', () => fx.addRing(state.player.x, state.player.y, '#4cc9f0', 90)),
      events.on('driftBoost', ({ level }) => {
        fx.addRing(state.player.x, state.player.y, '#fb8500', 70 + level * 25);
        fx.addText(state.player.x, state.player.y, level >= 3 ? '¡SÚPER TURBO!' : 'TURBO', { color: '#ffd166', size: 16 + level * 2, life: 1, y: 40 });
        fx.addShake(1.5);
      }),
    ];
  }

  bindCanvas() {
    this.onWheel = (event) => {
      event.preventDefault();
      if (this.cameraMode === 'driver' || this.footView) return;
      this.zoomFactor = clamp(this.zoomFactor * (event.deltaY > 0 ? 1.08 : 0.92), 0.6, 1.9);
    };
    this.onLost = (event) => {
      event.preventDefault();
      this.lost = true;
      this.onContextLost?.();
    };
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('webglcontextlost', this.onLost);
  }

  // ------------------------------------------------------------ Tamaño ----

  resize() {
    const parent = this.canvas.parentElement;
    this.cssW = Math.max(200, parent.clientWidth);
    this.cssH = Math.max(200, parent.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, QUALITY[this.quality].maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.postfx?.setSize(this.cssW * this.pixelRatio, this.cssH * this.pixelRatio);
    const aspect = this.cssW / this.cssH;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.aspectBoost = aspect < 1.2 ? clamp(Math.pow(1.2 / aspect, 0.7), 1, 1.8) : 1;
  }

  // ------------------------------------------------------------ Cámara ----

  /** Exterior → conductor → aérea → exterior. */
  toggleCameraMode() {
    const index = CAMERA_MODES.indexOf(this.cameraMode);
    this.setCameraMode(CAMERA_MODES[(index + 1) % CAMERA_MODES.length]);
    if (this.cameraMode === 'driver') this.snapCamera();
    return this.cameraMode;
  }

  setCameraMode(mode) {
    this.cameraMode = CAMERA_MODES.includes(mode) ? mode : 'chase';
    this.applyProjection();
  }

  /** En la cabina hace falta más ángulo de visión y un plano cercano más próximo (el volante está a pocos cm). */
  applyProjection() {
    this.camera.fov = this.baseFov();
    this.camera.near = this.footView ? 0.3 : this.cameraMode === 'driver' ? 0.5 : 2;
    this.camera.updateProjectionMatrix();
  }

  baseFov() {
    if (this.footView) return 72;
    return this.cameraMode === 'driver' ? 70 : 52;
  }

  /** Primera persona a pie: ojos del repartidor con un leve balanceo al andar, mirando según el ratón. */
  updateFootCamera(dt) {
    const f = this.game.state.player.foot;
    const moving = clamp((f.moving ?? 0) / 60, 0, 1);
    this.bobPhase += dt * 10 * moving;
    const airborne = (f.z ?? 0) > 0.05;
    const bob = airborne ? 0 : Math.sin(this.bobPhase) * 0.35 * moving;
    // Al aterrizar de un salto la cámara baja un poco y se recupera (el impacto lo deja onFoot en f.landed)
    if (f.landed > 0) {
      this.landDip = Math.min(2.2, f.landed / 40);
      f.landed = 0;
    }
    this.landDip = (this.landDip ?? 0) * Math.exp(-9 * dt);
    const eye = EYE_HEIGHT + (f.z ?? 0) + bob - this.landDip;
    const cp = Math.cos(f.pitch);
    this.camPos.set(f.x, eye, f.y);
    this.camLook.set(
      f.x + Math.cos(f.yaw) * cp * 20,
      eye + Math.sin(f.pitch) * 20,
      f.y + Math.sin(f.yaw) * cp * 20,
    );
    this.applyCamera(this.effects.shake * 0.15);
  }

  /** Lo que se lleva en las manos, pegado a la cámara (solo a pie). */
  createViewModel() {
    // Los modelos se colocan a tamaño real y el grupo se encoge hacia la cámara: se ven igual de grandes,
    // pero quedan a menos de 1 px de los ojos y nunca se meten dentro de una mesa o una pared (el
    // repartidor mide 4,5 px de radio), sin perder la profundidad entre sus propias piezas.
    const group = new THREE.Group();
    group.scale.setScalar(0.12);
    group.visible = false;
    this.viewModel = { group, key: '', models: [] };
    this.camera.add(group);
    this.scene.add(this.camera); // la cámara debe estar en la escena para que se dibujen sus hijos
    // Piezas compartidas de las manos con guantes (se reutilizan cada vez que cambia lo que se lleva)
    const finger = new THREE.CapsuleGeometry(0.24, 1.1, 3, 8).rotateX(Math.PI / 2);
    this.handKit = {
      palm: roundedBoxGeometry(0.3, 2),
      finger,
      arm: new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0),
      glove: new THREE.MeshStandardMaterial({ color: '#3a3f47', roughness: 0.85 }),
      cuff: new THREE.MeshStandardMaterial({ color: '#2b3038', roughness: 0.9 }),
      sleeve: new THREE.MeshStandardMaterial({ color: '#2f4a7a', roughness: 0.9, side: THREE.DoubleSide }),
    };
  }

  /**
   * Mano con guante y antebrazo que sujeta lo que se lleva. Marco de la mano: +x hacia el objeto, y arriba,
   * -z hacia delante; el origen va pegado a la superficie del objeto. side = +1 derecha, -1 izquierda;
   * "under": la palma va debajo del objeto (productos sueltos) en vez de en su costado (cajas).
   */
  createHand(side, under) {
    const kit = this.handKit;
    const hand = new THREE.Group();
    const add = (geometry, material, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      hand.add(mesh);
      return mesh;
    };
    add(kit.palm, kit.glove, -0.4, 0, -0.1, 0.8, 2.2, 2.4); // palma
    for (let i = 0; i < 4; i++) {
      // Dedos estirados hacia delante sobre el objeto, el índice algo más largo
      const f = add(kit.finger, kit.glove, -0.22, -0.78 + i * 0.52, -1.95 - (i === 2 ? 0.12 : 0));
      f.rotation.y = 0.06;
    }
    const thumb = add(kit.finger, kit.glove, -0.3, 1.25, -0.9, 1.1, 1.1, 0.85);
    thumb.rotation.set(-0.5, 0.15, 0);
    // Antebrazo: puño del guante y manga hacia la cámara (sale por la parte de abajo de la pantalla)
    const wrist = new THREE.Vector3(-0.45, 0, 1.0);
    const dir = new THREE.Vector3(under ? -3.3 : -1.8, under ? 1.8 : -3.3, 6.3);
    const length = dir.length();
    dir.normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const cuff = add(kit.arm, kit.cuff, wrist.x, wrist.y, wrist.z, 0.82, 1.4, 0.82);
    cuff.quaternion.setFromUnitVectors(up, dir);
    const sleeveStart = wrist.clone().addScaledVector(dir, 1.3);
    const sleeve = add(kit.arm, kit.sleeve, sleeveStart.x, sleeveStart.y, sleeveStart.z, 1.05, length, 1.05);
    sleeve.quaternion.setFromUnitVectors(up, dir);
    // Espejo para la mano derecha (+x del marco apunta hacia el centro) y giro para sujetar por debajo
    hand.scale.x = -side;
    if (under) hand.rotation.z = -side * Math.PI / 2;
    hand.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    return hand;
  }

  /** Muestra en las manos el producto real (libro, botella, bicicleta…) o la caja del tamaño del pedido. */
  updateViewModel() {
    const vm = this.viewModel;
    vm.group.visible = this.footView;
    if (!this.footView) return;
    const box = heldBox(this.game);
    const held = box ? [] : heldItems(this.game);
    const key = box ? `box:${box.id}` : held.map(({ item }) => item.name).join('|');
    if (key !== vm.key) {
      vm.key = key;
      for (const m of vm.models) {
        vm.group.remove(m);
        m.userData.dispose?.();
      }
      vm.models = [];
      if (box) {
        const [w, h, s] = boxSizeFor(box);
        const m = createBoxModel(box);
        m.position.set(0, -2.6 - h * 0.6, -(5.6 + s / 2));
        m.rotation.set(0.16, 0, 0);
        // Las dos manos agarran la caja por los costados (pegadas al cartón, sin atravesarlo)
        for (const side of [1, -1]) {
          const hand = this.createHand(side, false);
          hand.position.set(side * (w / 2 + 0.03), h * 0.42, s * 0.12);
          m.add(hand);
        }
        vm.models.push(m);
      } else {
        const dims = held.map(({ item }) => {
          const [w, h, d] = productInfo(item.name).size;
          const turned = d > w; // el lado largo, de lado a lado
          return { name: item.name, across: turned ? d : w, depth: turned ? w : d, h, yaw: turned ? Math.PI / 2 : 0 };
        });
        const total = dims.reduce((sum, d) => sum + d.across, 0) + Math.max(0, dims.length - 1) * 0.6;
        let cursor = -total / 2 + (dims.length === 1 ? 1.4 : 0);
        const placedItems = [];
        for (const d of dims) {
          const m = createProductModel(d.name);
          m.position.set(cursor + d.across / 2, -3.2 - d.h * 0.4, -(5.4 + d.depth / 2));
          m.rotation.set(0.24, d.yaw, 0);
          vm.models.push(m);
          placedItems.push({ left: cursor, right: cursor + d.across, y: m.position.y, z: m.position.z, depth: d.depth });
          cursor += d.across + 0.6;
        }
        // Manos por debajo de los extremos (una sola, centrada, si lo que se lleva es muy pequeño)
        if (placedItems.length) {
          const first = placedItems[0];
          const last = placedItems[placedItems.length - 1];
          const grips = last.right - first.left < 3.4
            ? [[1, (first.left + last.right) / 2, first]]
            : [[-1, first.left + 1.0, first], [1, last.right - 1.0, last]];
          for (const [side, x, item] of grips) {
            const hand = this.createHand(side, true);
            hand.position.set(x, item.y - 0.02, item.z + item.depth * 0.1);
            hand.rotation.x = 0.24;
            vm.models.push(hand);
          }
        }
      }
      for (const m of vm.models) {
        m.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
        vm.group.add(m);
      }
    }
    // Leve vaivén al andar
    const f = this.game.state.player.foot;
    const moving = clamp((f.moving ?? 0) / 60, 0, 1);
    vm.group.position.set(Math.sin(this.bobPhase * 0.5) * 0.02 * moving, Math.abs(Math.cos(this.bobPhase * 0.5)) * 0.015 * moving, 0);
  }

  /** Coloca la cámara en los ojos del conductor, mirando un poco hacia la curva. */
  updateDriverCamera(shake) {
    const entry = this.vehicles.get('player');
    if (!entry) return;
    const { model } = entry;
    model.group.updateMatrixWorld(true);
    const p = this.game.state.player;
    const bob = Math.sin(this.time * 11) * 0.06 * Math.min(1, Math.abs(p.speed) / 120);
    const yaw = this.steerSmooth * 0.14 * (p.speed < -5 ? -1 : 1);
    const eye = this.tmp.copy(model.eye);
    eye.y += bob;
    model.group.localToWorld(eye);
    this.camPos.copy(eye);
    const look = this.tmpEnd.set(model.eye.x + Math.cos(yaw) * 80, model.eye.y - 9, model.eye.z + Math.sin(yaw) * 80);
    model.group.localToWorld(look);
    this.camLook.copy(look);
    this.applyCamera(shake * 0.2);
  }

  /** Posición ideal de la cámara y punto al que mira. */
  cameraGoal() {
    const p = this.game.state.player;
    const speed = Math.abs(p.speed);
    const zoom = this.zoomFactor * this.aspectBoost;
    if (this.cameraMode === 'aerial') {
      const lookX = Math.cos(p.angle) * p.speed * 0.25;
      const lookZ = Math.sin(p.angle) * p.speed * 0.25;
      return {
        pos: new THREE.Vector3(p.x + lookX, 340 * zoom, p.y + lookZ + 230 * zoom),
        look: new THREE.Vector3(p.x + lookX, 0, p.y + lookZ),
      };
    }
    const dist = (150 + speed * 0.3) * zoom;
    const height = (104 + speed * 0.12) * zoom;
    const fx = Math.cos(this.camAngle);
    const fz = Math.sin(this.camAngle);
    const { widthPx, heightPx } = this.game.city;
    return {
      // Se mantiene dentro del mapa para no meterse en los edificios de las afueras
      pos: new THREE.Vector3(clamp(p.x - fx * dist, 10, widthPx - 10), height, clamp(p.y - fz * dist, 10, heightPx - 10)),
      look: new THREE.Vector3(p.x + fx * 60, 10, p.y + fz * 60),
    };
  }

  snapCamera() {
    this.camAngle = this.game.state.player.angle;
    if (this.footView) {
      this.updateFootCamera(0);
      return;
    }
    if (this.cameraMode === 'driver') {
      this.updateDriverCamera(0);
      return;
    }
    const goal = this.cameraGoal();
    this.camPos.copy(goal.pos);
    this.camLook.copy(goal.look);
    this.applyCamera(0);
  }

  updateCamera(dt) {
    const p = this.game.state.player;
    this.camAngle += normalizeAngle(p.angle - this.camAngle) * (1 - Math.exp(-3.4 * dt));
    if (this.footView) {
      this.updateFootCamera(dt);
      return;
    }
    if (this.cameraMode === 'driver') {
      this.updateDriverCamera(this.effects.shake);
      return;
    }
    const goal = this.cameraGoal();
    this.camPos.lerp(goal.pos, 1 - Math.exp(-5.5 * dt));
    this.camLook.lerp(goal.look, 1 - Math.exp(-8 * dt));
    this.applyCamera(this.effects.shake);
  }

  applyCamera(shake) {
    const jitter = shake * 0.9;
    this.camera.position.set(
      this.camPos.x + (Math.random() - 0.5) * jitter,
      this.camPos.y + (Math.random() - 0.5) * jitter,
      this.camPos.z + (Math.random() - 0.5) * jitter,
    );
    this.camera.lookAt(this.camLook);
  }

  /** Traduce un punto de la pantalla (px CSS del canvas) a coordenadas del mapa, o null si apunta al cielo. */
  screenToWorld(px, py) {
    this.camera.updateMatrixWorld();
    const ndc = new THREE.Vector2((px / this.cssW) * 2 - 1, -(py / this.cssH) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.tmp);
    if (!hit || hit.distanceTo(this.camera.position) > 2400) return null;
    return { x: hit.x, y: hit.z };
  }

  /** Rectángulo del mapa que se marca en el minimapa. */
  minimapView() {
    const w = 620 * this.zoomFactor;
    const h = 400 * this.zoomFactor;
    return { x: this.camLook.x - w / 2, y: this.camLook.z - h / 2, viewW: w, viewH: h };
  }

  /** Se llama al volver a este modo: limpia efectos viejos y recoloca la cámara. */
  activate() {
    this.resize();
    this.effects.clear();
    this.snapCamera();
  }

  // -------------------------------------------------------- Simulación ----

  update(dt) {
    this.time += dt;
    const { state, city } = this.game;
    if (city.version !== this.cityVersion) this.buildWorld();
    // Al bajar o subir del vehículo cambia la cámara (primera persona ↔ la elegida para conducir)
    const foot = state.player.mode === 'foot';
    if (foot !== this.footView) {
      this.footView = foot;
      this.applyProjection();
      this.snapCamera();
    }

    const hour = clockHour(state);
    const darkness = darknessAt(hour);
    this.updateEnvironment(hour, darkness);
    this.updateClouds(dt, darkness);
    // Los vehículos se colocan antes que la cámara: la vista del conductor depende de su posición
    this.syncVehicles(dt, darkness);
    this.syncCouriers(dt);
    this.syncDrones(dt, darkness);
    this.updateCamera(dt);
    this.updateViewModel();
    this.depotInterior.update(this.game, dt, this.camera, this.cssH);
    this.updateCockpit(dt);
    this.syncMarkers();
    this.syncPins();
    this.updateNavigationArrow();
    this.updateZoneLabels(dt);
    this.lamps.update(getBrokenLamps(this.game), lampPose);
    this.updateLampLights(dt, darkness);
    this.updateFades(dt);
    this.effects.update(dt, this.camera, this.cssH, this.pixelRatio);
    this.updateExhaust(dt);
    this.updateDriftFx(dt);
  }

  updateEnvironment(hour, darkness) {
    const { scene } = this;
    const sky = rampColor(scene.background, darkness, SKY_DAY, SKY_DUSK, SKY_NIGHT);
    scene.fog.color.copy(sky);
    scene.fog.near = rampNumber(darkness, 520, 430, 280);
    scene.fog.far = rampNumber(darkness, 1900, 1500, 1050);

    rampColor(this.sun.color, darkness, SUN_DAY, SUN_DUSK, SUN_NIGHT);
    this.sun.intensity = rampNumber(darkness, 2.7, 1.7, 0.6);
    rampColor(this.hemi.color, darkness, HEMI_SKY_DAY, HEMI_SKY_DUSK, HEMI_SKY_NIGHT);
    rampColor(this.hemi.groundColor, darkness, HEMI_GROUND_DAY, HEMI_GROUND_DUSK, HEMI_GROUND_NIGHT);
    this.hemi.intensity = rampNumber(darkness, 1.35, 1.0, 0.7);
    rampColor(this.outerMaterial.color, darkness, OUTER_DAY, OUTER_DUSK, OUTER_NIGHT);

    // El sol cruza el cielo entre las 06:00 y las 20:00; de noche la luz viene de la luna.
    const t = clamp((hour - 6) / 14, 0, 1);
    const angle = t * Math.PI;
    const direction = new THREE.Vector3(Math.cos(angle) * 0.85, Math.sin(angle) * 0.9 + 0.3, 0.45).normalize();
    direction.lerp(MOON_DIRECTION, darkness * darkness * (3 - 2 * darkness)).normalize();
    const subject = this.game.getFocus();
    // Zona de sombras más ajustada cuanto más cerca está la cámara (más nitidez a pie y en cabina)
    const span = this.footView ? 170 : this.cameraMode === 'driver' ? 240 : this.cameraMode === 'aerial' ? 420 : 340;
    const cam = this.sun.shadow.camera;
    if (cam.right !== span) {
      cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
      cam.updateProjectionMatrix();
    }
    // El centro se ajusta a la rejilla de texels del mapa de sombras: así no "tiemblan" al moverse
    const texel = (span * 2) / this.sun.shadow.mapSize.x;
    const focus = this.tmpFocus.set(Math.round(subject.x / texel) * texel, 0, Math.round(subject.y / texel) * texel);
    this.sun.position.copy(focus).addScaledVector(direction, 1000);
    this.sun.target.position.copy(focus);
    this.sun.target.updateMatrixWorld();

    this.starMaterial.opacity = clamp((darkness - 0.55) * 2.4, 0, 1);
    this.stars.visible = this.starMaterial.opacity > 0.01;
    this.stars.position.copy(this.camera.position);

    // Cúpula: el horizonte coincide con la niebla para que el suelo lejano se funda con el cielo
    const u = this.skyUniforms;
    rampColor(u.topColor.value, darkness, SKY_TOP_DAY, SKY_TOP_DUSK, SKY_TOP_NIGHT);
    u.horizonColor.value.copy(sky);
    u.sunColor.value.copy(this.sun.color);
    u.sunDir.value.copy(direction);
    u.sunStrength.value = rampNumber(darkness, 1, 0.9, 0.22);
    this.skyDome.position.copy(this.camera.position);
    this.updateGrading(darkness);

    if (Math.abs(darkness - this.lastDarkness) > 0.004) {
      this.lastDarkness = darkness;
      this.cityHandle.setNight(darkness);
      this.lamps.setNight(darkness);
      if (this.envTarget) {
        setVehicleEnvironment(this.envTarget.texture, rampNumber(darkness, 0.7, 0.45, 0.07));
        setBuildingEnvironment(this.envTarget.texture, rampNumber(darkness, 0.8, 0.5, 0.06));
        setSurfaceEnvironment(this.envTarget.texture, rampNumber(darkness, 0.55, 0.36, 0.08));
      }
    }
  }

  vehicleEntry(key, type, withLabel = false) {
    let entry = this.vehicles.get(key);
    if (entry && entry.typeId !== type.id) {
      this.removeVehicle(key, entry);
      entry = null;
    }
    if (!entry) {
      const model = createVehicleModel(type);
      this.vehicleLayer.add(model.group);
      entry = { key, typeId: type.id, model, type, hasLast: false, lastX: 0, lastZ: 0, label: null };
      if (withLabel) {
        entry.label = createLabel('', { size: 11, color: '#c9f7e4' });
        entry.label.position.set(0, 50, 0);
        model.group.add(entry.label);
      }
      this.vehicles.set(key, entry);
    }
    return entry;
  }

  /** Aplica el nombre, logotipo y colores de la empresa al almacén y a la flota. */
  applyBranding(company, rebuild = false) {
    setDepotBranding(company);
    const changed = setVehicleBranding(company);
    if (!rebuild || !changed) return;
    for (const [key, entry] of [...this.vehicles]) this.removeVehicle(key, entry);
  }

  removeVehicle(key, entry) {
    if (this.headlight.parent === entry.model.group) {
      entry.model.group.remove(this.headlight, this.headlight.target);
    }
    if (entry.label) disposeSprite(entry.label);
    this.vehicleLayer.remove(entry.model.group);
    entry.model.dispose();
    this.vehicles.delete(key);
  }

  placeVehicle(entry, x, y, angle, dt = 0) {
    const group = entry.model.group;
    if (entry.hasLast) {
      const dx = x - entry.lastX;
      const dz = y - entry.lastZ;
      const travelled = Math.hypot(dx, dz);
      if (travelled < 60) entry.model.spin(Math.sign(dx * Math.cos(angle) + dz * Math.sin(angle)) * travelled);
      // Dirección estimada a partir de cuánto ha girado (para los vehículos que conducen los empleados)
      if (dt > 0 && entry.key !== 'player') {
        const turn = clamp(normalizeAngle(angle - entry.lastAngle) / dt / 2.2, -1, 1);
        entry.steer = (entry.steer ?? 0) + (turn - (entry.steer ?? 0)) * (1 - Math.exp(-6 * dt));
        entry.model.setSteer(entry.steer);
      }
    }
    entry.hasLast = true;
    entry.lastX = x;
    entry.lastZ = y;
    entry.lastAngle = angle;
    group.position.set(x, 0, y);
    group.rotation.y = -angle;
    group.visible = true;
  }

  syncVehicles(dt, darkness) {
    const { state, runtime, controls } = this.game;
    const lightsOn = darkness > 0.4;
    for (const entry of this.vehicles.values()) entry.model.group.visible = false;

    // Vehículo del jugador (lleva el foco de los faros)
    const p = state.player;
    const playerVehicle = state.vehicles.find((v) => v.id === p.vehicleId);
    const playerType = getVehicleType(playerVehicle.typeId);
    const playerEntry = this.vehicleEntry('player', playerType);
    this.placeVehicle(playerEntry, p.x, p.y, p.angle);
    const braking = (controls.throttle < 0 && p.speed > 5) || (controls.throttle > 0 && p.speed < -5);
    playerEntry.model.setBraking(braking);
    playerEntry.model.setLights(lightsOn);
    this.steerSmooth += (clamp(controls.steer, -1, 1) - this.steerSmooth) * (1 - Math.exp(-8 * dt));
    playerEntry.model.setSteer(this.steerSmooth);
    playerEntry.model.setInteriorView(this.cameraMode === 'driver' && !this.footView);
    if (this.headlight.parent !== playerEntry.model.group) {
      playerEntry.model.group.add(this.headlight, this.headlight.target);
    }
    this.headlight.position.set(playerType.length / 2, 12, 0);
    this.headlight.target.position.set(playerType.length / 2 + 140, 0, 0);
    this.headlight.intensity = darkness * 3.2;

    // Aparcados en el patio del almacén (mismos sitios en los que se puede subir a ellos a pie)
    for (const spot of parkedVehicles(this.game)) {
      const entry = this.vehicleEntry(`parked:${spot.vehicle.id}`, getVehicleType(spot.vehicle.typeId));
      this.placeVehicle(entry, spot.x, spot.y, spot.angle);
      entry.model.setBraking(false);
      entry.model.setLights(lightsOn);
    }

    // Empleados en ruta
    for (const worker of state.workers) {
      const rt = runtime.workers[worker.id];
      const vehicle = state.vehicles.find((v) => v.id === worker.vehicleId);
      if (!rt || !vehicle || !vehicleOnRoad(rt)) continue;
      const entry = this.vehicleEntry(`worker:${worker.id}`, getVehicleType(vehicle.typeId), true);
      this.placeVehicle(entry, rt.x, rt.y, rt.angle, dt);
      entry.model.setBraking(!['driving', 'departing', 'arriving'].includes(rt.phase));
      entry.model.setLights(lightsOn);
      setLabelText(entry.label, worker.name, { size: 11, color: '#c9f7e4' });
      entry.label.visible = !rt.walker; // si ha bajado a entregar, el nombre lo lleva la persona
      if (entry.label.visible) scaleSpriteToScreen(entry.label, this.camera, this.cssH, entry.label.userData.label.pxHeight);
    }
  }

  /**
   * Repartidores a pie: bajan de su furgoneta, van a expedición, vuelven con las cajas en brazos, las meten por
   * la trasera y suben; en cada destino llevan la caja hasta la puerta. Dentro de la furgoneta no se dibujan.
   */
  syncCouriers(dt) {
    const { state, runtime } = this.game;
    const company = getCompany(state);
    const focus = this.game.getFocus();
    const seen = new Set();
    for (const worker of state.workers) {
      const rt = runtime.workers[worker.id];
      const w = rt?.walker;
      if (!w) continue;
      seen.add(worker.id);
      let entry = this.couriers.get(worker.id);
      if (!entry) {
        const character = createCharacter({ id: worker.id, name: worker.name, vest: '#3a86ff', cap: company.primary });
        this.vehicleLayer.add(character.group);
        entry = { character, boxKey: '', boxes: [] };
        this.couriers.set(worker.id, entry);
      }
      const { character } = entry;
      character.group.visible = true;
      // El suelo de la nave está un poco más alto que el del patio y la calle
      character.group.position.set(w.x, isInsideDepot(this.game.city.depot, w.x, w.y) ? 0.6 : 0.1, w.y);
      character.group.rotation.y = -w.yaw;
      const load = courierLoad(this.game, worker);
      character.update(w.anim, w.animTime, { carrying: load.length > 0, speed: w.moving, dt });
      // Cajas apiladas delante del pecho (se rehacen solo si cambia lo que lleva)
      const key = load.map((o) => o.id).join('|');
      if (key !== entry.boxKey) {
        entry.boxKey = key;
        for (const m of entry.boxes) { character.anchor.remove(m); m.userData.dispose?.(); }
        entry.boxes = [];
        let y = 0;
        for (const order of load.slice(0, 4)) {
          const [, h, s] = boxSizeFor(order);
          const m = createBoxModel(order);
          m.position.set(s / 2 - 0.6, -h * 0.4 + y, 0);
          m.rotation.y = Math.PI / 2;
          character.anchor.add(m);
          entry.boxes.push(m);
          y += h;
        }
      }
      setLabelText(character.label, worker.name, { size: 11, color: '#c9f7e4' });
      character.label.visible = distance(focus.x, focus.y, w.x, w.y) < 160;
      if (character.label.visible) scaleSpriteToScreen(character.label, this.camera, this.cssH, character.label.userData.label.pxHeight);
    }
    for (const [id, entry] of this.couriers) {
      if (seen.has(id)) continue;
      this.removeCourier(id, entry);
    }
  }

  removeCourier(id, entry) {
    for (const m of entry.boxes) m.userData.dispose?.();
    this.vehicleLayer.remove(entry.character.group);
    entry.character.dispose();
    this.couriers.delete(id);
  }

  syncDrones(dt, darkness) {
    const { state, runtime } = this.game;
    const roof = this.cityHandle.heightOf('depot') + 5;
    for (const entry of this.drones.values()) entry.root.visible = false;
    for (const drone of state.drones) {
      const rt = runtime.drones[drone.id];
      if (!rt) continue;
      let entry = this.drones.get(drone.id);
      if (!entry) {
        entry = createDroneModel(DRONE_TYPES[drone.typeId]);
        this.vehicleLayer.add(entry.root);
        this.drones.set(drone.id, entry);
      }
      const flying = rt.phase === 'outbound' || rt.phase === 'inbound';
      const dropping = rt.phase === 'dropping';
      const carrying = (flying || dropping || rt.phase === 'loading') && rt.order !== null && rt.phase !== 'inbound';
      entry.root.visible = true;
      entry.root.position.set(rt.x, 0, rt.y);
      entry.setHeading(rt.angle);
      entry.update(dt, this.time + drone.name.length, {
        altitude: flying ? 104 : dropping ? 30 : roof,
        carrying,
        lightsOn: darkness > 0.4,
        rotating: rt.phase !== 'idle' && rt.phase !== 'charging',
        blob: flying || dropping,
      });
    }
  }

  /** Velocímetro y navegador de la cabina (unas 10 veces por segundo, solo en la vista del conductor). */
  updateCockpit(dt) {
    if (this.cameraMode !== 'driver' || this.footView) return;
    this.cockpitTimer -= dt;
    if (this.cockpitTimer > 0) return;
    this.cockpitTimer = 0.1;
    const entry = this.vehicles.get('player');
    if (!entry) return;
    const { game } = this;
    const p = game.state.player;
    const target = game.getNavigationTarget();
    let nav = null;
    if (target) {
      const dist = distance(p.x, p.y, target.x, target.y);
      nav = {
        relAngle: normalizeAngle(Math.atan2(target.y - p.y, target.x - p.x) - p.angle),
        meters: Math.round((dist / TILE) * METERS_PER_TILE),
        label: target.label ?? '',
        color: target.color ?? '#ffd166',
      };
    }
    entry.model.updateCockpit({
      kmh: Math.abs(p.speed) * 0.36, // misma escala que el resto de la interfaz
      reverse: p.speed < -2,
      cargoUsed: cargoSlotsUsed(game),
      capacity: playerCapacity(game),
      clock: formatClock(game.state),
      target: nav,
    });
  }

  /** Marcas, humo de ruedas al derrapar, chispas por el escape y algo más de ángulo de cámara con turbo. */
  updateDriftFx(dt) {
    const { game } = this;
    const drift = getDrift(game);
    // Golpe de ángulo de visión durante el turbo (no en la cabina, que ya usa 70°)
    const baseFov = this.baseFov();
    const targetFov = baseFov + (drift.boost > 0 && !this.footView ? 7 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-6 * dt));
      this.camera.updateProjectionMatrix();
    }
    if (game.paused) return;
    const p = game.state.player;
    const type = getVehicleType(game.state.vehicles.find((v) => v.id === p.vehicleId).typeId);
    if (drift.active) {
      const wheels = rearWheelPositions(p, type);
      const last = this.lastWheels;
      if (!last || Math.hypot(wheels[0].x - last[0].x, wheels[0].y - last[0].y) > 5) {
        if (last) for (let i = 0; i < 2; i++) this.effects.addSkid(last[i].x, last[i].y, wheels[i].x, wheels[i].y);
        this.lastWheels = wheels;
      }
      this.driftSmokeTimer = (this.driftSmokeTimer ?? 0) - dt;
      if (this.driftSmokeTimer <= 0) {
        this.driftSmokeTimer = 0.045;
        for (const w of wheels) this.effects.addSmoke(w.x, w.y, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22);
      }
    } else {
      this.lastWheels = null;
    }
    if (drift.boost > 0) {
      this.boostTimer = (this.boostTimer ?? 0) - dt;
      if (this.boostTimer <= 0) {
        this.boostTimer = 0.05;
        this.effects.addSparks(p.x - Math.cos(p.angle) * type.length * 0.55, p.y - Math.sin(p.angle) * type.length * 0.55, 2);
      }
    }
  }

  updateExhaust(dt) {
    const { state } = this.game;
    this.smokeTimer -= dt;
    if (Math.abs(state.player.speed) <= 20 || this.smokeTimer > 0 || this.game.paused) return;
    this.smokeTimer = 0.07;
    const vehicle = state.vehicles.find((v) => v.id === state.player.vehicleId);
    const type = getVehicleType(vehicle.typeId);
    if (type.shape === 'electric') return;
    const { x, y, angle } = state.player;
    this.effects.addSmoke(
      x - Math.cos(angle) * type.length * 0.55,
      y - Math.sin(angle) * type.length * 0.55,
      -Math.cos(angle) * 12,
      -Math.sin(angle) * 12,
    );
  }

  // ------------------------------------------------- Marcadores y pines ----

  /** Círculo de almacén/entrega en el suelo con un haz de luz opcional. */
  marker(key, x, z, radius, color) {
    let marker = this.markers.get(key);
    if (!marker) {
      const group = new THREE.Group();
      const discMaterial = new THREE.MeshBasicMaterial({ map: getZoneTexture(color, false), transparent: true, depthWrite: false });
      const disc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), discMaterial);
      disc.position.y = 1.2;
      disc.renderOrder = 2;
      const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
      beamGeometry.translate(0, 0.5, 0);
      const beamMaterial = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const beam = new THREE.Mesh(beamGeometry, beamMaterial);
      beam.scale.set(7, 150, 7);
      group.add(disc, beam);
      this.markerLayer.add(group);
      marker = { group, disc, beam, color, label: null, solid: false };
      this.markers.set(key, marker);
    }
    marker.group.position.set(x, 0, z);
    marker.group.visible = true;
    marker.radius = radius;
    return marker;
  }

  syncMarkers() {
    const { game } = this;
    const { state, city } = game;
    for (const marker of this.markers.values()) marker.group.visible = false;

    // Almacén
    const depot = city.depot;
    const hasWaiting = state.orders.some((o) => o.status === 'pending' && !o.assignedTo && o.prep <= 0);
    const inDepot = game.isPlayerInDepot();
    const depotMarker = this.marker('depot', depot.zoneCenter.x, depot.zoneCenter.y, DEPOT_RADIUS, '#ffb703');
    this.styleMarker(depotMarker, {
      solid: inDepot, alpha: hasWaiting || inDepot ? 1 : 0.55, pulse: 0.025, beam: hasWaiting && !inDepot,
    });
    if (!depotMarker.label) {
      depotMarker.label = createLabel('ALMACÉN', { size: 13, color: '#ffd166' });
      depotMarker.label.position.set(0, 24, -DEPOT_RADIUS);
      depotMarker.group.add(depotMarker.label);
    }
    scaleSpriteToScreen(depotMarker.label, this.camera, this.cssH, depotMarker.label.userData.label.pxHeight);

    // Entregas de los pedidos cargados
    const deliverable = new Set(game.getDeliverableOrders().map((o) => o.id));
    for (const id of state.player.cargo) {
      const order = getOrder(state, id);
      if (!order) continue;
      const b = city.getBuilding(order.buildingId);
      const color = ORDER_KINDS[order.kind].color;
      const ready = deliverable.has(order.id);
      const marker = this.marker(`drop:${order.id}`, b.dropX, b.dropY, DROP_RADIUS, color);
      this.styleMarker(marker, { solid: ready, alpha: 1, pulse: ready ? 0.04 : 0.025, beam: true });
      if (!marker.label) {
        marker.label = createLabel('PULSA E · ENTREGAR', { size: 13 });
        marker.label.position.set(0, 24, DROP_RADIUS + 6);
        marker.group.add(marker.label);
      }
      marker.label.visible = ready && !this.footView;
      if (ready && !this.footView) scaleSpriteToScreen(marker.label, this.camera, this.cssH, marker.label.userData.label.pxHeight);
    }

    // A pie: puerta del destinatario (con la caja en las manos) y siguiente paso de la guía
    if (this.footView) {
      const box = heldBox(game);
      if (box) {
        const door = deliveryDoorPoint(city.getBuilding(box.buildingId));
        const marker = this.marker(`door:${box.id}`, door.x, door.y, DOOR_RADIUS, ORDER_KINDS[box.kind].color);
        this.styleMarker(marker, { solid: true, alpha: 1, pulse: 0.05, beam: true });
        marker.beam.scale.set(3, 40, 3);
      }
      const target = game.getFootGuide()?.target;
      if (target && target.kind !== 'door') {
        const marker = this.marker('guide', target.x, target.y, 7, target.color);
        if (marker.color !== target.color) {
          marker.color = target.color;
          marker.beam.material.color.set(target.color);
        }
        this.styleMarker(marker, { solid: false, alpha: 0.9, pulse: 0.08, beam: target.kind === 'vehicle' });
        marker.beam.scale.set(2, 30, 2);
      }
    }

    // Retira los marcadores de pedidos que ya no están cargados
    for (const [key, marker] of this.markers) {
      if (marker.group.visible || key === 'depot') continue;
      this.markerLayer.remove(marker.group);
      marker.disc.geometry.dispose();
      marker.disc.material.dispose();
      marker.beam.geometry.dispose();
      marker.beam.material.dispose();
      if (marker.label) disposeSprite(marker.label);
      this.markers.delete(key);
    }
  }

  styleMarker(marker, { solid, alpha, pulse, beam }) {
    const scale = (marker.radius * 128 / 118) * (1 + Math.sin(this.time * 3.6) * pulse);
    marker.disc.scale.set(scale, 1, scale);
    marker.disc.rotation.y = solid ? 0 : this.time * 0.3;
    marker.disc.material.map = getZoneTexture(marker.color, solid);
    marker.disc.material.opacity = alpha;
    marker.beam.visible = beam;
    marker.beam.material.opacity = 0.16 + Math.sin(this.time * 3) * 0.04;
  }

  syncPins() {
    const { game, camera } = this;
    const { state, city } = game;
    const tracked = game.trackedOrderId;
    const used = new Set();
    for (const order of state.orders) {
      if (order.assignedTo && order.assignedTo !== 'player') continue;
      const b = city.getBuilding(order.buildingId);
      const kind = ORDER_KINDS[order.kind];
      const loaded = state.player.cargo.includes(order.id) || state.player.hands.box === order.id;
      const focus = loaded || order.id === tracked;
      used.add(order.id);

      let pin = this.pins.get(order.id);
      if (!pin) {
        const sprite = new THREE.Sprite(getPinMaterial('#6c7a96', kind.icon));
        sprite.center.set(0.5, PIN_ANCHOR_Y);
        sprite.renderOrder = 16;
        sprite.layers.set(OVERLAY_LAYER);
        sprite.userData.aspect = PIN_ASPECT;
        this.pinLayer.add(sprite);
        pin = { sprite, label: null };
        this.pins.set(order.id, pin);
      }
      const material = getPinMaterial(loaded ? kind.color : '#6c7a96', kind.icon);
      if (pin.sprite.material !== material) pin.sprite.material = material;

      const bounce = focus ? Math.sin(this.time * 5 + order.number) * 3 : 0;
      pin.sprite.position.set(b.centerX, this.cityHandle.heightOf(b.id) + 10 + bounce, b.centerY);
      const pixels = focus ? (order.id === tracked ? 58 : 48) : 32;
      scaleSpriteToScreen(pin.sprite, camera, this.cssH, pixels, PIN_ASPECT);

      if (focus) {
        if (!pin.label) {
          pin.label = createLabel(b.address, { size: 12 });
          pin.label.position.copy(pin.sprite.position);
          this.pinLayer.add(pin.label);
        }
        const info = pin.label.userData.label;
        pin.label.position.copy(pin.sprite.position);
        pin.label.center.set(0.5, -(pixels + 4) / info.pxHeight);
        pin.label.visible = true;
        scaleSpriteToScreen(pin.label, camera, this.cssH, info.pxHeight);
      } else if (pin.label) {
        pin.label.visible = false;
      }
    }
    for (const [id, pin] of this.pins) {
      if (used.has(id)) continue;
      this.pinLayer.remove(pin.sprite);
      if (pin.label) { this.pinLayer.remove(pin.label); disposeSprite(pin.label); }
      this.pins.delete(id);
    }
  }

  /** Flecha pequeña (mejora "Flecha guía") que solo señala destinos de entrega. */
  updateNavigationArrow() {
    const { game } = this;
    const target = game.getArrowTarget();
    const p = game.state.player;
    if (!target) {
      this.arrow.visible = false;
      this.arrowLabel.visible = false;
      return;
    }
    const dist = distance(p.x, p.y, target.x, target.y);
    const near = target.kind === 'depot' ? DEPOT_RADIUS : DROP_RADIUS;
    if (dist < near + 30) {
      this.arrow.visible = false;
      this.arrowLabel.visible = false;
      return;
    }
    const angle = Math.atan2(target.y - p.y, target.x - p.x);
    const wobble = Math.sin(this.time * 6) * 1.5;
    // Desde la cabina la flecha va más lejos y más baja para verse a través del parabrisas
    const driver = this.cameraMode === 'driver';
    const radius = (driver ? 90 : 46) + wobble;
    const height = driver ? 26 : 40;
    this.arrow.visible = true;
    this.arrow.scale.setScalar(0.55);
    this.arrow.position.set(p.x + Math.cos(angle) * radius, height, p.y + Math.sin(angle) * radius);
    this.arrow.rotation.y = -angle;
    this.arrowMaterial.color.set(target.color);

    const meters = Math.round((dist / TILE) * METERS_PER_TILE);
    setLabelText(this.arrowLabel, `${meters} m`, { size: 11 });
    this.arrowLabel.visible = true;
    this.arrowLabel.position.set(p.x + Math.cos(angle) * (radius + 20), height + 4, p.y + Math.sin(angle) * (radius + 20));
    scaleSpriteToScreen(this.arrowLabel, this.camera, this.cssH, this.arrowLabel.userData.label.pxHeight);
  }

  updateZoneLabels(dt) {
    this.labelTimer -= dt;
    if (this.labelTimer <= 0) {
      this.labelTimer = 0.5;
      if (this.zoneLabelKey() !== this.labelKey) this.buildZoneLabels();
    }
    // El cartel de una zona bloqueada solo sale cuando el jugador está muy cerca de su borde
    const focus = this.game.getFocus();
    const near = nearestLockedZone(this.game.city, focus.x, focus.y);
    for (const sprite of this.zoneLabels) {
      const show = Boolean(near) && near.zoneId === sprite.userData.zoneId;
      sprite.visible = show;
      if (!show) continue;
      const at = signPosition(near, focus.x, focus.y);
      sprite.position.set(at.x, this.footView ? 26 : 40, at.y);
      sprite.material.opacity = signOpacity(near.dist);
      scaleSpriteToScreen(sprite, this.camera, this.cssH, this.footView ? 84 : 96, sprite.userData.aspect);
    }
  }

  // ----------------------------------------------------- Luz y visibilidad ----

  /** Asigna las farolas más cercanas al jugador a un pequeño grupo de luces reales. */
  updateLampLights(dt, darkness) {
    const lit = darkness > 0.03;
    const broken = getBrokenLamps(this.game);
    this.lampTimer -= dt;
    if (this.lampTimer <= 0 && lit) {
      this.lampTimer = 0.3;
      const lamps = this.game.city.lampPosts;
      const p = this.game.getFocus();
      const taken = new Set();
      for (const light of this.lampLights) {
        let best = -1;
        let bestDistance = Infinity;
        for (let i = 0; i < lamps.length; i++) {
          if (taken.has(i) || broken.has(i)) continue;
          const d = (lamps[i].x - p.x) ** 2 + (lamps[i].y - p.y) ** 2;
          if (d < bestDistance) { bestDistance = d; best = i; }
        }
        light.userData.lamp = best;
        if (best < 0) continue;
        taken.add(best);
        light.position.set(lamps[best].x, 34, lamps[best].y);
      }
    }
    // Una farola derribada se apaga al instante (sin esperar al próximo reparto de luces)
    for (const light of this.lampLights) {
      const lamp = light.userData.lamp ?? -1;
      light.intensity = lit && lamp >= 0 && !broken.has(lamp) ? darkness * 2.4 : 0;
    }
  }

  /** Los edificios que quedan entre la cámara y el vehículo se vuelven casi transparentes. */
  updateFades(dt) {
    if (this.cameraMode === 'driver' || this.footView) {
      for (const entry of this.cityHandle.entries) updateEntryFade(entry, 1, dt);
      return;
    }
    const p = this.game.state.player;
    const focus = this.tmpFocus.set(p.x, 18, p.y);
    const from = this.camera.position;
    const end = this.tmpEnd.copy(from).lerp(focus, 0.97);
    for (const entry of this.cityHandle.entries) {
      const target = segmentHitsBuilding(from, end, entry.box, 3) ? 0.15 : 1;
      updateEntryFade(entry, target, dt);
    }
  }

  // ------------------------------------------------------------ Dibujo ----

  draw() {
    if (this.lost) return;
    const { renderer, scene, camera } = this;
    // 1) Mundo (con post-procesado si la calidad lo permite)
    camera.layers.set(0);
    if (this.postfx && QUALITY[this.quality].post) this.postfx.render(scene, camera, this.grading);
    else renderer.render(scene, camera);
    // 2) Etiquetas y pines encima, sin filtros (y sin volver a calcular las sombras).
    // Sin fondo: si la escena tiene un color de fondo, Three.js borra la pantalla aunque autoClear
    // esté desactivado, y se perdería todo lo pintado en el paso 1 (se veía la pantalla azul).
    const background = scene.background;
    scene.background = null;
    camera.layers.set(OVERLAY_LAYER);
    renderer.autoClear = false;
    renderer.shadowMap.autoUpdate = false;
    try {
      renderer.render(scene, camera);
    } finally {
      renderer.shadowMap.autoUpdate = true;
      renderer.autoClear = true;
      scene.background = background;
      camera.layers.set(0);
    }
  }

  /** Datos de depuración para comprobar el rendimiento. */
  stats() {
    const { render, memory } = this.renderer.info;
    return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures };
  }

  destroy() {
    for (const [id, entry] of [...this.couriers]) this.removeCourier(id, entry);
    this.resizeObserver.disconnect();
    for (const off of this.unsubscribe) off();
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.effects.dispose();
    this.disposeWorld();
    this.outskirts?.dispose();
    for (const item of Object.values(this.handKit ?? {})) item.dispose();
    setVehicleEnvironment(null, 0);
    setSurfaceEnvironment(null, 0);
    this.envTarget?.dispose();
    this.skyDome.geometry.dispose();
    this.skyDome.material.dispose();
    this.cloudMaterial.dispose();
    this.postfx?.dispose();
    setBuildingEnvironment(null, 0);
    this.renderer.dispose();
  }
}
