// Ordenador de la oficina: es el único sitio desde el que se gestiona la empresa (pedidos, mejoras, equipo,
// empresa y logros). Se usa en persona, con E junto a la mesa de la oficina, y se muestra como una pantalla
// de ordenador dentro de una ventana modal (el juego queda en pausa mientras estás sentado delante).

import { UPGRADES } from '../config/upgrades.js';
import { WORKER_TYPES, WORKER_ORDER } from '../config/workers.js';
import { escapeHtml, formatInt, formatMoney } from '../core/util.js';
import { getCompany } from '../systems/branding.js';
import { formatClock } from '../systems/dayCycle.js';
import { getUpgradeStatus, isUpgradeReady } from '../systems/upgrades.js';
import { hireStatus } from '../systems/workers.js';
import { onAction, setHtml, setText } from './dom.js';
import { renderOrdersPanel } from './panels/ordersPanel.js';
import { renderUpgradesPanel, upgradesUiState } from './panels/upgradesPanel.js';
import { renderTeamPanel, teamUiState } from './panels/teamPanel.js';
import { renderBusinessPanel } from './panels/businessPanel.js';
import { renderGoalsPanel } from './panels/goalsPanel.js';
import { chip } from './panels/shared.js';

/** Aplicaciones del escritorio. Las teclas 1-5 abren las cinco de gestión, en este orden. */
const APPS = [
  { id: 'home', icon: '🏠', label: 'Inicio', hint: 'Resumen del día', render: (game, pc) => renderHome(game, pc) },
  { id: 'orders', icon: '📦', label: 'Pedidos', hint: 'Productos, destinos y plazos', render: renderOrdersPanel },
  { id: 'upgrades', icon: '🔧', label: 'Mejoras', hint: 'Vehículos, almacén, empresa y drones', render: renderUpgradesPanel },
  { id: 'team', icon: '👥', label: 'Equipo', hint: 'Contratar y gestionar la plantilla', render: renderTeamPanel },
  { id: 'business', icon: '📊', label: 'Empresa', hint: 'Finanzas, marca y barrios', render: renderBusinessPanel },
  { id: 'goals', icon: '🏆', label: 'Logros', hint: 'Misiones y logros', render: renderGoalsPanel },
];

export class OfficeComputer {
  constructor({ game, sfx, onRename = null, onBrand = null }) {
    this.game = game;
    this.sfx = sfx;
    this.onRename = onRename;
    this.onBrand = onBrand;
    this.active = 'home';
    this.highlightTab = null;
    this.timer = 0;
    this.el = null;
    this.onKey = (e) => this.handleKey(e);
  }

  get isOpen() {
    return this.el !== null;
  }

  /** Marco fijo de la pantalla; el contenido lo rellena refresh(). */
  shellHtml() {
    return `
      <div class="pc">
        <div class="pc-monitor">
          <div class="pc-screen">
            <header class="pc-titlebar">
              <span class="pc-title"><span aria-hidden="true">🖥️</span> <b data-pc-company></b><span class="pc-sub"> · Gestión</span></span>
              <span class="pc-clock" data-pc-clock></span>
              <button type="button" class="pc-power" data-modal-action="close" aria-label="Apagar el ordenador y levantarte" data-tip="Levantarte (Esc)">⏻</button>
            </header>
            <div class="pc-body">
              <nav class="pc-apps" data-pc-apps role="tablist" aria-label="Aplicaciones"></nav>
              <section class="pc-window" data-pc-panel role="tabpanel" tabindex="-1"></section>
            </div>
            <footer class="pc-taskbar" data-pc-status></footer>
          </div>
        </div>
        <div class="pc-stand" aria-hidden="true"></div>
      </div>`;
  }

