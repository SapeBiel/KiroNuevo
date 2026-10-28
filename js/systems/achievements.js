// Comprobación y entrega de premios de logros.

import { ACHIEVEMENTS } from '../config/achievements.js';
import { formatInt } from '../core/util.js';
import { grantBonus } from './economy.js';
import { addXp } from './progression.js';

export function achievementProgress(game, def) {
  const [current, target] = def.progress(game.state);
  return { current: Math.min(current, target), target, done: Boolean(game.state.achievements[def.id]) };
}

export function updateAchievements(game) {
  const { state } = game;
  for (const def of ACHIEVEMENTS) {
    if (state.achievements[def.id]) continue;
    const [current, target] = def.progress(state);
    if (current < target) continue;
    state.achievements[def.id] = state.day;
    grantBonus(game, def.money);
    addXp(game, def.xp);
    game.events.emit('achievementUnlocked', { def });
    game.events.emit('notify', {
      type: 'success', icon: def.icon, title: `Logro: ${def.name}`,
      text: `+${formatInt(def.money)} €${def.xp ? ` y +${def.xp} XP` : ''}`,
    });
  }
}
