// Punto de entrada: crea el juego y conecta lógica, renderizado e interfaz.

import { Game } from './core/game.js';
import { loadSettings, saveSettings } from './core/storage.js';
import { formatInt, pad } from './core/util.js';
import { ORDER_KINDS } from './config/packages.js';
import { TUTORIAL_STEPS } from './config/tutorial.js';
import { ViewManager } from './render/views.js';
import { Sfx } from './ui/audio.js';
import { OfficeComputer } from './ui/computer.js';
import { Hud } from './ui/hud.js';
import { Input } from './ui/input.js';
import {
  ModalManager, welcomeHtml, helpHtml, menuHtml, confirmResetHtml, summaryHtml, renameHtml, brandingHtml,
} from './ui/modals.js';
import { drawBrandPreview } from './ui/brandPreview.js';
import { COLOR_PRESETS, DEFAULT_COMPANY, getCompany, getLogo } from './systems/branding.js';
import { getVehicleType } from './config/vehicles.js';
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
    // El juego es en 3D; la vista 2D solo queda de respaldo si el navegador no puede mostrar WebGL
    initialMode: '3d',
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

  // Toda la gestión de la empresa se hace desde el ordenador de la oficina (no hay panel lateral)
  const computer = new OfficeComputer({
    game, sfx,
    onRename: (workerId) => openRename(workerId),
    onBrand: () => openBranding(),
  });

  const hud = new Hud({
    game,
    getViewMode: () => view.mode,
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

  /** Ordenador de la oficina: la pantalla con todas las aplicaciones de gestión. */
  function openOfficeComputer(appId = null) {
    if (modals.isOpen) return;
    sfx.play('click');
    const entry = modals.open({
      id: 'computer', title: 'Ordenador de la oficina', html: computer.shellHtml(), className: 'modal-computer',
      onClose: () => { computer.detach(); view.canvas.focus({ preventScroll: true }); },
    });
    if (!entry) return;
    computer.attach(entry.overlay, appId);
    entry.overlay.querySelector('.pc-app.is-active')?.focus({ preventScroll: true });
  }

  /** Las teclas 1-5 ya no abren paneles fuera del ordenador: se recuerda dónde está. */
  function remindComputer() {
    notifications.push({
      type: 'info', icon: '🖥️', title: 'La gestión se hace en el ordenador',
      text: 'Ve a la oficina del almacén (esquina del fondo a la izquierda) y pulsa E junto a la mesa.', duration: 3200,
    });
  }

  const CAMERA_TITLES = { chase: 'Cámara exterior', driver: 'Vista del conductor', aerial: 'Cámara aérea' };

  function toggleCamera() {
    if (view.mode !== '3d') return;
    if (game.onFoot) {
      notifications.push({ type: 'info', icon: '👀', title: 'A pie vas en primera persona', text: 'La cámara del vehículo se elige al volante (C).', duration: 2200 });
      return;
    }
    const mode = view.toggleCamera();
    settings.camera = mode;
    saveSettings(settings);
    notifications.push({
      type: 'info', icon: '🎥', title: CAMERA_TITLES[mode] ?? 'Cámara', text: 'Pulsa C para cambiarla.', duration: 1800,
    });
  }

  function openRename(workerId) {
    const worker = game.state.workers.find((w) => w.id === workerId);
    // Se abre encima del ordenador de la oficina (open() ya evita abrirla dos veces)
    if (!worker) return;
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
      computer.refresh();
      notifications.push({ type: 'success', icon: '✏️', title: `Ahora se llama ${result.worker.name}`, text: '', duration: 2200 });
    }
    // El control general de teclado ignora los campos de texto, así que Intro y Esc se gestionan aquí
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); save(entry); }
      else if (e.key === 'Escape') { e.preventDefault(); modals.close(entry); }
    });
    inputEl.addEventListener('input', () => { errorEl.textContent = ''; inputEl.removeAttribute('aria-invalid'); });
  }

  // ------------------------------------------------- Imagen de la empresa ----

  /** Logotipo de la barra superior (SVG) con el color principal y el icono elegidos. */
  function brandLogoSvg(company) {
    const logo = getLogo(company.logo);
    const inner = logo.id === 'box'
      ? `<path d="M10 18l14-7 14 7v14l-14 7-14-7z" fill="#b9824a" stroke="#6b4423" stroke-width="2" stroke-linejoin="round"/>
         <path d="M10 18l14 7 14-7M24 25v14" stroke="#e8c48e" stroke-width="3" fill="none"/>`
      : `<rect x="7" y="7" width="34" height="34" rx="9" fill="${company.accent}"/>
         <text x="24" y="25.5" font-size="22" text-anchor="middle" dominant-baseline="central">${logo.icon}</text>`;
    return `<svg class="brand-logo" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="${company.primary}"/>${inner}</svg>`;
  }

  /** Nombre de la empresa en la barra superior y en el título de la pestaña. */
  function updateBrand() {
    const company = getCompany(game.state);
    const button = $('#btn-brand');
    if (!button) return;
    button.querySelector('.brand-logo')?.remove();
    button.insertAdjacentHTML('afterbegin', brandLogoSvg(company));
    $('#brand-name').textContent = company.name;
    $('#brand-tagline').textContent = company.slogan || 'Delivery Tycoon';
    document.title = company.name === DEFAULT_COMPANY.name ? 'Parcel Empire: Delivery Tycoon' : `${company.name} · Parcel Empire`;
  }

  /** Ventana para cambiar nombre, eslogan, logotipo y colores (con vista previa). */
  function openBranding(onClose = null) {
    sfx.play('click');
    const draft = { ...getCompany(game.state) };
    const entry = modals.open({
      id: 'branding', title: 'Imagen de la empresa', html: brandingHtml(draft), className: 'modal-wide', onClose,
      onAction: (action, current, el) => {
        if (action === 'save-brand') save(current);
        else if (action === 'brand-logo') { draft.logo = el.dataset.id; sync(); sfx.play('click'); }
        else if (action === 'brand-preset') {
          const preset = COLOR_PRESETS.find((p) => p.id === el.dataset.id);
          if (!preset) return;
          Object.assign(draft, { primary: preset.primary, secondary: preset.secondary, accent: preset.accent, fleetColors: true });
          sync(true);
          sfx.play('click');
        }
      },
    });
    if (!entry) return;
    const root = entry.overlay;
    const nameEl = root.querySelector('#brand-name-input');
    const sloganEl = root.querySelector('#brand-slogan-input');
    const fleetEl = root.querySelector('#brand-fleet');
    const errorEl = root.querySelector('#brand-error');
    const preview = root.querySelector('#brand-preview');
    const colorEls = { primary: root.querySelector('#brand-primary'), secondary: root.querySelector('#brand-secondary'), accent: root.querySelector('#brand-accent') };
    const playerType = getVehicleType(game.state.vehicles.find((v) => v.id === game.state.player.vehicleId)?.typeId);

    // Refleja el borrador en los controles y en la vista previa
    function sync(updateInputs = false) {
      if (updateInputs) {
        for (const [key, input] of Object.entries(colorEls)) input.value = draft[key];
        fleetEl.checked = draft.fleetColors;
      }
      for (const button of root.querySelectorAll('.logo-option')) button.setAttribute('aria-pressed', String(button.dataset.id === draft.logo));
      drawBrandPreview(preview, { ...draft, name: draft.name.trim() || DEFAULT_COMPANY.name }, playerType?.color);
    }

    function save(current) {
      const result = game.setCompany(draft);
      if (!result.ok) {
        errorEl.textContent = result.reason;
        nameEl.setAttribute('aria-invalid', 'true');
        sfx.play('error');
        nameEl.focus();
        return;
      }
      modals.close(current);
      notifications.push({ type: 'success', icon: '🎨', title: `¡${result.company.name} estrena imagen!`, text: 'Ya la llevan el almacén y toda la flota.', duration: 2600 });
    }

    nameEl.addEventListener('input', () => {
      draft.name = nameEl.value;
      errorEl.textContent = '';
      nameEl.removeAttribute('aria-invalid');
      sync();
    });
    sloganEl.addEventListener('input', () => { draft.slogan = sloganEl.value; sync(); });
    for (const [key, input] of Object.entries(colorEls)) {
      // Si el jugador elige colores es que los quiere en la flota (puede desmarcarlo después)
      input.addEventListener('input', () => { draft[key] = input.value; draft.fleetColors = true; fleetEl.checked = true; sync(); });
    }
    fleetEl.addEventListener('change', () => { draft.fleetColors = fleetEl.checked; sync(); });
    // El control general de teclado ignora los campos (input): Intro guarda y Esc cierra desde aquí.
    // Con el foco en un botón, Esc ya lo gestiona el control general.
    root.addEventListener('keydown', (e) => {
      if (!(e.target instanceof HTMLInputElement)) return;
      if (e.key === 'Escape') { e.preventDefault(); modals.close(entry); }
      else if (e.key === 'Enter' && e.target.type === 'text') { e.preventDefault(); save(entry); }
    });
    nameEl.select();
    sync();
  }

  function updateViewButtons(mode) {
    $('#btn-camera').hidden = mode !== '3d';
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
      case 'brand':
        modals.close(entry);
        openBranding(() => openMenu());
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
        // Se abre encima de la bienvenida; al cerrarla se vuelve a ella
        if (action === 'brand') { sfx.unlock(); openBranding(); return; }
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
      openTab: () => remindComputer(),
      toggleSound,
      toggleCamera,
      toggleMenu: () => (modals.isOpen ? modals.closeTop() : openMenu()),
      closeTopLayer: () => modals.closeTop(),
      onPointerLock: (locked) => hud.setPointerLocked(locked),
    },
  });

  $('#btn-menu').addEventListener('click', () => { sfx.unlock(); openMenu(); });
  $('#btn-brand').addEventListener('click', () => { sfx.unlock(); if (!modals.isOpen) openBranding(); });
  $('#btn-sound').addEventListener('click', toggleSound);
  $('#btn-camera').addEventListener('click', toggleCamera);
  $('#btn-help').addEventListener('click', () => { sfx.unlock(); if (!modals.isOpen) openHelp(); });
  window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
  window.addEventListener('keydown', () => sfx.unlock(), { once: true });
  updateSoundButton();
  updateViewButtons(view.mode);
  updateBrand();

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
  // Trabajo a pie: recoger, empaquetar, mover cajas y subir o bajar del vehículo
  events.on('itemPicked', () => sfx.play('click'));
  events.on('itemReturned', () => sfx.play('click'));
  events.on('itemsPlaced', () => sfx.play('click'));
  events.on('orderPacked', ({ order }) => {
    sfx.play('buy');
    notifications.push({ type: 'success', icon: '📦', title: `Pedido #${pad(order.number)} empaquetado`, text: 'Llévalo a expedición, junto a la fachada.', duration: 2600 });
  });
  for (const name of ['boxTaken', 'boxUnloaded', 'boxStored']) events.on(name, () => sfx.play('load'));
  events.on('boxStored', ({ order }) => {
    if (order.dispatched) notifications.push({ type: 'info', icon: '🏷️', title: `Caja #${pad(order.number)} en expedición`, text: 'Cógela de aquí para cargarla en el vehículo.', duration: 2200 });
  });
  events.on('officeComputer', () => openOfficeComputer());
  events.on('playerJumped', () => sfx.play('jump'));
  events.on('playerExited', () => sfx.play('click'));
  events.on('playerEntered', () => sfx.play('click'));
  events.on('tutorialStep', () => sfx.play('click'));
  events.on('daySummary', (summary) => openSummary(summary));
  events.on('companyChanged', () => { updateBrand(); computer.refresh(); sfx.play('buy'); });

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
      computer.tick(dt);
      highlightTimer += dt;
      if (highlightTimer > 0.3) {
        highlightTimer = 0;
        const t = game.state.tutorial;
        const step = !t.done && t.welcomed ? TUTORIAL_STEPS[t.step]?.id : null;
        computer.highlightTab = step === 'upgrade' ? 'upgrades' : step === 'finish' ? 'orders' : null;
      }
    } catch (error) {
      console.error('Error en el bucle del juego:', error);
    }
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
}

start();
