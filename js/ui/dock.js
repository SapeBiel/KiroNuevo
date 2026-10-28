// Panel lateral con pestañas (Pedidos, Mejoras, Equipo, Empresa, Logros).

import { UPGRADES } from '../config/upgrades.js';
import { WORKER_TYPES, WORKER_ORDER } from '../config/workers.js';
import { setHtml, onAction } from './dom.js';
import { renderOrdersPanel } from './panels/ordersPanel.js';
import { renderUpgradesPanel, upgradesUiState } from './panels/upgradesPanel.js';
import { renderTeamPanel, teamUiState } from './panels/teamPanel.js';
import { renderBusinessPanel } from './panels/businessPanel.js';
import { renderGoalsPanel } from './panels/goalsPanel.js';
import { getUpgradeStatus } from '../systems/upgrades.js';
import { hireStatus } from '../systems/workers.js';

const TABS = [
  { id: 'orders', icon: '📦', label: 'Pedidos', render: renderOrdersPanel },
  { id: 'upgrades', icon: '🔧', label: 'Mejoras', render: renderUpgradesPanel },
  { id: 'team', icon: '👥', label: 'Equipo', render: renderTeamPanel },
  { id: 'business', icon: '📊', label: 'Empresa', render: renderBusinessPanel },
  { id: 'goals', icon: '🏆', label: 'Logros', render: renderGoalsPanel },
];

export class Dock {
  constructor({ root, tabsEl, panelEl, game, sfx, onToggle, onRename = null }) {
    this.onRename = onRename;
    this.root = root;
    this.tabsEl = tabsEl;
    this.panelEl = panelEl;
    this.game = game;
    this.sfx = sfx;
    this.onToggle = onToggle;
    this.active = 'orders';
    this.open = window.innerWidth > 900;
    this.timer = 0;
    this.highlightTab = null;

    onAction(panelEl, (action, data) => this.handle(action, data));
    tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (btn) this.select(btn.dataset.tab);
      if (e.target.closest('[data-dock-toggle]')) this.toggle();
    });
    this.applyOpen();
    this.refresh();
  }

  applyOpen() {
    this.root.classList.toggle('is-collapsed', !this.open);
    this.onToggle?.(this.open);
  }

  toggle() {
    this.open = !this.open;
    this.applyOpen();
    this.refresh();
  }

  select(id) {
    if (this.active === id && this.open) { this.toggle(); return; }
    this.active = id;
    this.open = true;
    this.applyOpen();
    this.sfx.play('click');
    this.panelEl.scrollTop = 0;
    this.refresh();
  }

  selectByIndex(index) {
    const tab = TABS[index];
    if (!tab) return;
    if (this.active === tab.id && this.open) return;
    this.select(tab.id);
  }

  collapse() {
    if (this.open && window.innerWidth <= 900) { this.open = false; this.applyOpen(); return true; }
    return false;
  }

  handle(action, data) {
    const { game } = this;
    switch (action) {
      case 'blocked':
        game.events.emit('notify', { type: 'error', icon: '⛔', title: data.reason, text: '' });
        game.events.emit('actionFailed', { ok: false, reason: data.reason });
        break;
      case 'load': game.loadOrder(data.id); break;
      case 'unload': game.unloadOrder(data.id); break;
      case 'reject': game.rejectOrder(data.id); break;
      case 'track': game.trackOrder(data.id); break;
      case 'subtab': upgradesUiState.category = data.id; this.panelEl.scrollTop = 0; this.sfx.play('click'); break;
      case 'buy-upgrade': game.buyUpgrade(data.id); break;
      case 'buy-vehicle': game.buyVehicle(data.id); break;
      case 'drive': game.driveVehicle(data.id); break;
      case 'hire': game.hireWorker(data.id); break;
      case 'cycle-vehicle': game.cycleWorkerVehicle(data.id); break;
      case 'rename-worker': this.onRename?.(data.id); break;
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

  badges() {
    const { game } = this;
    const { state } = game;
    const ready = state.orders.filter((o) => o.status === 'pending' && !o.assignedTo && o.prep <= 0).length;
    const upgradeReady = Object.values(UPGRADES).some((u) => getUpgradeStatus(game, u).state === 'available');
    const hireReady = WORKER_ORDER.some((id) => state.level >= WORKER_TYPES[id].unlockLevel && hireStatus(game, id).state === 'available');
    return { orders: ready || '', upgrades: upgradeReady ? '●' : '', team: hireReady ? '●' : '', business: '', goals: '' };
  }

  refresh() {
    const badges = this.badges();
    const highlight = this.highlightTab;
    setHtml(this.tabsEl, `
      <button class="dock-toggle" data-dock-toggle aria-label="${this.open ? 'Ocultar panel' : 'Mostrar panel'}" data-tip="${this.open ? 'Ocultar panel' : 'Mostrar panel'}">${this.open ? '»' : '«'}</button>
      ${TABS.map((t, i) => `<button role="tab" class="dock-tab ${t.id === this.active && this.open ? 'is-active' : ''} ${highlight === t.id ? 'is-highlight' : ''}" data-tab="${t.id}"
        aria-selected="${t.id === this.active && this.open}" data-tip="${t.label} (${i + 1})">
        <span class="dock-icon" aria-hidden="true">${t.icon}</span><span class="dock-label">${t.label}</span>
        ${badges[t.id] ? `<i class="badge-dot ${t.id === 'orders' ? 'is-count' : ''}">${badges[t.id]}</i>` : ''}</button>`).join('')}`);
    if (!this.open) return;
    const tab = TABS.find((t) => t.id === this.active);
    setHtml(this.panelEl, tab.render(this.game));
  }

  tick(dt) {
    this.timer += dt;
    if (this.timer >= 0.25) {
      this.timer = 0;
      this.refresh();
    }
  }
}
