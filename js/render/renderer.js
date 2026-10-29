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
import { getBrokenLamps, lampPose } from '../systems/streetLamps.js';
import { getCompany } from '../systems/branding.js';
import { renderStaticMap, BUILDING_LIFT } from './mapLayer.js';
import { drawVehicle, drawDrone, drawPin, drawOutlinedText, roundRect, shade } from './sprites.js';
import { getShelf, productInfo } from '../config/products.js';
import { BELT_SPEED, BELT_WIDTH, depotLayout, isInsideDepot } from '../world/depotLayout.js';
import { deliveryDoorPoint } from '../world/lotLayout.js';
import { nearestLockedZone, signOpacity, signPosition } from '../world/zoneBorder.js';
import { parkedVehicles, vehicleOnRoad, WALKER_RADIUS } from '../systems/onFoot.js';
import { DOOR_RADIUS, beltItems, heldBox, heldItems, itemsAt, rackBoxes } from '../systems/handling.js';
import { pickerLoad, pickersOf } from '../systems/warehouseStaff.js';
import { courierLoad, reservedOnRack } from '../systems/workers.js';
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
    this.staticCanvas = renderStaticMap(this.game.city, getCompany(this.game.state));
  }

  bindEvents() {
    const { events, city, state } = this.game;
    events.on('orderDelivered', ({ building, reward, xp, by }) => {
      const manual = by.type === 'player';
      // A pie se entrega en la puerta; empleados y drones, en la calle
      const at = by.at ?? { x: building.dropX, y: building.dropY };
      this.effects.confetti(at.x, at.y, manual ? 40 : 14, manual ? 1 : 0.6);
      this.effects.ring(at.x, at.y, '#7CFC9A', manual ? 90 : 90);
      this.effects.text(at.x, at.y - 24, `+${formatInt(reward)} €`, { size: manual ? 26 : 18 });
      if (manual && xp) this.effects.text(at.x, at.y + 2, `+${xp} XP`, { color: '#8ad7ff', size: 15, life: 1.3, rise: 30 });
    });
    events.on('orderLoaded', ({ from }) => {
      // La caja sale de las manos del repartidor hacia la trasera del vehículo
      const depot = city.depot;
      const start = from ?? { x: depot.doorX + (Math.random() - 0.5) * 30, y: depot.doorY - 6 };
      this.effects.box(start.x, start.y, () => ({ x: state.player.x, y: state.player.y }), 0);
    });
    events.on('crash', ({ impact, x, y }) => {
      this.effects.sparks(x, y, Math.min(16, 4 + impact / 12));
      this.effects.addShake(Math.min(6, impact / 30));
    });
    events.on('lampHit', ({ x, y, speed }) => {
      this.effects.sparks(x, y, Math.min(14, 6 + speed / 25));
      this.effects.addShake(Math.min(3, 0.8 + speed / 120));
    });
    // El rótulo del tejado del almacén lleva el nombre y los colores de la empresa
    events.on('companyChanged', () => this.rebuildStatic());
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
    const { city } = this.game;
    const p = this.game.getFocus();
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

    this.drawLampPosts();
    this.drawDepotInterior();
    this.drawZones();
    this.effects.draw(ctx, 'ground');
    this.drawParkedVehicles(darkness);
    this.drawWorkers(darkness);
    this.drawPlayer(darkness);
    this.drawWalker();
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

  /** Farolas vistas desde arriba: de pie son un punto; derribadas, un poste tumbado junto a su muñón. */
  drawLampPosts() {
    const { ctx, game } = this;
    const broken = getBrokenLamps(game);
    const lamps = game.city.lampPosts;
    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i];
      if (!this.inView(lamp.x, lamp.y, 50)) continue;
      const entry = broken.get(i);
      if (!entry) {
        ctx.fillStyle = 'rgba(10,15,30,0.25)';
        ctx.beginPath();
        ctx.arc(lamp.x + 2, lamp.y + 3, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4b5263';
        ctx.beginPath();
        ctx.arc(lamp.x, lamp.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe9a6';
        ctx.beginPath();
        ctx.arc(lamp.x, lamp.y, 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const pose = lampPose(entry);
      const bx = lamp.x + pose.dirX * pose.slide;
      const by = lamp.y + pose.dirY * pose.slide;
      const length = Math.sin(pose.tilt) * 34; // desde arriba, cuanto más tumbada más largo se ve el poste
      const tx = bx + pose.dirX * length;
      const ty = by + pose.dirY * length;
      ctx.fillStyle = '#3a404d';
      ctx.beginPath();
      ctx.arc(lamp.x, lamp.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(10,15,30,0.25)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(bx + 1.5, by + 2);
      ctx.lineTo(tx + 1.5, ty + 2);
      ctx.stroke();
      ctx.strokeStyle = '#4b5263';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#3b4252';
      ctx.beginPath();
      ctx.arc(tx, ty, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
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
      if (ready) drawOutlinedText(ctx, game.onFoot ? 'APARCADO EN EL DESTINO' : 'PULSA E · BAJAR', b.dropX, b.dropY + DROP_RADIUS + 16, { size: 13, color: '#fff' });
    }

    // A pie: puerta del destinatario (con la caja en las manos) y siguiente paso
    if (game.onFoot) {
      const box = heldBox(game);
      if (box) {
        const door = deliveryDoorPoint(city.getBuilding(box.buildingId));
        const color = ORDER_KINDS[box.kind].color;
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = color;
        ctx.fillStyle = hexToRgba(color, 0.25);
        ctx.beginPath();
        ctx.arc(door.x, door.y, DOOR_RADIUS * (1 + Math.sin(time * 5) * 0.06), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
        drawOutlinedText(ctx, 'PUERTA', door.x, door.y - DOOR_RADIUS - 8, { size: 11, color: '#fff' });
      }
      const target = game.getFootGuide()?.target;
      if (target && target.kind !== 'door') {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -time * 12;
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = target.color;
        ctx.beginPath();
        ctx.arc(target.x, target.y, 9 + Math.sin(time * 6) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawParkedVehicles(darkness) {
    const { game, ctx } = this;
    for (const { vehicle, x, y, angle } of parkedVehicles(game)) {
      const look = this.livery(getVehicleType(vehicle.typeId));
      drawVehicle(ctx, look.type, x, y, angle, { lightsOn: darkness > 0.4, alpha: 0.95, stripe: look.stripe });
    }
  }

  /**
   * Interior del almacén visto desde arriba (sin tejado) mientras se está dentro a pie: estanterías con sus
   * productos, mesa de empaquetado con lo que hay encima y zona de expedición con las cajas listas.
   */
  drawDepotInterior() {
    const { ctx, game, time } = this;
    const { state, city } = game;
    const f = state.player.foot;
    if (!game.onFoot || !isInsideDepot(city.depot, f.x, f.y)) return;
    const L = depotLayout(city.depot);
    const { outer: o, inner: i } = L;
    const rectFill = (r, color) => { ctx.fillStyle = color; ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0); };
    ctx.save();
    rectFill(o, '#7d7666');
    rectFill(i, '#d8d2c4');
    // Fachada abierta (sin valla): el suelo sigue hasta fuera, con una línea amarilla en el borde
    ctx.fillStyle = '#d8d2c4';
    ctx.fillRect(i.x0, i.y1, i.x1 - i.x0, o.y1 - i.y1 + 1);
    ctx.fillStyle = '#ffb703';
    ctx.fillRect(i.x0, o.y1 - 0.8, i.x1 - i.x0, 0.8);
    // Marcas del suelo alrededor de la mesa
    const t = L.table.rect;
    ctx.strokeStyle = 'rgba(232,160,0,0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(t.x0 - 9, t.y0 - 9, t.x1 - t.x0 + 18, t.y1 - t.y0 + 18);
    ctx.setLineDash([]);

    const itemColor = (item) => productInfo(item.name).color;
    const dot = (item, x, y, s = 4) => {
      ctx.fillStyle = itemColor(item);
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeStyle = 'rgba(10,15,30,0.6)';
      ctx.lineWidth = 0.6;
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    };

    // Oficina: moqueta, tabiques de cristal, mesa con ordenador, archivadores, librería y planta
    const of = L.office;
    rectFill(of.room, '#56677d');
    for (const wall of of.walls) rectFill(wall, 'rgba(160,205,240,0.9)');
    rectFill(of.desk, '#b98b5e');
    rectFill({ x0: of.computer.x - 4.5, y0: of.computer.y - 1, x1: of.computer.x + 4.5, y1: of.computer.y + 0.5 }, '#1d2230');
    ctx.fillStyle = '#2b2f38';
    ctx.beginPath();
    ctx.arc(of.chair.x, of.chair.y, 2.8, 0, Math.PI * 2);
    ctx.fill();
    rectFill(of.cabinets, '#7d8794');
    rectFill(of.bookcase, '#8a6a4a');
    ctx.fillStyle = '#3a7d44';
    ctx.beginPath();
    ctx.arc((of.plant.x0 + of.plant.x1) / 2, (of.plant.y0 + of.plant.y1) / 2, 4, 0, Math.PI * 2);
    ctx.fill();
    drawOutlinedText(ctx, 'OFICINA', (of.room.x0 + of.room.x1) / 2, of.room.y1 - 10, { size: 9, color: '#ffd166' });

    // Estanterías de stock (decorado) y recepción
    for (const shelf of L.shelves) {
      const r = shelf.rect;
      const info = getShelf(shelf.id);
      rectFill(r, '#4d5463');
      const horizontal = r.x1 - r.x0 > r.y1 - r.y0;
      const n = 4;
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = k % 2 ? info.color : shade(info.color, -30);
        if (horizontal) ctx.fillRect(r.x0 + 2 + k * ((r.x1 - r.x0 - 4) / n), r.y0 + 2, (r.x1 - r.x0 - 4) / n - 1.5, r.y1 - r.y0 - 4);
        else ctx.fillRect(r.x0 + 2, r.y0 + 2 + k * ((r.y1 - r.y0 - 4) / n), r.x1 - r.x0 - 4, (r.y1 - r.y0 - 4) / n - 1.5);
      }
      drawOutlinedText(ctx, shelf.id, (r.x0 + r.x1) / 2 + shelf.face.x * 12, (r.y0 + r.y1) / 2 + shelf.face.y * 12, { size: 11, color: info.color });
    }
    for (const p of L.reception.pallets) rectFill(p, '#c99a62');
    for (const c of L.columns) rectFill(c, '#9aa1ad');
    drawOutlinedText(ctx, 'RECEPCIÓN', (L.reception.area.x0 + L.reception.area.x1) / 2, L.reception.area.y1 - 4, { size: 8, color: '#90be6d' });

    // Cinta (con la banda en movimiento) y cajón de fin de línea
    for (const c of L.belt.colliders) rectFill(c, '#ffb703');
    ctx.strokeStyle = '#2b2f36';
    ctx.lineWidth = BELT_WIDTH - 3;
    ctx.beginPath();
    L.belt.path.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.strokeStyle = '#4a515c';
    ctx.lineWidth = BELT_WIDTH - 3;
    ctx.setLineDash([1.5, 4.5]);
    ctx.lineDashOffset = -(time * BELT_SPEED) % 6;
    ctx.beginPath();
    L.belt.path.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    for (const { item, point } of beltItems(game)) dot(item, point.x, point.y, 4.5);
    const bin = L.bin.rect;
    rectFill(bin, '#2f6db5');
    rectFill({ x0: bin.x0 + 1.5, y0: bin.y0 + 1.5, x1: bin.x1 - 1.5, y1: bin.y1 - 1.5 }, '#25578f');
    itemsAt(state, 'bin').slice(0, 9).forEach(({ item }, k) => dot(item, bin.x0 + 3.5 + (k % 3) * 3.5, bin.y0 + 3.5 + Math.floor(k / 3) * 3.5, 3));

    // Mesas: la del jugador y las de los preparadores, con lo que hay encima
    for (const table of L.tables) {
      rectFill(table.rect, table.player ? '#a87a4f' : '#94704c');
      ctx.strokeStyle = '#6b4a32';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(table.rect.x0, table.rect.y0, table.rect.x1 - table.rect.x0, table.rect.y1 - table.rect.y0);
    }
    let slot = 0;
    const stationSlots = new Map();
    for (const { item } of itemsAt(state, 'table')) {
      if (Number.isInteger(item.station) && item.table !== 0) {
        const s = L.stations[item.station];
        if (!s) continue;
        const k = stationSlots.get(item.station) ?? 0;
        stationSlots.set(item.station, k + 1);
        dot(item, s.surface.x0 + 3 + k * 5, (s.surface.y0 + s.surface.y1) / 2, 3.6);
      } else if (slot < 10) {
        dot(item, t.x0 + 4 + (slot % 5) * 6.5, t.y0 + 4 + Math.floor(slot / 5) * 6, 4.5);
        slot++;
      }
    }

    // Expedición con las cajas listas
    const rack = L.rack.rect;
    rectFill(rack, '#59606e');
    [...rackBoxes(state), ...reservedOnRack(game)].slice(0, 7).forEach((order, k) => {
      ctx.fillStyle = '#c99a62';
      ctx.fillRect(rack.x0 + 2, rack.y0 + 2 + k * 5.6, rack.x1 - rack.x0 - 4, 4.6);
      ctx.fillStyle = ORDER_KINDS[order.kind].color;
      ctx.fillRect(rack.x0 + 2, rack.y0 + 2 + k * 5.6, 2, 4.6);
    });
    drawOutlinedText(ctx, 'EXPEDICIÓN', (rack.x0 + rack.x1) / 2 - 18, (rack.y0 + rack.y1) / 2, { size: 8, color: '#ffd166' });

    // Preparadores: cuerpo con chaleco, cabeza hacia donde miran y lo que llevan
    for (const worker of pickersOf(state)) {
      const rt = game.runtime.pickers?.[worker.id];
      if (!rt) continue;
      const fx = Math.cos(rt.yaw);
      const fy = Math.sin(rt.yaw);
      const crouch = rt.anim === 'crouch' ? 0.8 : 1;
      ctx.fillStyle = '#ff8c1a';
      ctx.strokeStyle = 'rgba(10,15,30,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(rt.x, rt.y, 4.5 * crouch, 3.4 * crouch, rt.yaw + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0ac69';
      ctx.beginPath();
      ctx.arc(rt.x + fx * 0.8, rt.y + fy * 0.8, 2.2, 0, Math.PI * 2);
      ctx.fill();
      const load = pickerLoad(game, worker);
      if (load.box) {
        ctx.fillStyle = '#c99a62';
        ctx.fillRect(rt.x + fx * 6 - 3, rt.y + fy * 6 - 3, 6, 6);
      } else {
        load.items.forEach((item, k) => dot(item, rt.x + fx * 5.5 + (k - 1) * 2.4 * -fy, rt.y + fy * 5.5 + (k - 1) * 2.4 * fx, 3));
      }
      drawOutlinedText(ctx, worker.name.split(' ')[0], rt.x, rt.y - 9, { size: 7, color: '#ffe6b0' });
    }
    ctx.restore();
  }

  /** La persona vista desde arriba: cuerpo, cabeza mirando hacia delante y lo que lleva en las manos. */
  drawWalker() {
    const { game, ctx } = this;
    if (!game.onFoot) return;
    const f = game.state.player.foot;
    const company = getCompany(game.state);
    const fx = Math.cos(f.yaw);
    const fy = Math.sin(f.yaw);
    // Salto: la sombra se queda en el suelo (más pequeña) y la figura sube y crece un poco
    const z = Math.max(0, f.z ?? 0);
    const lift = Math.min(1, z / 8);
    ctx.save();
    ctx.fillStyle = `rgba(10,15,30,${0.3 - lift * 0.12})`;
    ctx.beginPath();
    ctx.arc(f.x + 1.5, f.y + 2, (WALKER_RADIUS + 0.5) * (1 - lift * 0.3), 0, Math.PI * 2);
    ctx.fill();
    if (z > 0) {
      ctx.translate(f.x, f.y - z * 0.5);
      ctx.scale(1 + lift * 0.15, 1 + lift * 0.15);
      ctx.translate(-f.x, -f.y);
    }
    ctx.fillStyle = company.primary;
    ctx.strokeStyle = 'rgba(10,15,30,0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(f.x, f.y, WALKER_RADIUS + 1, WALKER_RADIUS - 0.5, f.yaw + Math.PI / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f2c9a0';
    ctx.beginPath();
    ctx.arc(f.x + fx * 0.8, f.y + fy * 0.8, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const box = heldBox(game);
    const items = heldItems(game);
    if (box) {
      ctx.translate(f.x + fx * 6.5, f.y + fy * 6.5);
      ctx.rotate(f.yaw);
      ctx.fillStyle = '#c99a62';
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.fillStyle = '#e8c48e';
      ctx.fillRect(-3.5, -0.8, 7, 1.6);
    } else {
      items.forEach(({ item }, k) => {
        ctx.fillStyle = productInfo(item.name).color;
        ctx.fillRect(f.x + fx * 6 - 2 + (k - 1) * 2.5 * -fy, f.y + fy * 6 - 2 + (k - 1) * 2.5 * fx, 4, 4);
      });
    }
    ctx.restore();
  }

  drawWorkers(darkness) {
    const { game, ctx } = this;
    const { state } = game;
    for (const worker of state.workers) {
      const rt = game.runtime.workers[worker.id];
      const vehicle = state.vehicles.find((v) => v.id === worker.vehicleId);
      if (!rt || !vehicle) continue;
      if (vehicleOnRoad(rt) && this.inView(rt.x, rt.y)) {
        const look = this.livery(getVehicleType(vehicle.typeId));
        drawVehicle(ctx, look.type, rt.x, rt.y, rt.angle, { lightsOn: darkness > 0.4, stripe: look.stripe });
        if (!rt.walker) drawOutlinedText(ctx, worker.name, rt.x, rt.y - 26, { size: 10, color: '#c9f7e4' });
      }
      // A pie: con la caja en las manos por el almacén o hasta la puerta del cliente
      const w = rt.walker;
      if (!w || !this.inView(w.x, w.y)) continue;
      const fx = Math.cos(w.yaw);
      const fy = Math.sin(w.yaw);
      ctx.fillStyle = '#3a86ff';
      ctx.strokeStyle = 'rgba(10,15,30,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(w.x, w.y, 4.5, 3.4, w.yaw + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0ac69';
      ctx.beginPath();
      ctx.arc(w.x + fx * 0.8, w.y + fy * 0.8, 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (courierLoad(game, worker).length) {
        ctx.fillStyle = '#c99a62';
        ctx.fillRect(w.x + fx * 6 - 3, w.y + fy * 6 - 3, 6, 6);
      }
      drawOutlinedText(ctx, worker.name.split(' ')[0], w.x, w.y - 9, { size: 7, color: '#c9f7e4' });
    }
  }

  drawPlayer(darkness) {
    const { game, ctx } = this;
    const { state, controls } = game;
    const p = state.player;
    const vehicle = state.vehicles.find((v) => v.id === p.vehicleId);
    const braking = (controls.throttle < 0 && p.speed > 5) || (controls.throttle > 0 && p.speed < -5);
    const look = this.livery(getVehicleType(vehicle.typeId));
    drawVehicle(ctx, look.type, p.x, p.y, p.angle, { braking, lightsOn: darkness > 0.4, stripe: look.stripe });
  }

  /** Tipo de vehículo con la pintura de la empresa si la flota lleva sus colores. */
  livery(type) {
    const company = getCompany(this.game.state);
    if (!company.fleetColors) return { type, stripe: null };
    return { type: { ...type, color: company.primary }, stripe: company.secondary };
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
      const loaded = state.player.cargo.includes(order.id) || state.player.hands.box === order.id;
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
    // Solo el cartel de la zona bloqueada cuyo borde tiene el jugador muy cerca
    const focus = game.getFocus();
    const near = nearestLockedZone(game.city, focus.x, focus.y);
    if (!near) return;
    for (const id of ZONE_ORDER) {
      if (state.zones[id] || id !== near.zoneId) continue;
      const zone = ZONES[id];
      const at = signPosition(near, focus.x, focus.y, 60);
      const cx = at.x;
      const cy = at.y;
      const width = 270;
      const height = 92;
      ctx.save();
      ctx.globalAlpha = signOpacity(near.dist);
      ctx.fillStyle = 'rgba(15,22,41,0.88)';
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      roundRect(ctx, cx - width / 2, cy - height / 2, width, height, 16);
      ctx.fill();
      ctx.stroke();
      drawOutlinedText(ctx, `🔒 ${zone.name}`, cx, cy - 22, { size: 19, color: '#ffffff' });
      drawOutlinedText(ctx, `Nivel ${zone.unlockLevel} · ${formatInt(zone.unlockCost)} €`, cx, cy + 6, { size: 15, color: '#ffd166' });
      drawOutlinedText(ctx, state.level >= zone.unlockLevel ? 'Desbloquéala en el ordenador (Empresa)' : 'Sigue creciendo para abrirla', cx, cy + 29, { size: 11, color: '#b9c3da', weight: '600' });
      ctx.restore();
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

    // Las farolas derribadas no alumbran
    const broken = getBrokenLamps(game);
    city.lampPosts.forEach((lamp, i) => {
      if (!broken.has(i) && this.inView(lamp.x, lamp.y, 90)) light(lamp.x, lamp.y, 90, 0.85);
    });
    const depot = city.depot;
    light(depot.zoneCenter.x, depot.zoneCenter.y, 170, 0.9);
    light(depot.centerX, depot.centerY, 120, 0.9); // luces del almacén
    const p = state.player;
    light(p.x, p.y, 60, 0.8);
    // Faros solo al volante; a pie, una linterna
    if (!game.onFoot) light(p.x + Math.cos(p.angle) * 85, p.y + Math.sin(p.angle) * 85, 120, 0.95);
    else light(p.foot.x + Math.cos(p.foot.yaw) * 30, p.foot.y + Math.sin(p.foot.yaw) * 30, 55, 0.85);
    for (const rt of Object.values(game.runtime.workers)) if (vehicleOnRoad(rt)) light(rt.x + Math.cos(rt.angle) * 50, rt.y + Math.sin(rt.angle) * 50, 80, 0.8);
    for (const rt of Object.values(game.runtime.drones)) if (rt.phase !== 'idle' && rt.phase !== 'charging') light(rt.x, rt.y, 55, 0.7);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.nightCanvas, 0, 0);

    // Brillo cálido de las farolas
    ctx.setTransform(scale, 0, 0, scale, -(camera.x - shakeX) * scale, -(camera.y - shakeY) * scale);
    ctx.globalCompositeOperation = 'lighter';
    for (const [i, lamp] of city.lampPosts.entries()) {
      if (broken.has(i) || !this.inView(lamp.x, lamp.y, 60)) continue;
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
