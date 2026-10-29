// Vista previa (de lado) de una furgoneta con la imagen de la empresa, para la ventana de personalización.

import { drawBrandMark, shade } from '../render/sprites.js';
import { brandTitle, contrastText } from '../systems/branding.js';

const FONT = '"Segoe UI","Trebuchet MS",system-ui,sans-serif';

function fitFont(ctx, text, weight, size, maxWidth) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > 8 && ctx.measureText(text).width > maxWidth) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
}

/** Carrocería de perfil: furgón con la cabina a la derecha (mirando hacia la derecha). */
function bodyPath(ctx, base) {
  ctx.beginPath();
  ctx.moveTo(30, 54);
  ctx.quadraticCurveTo(30, 40, 44, 40);
  ctx.lineTo(258, 40);
  ctx.quadraticCurveTo(266, 40, 271, 46);
  ctx.lineTo(302, 84);
  ctx.lineTo(324, 92);
  ctx.quadraticCurveTo(336, 96, 336, 110);
  ctx.lineTo(336, base);
  ctx.lineTo(30, base);
  ctx.closePath();
}

/**
 * Dibuja la vista previa. Si la flota no lleva los colores de la empresa, la carrocería usa
 * `modelColor` (la pintura de serie del vehículo actual) y solo cambian el nombre y el logotipo.
 */
export function drawBrandPreview(canvas, company, modelColor = '#f4b942') {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const base = h - 50;
  ctx.clearRect(0, 0, w, h);

  // Fondo: cielo y calzada
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#9fd2f7');
  sky.addColorStop(1, '#e4f3ff');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#4b5263';
  ctx.fillRect(0, h - 36, w, 36);
  ctx.fillStyle = '#f4f1de';
  for (let x = 10; x < w; x += 46) ctx.fillRect(x, h - 14, 24, 3);

  const paint = company.fleetColors ? company.primary : modelColor;
  const stripe = company.fleetColors ? company.secondary : '#2b2f38';
  const detail = company.fleetColors ? company.accent : '#fb8500';
  const ink = contrastText(paint);

  // Sombra
  ctx.fillStyle = 'rgba(10,15,30,0.3)';
  ctx.beginPath();
  ctx.ellipse(184, base + 16, 160, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Carrocería con franjas recortadas a su silueta
  ctx.save();
  bodyPath(ctx, base);
  ctx.fillStyle = paint;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = stripe;
  ctx.beginPath();
  ctx.moveTo(0, base - 30);
  ctx.bezierCurveTo(110, base - 18, 220, base - 52, 340, base - 66);
  ctx.lineTo(340, base - 50);
  ctx.bezierCurveTo(220, base - 36, 110, base - 2, 0, base - 12);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = detail;
  ctx.beginPath();
  ctx.moveTo(0, base - 8);
  ctx.bezierCurveTo(110, base + 2, 220, base - 30, 340, base - 44);
  ctx.lineTo(340, base - 36);
  ctx.bezierCurveTo(220, base - 22, 110, base + 8, 0, base);
  ctx.closePath();
  ctx.fill();
  // Brillo suave en el techo
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(30, 40, 240, 8);
  ctx.restore();
  bodyPath(ctx, base);
  ctx.lineWidth = 2;
  ctx.strokeStyle = shade(paint, -60);
  ctx.stroke();

  // Ventanilla de la cabina, puerta y faro
  ctx.fillStyle = '#1d2a38';
  ctx.beginPath();
  ctx.moveTo(268, 52);
  ctx.lineTo(296, 86);
  ctx.lineTo(268, 86);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(262, 46);
  ctx.lineTo(262, base - 2);
  ctx.stroke();
  ctx.fillStyle = '#fff4c2';
  ctx.fillRect(330, 102, 6, 9);
  ctx.fillStyle = '#2b2f38';
  ctx.fillRect(326, base - 10, 12, 8);

  // Rotulación: logotipo, nombre y eslogan
  drawBrandMark(ctx, 44, 54, 38, company);
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const title = brandTitle(company);
  fitFont(ctx, title, 900, 24, 160);
  ctx.fillText(title, 92, 66);
  const tagline = company.slogan || 'Mensajería y reparto';
  fitFont(ctx, tagline, 700, 13, 160);
  ctx.globalAlpha = 0.9;
  ctx.fillText(tagline, 92, 86);
  ctx.globalAlpha = 1;

  // Ruedas
  for (const x of [86, 282]) {
    ctx.fillStyle = '#16181d';
    ctx.beginPath();
    ctx.arc(x, base, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c6ccd4';
    ctx.beginPath();
    ctx.arc(x, base, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4b5263';
    ctx.beginPath();
    ctx.arc(x, base, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
