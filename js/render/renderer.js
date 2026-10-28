// Renderizador principal en Canvas 2D: cámara, capas, vehículos, drones, marcadores y noche.

import { DEPOT_RADIUS, DROP_RADIUS, METERS_PER_TILE, TILE } from '../config/constants.js';
import { ZONES, ZONE_ORDER } from '../config/zones.js';
import { ORDER_KINDS } from '../config/packages.js';
import { DRONE_TYPES } from '../config/drones.js';
import { getVehicleType } from '../config/vehicles.js';
import { clamp, distance, formatInt } from '../core/util.js';
import { clockHour, darknessAt } from '../systems/dayCycle.js';
import { getOrder } from '../systems/orders.js';
import { getDrift, rearWheelPositions } from '../systems/playerVehicle.js';
import { renderStaticMap, BUILDING_LIFT } from './mapLayer.js';
import { drawVehicle, drawDrone, drawPin, drawOutlinedText, roundRect } from './sprites.js';
import { Effects } from './effects.js';
import { drawMinimap } from './minimap.js';

export class Renderer {
  constructor({ canvas, minimapCanvas, game }) {
    this.canvas = canvas;
    this.minimapCanvas = minimapCanvas;
    this.game = game;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.effects = new Effects();
    this.camera = { x: 0, y: 0, viewW: 800, viewH: 600 };
    this.zoom = 1;
    this.dpr = 1;
    this.time = 0;
    this.smokeTimer = 0;
    this.minimapTick = 0;
    this.nightCanvas = document.createElement('canvas');
    this.zoneBounds = Object.fromEntries(ZONE_ORDER.map((id) => [id, game.city.zoneBounds(id)]));
    this.staticCanvas = null;
    this.rebuildStatic();
    this.bindEvents();
    this.resize();
    this.snapCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
  }

  rebuildStatic() {
    this.staticCanvas = renderStaticMap(this.game.city);
  }

  bindEvents() {
    const { events, city, state } = this.game;
    events.on('orderDelivered', ({ building, reward, xp, by }) => {
      const manual = by.type === 'player';
      this.effects.confetti(building.dropX, building.dropY, manual ? 40 : 14, manual ? 1 : 0.6);
      this.effects.ring(building.dropX, building.dropY, '#7CFC9A', manual ? 150 : 90);
      this.effects.text(building.dropX, building.dropY - 24, `+${formatInt(reward)} €`, { size: manual ? 26 : 18 });
      if (manual && xp) this.effects.text(building.dropX, building.dropY + 2, `+${xp} XP`, { color: '#8ad7ff', size: 15, life: 1.3, rise: 30 });
    });
    events.on('orderLoaded', () => {
      const depot = city.depot;
      this.effects.box(depot.doorX + (Math.random() - 0.5) * 30, depot.doorY - 6, () => ({ x: state.player.x, y: state.player.y }), Math.random() * 0.12);
    });
    events.on('crash', ({ impact, x, y }) => {
      this.effects.sparks(x, y, Math.min(16, 4 + impact / 12));
      this.effects.addShake(Math.min(6, impact / 30));
    });
    events.on('zoneUnlocked', () => {
      this.rebuildStatic();
      this.effects.ring(state.player.x, state.player.y, '#ffd166', 260);
    });
    events.on('levelUp', () => {
      this.effects.confetti(state.player.x, state.player.y, 60, 1.3);
      this.effects.ring(state.player.x, state.player.y, '#ffd166', 200);
    });
    events.on('upgradePurchased', () => this.effects.ring(state.player.x, state.player.y, '#4cc9f0', 90));
    events.on('driftBoost', ({ level }) => {
      this.effects.ring(state.player.x, state.player.y, '#fb8500', 70 + level * 25);
      this.effects.text(state.player.x, state.player.y - 30, level >= 3 ? '¡SÚPER TURBO!' : 'TURBO', { color: '#ffd166', size: 16 + level * 2, life: 1 });
    });
  }

