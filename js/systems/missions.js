// Misiones diarias: objetivos cortos con recompensa que se renuevan cada jornada.

import { ZONES } from '../config/zones.js';
import { allocateId } from '../core/state.js';
import { formatInt } from '../core/util.js';
import { grantBonus } from './economy.js';
import { addXp, unlockedZoneIds } from './progression.js';

const MISSION_BUILDERS = {
  deliveries(game) {
    const level = game.state.level;
    const target = 3 + Math.ceil(level * 0.9);
    return { target, money: target * (10 + 3 * level), xp: target * 3, text: `Completa ${target} entregas` };
  },
  earn(game) {
    const level = game.state.level;
    const target = Math.round((60 * (1 + level * 0.9)) / 10) * 10;
    return { target, money: Math.round(target * 0.25), xp: 15 + 5 * level, text: `Gana ${formatInt(target)} € con entregas` };
  },
  urgent(game) {
    const level = game.state.level;
    const target = 1 + Math.floor(level / 4);
    return { target, money: target * (40 + 10 * level), xp: target * 25, text: `Entrega ${target} pedido${target > 1 ? 's' : ''} urgente${target > 1 ? 's' : ''} a tiempo` };
  },
  zone(game) {
    const level = game.state.level;
    const zones = unlockedZoneIds(game.state);
    const zoneId = zones[Math.floor(Math.random() * zones.length)];
    const target = 3 + Math.floor(level / 3);
    return { target, zoneId, money: target * (14 + 3 * level), xp: target * 4, text: `Entrega ${target} pedidos en ${ZONES[zoneId].name}` };
  },
  streak(game) {
    const level = game.state.level;
    const target = 3 + Math.floor(level / 3);
    return { target, money: 60 + 15 * level, xp: 30 + 8 * level, text: `Consigue una racha de ${target} entregas a tiempo` };
  },
};

function availableTypes(game) {
  const { state } = game;
  const types = ['deliveries', 'earn'];
  if (state.level >= 2) types.push('streak');
  if (state.level >= 3) types.push('urgent');
  if (unlockedZoneIds(state).length >= 2) types.push('zone');
  return types;
}

export function generateMissions(game) {
  const pool = availableTypes(game);
  const chosen = [];
  while (chosen.length < 3 && pool.length) {
    const [type] = pool.splice(Math.floor(Math.random() * pool.length), 1);
    const built = MISSION_BUILDERS[type](game);
    chosen.push({
      id: allocateId(game.state, 'm'), type, target: built.target, progress: 0, done: false,
      moneyReward: built.money, xpReward: built.xp, text: built.text, zoneId: built.zoneId ?? null,
    });
  }
  return chosen;
}

function completeMission(game, mission) {
  mission.done = true;
  mission.progress = mission.target;
  grantBonus(game, mission.moneyReward);
  addXp(game, mission.xpReward);
  game.state.dayStats.missionsDone += 1;
  game.events.emit('missionCompleted', { mission });
  game.events.emit('notify', { type: 'success', icon: '🎯', title: 'Misión completada', text: `${mission.text}: +${formatInt(mission.moneyReward)} € y +${mission.xpReward} XP` });
}

/** Se llama tras cada entrega para avanzar las misiones activas. */
export function trackMissionProgress(game, delivery) {
  const { order, reward, by, streak } = delivery;
  for (const mission of game.state.missions) {
    if (mission.done) continue;
    switch (mission.type) {
      case 'deliveries': mission.progress += 1; break;
      case 'earn': mission.progress += reward; break;
      case 'urgent': if (order.priority === 'urgent' && !order.late) mission.progress += 1; break;
      case 'zone': if (order.zoneId === mission.zoneId) mission.progress += 1; break;
      case 'streak': if (by.type === 'player') mission.progress = Math.max(mission.progress, streak); break;
      default: break;
    }
    if (mission.progress >= mission.target) completeMission(game, mission);
  }
}
