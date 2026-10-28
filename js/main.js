// Punto de entrada: crea el juego y conecta lógica, renderizado e interfaz.

import { Game } from './core/game.js';
import { loadSettings, saveSettings } from './core/storage.js';
import { formatInt, pad } from './core/util.js';
import { ORDER_KINDS } from './config/packages.js';
import { TUTORIAL_STEPS } from './config/tutorial.js';
import { ViewManager } from './render/views.js';
import { Sfx } from './ui/audio.js';
import { Dock } from './ui/dock.js';
import { Hud } from './ui/hud.js';
import { Input } from './ui/input.js';
import {
  ModalManager, welcomeHtml, helpHtml, menuHtml, confirmResetHtml, summaryHtml, renameHtml,
} from './ui/modals.js';
import { WORKER_TYPES } from './config/workers.js';
import { MAX_WORKER_NAME } from './systems/workers.js';
import { getDrift } from './systems/playerVehicle.js';
import { Notifications } from './ui/notifications.js';
import { initTooltip } from './ui/tooltip.js';
import { $ } from './ui/dom.js';

const GRAPHICS_LEVELS = ['alta', 'media', 'baja'];

function start() {
  const settings = loadSettings();
  const game = Game.create();
  window.__game = game; // útil para depurar desde la consola

  const sfx = new Sfx(settings.sound);
  const notifications = new Notifications($('#toasts'), $('#banner-root'));
  initTooltip($('#tooltip'));

  const view = new ViewManager({
    game,
    canvas2d: $('#game-canvas'),
    canvas3d: $('#game-canvas-3d'),
    minimapCanvas: $('#minimap'),
    initialMode: settings.view === '2d' ? '2d' : '3d',
    cameraMode: settings.camera,
    quality: GRAPHICS_LEVELS.includes(settings.graphics) ? settings.graphics : 'alta',
    onChange: (mode) => updateViewButtons(mode),
    onError: (text) => notifications.push({ type: 'warn', icon: '🧊', title: 'Modo 3D no disponible', text }),
  });
  let input = null;

  const modals = new ModalManager($('#modal-root'), (count) => {
    game.paused = count > 0;
    if (input) input.enabled = count === 0;
    if (count > 0) { input?.releaseAll(); sfx.stopScreech(); }
  });

  const dock = new Dock({
    root: $('#app'), tabsEl: $('#dock-tabs'), panelEl: $('#dock-panel'), game, sfx,
    onToggle: () => window.setTimeout(() => view.resize(), 220),
    onRename: (workerId) => openRename(workerId),
  });

  const hud = new Hud({
    game,
    onInteract: () => interact(),
    onSkipTutorial: () => { game.skipTutorial(); sfx.play('click'); },
    onAckTutorial: () => { game.acknowledgeTutorialFinish(); sfx.play('click'); },
  });

  // ------------------------------------------------------------ Acciones ----

  function interact() {
    sfx.unlock();
    game.interact();
  }

  function toggleSound() {
    settings.sound = !settings.sound;
    sfx.setEnabled(settings.sound);
    saveSettings(settings);
    updateSoundButton();
    if (settings.sound) { sfx.unlock(); sfx.play('click'); }
  }

  function updateSoundButton() {
    const btn = $('#btn-sound');
    btn.textContent = settings.sound ? '🔊' : '🔇';
    btn.setAttribute('aria-pressed', String(!settings.sound));
    btn.setAttribute('aria-label', settings.sound ? 'Desactivar sonido' : 'Activar sonido');
  }

  async function toggleView() {
    sfx.play('click');
    settings.view = await view.toggleMode();
    saveSettings(settings);
    view.canvas.focus({ preventScroll: true });
  }

  const CAMERA_TITLES = { chase: 'Cámara exterior', driver: 'Vista del conductor', aerial: 'Cámara aérea' };

  function toggleCamera() {
    if (view.mode !== '3d') return;
    const mode = view.toggleCamera();
    settings.camera = mode;
    saveSettings(settings);
    notifications.push({
      type: 'info', icon: '🎥', title: CAMERA_TITLES[mode] ?? 'Cámara', text: 'Pulsa C para cambiarla.', duration: 1800,
    });
  }

  function openRename(workerId) {
    const worker = game.state.workers.find((w) => w.id === workerId);
    if (!worker || modals.isOpen) return;
    const type = WORKER_TYPES[worker.typeId];
    sfx.play('click');
    const entry = modals.open({
      id: 'rename', title: 'Cambiar nombre',
      html: renameHtml({ name: worker.name, icon: type?.icon ?? '👤', typeName: type?.name ?? 'Empleado', maxLength: MAX_WORKER_NAME }),
      onAction: (action, current) => { if (action === 'save-name') save(current); },
    });
    if (!entry) return;
    const inputEl = entry.overlay.querySelector('#rename-input');
    const errorEl = entry.overlay.querySelector('#rename-error');
    inputEl.select();
    function save(current) {
      const result = game.renameWorker(workerId, inputEl.value);
      if (!result.ok) {
        errorEl.textContent = result.reason;
        inputEl.setAttribute('aria-invalid', 'true');
        sfx.play('error');
        inputEl.focus();
        return;
      }
      modals.close(current);
      dock.refresh();
      notifications.push({ type: 'success', icon: '✏️', title: `Ahora se llama ${result.worker.name}`, text: '', duration: 2200 });
    }
    // El control general de teclado ignora los campos de texto, así que Intro y Esc se gestionan aquí
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(entry); }
      else if (e.key === 'Escape') { e.preventDefault(); modals.close(entry); }
    });
    inputEl.addEventListener('input', () => { errorEl.textContent = ''; inputEl.removeAttribute('aria-invalid'); });
  }

  function updateViewButtons(mode) {
    const is3d = mode === '3d';
    const viewBtn = $('#btn-view');
    viewBtn.textContent = is3d ? '2D' : '3D';
    viewBtn.setAttribute('aria-label', is3d ? 'Cambiar a vista 2D' : 'Cambiar a vista 3D');
    viewBtn.dataset.tip = is3d ? 'Cambiar a vista 2D (V)' : 'Cambiar a vista 3D (V)';
    $('#btn-camera').hidden = !is3d;
  }

  function openMenu() {
    if (modals.isOpen) return;
    modals.open({ id: 'menu', title: 'Menú', html: menuHtml({ sound: settings.sound, graphics: settings.graphics }), onAction: onMenuAction });
  }

  function onMenuAction(action, entry) {
    switch (action) {
      case 'save':
        game.save();
        notifications.push({ type: 'success', icon: '💾', title: 'Partida guardada', text: '' });
        break;
      case 'graphics': {
        // Alta → Media → Baja → Alta
        const index = GRAPHICS_LEVELS.indexOf(settings.graphics);
        settings.graphics = GRAPHICS_LEVELS[(index + 1) % GRAPHICS_LEVELS.length];
        saveSettings(settings);
        view.setQuality(settings.graphics);
        modals.close(entry);
        openMenu();
        break;
      }
      case 'sound':
        toggleSound();
        modals.close(entry);
        openMenu();
        break;
      case 'help':
        modals.close(entry);
        openHelp(() => openMenu());
        break;
      case 'reset':
        openResetConfirm();
        break;
      default: break;
    }
  }

  function openHelp(onClose) {
    modals.open({ id: 'help', title: 'Cómo se juega', html: helpHtml(), className: 'modal-wide', onClose });
  }

  function openResetConfirm() {
    modals.open({
      id: 'confirm-reset', title: 'Reiniciar partida', html: confirmResetHtml(),
      onAction: (action) => {
        if (action !== 'confirm-reset') return;
        game.reset();
        window.location.reload();
      },
    });
  }

  function openSummary(summary) {
    modals.open({
      id: 'summary', title: 'Resumen de la jornada', html: summaryHtml(summary), className: 'modal-wide', dismissable: false,
      onAction: (action, entry) => {
        if (action !== 'next-day') return;
        game.acknowledgeSummary();
        modals.close(entry);
        sfx.play('click');
      },
    });
  }

  function openWelcome() {
    modals.open({
      id: 'welcome', title: 'Bienvenido', html: welcomeHtml(), className: 'modal-wide', dismissable: false,
      onAction: (action, entry) => {
        if (action !== 'start') return;
        sfx.unlock();
        game.state.tutorial.welcomed = true;
        modals.close(entry);
        view.canvas.focus({ preventScroll: true });
      },
    });
  }

  input = new Input({
    game,
    canvas: [$('#game-canvas'), $('#game-canvas-3d')],
    renderer: view,
    actions: {
      interact,
      openTab: (index) => dock.selectByIndex(index),
      toggleSound,
      toggleView,
      toggleCamera,
      toggleMenu: () => (modals.isOpen ? modals.closeTop() : openMenu()),
      closeTopLayer: () => { if (!modals.closeTop()) dock.collapse(); },
    },
  });

  $('#btn-menu').addEventListener('click', () => { sfx.unlock(); openMenu(); });
  $('#btn-sound').addEventListener('click', toggleSound);
  $('#btn-view').addEventListener('click', toggleView);
  $('#btn-camera').addEventListener('click', toggleCamera);
  $('#btn-help').addEventListener('click', () => { sfx.unlock(); if (!modals.isOpen) openHelp(); });
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
  window.addEventListener('keydown', () => sfx.unlock(), { once: true });
  updateSoundButton();
  updateViewButtons(view.mode);

  // -------------------------------------------------------------- Eventos ----

  const { events } = game;
  events.on('notify', (n) => notifications.push(n));
  events.on('actionFailed', () => sfx.play('error'));
  events.on('orderLoaded', () => sfx.play('load'));
  events.on('orderDelivered', ({ by, reward, order, building, streak }) => {
    if (by.type === 'player') {
      sfx.play('deliver');
      notifications.push({
        type: 'success', icon: '✅', title: `Entrega completada: +${formatInt(reward)} €`,
        text: `Pedido #${pad(order.number)} en ${building.address}${streak > 1 ? ` · Racha ×${streak}` : ''}${order.late ? ' · con retraso' : ''}`,
      });
    } else {
      sfx.play('coin');
    }
  });
  events.on('orderCreated', ({ order, building }) => {
    if (game.state.stats.ordersCreated <= 1) return;
    if (order.priority === 'urgent') sfx.play('urgent'); else sfx.play('order');
    notifications.push({
      type: order.priority === 'urgent' ? 'warn' : 'info', icon: ORDER_KINDS[order.kind].icon,
      title: `Nuevo pedido #${pad(order.number)}`, text: `${order.contents} → ${building.address}`, duration: 3200,
    });
  });
  events.on('upgradePurchased', ({ def, level }) => {
    sfx.play('buy');
    notifications.push({ type: 'success', icon: def.icon, title: `${def.name}${def.maxLevel > 1 ? ` · nivel ${level}` : ''}`, text: def.describe(level) });
  });
  events.on('vehicleBought', ({ type }) => { sfx.play('buy'); notifications.push({ type: 'success', icon: type.icon, title: `Nuevo vehículo: ${type.name}`, text: 'Ya está en el garaje.' }); });
  events.on('workerHired', ({ worker, type }) => { sfx.play('hire'); notifications.push({ type: 'success', icon: type.icon, title: `${worker.name} se une al equipo`, text: type.name }); });
  events.on('droneBought', ({ drone, type }) => { sfx.play('hire'); notifications.push({ type: 'success', icon: type.icon, title: `${drone.name} listo`, text: `${type.name} en servicio.` }); });
  events.on('zoneUnlocked', () => sfx.play('levelUp'));
  events.on('levelUp', ({ level, title, unlocks }) => {
    sfx.play('levelUp');
    notifications.banner({ icon: '⭐', title: `¡Nivel ${level}!`, subtitle: title, lines: unlocks.slice(0, 5) });
  });
  events.on('achievementUnlocked', () => sfx.play('achievement'));
  events.on('missionCompleted', () => sfx.play('achievement'));
  events.on('crash', ({ impact }) => { if (impact > 70) sfx.play('crash'); });
  events.on('lampHit', () => sfx.play('lamp'));
  events.on('driftStart', () => sfx.startScreech());
  events.on('driftEnd', () => sfx.stopScreech());
  events.on('driftBoost', () => sfx.play('boost'));
  events.on('tutorialStep', () => sfx.play('click'));
  events.on('daySummary', (summary) => openSummary(summary));

  // ------------------------------------------------------------ Arranque ----

  if (game.state.pendingSummary) openSummary(game.state.pendingSummary);
  else if (!game.state.tutorial.welcomed && !game.state.tutorial.done) openWelcome();

  for (const type of ['pagehide', 'beforeunload']) window.addEventListener(type, () => game.save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(); });

  let last = performance.now();
  let highlightTimer = 0;
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      input.update();
      game.update(dt);
      const drift = getDrift(game);
      if (drift.active) sfx.setScreechIntensity(Math.min(1, Math.abs(drift.slip) / 0.9));
      view.update(dt);
      view.draw();
      hud.update(dt);
      dock.tick(dt);
      highlightTimer += dt;
      if (highlightTimer > 0.3) {
        highlightTimer = 0;
        const t = game.state.tutorial;
        const step = !t.done && t.welcomed ? TUTORIAL_STEPS[t.step]?.id : null;
        dock.highlightTab = step === 'upgrade' ? 'upgrades' : step === 'finish' ? 'orders' : null;
      }
    } catch (error) {
      console.error('Error en el bucle del juego:', error);
    }
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
}

start();
