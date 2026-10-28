// Sprites dibujados por código: vehículos, drones y marcadores.

export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

/** Vehículo visto desde arriba, orientado hacia +x. */
export function drawVehicle(ctx, type, x, y, angle, { braking = false, lightsOn = false, alpha = 1 } = {}) {
  const L = type.length;
  const W = type.width;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Sombra
  ctx.fillStyle = 'rgba(10,15,30,0.28)';
  roundRect(ctx, -L / 2 + 3, -W / 2 + 4, L, W, 5);
  ctx.fill();

  // Ruedas
  ctx.fillStyle = '#1b1f27';
  for (const wx of [-L * 0.3, L * 0.3]) {
    ctx.fillRect(wx - 5, -W / 2 - 1.5, 10, 3.5);
    ctx.fillRect(wx - 5, W / 2 - 2, 10, 3.5);
  }

  // Carrocería
  const body = type.color;
  ctx.fillStyle = body;
  roundRect(ctx, -L / 2, -W / 2, L, W, 5);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = shade(body, -55);
  ctx.stroke();

  if (type.shape === 'truck') {
    // Caja de carga larga + cabina
    ctx.fillStyle = shade(body, 28);
    roundRect(ctx, -L / 2 + 2, -W / 2 + 2, L * 0.68, W - 4, 3);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(-L / 2 + 2 + (L * 0.68 * i) / 5, -W / 2 + 3);
      ctx.lineTo(-L / 2 + 2 + (L * 0.68 * i) / 5, W / 2 - 3);
      ctx.stroke();
    }
    ctx.fillStyle = shade(body, -20);
    roundRect(ctx, L * 0.2, -W / 2 + 2, L * 0.28, W - 4, 3);
    ctx.fill();
    ctx.fillStyle = '#9fd3ff';
    roundRect(ctx, L * 0.34, -W / 2 + 4, L * 0.1, W - 8, 2);
    ctx.fill();
  } else {
    // Techo + parabrisas
    ctx.fillStyle = shade(body, 30);
    roundRect(ctx, -L / 2 + 2, -W / 2 + 2, L * 0.58, W - 4, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(ctx, -L / 2 + 6, -W / 2 + 5, L * 0.18, W - 10, 2);
    ctx.fill();
    ctx.fillStyle = '#a8dcff';
    roundRect(ctx, L * 0.14, -W / 2 + 3, L * 0.16, W - 6, 3);
    ctx.fill();
    ctx.fillStyle = shade(body, -12);
    roundRect(ctx, L * 0.32, -W / 2 + 3, L * 0.16, W - 6, 3);
    ctx.fill();
    if (type.shape === 'electric') {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-L * 0.12, -5);
      ctx.lineTo(-L * 0.02, -1);
      ctx.lineTo(-L * 0.08, -1);
      ctx.lineTo(-L * 0.14, 5);
      ctx.lineTo(-L * 0.22, 0.5);
      ctx.lineTo(-L * 0.16, 0.5);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Faros y luces traseras
  ctx.fillStyle = lightsOn ? '#fff7c2' : '#f4f1d0';
  ctx.fillRect(L / 2 - 3, -W / 2 + 2, 3, 4);
  ctx.fillRect(L / 2 - 3, W / 2 - 6, 3, 4);
  ctx.fillStyle = braking ? '#ff3b3b' : '#a31d1d';
  ctx.fillRect(-L / 2, -W / 2 + 2, 2.5, 4);
  ctx.fillRect(-L / 2, W / 2 - 6, 2.5, 4);
  ctx.restore();
}

/** Dron visto desde arriba. "height" desplaza el cuerpo respecto a su sombra. */
export function drawDrone(ctx, type, x, y, time, { carrying = false, height = 14, lightsOn = false } = {}) {
  // Sombra en el suelo
  ctx.fillStyle = 'rgba(10,15,30,0.22)';
  ctx.beginPath();
  ctx.ellipse(x + 4, y + height + 6, 11, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  const cy = y - height * 0.4;
  ctx.save();
  ctx.translate(x, cy);
  const arm = 11;
  ctx.strokeStyle = '#2b303b';
  ctx.lineWidth = 2.2;
  for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dx * arm, dy * arm);
    ctx.stroke();
  }
  for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const rx = dx * arm;
    const ry = dy * arm;
    ctx.fillStyle = 'rgba(210,225,240,0.45)';
    ctx.beginPath();
    ctx.arc(rx, ry, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1f2430';
    ctx.lineWidth = 1.4;
    const a = time * 40 + dx * 1.3 + dy;
    ctx.beginPath();
    ctx.moveTo(rx - Math.cos(a) * 7, ry - Math.sin(a) * 7);
    ctx.lineTo(rx + Math.cos(a) * 7, ry + Math.sin(a) * 7);
    ctx.stroke();
  }
  ctx.fillStyle = type.color;
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#1f2430';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = lightsOn || Math.floor(time * 3) % 2 === 0 ? '#ff4d4d' : '#7a1f1f';
  ctx.beginPath();
  ctx.arc(0, -1, 1.8, 0, Math.PI * 2);
  ctx.fill();
  if (carrying) {
    ctx.fillStyle = '#c99a62';
    ctx.fillRect(-4, 4, 8, 7);
    ctx.fillStyle = '#e8c48e';
    ctx.fillRect(-4, 6.5, 8, 1.5);
  }
  ctx.restore();
}

/** Marcador en forma de gota con un icono dentro. */
export function drawPin(ctx, x, y, { color = '#ff7b00', size = 1, icon = '📦', pulse = 0 } = {}) {
  const s = size;
  ctx.save();
  ctx.translate(x, y + pulse);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(10,15,30,0.3)';
  ctx.beginPath();
  ctx.ellipse(0, 4, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.bezierCurveTo(-14, -12, -13, -30, 0, -30);
  ctx.bezierCurveTo(13, -30, 14, -12, 0, 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.arc(0, -17, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '12px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#222';
  ctx.fillText(icon, 0, -16.5);
  ctx.restore();
}

export function drawOutlinedText(ctx, text, x, y, { size = 12, color = '#fff', stroke = 'rgba(10,15,30,0.85)', align = 'center', weight = '700' } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px "Segoe UI","Trebuchet MS",system-ui,sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size / 3.5);
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