  resize() {
    const parent = this.canvas.parentElement;
    const cssW = Math.max(200, parent.clientWidth);
    const cssH = Math.max(200, parent.clientHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.zoom = clamp(Math.min(cssW, cssH * 1.5) / 1000, 0.75, 1.25);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.cssW = cssW;
    this.cssH = cssH;
    this.camera.viewW = cssW / this.zoom;
    this.camera.viewH = cssH / this.zoom;
    this.nightCanvas.width = this.canvas.width;
    this.nightCanvas.height = this.canvas.height;

    const mm = this.minimapCanvas;
    if (mm) {
      const w = mm.clientWidth || 180;
      const h = mm.clientHeight || 137;
      mm.width = Math.round(w * this.dpr);
      mm.height = Math.round(h * this.dpr);
    }
  }

  /** Punto de la pantalla (px CSS del canvas) → coordenadas del mapa. */
  screenToWorld(px, py) {
    return { x: this.camera.x + px / this.zoom, y: this.camera.y + py / this.zoom };
  }

  /** Se llama al volver a este modo: recoloca la cámara y descarta efectos viejos. */
  activate() {
    this.resize();
    this.effects.particles.length = 0;
    this.effects.shake = 0;
    this.snapCamera();
  }

  cameraTarget() {
    const { city, state } = this.game;
    const p = state.player;
    const lookX = Math.cos(p.angle) * p.speed * 0.3;
    const lookY = Math.sin(p.angle) * p.speed * 0.3;
    const { viewW, viewH } = this.camera;
    const maxX = city.widthPx - viewW;
    const maxY = city.heightPx - viewH;
    return {
      x: maxX <= 0 ? maxX / 2 : clamp(p.x + lookX - viewW / 2, 0, maxX),
      y: maxY <= 0 ? maxY / 2 : clamp(p.y + lookY - viewH / 2, 0, maxY),
    };
  }

  snapCamera() {
    const t = this.cameraTarget();
    this.camera.x = t.x;
    this.camera.y = t.y;
  }

  update(dt) {
    this.time += dt;
    const target = this.cameraTarget();
    const k = 1 - Math.exp(-6 * dt);
    this.camera.x += (target.x - this.camera.x) * k;
    this.camera.y += (target.y - this.camera.y) * k;
    this.effects.update(dt);

    // Humo del tubo de escape
    const { state } = this.game;
    this.smokeTimer -= dt;
    if (Math.abs(state.player.speed) > 20 && this.smokeTimer <= 0 && !this.game.paused) {
      this.smokeTimer = 0.07;
      const type = getVehicleType(this.game.state.vehicles.find((v) => v.id === state.player.vehicleId).typeId);
      const bx = state.player.x - Math.cos(state.player.angle) * type.length * 0.55;
      const by = state.player.y - Math.sin(state.player.angle) * type.length * 0.55;
      if (type.shape !== 'electric') this.effects.smoke(bx, by, -Math.cos(state.player.angle) * 12, -Math.sin(state.player.angle) * 12);
    }
    this.updateDriftFx(dt);
  }

  /** Marcas de neumático y humo de las ruedas traseras al derrapar; chispas por el escape con turbo. */
  updateDriftFx(dt) {
    const { game } = this;
    if (game.paused) return;
    const drift = getDrift(game);
    const p = game.state.player;
    const type = getVehicleType(game.state.vehicles.find((v) => v.id === p.vehicleId).typeId);
    if (drift.active) {
      const wheels = rearWheelPositions(p, type);
      const last = this.lastWheels;
      if (!last || Math.hypot(wheels[0].x - last[0].x, wheels[0].y - last[0].y) > 6) {
        if (last) for (let i = 0; i < 2; i++) this.effects.skid(last[i].x, last[i].y, wheels[i].x, wheels[i].y);
        this.lastWheels = wheels;
      }
      this.driftSmokeTimer = (this.driftSmokeTimer ?? 0) - dt;
      if (this.driftSmokeTimer <= 0) {
        this.driftSmokeTimer = 0.05;
        for (const w of wheels) this.effects.smoke(w.x, w.y, (Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24);
      }
    } else {
      this.lastWheels = null;
    }
    if (drift.boost > 0) {
      this.boostTimer = (this.boostTimer ?? 0) - dt;
      if (this.boostTimer <= 0) {
        this.boostTimer = 0.06;
        this.effects.sparks(p.x - Math.cos(p.angle) * type.length * 0.55, p.y - Math.sin(p.angle) * type.length * 0.55, 2);
      }
    }
  }

  // ------------------------------------------------------------------ Dibujo ----

  draw() {
    const { ctx, game, camera } = this;
    const { state } = game;
    const shakeX = (Math.random() - 0.5) * this.effects.shake;
    const shakeY = (Math.random() - 0.5) * this.effects.shake;
    const scale = this.dpr * this.zoom;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#141a2b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, -(camera.x - shakeX) * scale, -(camera.y - shakeY) * scale);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.staticCanvas, 0, 0, game.city.widthPx, game.city.heightPx);

    const hour = clockHour(state);
    const darkness = darknessAt(hour);

    this.drawZones();
    this.effects.draw(ctx, 'ground');
    this.drawParkedVehicles(darkness);
    this.drawWorkers(darkness);
    this.drawPlayer(darkness);
    this.drawPins();
    this.drawDrones(darkness);
    this.drawLockedLabels();
    this.effects.draw(ctx, 'air');

    if (darkness > 0.02) this.drawNight(darkness, scale, shakeX, shakeY);
    this.drawNavigationArrow();

    this.minimapTick = (this.minimapTick + 1) % 3;
    if (this.minimapCanvas && this.minimapTick === 0) drawMinimap(this.minimapCanvas, game, this.staticCanvas, camera);
  }

  inView(x, y, margin = 120) {
    const c = this.camera;
    return x > c.x - margin && x < c.x + c.viewW + margin && y > c.y - margin && y < c.y + c.viewH + margin;
  }

  drawZones() {
    const { ctx, game, time } = this;
    const { state, city } = game;
    const depot = city.depot;
    const hasWaiting = state.orders.some((o) => o.status === 'pending' && !o.assignedTo && o.prep <= 0);
    const inDepot = game.isPlayerInDepot();

    // Zona del almacén
    const pulse = 1 + Math.sin(time * 3.5) * 0.025;
    ctx.save();
    ctx.lineDashOffset = -time * 18;
    ctx.setLineDash([14, 10]);
    ctx.lineWidth = inDepot ? 4 : 3;
    ctx.strokeStyle = '#ffb703';
    ctx.fillStyle = inDepot ? 'rgba(255,183,3,0.22)' : hasWaiting ? 'rgba(255,183,3,0.12)' : 'rgba(255,183,3,0.05)';
    ctx.beginPath();
    ctx.arc(depot.zoneCenter.x, depot.zoneCenter.y, DEPOT_RADIUS * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = hasWaiting || inDepot ? 1 : 0.55;
    ctx.stroke();
    ctx.restore();
    drawOutlinedText(ctx, 'ALMACÉN', depot.zoneCenter.x, depot.zoneCenter.y - DEPOT_RADIUS - 12, { size: 13, color: '#ffd166' });

    // Zonas de entrega de los pedidos cargados
    const deliverable = new Set(game.getDeliverableOrders().map((o) => o.id));
    for (const id of state.player.cargo) {
      const order = getOrder(state, id);
      if (!order) continue;
      const b = city.getBuilding(order.buildingId);
      const color = ORDER_KINDS[order.kind].color;
      const ready = deliverable.has(order.id);
      ctx.save();
      ctx.lineDashOffset = ready ? 0 : -time * 22;
      ctx.setLineDash(ready ? [] : [12, 9]);
      ctx.lineWidth = ready ? 5 : 3.5;
      ctx.strokeStyle = color;
      ctx.fillStyle = hexToRgba(color, ready ? 0.3 : 0.14);
      const r = DROP_RADIUS * (1 + Math.sin(time * 4) * (ready ? 0.04 : 0.025));
      ctx.beginPath();
      ctx.arc(b.dropX, b.dropY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (ready) drawOutlinedText(ctx, 'PULSA E · ENTREGAR', b.dropX, b.dropY + DROP_RADIUS + 16, { size: 13, color: '#fff' });
    }
  }

  parkedSpot(index) {
    const lot = this.game.city.depot.lot;
    return { x: lot.x + 28 + (index % 4) * 46, y: lot.y + 17 + Math.floor(index / 4) * 30 };
  }

  drawParkedVehicles(darkness) {
    const { game, ctx } = this;
    const { state } = game;
    let index = 0;
    for (const vehicle of state.vehicles) {
      if (vehicle.id === state.player.vehicleId) continue;
      const rt = vehicle.driver ? game.runtime.workers[vehicle.driver] : null;
      if (rt && rt.phase !== 'idle') continue;
      const spot = this.parkedSpot(index++);
      if (index > 8) break;
      drawVehicle(ctx, getVehicleType(vehicle.typeId), spot.x, spot.y, 0, { lightsOn: darkness > 0.4, alpha: 0.95 });
    }
  }

  drawWorkers(darkness) {
    const { game, ctx } = this;
    const { state } = game;
    for (const worker of state.workers) {
      const rt = game.runtime.workers[worker.id];
      const vehicle = state.vehicles.find((v) => v.id === worker.vehicleId);
      if (!rt || !vehicle || rt.phase === 'idle') continue;
      if (!this.inView(rt.x, rt.y)) continue;
      drawVehicle(ctx, getVehicleType(vehicle.typeId), rt.x, rt.y, rt.angle, { lightsOn: darkness > 0.4 });
      drawOutlinedText(ctx, worker.name, rt.x, rt.y - 26, { size: 10, color: '#c9f7e4' });
    }
  }

  drawPlayer(darkness) {
    const { game, ctx } = this;
    const { state, controls } = game;
    const p = state.player;
    const vehicle = state.vehicles.find((v) => v.id === p.vehicleId);
    const braking = (controls.throttle < 0 && p.speed > 5) || (controls.throttle > 0 && p.speed < -5);
    drawVehicle(ctx, getVehicleType(vehicle.typeId), p.x, p.y, p.angle, { braking, lightsOn: darkness > 0.4 });
  }

  drawPins() {
    const { game, ctx, time } = this;
    const { state, city } = game;
    const tracked = game.trackedOrderId;
    for (const order of state.orders) {
      if (order.assignedTo && order.assignedTo !== 'player') continue;
      const b = city.getBuilding(order.buildingId);
      if (!this.inView(b.centerX, b.y)) continue;
      const kind = ORDER_KINDS[order.kind];
      const loaded = order.assignedTo === 'player';
      const lift = BUILDING_LIFT[b.kind] ?? 8;
      const focus = loaded || order.id === tracked;
      const bounce = focus ? Math.sin(time * 5 + order.number) * 3 : 0;
      ctx.save();
      ctx.globalAlpha = focus ? 1 : 0.8;
      drawPin(ctx, b.centerX, b.y - lift + 8, {
        color: loaded ? kind.color : '#6c7a96', icon: kind.icon, size: focus ? (order.id === tracked ? 1.35 : 1.15) : 0.72, pulse: bounce,
      });
      ctx.restore();
      if (focus) drawOutlinedText(ctx, b.address, b.centerX, b.y - lift - 42 + bounce, { size: 11 });
    }
  }

  drawDrones(darkness) {
    const { game, ctx, time } = this;
    const { state } = game;
    for (const drone of state.drones) {
      const rt = game.runtime.drones[drone.id];
      if (!rt || !this.inView(rt.x, rt.y)) continue;
      const flying = rt.phase === 'outbound' || rt.phase === 'inbound' || rt.phase === 'dropping';
      const carrying = rt.phase === 'outbound' || rt.phase === 'dropping' || rt.phase === 'loading';
      drawDrone(ctx, DRONE_TYPES[drone.typeId], rt.x, rt.y, time + drone.name.length, {
        carrying: carrying && rt.order !== null, height: flying ? 18 : 3, lightsOn: darkness > 0.4,
      });
    }
  }

  drawLockedLabels() {
    const { game, ctx } = this;
    const { state } = game;
    for (const id of ZONE_ORDER) {
      if (state.zones[id]) continue;
      const zone = ZONES[id];
      const bounds = this.zoneBounds[id];
      const cx = bounds.centerX;
      const cy = bounds.centerY;
      if (!this.inView(cx, cy, 260)) continue;
      const width = 270;
      const height = 92;
      ctx.save();
      ctx.fillStyle = 'rgba(15,22,41,0.88)';
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      roundRect(ctx, cx - width / 2, cy - height / 2, width, height, 16);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      drawOutlinedText(ctx, `🔒 ${zone.name}`, cx, cy - 22, { size: 19, color: '#ffffff' });
      drawOutlinedText(ctx, `Nivel ${zone.unlockLevel} · ${formatInt(zone.unlockCost)} €`, cx, cy + 6, { size: 15, color: '#ffd166' });
      drawOutlinedText(ctx, state.level >= zone.unlockLevel ? 'Desbloquéala en el panel Empresa' : 'Sigue creciendo para abrirla', cx, cy + 29, { size: 11, color: '#b9c3da', weight: '600' });
    }
  }

  drawNight(darkness, scale, shakeX, shakeY) {
    const { ctx, game, camera } = this;
    const { state, city } = game;
    const n = this.nightCanvas.getContext('2d');
    n.setTransform(1, 0, 0, 1, 0, 0);
    n.globalCompositeOperation = 'source-over';
    n.clearRect(0, 0, this.nightCanvas.width, this.nightCanvas.height);
    n.fillStyle = `rgba(7,12,40,${0.66 * darkness})`;
    n.fillRect(0, 0, this.nightCanvas.width, this.nightCanvas.height);
    n.setTransform(scale, 0, 0, scale, -(camera.x - shakeX) * scale, -(camera.y - shakeY) * scale);
    n.globalCompositeOperation = 'destination-out';

    const light = (x, y, radius, strength = 1) => {
      const g = n.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, `rgba(0,0,0,${strength})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      n.fillStyle = g;
      n.beginPath();
      n.arc(x, y, radius, 0, Math.PI * 2);
      n.fill();
    };

    for (const lamp of city.lampPosts) if (this.inView(lamp.x, lamp.y, 90)) light(lamp.x, lamp.y, 90, 0.85);
    const depot = city.depot;
    light(depot.zoneCenter.x, depot.zoneCenter.y, 170, 0.9);
    const p = state.player;
    light(p.x, p.y, 60, 0.8);
    light(p.x + Math.cos(p.angle) * 85, p.y + Math.sin(p.angle) * 85, 120, 0.95);
    for (const rt of Object.values(game.runtime.workers)) if (rt.phase !== 'idle') light(rt.x + Math.cos(rt.angle) * 50, rt.y + Math.sin(rt.angle) * 50, 80, 0.8);
    for (const rt of Object.values(game.runtime.drones)) if (rt.phase !== 'idle' && rt.phase !== 'charging') light(rt.x, rt.y, 55, 0.7);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.nightCanvas, 0, 0);

    // Brillo cálido de las farolas
    ctx.setTransform(scale, 0, 0, scale, -(camera.x - shakeX) * scale, -(camera.y - shakeY) * scale);
    ctx.globalCompositeOperation = 'lighter';
    for (const lamp of city.lampPosts) {
      if (!this.inView(lamp.x, lamp.y, 60)) continue;
      const g = ctx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, 38);
      g.addColorStop(0, `rgba(255,206,120,${0.38 * darkness})`);
      g.addColorStop(1, 'rgba(255,206,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y, 38, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Flecha junto al vehículo que apunta al destino activo. */
  drawNavigationArrow() {
    const { ctx, game, camera } = this;
    const target = game.getArrowTarget();
    if (!target) return;
    const scale = this.dpr * this.zoom;
    ctx.setTransform(scale, 0, 0, scale, -camera.x * scale, -camera.y * scale);
    const p = game.state.player;
    const dist = distance(p.x, p.y, target.x, target.y);
    const near = target.kind === 'depot' ? DEPOT_RADIUS : DROP_RADIUS;
    if (dist < near + 30) return;
    const angle = Math.atan2(target.y - p.y, target.x - p.x);
    const radius = 46;
    ctx.save();
    ctx.translate(p.x + Math.cos(angle) * radius, p.y + Math.sin(angle) * radius);
    ctx.rotate(angle);
    const wobble = Math.sin(this.time * 6) * 1.5;
    ctx.translate(wobble, 0);
    ctx.scale(0.6, 0.6);
    ctx.fillStyle = target.color;
    ctx.strokeStyle = 'rgba(10,15,30,0.9)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-8, -11);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-8, 11);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    const meters = Math.round((dist / TILE) * METERS_PER_TILE);
    drawOutlinedText(ctx, `${meters} m`, p.x + Math.cos(angle) * (radius + 22), p.y + Math.sin(angle) * (radius + 22), { size: 10, color: '#ffffff' });
  }

  destroy() {
    this.resizeObserver.disconnect();
  }
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}
