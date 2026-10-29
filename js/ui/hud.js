// HUD: barra superior, tarjeta de carga, botón contextual, racha y tutorial.

import { DAY_LENGTH, MAX_LEVEL, STREAK_BONUS_PER_STEP, STREAK_MAX_STEPS, STREAK_WINDOW, METERS_PER_TILE, TILE } from '../config/constants.js';
import { levelTitle, xpToNextLevel } from '../config/levels.js';
import { TUTORIAL_STEPS } from '../config/tutorial.js';
import { ORDER_KINDS } from '../config/packages.js';
import { getVehicleType } from '../config/vehicles.js';
import { distance, formatDuration, formatInt, formatMoney, escapeHtml, pad } from '../core/util.js';
import { clockHour, formatClock } from '../systems/dayCycle.js';
import { incomePerMinute } from '../systems/economy.js';
import { cargoSlotsUsed, getOrder, playerCapacity } from '../systems/orders.js';
import { $, bar, setHtml, setStyle, setText } from './dom.js';
import { HAND_CAPACITY, ITEM_AT_LABELS, productInfo } from '../config/products.js';
import { handsBulk, heldBox, heldItems, isPlayerPicking } from '../systems/handling.js';
import { BOOST_MIN_TIME, getDrift } from '../systems/playerVehicle.js';

