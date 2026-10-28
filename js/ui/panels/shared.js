// Fragmentos HTML reutilizables por los paneles.

import { escapeHtml, formatMoney } from '../../core/util.js';

export const attr = escapeHtml;

/** Botón de compra: deshabilitado visualmente (pero con tooltip) si no se puede comprar. */
export function buyButton({ action, id, status, label, price }) {
  const ok = status.state === 'available';
  const maxed = status.state === 'maxed';
  const text = maxed ? '✓ Máximo' : status.state === 'locked' ? `🔒 ${status.reason ?? ''}` : `${label}<small>${formatMoney(price)}</small>`;
  const cls = ok ? 'btn btn-primary' : maxed ? 'btn is-maxed' : 'btn is-disabled';
  const reason = maxed ? '' : status.reason ?? '';
  return `<button class="${cls} btn-buy" data-action="${action}" data-id="${attr(id)}" aria-disabled="${ok ? 'false' : 'true'}"
    data-reason="${attr(reason)}" ${reason ? `data-tip="${attr(reason)}"` : ''}>${text}</button>`;
}

export function pips(level, max) {
  if (max > 10) return '';
  let html = '<div class="pips" aria-hidden="true">';
  for (let i = 0; i < max; i++) html += `<i class="${i < level ? 'on' : ''}"></i>`;
  return `${html}</div>`;
}

export function chip(text, tip = '') {
  return `<span class="chip" ${tip ? `data-tip="${attr(tip)}"` : ''}>${text}</span>`;
}

export function emptyState(icon, title, text) {
  return `<div class="empty"><div class="empty-icon" aria-hidden="true">${icon}</div><b>${title}</b><p>${text}</p></div>`;
}

/** Velocidad en km/h "de ciudad" para mostrar al jugador. */
export const toKmh = (pxPerSecond) => Math.round(pxPerSecond * 0.36);
