// Avisos temporales (toasts) y banner de subida de nivel.

import { escapeHtml } from '../core/util.js';

const MAX_TOASTS = 5;

export class Notifications {
  constructor(root, bannerRoot) {
    this.root = root;
    this.bannerRoot = bannerRoot;
    this.last = { key: '', time: 0, element: null };
  }

  push({ type = 'info', icon = '💬', title = '', text = '', duration = 4600 }) {
    const key = `${type}|${title}|${text}`;
    const now = performance.now();
    // Evita apilar el mismo aviso repetido en pocos segundos
    if (this.last.key === key && now - this.last.time < 1500 && this.last.element?.isConnected) {
      this.last.time = now;
      this.last.element.classList.remove('is-pulse');
      void this.last.element.offsetWidth;
      this.last.element.classList.add('is-pulse');
      return;
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-icon" aria-hidden="true">${escapeHtml(icon)}</span>
      <div class="toast-body"><b>${escapeHtml(title)}</b>${text ? `<p>${escapeHtml(text)}</p>` : ''}</div>`;
    this.root.appendChild(el);
    this.last = { key, time: now, element: el };
    while (this.root.children.length > MAX_TOASTS) this.root.firstElementChild.remove();
    window.setTimeout(() => {
      el.classList.add('is-leaving');
      window.setTimeout(() => el.remove(), 350);
    }, duration);
  }

  banner({ title, subtitle = '', lines = [], icon = '🏆' }) {
    const el = document.createElement('div');
    el.className = 'banner';
    el.setAttribute('role', 'status');
    el.innerHTML = `<div class="banner-icon" aria-hidden="true">${escapeHtml(icon)}</div>
      <div><b>${escapeHtml(title)}</b>${subtitle ? `<span>${escapeHtml(subtitle)}</span>` : ''}
      ${lines.length ? `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : ''}</div>`;
    this.bannerRoot.appendChild(el);
    window.setTimeout(() => el.classList.add('is-leaving'), 4200);
    window.setTimeout(() => el.remove(), 4700);
  }
}