export class Hud {
  constructor({ game, getViewMode = () => '2d', onInteract, onSkipTutorial, onAckTutorial }) {
    this.game = game;
    this.getViewMode = getViewMode;
    this.pointerLocked = false;
    this.displayedMoney = game.state.money;
    this.timer = 0;
    this.el = {
      money: $('#hud-money'), income: $('#hud-income'), level: $('#hud-level'), title: $('#hud-title'),
      xpBar: $('#hud-xp-bar'), xpText: $('#hud-xp-text'), rep: $('#hud-rep'), repBar: $('#hud-rep-bar'),
      orders: $('#hud-orders'), clock: $('#hud-clock'), clockIcon: $('#hud-clock-icon'), day: $('#hud-day'),
      dayBar: $('#hud-day-bar'), cargo: $('#cargo-card'), context: $('#context-action'), streak: $('#streak-chip'),
      tutorial: $('#tutorial-card'), contextLabel: $('#context-label'),
      drift: $('#drift-meter'), driftLabel: $('#drift-label'), driftBar: $('#drift-bar'),
      hands: $('#hands-card'), crosshair: $('#crosshair'), lookHint: $('#look-hint'),
    };
    this.onSkipTutorial = onSkipTutorial;
    this.onAckTutorial = onAckTutorial;
    this.el.context.addEventListener('click', () => onInteract());
    this.el.tutorial.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tutorial]');
      if (!btn) return;
      if (btn.dataset.tutorial === 'skip') this.onSkipTutorial();
      else if (btn.dataset.tutorial === 'ack') this.onAckTutorial();
    });
    this.updateStatic();
  }

  update(dt) {
    const { game } = this;
    // El dinero sube y baja con una pequeña animación
    const target = game.state.money;
    const diff = target - this.displayedMoney;
    this.displayedMoney = Math.abs(diff) < 1 ? target : this.displayedMoney + diff * Math.min(1, dt * 9);
    setText(this.el.money, formatMoney(this.displayedMoney));

    const ctx = game.getContextAction();
    const show = Boolean(ctx) && !game.paused;
    this.el.context.classList.toggle('is-visible', show);
    if (show) setText(this.el.contextLabel, ctx.label);
    this.el.context.dataset.kind = ctx?.kind ?? '';
    this.el.context.classList.toggle('is-info', Boolean(ctx) && ctx.ok === false);
    // Mira y aviso de captura del ratón (solo a pie en la vista 3D)
    const firstPerson = game.onFoot && this.getViewMode() === '3d' && !game.paused;
    this.el.crosshair?.classList.toggle('is-visible', firstPerson);
    this.el.crosshair?.classList.toggle('is-target', firstPerson && Boolean(ctx) && ctx.ok !== false);
    this.el.lookHint?.classList.toggle('is-visible', firstPerson && !this.pointerLocked && !document.body.classList.contains('has-touch'));
    this.updateDrift();

    this.timer += dt;
    if (this.timer >= 0.2) {
      this.timer = 0;
      this.updateStatic();
    }
  }

  /** Indicador de derrape: se llena hasta el turbo; durante el turbo muestra el tiempo que queda. */
  updateDrift() {
    const drift = getDrift(this.game);
    const { drift: box, driftLabel, driftBar } = this.el;
    if (!box) return;
    const boosting = drift.boost > 0;
    box.classList.toggle('is-visible', drift.active || boosting);
    box.classList.toggle('is-boost', boosting && !drift.active);
    if (drift.active) {
      const ready = drift.time >= BOOST_MIN_TIME;
      setText(driftLabel, ready ? `DERRAPE ${drift.time.toFixed(1)} s · ¡suelta para turbo!` : `DERRAPE ${drift.time.toFixed(1)} s`);
      setStyle(driftBar, 'width', `${Math.min(100, (drift.time / 2) * 100).toFixed(1)}%`);
    } else if (boosting) {
      setText(driftLabel, '🔥 TURBO');
      setStyle(driftBar, 'width', `${((drift.boost / (drift.boostTotal || 1)) * 100).toFixed(1)}%`);
    }
  }

  updateStatic() {
    const { game } = this;
    const { state, derived } = game;
    const need = xpToNextLevel(state.level);
    setText(this.el.income, `${formatMoney(incomePerMinute(game))}/min`);
    setText(this.el.level, String(state.level));
    setText(this.el.title, levelTitle(state.level));
    setStyle(this.el.xpBar, 'width', `${state.level >= MAX_LEVEL ? 100 : Math.min(100, (state.xp / need) * 100)}%`);
    setText(this.el.xpText, state.level >= MAX_LEVEL ? 'Nivel máximo' : `${formatInt(state.xp)}/${formatInt(need)} XP`);
    setText(this.el.rep, String(Math.floor(state.reputation)));
    setStyle(this.el.repBar, 'width', `${state.reputation}%`);
    setText(this.el.orders, `${state.orders.length}/${derived.maxActiveOrders}`);
    setText(this.el.clock, formatClock(state));
    setText(this.el.day, `Día ${state.day}`);
    setStyle(this.el.dayBar, 'width', `${(state.dayTime / DAY_LENGTH) * 100}%`);
    const hour = clockHour(state);
    setText(this.el.clockIcon, hour >= 20 || hour < 5 ? '🌙' : hour >= 18 || hour < 7 ? '🌅' : '☀️');
    this.renderCargo();
    this.renderHands();
    this.renderStreak();
    this.renderTutorial();
  }

  setPointerLocked(locked) {
    this.pointerLocked = locked;
  }

  /** A pie: qué llevas en las manos, qué hay en la mesa y cuál es el siguiente paso. */
  renderHands() {
    const { game } = this;
    const el = this.el.hands;
    if (!el) return;
    if (!game.onFoot) { el.classList.remove('is-visible'); return; }
    el.classList.add('is-visible');
    const { state, city } = game;
    const box = heldBox(game);
    const items = heldItems(game);
    let held;
    if (box) {
      const b = city.getBuilding(box.buildingId);
      held = `<li style="--kind:${ORDER_KINDS[box.kind].color}"><span class="dot-kind">📦</span><span class="row-main"><b>Caja #${pad(box.number)}</b><small>${escapeHtml(b.address)}</small></span></li>`;
    } else if (items.length) {
      held = items.map(({ order, item }) => `<li style="--kind:${productInfo(item.name).color}"><span class="dot-kind">${item.shelf}</span><span class="row-main"><b>${escapeHtml(item.name)}</b><small>Pedido #${pad(order.number)}${productInfo(item.name).bulk >= HAND_CAPACITY ? ' · voluminoso' : ''}</small></span></li>`).join('');
    } else {
      held = '<li class="is-empty"><span class="row-main"><small>Manos libres</small></span></li>';
    }
    // Pedido que se está reuniendo: lista de productos con su estado
    const picking = state.orders.find((o) => isPlayerPicking(o));
    let checklist = '';
    if (picking) {
      checklist = `<p class="hands-order">Pedido #${pad(picking.number)} · ${picking.items.map((i) => `${(ITEM_AT_LABELS[i.at] ?? ['⬜'])[0]} ${escapeHtml(i.name)}`).join(' · ')}</p>`;
    }
    const guide = game.getFootGuide();
    setHtml(el, `
      <div class="cargo-title"><span>✋ En las manos</span><b>${box ? (box.dispatched ? 'caja registrada' : 'caja sin registrar') : `${handsBulk(game)}/${HAND_CAPACITY}`}</b></div>
      <ul class="cargo-list">${held}</ul>
      ${checklist}
      ${guide ? `<p class="hands-guide">➜ ${escapeHtml(guide.text)}</p>` : ''}`);
  }

  renderCargo() {
    const { game } = this;
    const { state, city } = game;
    const cargo = state.player.cargo.map((id) => getOrder(state, id)).filter(Boolean);
    const vehicle = state.vehicles.find((v) => v.id === state.player.vehicleId);
    const used = cargoSlotsUsed(game);
    const capacity = playerCapacity(game);
    const p = game.getFocus();
    let rows = '';
    for (const order of cargo) {
      const b = city.getBuilding(order.buildingId);
      const kind = ORDER_KINDS[order.kind];
      const meters = Math.round((distance(p.x, p.y, b.dropX, b.dropY) / TILE) * METERS_PER_TILE);
      const timer = order.timeLeft !== null ? (order.late ? '<span class="late">tarde</span>' : `<span class="${order.timeLeft < 15 ? 'late' : ''}">⏰ ${formatDuration(order.timeLeft)}</span>`) : '';
      rows += `<li style="--kind:${kind.color}"><span class="dot-kind">${kind.icon}</span><span class="row-main"><b>${escapeHtml(b.address)}</b><small>${escapeHtml(order.contents)}</small></span><span class="row-side">${meters} m ${timer}</span></li>`;
    }
    setHtml(this.el.cargo, `
      <div class="cargo-title"><span>${getVehicleType(vehicle.typeId).icon} ${getVehicleType(vehicle.typeId).name}</span><b>${used}/${capacity}</b></div>
      ${bar(capacity ? (used / capacity) * 100 : 0, 'bar-cargo')}
      ${rows ? `<ul class="cargo-list">${rows}</ul>` : '<p class="cargo-empty">Sin carga. Prepara pedidos en el almacén 🟡 y carga las cajas por la trasera.</p>'}`);
  }

  renderStreak() {
    const { state } = this.game;
    const { count, timer } = state.streak;
    if (count < 1) { this.el.streak.classList.remove('is-visible'); return; }
    this.el.streak.classList.add('is-visible');
    const bonus = Math.round(Math.min(count - 1, STREAK_MAX_STEPS) * STREAK_BONUS_PER_STEP * 100);
    setHtml(this.el.streak, `<b>🔥 Racha ×${count}</b><span>+${bonus} %</span>${bar((timer / STREAK_WINDOW) * 100, 'bar-streak')}`);
  }

  renderTutorial() {
    const { state } = this.game;
    const t = state.tutorial;
    const el = this.el.tutorial;
    if (t.done || !t.welcomed) { el.classList.remove('is-visible'); return; }
    const step = TUTORIAL_STEPS[t.step];
    if (!step) { el.classList.remove('is-visible'); return; }
    el.classList.add('is-visible');
    setHtml(el, `
      <div class="tutorial-head"><span class="tutorial-step">Tutorial · ${t.step + 1}/${TUTORIAL_STEPS.length}</span>
        <button class="btn btn-ghost btn-sm" data-tutorial="skip">Saltar</button></div>
      <b>${step.title}</b><p>${step.text}</p>
      ${step.needsAck ? '<button class="btn btn-primary btn-sm" data-tutorial="ack">¡Entendido!</button>' : ''}`);
  }
}
