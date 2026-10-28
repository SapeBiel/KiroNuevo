// Ciclo de día/noche, cobro de sueldos y mantenimiento al final de la jornada.

import { DAY_LENGTH, DAY_START_HOUR } from '../config/constants.js';
import { createDayStats } from '../core/state.js';
import { chargeOperating, computeDailyCosts } from './economy.js';
import { adjustReputation } from './progression.js';
import { generateMissions } from './missions.js';

export function clockHour(state) {
  return (DAY_START_HOUR + (state.dayTime / DAY_LENGTH) * 24) % 24;
}

export function formatClock(state) {
  const hour = clockHour(state);
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 0 = pleno día, 1 = noche cerrada. */
export function darknessAt(hour) {
  if (hour >= 21 || hour < 5) return 1;
  if (hour >= 5 && hour < 7) return 1 - (hour - 5) / 2;
  if (hour >= 19 && hour < 21) return (hour - 19) / 2;
  return 0;
}

export function updateDayCycle(game, dt) {
  const { state } = game;
  state.dayTime += dt;
  if (state.dayTime >= DAY_LENGTH) endDay(game);
}

export function endDay(game) {
  const { state } = game;
  if (state.pendingSummary) return state.pendingSummary;
  state.dayTime = DAY_LENGTH - 0.001;
  const costs = computeDailyCosts(game);
  const salaries = chargeOperating(game, costs.salaries, 'salaries');
  const upkeep = chargeOperating(game, costs.upkeep, 'upkeep');
  const unpaid = salaries.unpaid + upkeep.unpaid;
  if (unpaid > 0) {
    adjustReputation(game, -3);
    game.events.emit('notify', { type: 'warn', icon: '⚠️', title: 'Gastos sin pagar', text: 'No había fondos para todos los gastos del día. Tu reputación baja un poco.' });
  }

  const d = state.dayStats;
  const expenses = d.fuel + d.salaries + d.upkeep;
  const net = d.income - expenses;
  const stars = (net > 0 ? 1 : 0) + (d.late === 0 && d.deliveries > 0 ? 1 : 0) + (d.deliveries >= 4 + state.level ? 1 : 0);
  const summary = {
    day: state.day,
    deliveries: d.deliveries,
    income: d.income,
    fuel: d.fuel,
    salaries: d.salaries,
    upkeep: d.upkeep,
    net,
    bestStreak: d.bestStreak,
    late: d.late,
    urgentOnTime: d.urgentOnTime,
    xp: d.xp,
    missionsDone: d.missionsDone,
    unpaid,
    stars,
    level: state.level,
    money: state.money,
  };
  state.history.push({ day: state.day, income: d.income, expenses, deliveries: d.deliveries });
  if (state.history.length > 10) state.history.shift();
  state.pendingSummary = summary;
  game.events.emit('daySummary', summary);
  return summary;
}

export function startNextDay(game) {
  const { state } = game;
  if (!state.pendingSummary) return;
  state.pendingSummary = null;
  state.day += 1;
  state.dayTime = 0;
  state.dayStats = createDayStats();
  state.missions = generateMissions(game);
  game.events.emit('newDay', { day: state.day });
}