  /** Conecta la pantalla recién abierta (el contenedor de la ventana modal). */
  attach(root, appId = null) {
    this.el = {
      root,
      apps: root.querySelector('[data-pc-apps]'),
      panel: root.querySelector('[data-pc-panel]'),
      company: root.querySelector('[data-pc-company]'),
      clock: root.querySelector('[data-pc-clock]'),
      status: root.querySelector('[data-pc-status]'),
    };
    if (appId && APPS.some((a) => a.id === appId)) this.active = appId;
    onAction(this.el.panel, (action, data) => this.handle(action, data));
    this.el.apps.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) this.select(btn.dataset.tab);
    });
    window.addEventListener('keydown', this.onKey);
    this.timer = 0;
    this.refresh();
  }

  /** Se llama al cerrar la ventana. */
  detach() {
    window.removeEventListener('keydown', this.onKey);
    this.el = null;
  }

  handleKey(e) {
    if (!this.el || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const target = e.target;
    if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    if (/^Digit[1-5]$/.test(e.code)) {
      e.preventDefault();
      this.select(APPS[Number(e.code.slice(5))].id);
    } else if (e.code === 'Digit0' || e.code === 'Home') {
      e.preventDefault();
      this.select('home');
    }
  }

  select(id) {
    if (!APPS.some((a) => a.id === id) || this.active === id) return;
    this.active = id;
    this.sfx.play('click');
    if (this.el) this.el.panel.scrollTop = 0;
    this.refresh();
  }

  handle(action, data) {
    const { game } = this;
    switch (action) {
      case 'blocked':
        game.events.emit('notify', { type: 'error', icon: '⛔', title: data.reason, text: '' });
        game.events.emit('actionFailed', { ok: false, reason: data.reason });
        break;
      case 'open-app': this.select(data.id); return;
      case 'load': game.loadOrder(data.id); break;
      case 'unload': game.unloadOrder(data.id); break;
      case 'reject': game.rejectOrder(data.id); break;
      case 'track': game.trackOrder(data.id); break;
      case 'subtab': upgradesUiState.category = data.id; this.el.panel.scrollTop = 0; this.sfx.play('click'); break;
      case 'buy-upgrade': game.buyUpgrade(data.id); break;
      case 'buy-vehicle': game.buyVehicle(data.id); break;
      case 'drive': game.driveVehicle(data.id); break;
      case 'hire': game.hireWorker(data.id); break;
      case 'cycle-vehicle': game.cycleWorkerVehicle(data.id); break;
      case 'rename-worker': this.onRename?.(data.id); break;
      case 'edit-brand': this.onBrand?.(); break;
      case 'buy-drone': game.buyDrone(data.id); break;
      case 'unlock-zone': game.unlockZone(data.id); break;
      case 'fire':
        if (teamUiState.firing === data.id && performance.now() < teamUiState.firingUntil) {
          teamUiState.firing = null;
          game.fireWorker(data.id);
        } else {
          teamUiState.firing = data.id;
          teamUiState.firingUntil = performance.now() + 3000;
          this.sfx.play('click');
        }
        break;
      default: break;
    }
    this.refresh();
  }

  /** Avisos de las aplicaciones: pedidos listos y compras o contrataciones posibles. */
  badges() {
    const { game } = this;
    const { state } = game;
    const ready = state.orders.filter((o) => o.status === 'pending' && !o.assignedTo && o.prep <= 0).length;
    const upgradeReady = Object.values(UPGRADES).some((u) => isUpgradeReady(getUpgradeStatus(game, u)));
    const hireReady = WORKER_ORDER.some((id) => state.level >= WORKER_TYPES[id].unlockLevel && hireStatus(game, id).state === 'available');
    return { home: '', orders: ready || '', upgrades: upgradeReady ? '●' : '', team: hireReady ? '●' : '', business: '', goals: '' };
  }

  refresh() {
    if (!this.el) return;
    const { game } = this;
    const { state } = game;
    const badges = this.badges();
    this.badgeCache = badges;
    const highlight = this.highlightTab;
    setHtml(this.el.apps, APPS.map((a, i) => {
      const active = a.id === this.active;
      const keyHint = i === 0 ? '0' : String(i);
      return `<button type="button" role="tab" class="pc-app ${active ? 'is-active' : ''} ${highlight === a.id ? 'is-highlight' : ''}" data-tab="${a.id}"
        aria-selected="${active}" data-tip="${a.label} (${keyHint})">
        <span class="pc-app-icon" aria-hidden="true">${a.icon}</span><span class="pc-app-label">${a.label}</span>
        ${badges[a.id] ? `<i class="badge-dot ${a.id === 'orders' ? 'is-count' : ''}">${badges[a.id]}</i>` : ''}</button>`;
    }).join(''));
    const app = APPS.find((a) => a.id === this.active) ?? APPS[0];
    setHtml(this.el.panel, app.render(game, this));
    setText(this.el.company, getCompany(state).name);
    setText(this.el.clock, `Día ${state.day} · ${formatClock(state)}`);
    setHtml(this.el.status, `
      <span>💶 <b>${formatMoney(state.money)}</b></span>
      <span>⭐ Nivel <b>${state.level}</b></span>
      <span>📦 <b>${formatInt(state.orders.length)}</b> pedidos</span>
      <span class="pc-hint"><kbd>1</kbd>–<kbd>5</kbd> aplicaciones · <kbd>Esc</kbd> levantarte</span>`);
  }

  tick(dt) {
    if (!this.el) return;
    this.timer += dt;
    if (this.timer >= 0.25) {
      this.timer = 0;
      this.refresh();
    }
  }
}

/** Escritorio: resumen rápido y accesos directos a las aplicaciones. */
function renderHome(game, pc) {
  const { state } = game;
  const waiting = state.orders.filter((o) => o.prep > 0).length;
  const ready = state.orders.filter((o) => o.prep <= 0 && !o.assignedTo).length;
  const badges = pc.badgeCache ?? {};
  const kpi = (icon, label, value) => `
    <div class="kpi"><span class="kpi-icon" aria-hidden="true">${icon}</span><div><small>${label}</small><b>${value}</b></div></div>`;
  return `
    <div class="panel-head"><h3>👋 ${escapeHtml(getCompany(state).name)}</h3>
      <div class="chips">${chip(`Día ${state.day}`)}${chip(`Saldo ${formatMoney(state.money)}`)}</div></div>
    <div class="kpis">
      ${kpi('🧺', 'Pedidos por preparar', formatInt(waiting))}
      ${kpi('🏷️', 'Cajas listas en expedición', formatInt(ready))}
      ${kpi('👥', 'Empleados', formatInt(state.workers.length))}
      ${kpi('✅', 'Entregas totales', formatInt(state.stats.deliveries))}
    </div>
    <h4 class="section-title">Aplicaciones</h4>
    <div class="pc-tiles">
      ${APPS.slice(1).map((a, i) => `
        <button type="button" class="pc-tile ${pc.highlightTab === a.id ? 'is-highlight' : ''}" data-action="open-app" data-id="${a.id}">
          <span class="pc-tile-icon" aria-hidden="true">${a.icon}</span>
          <b>${a.label}</b><small>${a.hint}</small><kbd aria-hidden="true">${i + 1}</kbd>
          ${badges[a.id] ? `<i class="badge-dot ${a.id === 'orders' ? 'is-count' : ''}">${badges[a.id]}</i>` : ''}
        </button>`).join('')}
    </div>`;
}
