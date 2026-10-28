// Entrada: teclado, ratón/táctil sobre el mapa y botones táctiles en pantalla.

import { clamp, normalizeAngle } from '../core/util.js';

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const DRIFT = ['Space', 'ShiftLeft', 'ShiftRight'];
const GAME_KEYS = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, ...DRIFT]);

export class Input {
  /** "canvas" puede ser un elemento o una lista (vista 2D y 3D); "renderer" debe tener screenToWorld(x, y). */
  constructor({ game, canvas, renderer, actions }) {
    this.game = game;
    this.canvases = [].concat(canvas);
    this.renderer = renderer;
    this.actions = actions; // { interact, openTab, toggleMenu, toggleSound, toggleView, toggleCamera, closeTopLayer }
    this.enabled = true;
    this.keys = new Set();
    this.virtual = { up: false, down: false, left: false, right: false, drift: false };
    this.pointer = { active: false, x: 0, y: 0 };
    this.bind();
  }

  bind() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });

    const stop = () => { this.pointer.active = false; };
    for (const canvas of this.canvases) {
      canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture?.(e.pointerId);
        this.pointer = { active: true, ...this.localPoint(e) };
      });
      canvas.addEventListener('pointermove', (e) => {
        if (this.pointer.active) Object.assign(this.pointer, this.localPoint(e));
      });
      canvas.addEventListener('pointerup', stop);
      canvas.addEventListener('pointercancel', stop);
      canvas.addEventListener('lostpointercapture', stop);
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // Botones táctiles
    for (const button of document.querySelectorAll('[data-hold]')) {
      const key = button.dataset.hold;
      const set = (value) => (e) => { e.preventDefault(); this.virtual[key] = value; button.classList.toggle('is-held', value); };
      button.addEventListener('pointerdown', set(true));
      button.addEventListener('pointerup', set(false));
      button.addEventListener('pointercancel', set(false));
      button.addEventListener('pointerleave', set(false));
      button.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    document.getElementById('touch-interact')?.addEventListener('click', () => this.actions.interact());
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') document.body.classList.add('has-touch');
    }, { passive: true });
  }

  localPoint(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  releaseAll() {
    this.keys.clear();
    this.pointer.active = false;
    for (const k of Object.keys(this.virtual)) this.virtual[k] = false;
  }

  onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    const typing = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (typing) return;

    if (e.code === 'Escape') {
      this.actions.closeTopLayer();
      return;
    }
    if (e.code === 'KeyP') {
      if (!e.repeat) this.actions.toggleMenu();
      return;
    }
    if (!this.enabled) return;

    const focusIsButton = document.activeElement instanceof HTMLElement && ['BUTTON', 'A', 'SUMMARY'].includes(document.activeElement.tagName);
    // Con el foco en un botón, Espacio lo pulsa (accesibilidad); si no, es el derrape
    if (e.code === 'Space' && focusIsButton) return;
    if (GAME_KEYS.has(e.code)) {
      e.preventDefault();
      this.keys.add(e.code);
      return;
    }
    // Las acciones puntuales no se repiten al mantener la tecla pulsada
    if (e.repeat) return;
    if (e.code === 'KeyE') {
      e.preventDefault();
      this.actions.interact();
    } else if (/^Digit[1-5]$/.test(e.code)) {
      this.actions.openTab(Number(e.code.slice(5)) - 1);
    } else if (e.code === 'KeyM') {
      this.actions.toggleSound();
    } else if (e.code === 'KeyV') {
      this.actions.toggleView?.();
    } else if (e.code === 'KeyC') {
      this.actions.toggleCamera?.();
    }
  }

  /** Traduce la entrada en mandos de conducción. Se llama una vez por fotograma. */
  update() {
    const { game } = this;
    const has = (codes) => codes.some((c) => this.keys.has(c));
    let throttle = (has(UP) || this.virtual.up ? 1 : 0) - (has(DOWN) || this.virtual.down ? 1 : 0);
    let steer = (has(RIGHT) || this.virtual.right ? 1 : 0) - (has(LEFT) || this.virtual.left ? 1 : 0);

    let drift = has(DRIFT) || this.virtual.drift;

    if (!this.enabled) {
      throttle = 0;
      steer = 0;
      drift = false;
    } else if (throttle === 0 && steer === 0 && this.pointer.active) {
      // Conducción con ratón/dedo: el vehículo se dirige hacia el puntero (si apunta al cielo en 3D, no hace nada)
      const world = this.renderer.screenToWorld(this.pointer.x, this.pointer.y);
      if (world) {
        const p = game.state.player;
        const dx = world.x - p.x;
        const dy = world.y - p.y;
        const dist = Math.hypot(dx, dy);
        const diff = normalizeAngle(Math.atan2(dy, dx) - p.angle);
        steer = clamp(diff * 2.4, -1, 1);
        if (dist < 40) throttle = p.speed > 8 ? -0.7 : 0;
        else throttle = Math.abs(diff) > 1.3 ? 0.55 : 1;
      }
    }
    game.controls.throttle = throttle;
    game.controls.steer = steer;
    game.controls.drift = drift;
  }
}
