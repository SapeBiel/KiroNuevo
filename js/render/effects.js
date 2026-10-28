// Partículas y textos flotantes (confeti, humo, chispas, cajas voladoras, cifras de dinero).

import { drawOutlinedText } from './sprites.js';

const CONFETTI_COLORS = ['#ffb703', '#fb8500', '#4cc9f0', '#90be6d', '#f72585', '#ffffff'];

export class Effects {
  constructor() {
    this.particles = [];
    this.shake = 0;
  }

  add(particle) {
    if (this.particles.length > 600) this.particles.shift();
    this.particles.push({ vx: 0, vy: 0, gravity: 0, drag: 0, rotation: 0, spin: 0, size: 4, color: '#fff', ...particle, age: 0 });
  }

  confetti(x, y, count = 26, power = 1) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (60 + Math.random() * 170) * power;
      this.add({
        type: 'confetti', x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 80,
        gravity: 260, drag: 1.4, life: 0.9 + Math.random() * 0.7, size: 3 + Math.random() * 4,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], rotation: Math.random() * 6, spin: (Math.random() - 0.5) * 14, layer: 'air',
      });
    }
  }

  smoke(x, y, vx = 0, vy = 0) {
    this.add({ type: 'smoke', x, y, vx: vx + (Math.random() - 0.5) * 10, vy: vy + (Math.random() - 0.5) * 10, life: 0.7, size: 3 + Math.random() * 2, layer: 'ground' });
  }

  sparks(x, y, count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 140;
      this.add({ type: 'spark', x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, drag: 3, life: 0.35 + Math.random() * 0.2, size: 2, color: '#ffd166', layer: 'air' });
    }
  }

  text(x, y, text, { color = '#7CFC9A', size = 22, life = 1.5, rise = 46 } = {}) {
    this.add({ type: 'text', x, y, vy: -rise, drag: 1.2, life, text, color, size, layer: 'air' });
  }

  ring(x, y, color = '#ffffff', radius = 120) {
    this.add({ type: 'ring', x, y, life: 0.9, size: radius, color, layer: 'ground' });
  }

  /** Caja que vuela desde un punto hasta un objetivo que puede moverse (la furgoneta). */
  box(fromX, fromY, getTarget, delay = 0) {
    this.add({ type: 'box', x: fromX, y: fromY, fromX, fromY, getTarget, life: 0.55, delay, layer: 'air' });
  }

  addShake(amount) {
    this.shake = Math.min(10, this.shake + amount);
  }

  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 18);
    for (const p of this.particles) {
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.age += dt;
      if (p.type === 'box') {
        const t = Math.min(1, p.age / p.life);
        const target = p.getTarget();
        const ease = t * t * (3 - 2 * t);
        p.x = p.fromX + (target.x - p.fromX) * ease;
        p.y = p.fromY + (target.y - p.fromY) * ease - Math.sin(t * Math.PI) * 38;
        continue;
      }
      p.vy += p.gravity * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k; p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life || p.delay > 0);
  }

  draw(ctx, layer) {
    for (const p of this.particles) {
      if (p.layer !== layer || p.delay > 0) continue;
      const t = p.age / p.life;
      switch (p.type) {
        case 'confetti':
          ctx.save();
          ctx.globalAlpha = 1 - t * t;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          break;
        case 'smoke':
          ctx.fillStyle = `rgba(210,215,225,${0.32 * (1 - t)})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size + t * 7, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'spark':
          ctx.fillStyle = p.color;
          ctx.globalAlpha = 1 - t;
          ctx.fillRect(p.x - 1, p.y - 1, p.size, p.size);
          ctx.globalAlpha = 1;
          break;
        case 'text':
          ctx.save();
          ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
          drawOutlinedText(ctx, p.text, p.x, p.y, { size: p.size, color: p.color, weight: '800' });
          ctx.restore();
          break;
        case 'ring':
          ctx.save();
          ctx.globalAlpha = 0.8 * (1 - t);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 5 * (1 - t) + 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (0.2 + 0.8 * t), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          break;
        case 'box':
          ctx.fillStyle = '#c99a62';
          ctx.fillRect(p.x - 5, p.y - 5, 10, 10);
          ctx.fillStyle = '#e8c48e';
          ctx.fillRect(p.x - 5, p.y - 1, 10, 2);
          ctx.strokeStyle = '#7d5430';
          ctx.lineWidth = 1;
          ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
          break;
        default:
          break;
      }
    }
  }
}
