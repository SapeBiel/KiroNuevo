// HUD: barra superior, tarjeta de carga, botón contextual, racha y tutorial.

import { DAY_LENGTH, MAX_LEVEL, STREAK_BONUS_PER_STEP, STREAK_MAX_STEPS, STREAK_WINDOW, METERS_PER_TILE, TILE } from '../config/constants.js';
import { levelTitle, xpToNextLevel } from '../config/levels.js';
import { TUTORIAL_STEPS } from '../config/tutorial.js';
import { ORDER_KINDS } from '../config/packages.js';
import { getVehicleType } from '../config/vehicles.js';
import { distance, formatDuration, formatInt, formatMoney, escapeHtml } from '../core/util.js';
import { clockHour, formatClock } from '../systems/dayCycle.js';
import { incomePerMinute } from '../systems/economy.js';
import { cargoSlotsUsed, getOrder, playerCapacity } from '../systems/orders.js';
import { $, bar, setHtml, setStyle, setText } from './dom.js';
import { BOOST_MIN_TIME, getDrift } from '../systems/playerVehicle.js';

export class Hud {
  constructor({ game, onInteract, onSkipTutorial, onAckTutorial }) {
    this.game = game;
    this.displayedMoney = game.state.money;
    this.timer = 0;
    this.el = {
      money: $('#hud-money'), income: $('#hud-income'), level: $('#hud-level'), title: $('#hud-title'),
      xpBar: $('#hud-xp-bar'), xpText: $('#hud-xp-text'), rep: $('#hud-rep'), repBar: $('#hud-rep-bar'),
      orders: $('#hud-orders'), clock: $('#hud-clock'), clockIcon: $('#hud-clock-icon'), day: $('#hud-day'),
      dayBar: $('#hud-day-bar'), cargo: $('#cargo-card'), context: $('#context-action'), streak: $('#streak-chip'),
      tutorial: $('#tutorial-card'), contextLabel: $('#context-label'),
      drift: $('#drift-meter'), driftLabel: $('#drift-label'), driftBar: $('#drift-bar'),
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
    this.renderStreak();
    this.renderTutorial();
  }

  renderCargo() {
    const { game } = this;
    const { state, city } = game;
    const cargo = state.player.cargo.map((id) => getOrder(state, id)).filter(Boolean);
    const vehicle = state.vehicles.find((v) => v.id === state.player.vehicleId);
    const used = cargoSlotsUsed(game);
    const capacity = playerCapacity(game);
    const p = state.player;
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
      ${rows ? `<ul class="cargo-list">${rows}</ul>` : '<p class="cargo-empty">Sin carga. Ve al almacén 🟡 y pulsa E.</p>'}`);
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
