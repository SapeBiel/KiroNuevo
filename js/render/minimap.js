// Minimapa: mapa reducido con tu posición, destinos, empleados y drones.

import { ORDER_KINDS } from '../config/packages.js';

export function drawMinimap(canvas, game, staticCanvas, camera) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return; // oculto en pantallas pequeñas
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / w;
  const { city, state } = game;
  const sx = w / city.widthPx;
  const sy = h / city.heightPx;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(staticCanvas, 0, 0, w, h);

  const dot = (x, y, r, color, stroke = true) => {
    ctx.beginPath();
    ctx.arc(x * sx, y * sy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };

  // Pedidos pendientes y cargados
  for (const order of state.orders) {
    const b = city.getBuilding(order.buildingId);
    const loaded = order.assignedTo === 'player';
    dot(b.dropX, b.dropY, loaded ? 4 : 2.2, loaded ? ORDER_KINDS[order.kind].color : 'rgba(255,255,255,0.8)', loaded);
  }

  // Almacén
  const depot = city.depot;
  ctx.fillStyle = '#ffb703';
  ctx.fillRect(depot.centerX * sx - 4, depot.centerY * sy - 4, 8, 8);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(depot.centerX * sx - 4, depot.centerY * sy - 4, 8, 8);

  // Empleados y drones
  for (const rt of Object.values(game.runtime.workers)) if (rt.phase !== 'idle') dot(rt.x, rt.y, 2.5, '#46c28e');
  for (const rt of Object.values(game.runtime.drones)) if (rt.phase === 'outbound' || rt.phase === 'inbound') dot(rt.x, rt.y, 2.5, '#8ecae6');

  // Jugador
  const p = state.player;
  ctx.save();
  ctx.translate(p.x * sx, p.y * sy);
  ctx.rotate(p.angle);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, -4);
  ctx.lineTo(-2, 0);
  ctx.lineTo(-4, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Zona visible
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.strokeRect(camera.x * sx, camera.y * sy, camera.viewW * sx, camera.viewH * sy);
}
