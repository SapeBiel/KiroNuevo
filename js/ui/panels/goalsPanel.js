// Panel de objetivos: misiones del día, logros y avance al siguiente nivel.

import { ACHIEVEMENTS } from '../../config/achievements.js';
import { MAX_LEVEL } from '../../config/constants.js';
import { getLevelUnlocks, levelTitle } from '../../config/levels.js';
import { formatInt } from '../../core/util.js';
import { achievementProgress } from '../../systems/achievements.js';
import { bar } from '../dom.js';
import { attr, chip } from './shared.js';

export function renderGoalsPanel(game) {
  const { state } = game;
  const unlocked = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length;
  const nextUnlocks = state.level < MAX_LEVEL ? getLevelUnlocks(state.level + 1) : [];

  let html = `<div class="panel-head"><h3>🏆 Objetivos</h3><div class="chips">${chip(`Logros ${unlocked}/${ACHIEVEMENTS.length}`)}</div></div>`;

  if (state.level < MAX_LEVEL) {
    html += `<div class="callout next-level"><b>Nivel ${state.level + 1}: ${levelTitle(state.level + 1)}</b>
      <p>${nextUnlocks.length ? `Desbloquea: ${nextUnlocks.map(attr).join(' · ')}` : 'Más pedidos, mejores recompensas y nuevas oportunidades.'}</p></div>`;
  }

  html += '<h4 class="section-title">Misiones del día</h4>';
  if (!state.missions.length) html += '<p class="muted">Nuevas misiones al comenzar la próxima jornada.</p>';
  html += '<div class="cards">';
  for (const m of state.missions) {
    const percent = (Math.min(m.progress, m.target) / m.target) * 100;
    html += `
      <article class="card mission ${m.done ? 'is-done' : ''}">
        <div class="card-icon" aria-hidden="true">${m.done ? '✅' : '🎯'}</div>
        <div class="card-main">
          <h4>${attr(m.text)}</h4>
          ${bar(percent, m.done ? 'bar-done' : 'bar-mission')}
          <p class="effect">${m.done ? 'Completada' : `${formatInt(Math.min(m.progress, m.target))}/${formatInt(m.target)}`} · Premio: ${formatInt(m.moneyReward)} € + ${m.xpReward} XP</p>
        </div>
      </article>`;
  }
  html += '</div><h4 class="section-title">Logros</h4><div class="cards">';
  const sorted = [...ACHIEVEMENTS].sort((a, b) => Number(Boolean(state.achievements[a.id])) - Number(Boolean(state.achievements[b.id])));
  for (const def of sorted) {
    const p = achievementProgress(game, def);
    html += `
      <article class="card achievement ${p.done ? 'is-done' : ''}">
        <div class="card-icon" aria-hidden="true">${p.done ? def.icon : '🔒'}</div>
        <div class="card-main">
          <h4>${def.name}</h4>
          <p>${def.desc}</p>
          ${p.done ? '' : bar((p.current / p.target) * 100, 'bar-mission')}
          <p class="effect">${p.done ? `Conseguido el día ${state.achievements[def.id]}` : `${formatInt(p.current)}/${formatInt(p.target)}`} · ${formatInt(def.money)} €${def.xp ? ` + ${def.xp} XP` : ''}</p>
        </div>
      </article>`;
  }
  return `${html}</div>`;
}
