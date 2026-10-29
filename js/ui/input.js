// Entrada: teclado, ratón/táctil sobre el mapa y botones táctiles en pantalla.
// Al volante escribe throttle/steer/drift; a pie, la dirección de marcha en el mapa (walkX/walkY),
// los giros de la mirada (lookYaw/lookPitch) y si se corre. En 3D a pie el ratón se captura (pointer lock).

import { clamp, normalizeAngle } from '../core/util.js';

const UP = ['KeyW', 'ArrowUp'];
const DOWN = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const DRIFT = ['Space', 'ShiftLeft', 'ShiftRight'];
const SPRINT = ['ShiftLeft', 'ShiftRight'];
const GAME_KEYS = new Set([...UP, ...DOWN, ...LEFT, ...RIGHT, ...DRIFT]);

const LOOK_SENSITIVITY = 0.0024; // rad por píxel de ratón
const TOUCH_LOOK = 0.006; // rad por píxel al arrastrar el dedo
const KEY_TURN = 2.4; // rad/s con las flechas izquierda/derecha (a pie en 3D)

export class Input {
  /** "canvas" puede ser un elemento o una lista (vista 2D y 3D); "renderer" debe tener screenToWorld(x, y) y mode. */
  constructor({ game, canvas, renderer, actions }) {
    this.game = game;
    this.canvases = [].concat(canvas);
    this.renderer = renderer;
    this.actions = actions; // { interact, openTab, toggleMenu, toggleSound, toggleCamera, closeTopLayer, onPointerLock }
    this.jumpPressed = false;
    this.touchJumpHeld = false;
    this.enabled = true;
    this.keys = new Set();
    this.virtual = { up: false, down: false, left: false, right: false, drift: false };
    this.pointer = { active: false, x: 0, y: 0 };
    this.look = { dx: 0, dy: 0 };
    this.drag = null; // arrastre para mirar en pantallas táctiles (a pie, 3D)
    this.lastTime = performance.now();
    this.bind();
  }

  get onFoot() {
    return this.game.state.player.mode === 'foot';
  }

  get is3d() {
    return this.renderer.mode === '3d';
  }

  pointerLocked() {
    return Boolean(document.pointerLockElement) && this.canvases.includes(document.pointerLockElement);
  }

  unlockPointer() {
    if (this.pointerLocked()) document.exitPointerLock?.();
  }

  requestLock(canvas) {
    try {
      const result = canvas.requestPointerLock?.();
      result?.catch?.(() => {}); // el navegador puede negarlo (p. ej. justo después de pulsar Esc)
    } catch { /* sin pointer lock: se puede mirar con las flechas */ }
  }

  bind() {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked()) return;
      this.look.dx += e.movementX || 0;
      this.look.dy += e.movementY || 0;
    });
    document.addEventListener('pointerlockchange', () => this.actions.onPointerLock?.(this.pointerLocked()));

    const stop = (e) => {
      this.pointer.active = false;
      if (this.drag && (!e || e.pointerId === this.drag.id)) this.drag = null;
    };
    for (const canvas of this.canvases) {
      canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        canvas.focus({ preventScroll: true });
        if (this.onFoot && this.is3d) {
          // A pie en 3D: con ratón se captura el puntero; con el dedo se arrastra para mirar
          if (e.pointerType === 'mouse') {
            if (this.enabled && !this.pointerLocked()) this.requestLock(canvas);
          } else {
            canvas.setPointerCapture?.(e.pointerId);
            this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
          }
          return;
        }
        canvas.setPointerCapture?.(e.pointerId);
        this.pointer = { active: true, ...this.localPoint(e) };
      });
      canvas.addEventListener('pointermove', (e) => {
        if (this.drag && e.pointerId === this.drag.id) {
          this.look.dx += ((e.clientX - this.drag.x) * TOUCH_LOOK) / LOOK_SENSITIVITY;
          this.look.dy += ((e.clientY - this.drag.y) * TOUCH_LOOK) / LOOK_SENSITIVITY;
          this.drag.x = e.clientX;
          this.drag.y = e.clientY;
          return;
        }
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
    this.drag = null;
    this.look.dx = 0;
    this.look.dy = 0;
    for (const k of Object.keys(this.virtual)) this.virtual[k] = false;
    this.unlockPointer();
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
      // A pie, Espacio salta (una vez por pulsación); al volante sigue siendo el derrape
      if (e.code === 'Space' && !e.repeat && this.onFoot) this.jumpPressed = true;
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
    } else if (e.code === 'KeyC') {
      this.actions.toggleCamera?.();
    }
  }

  /** Traduce la entrada en mandos. Se llama una vez por fotograma. */
  update() {
    const now = performance.now();
    const dt = clamp((now - this.lastTime) / 1000, 0, 0.1);
    this.lastTime = now;
    if (this.onFoot) this.updateOnFoot(dt);
    else this.updateDriving();
  }

  updateDriving() {
    const { game } = this;
    const controls = game.controls;
    // Al volante no se salta
    controls.jump = false;
    this.jumpPressed = false;
    this.touchJumpHeld = this.virtual.drift;
    // Al volante el ratón no está capturado (se conduce con teclado o manteniendo pulsado el mapa)
    this.unlockPointer();
    this.drag = null;
    this.look.dx = 0;
    this.look.dy = 0;
    controls.walkX = 0;
    controls.walkY = 0;
    controls.sprint = false;

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
    controls.throttle = throttle;
    controls.steer = steer;
    controls.drift = drift;
  }

  updateOnFoot(dt) {
    const { game } = this;
    const controls = game.controls;
    controls.throttle = 0;
    controls.steer = 0;
    controls.drift = false;
    if (!this.enabled) {
      controls.walkX = 0;
      controls.walkY = 0;
      controls.sprint = false;
      controls.jump = false;
      this.jumpPressed = false;
      controls.lookYaw = 0;
      controls.lookPitch = 0;
      this.look.dx = 0;
      this.look.dy = 0;
      return;
    }
    const has = (codes) => codes.some((c) => this.keys.has(c));
    const forward = (has(UP) || this.virtual.up ? 1 : 0) - (has(DOWN) || this.virtual.down ? 1 : 0);
    const strafeKeys = (has(['KeyD']) ? 1 : 0) - (has(['KeyA']) ? 1 : 0);
    const arrows = (has(['ArrowRight']) ? 1 : 0) - (has(['ArrowLeft']) ? 1 : 0);
    const touchTurn = (this.virtual.right ? 1 : 0) - (this.virtual.left ? 1 : 0);
    controls.sprint = has(SPRINT);
    // Salto: Espacio o, en táctil, el botón ⤿ (solo al pulsarlo, no mientras se mantiene)
    const touchJump = this.virtual.drift && !this.touchJumpHeld;
    this.touchJumpHeld = this.virtual.drift;
    if (this.jumpPressed || touchJump) controls.jump = true;
    this.jumpPressed = false;

    if (this.is3d) {
      // Primera persona: W/S adelante y atrás, A/D de lado, ratón (o flechas) para girar
      controls.lookYaw += this.look.dx * LOOK_SENSITIVITY + (arrows + touchTurn) * KEY_TURN * dt;
      controls.lookPitch -= this.look.dy * LOOK_SENSITIVITY;
      const yaw = game.state.player.foot.yaw + controls.lookYaw;
      const fx = Math.cos(yaw);
      const fy = Math.sin(yaw);
      controls.walkX = fx * forward - fy * strafeKeys;
      controls.walkY = fy * forward + fx * strafeKeys;
      controls.faceMove = false;
    } else {
      // Vista cenital: las teclas mueven en la dirección de la pantalla y la persona mira hacia donde anda
      this.unlockPointer();
      let walkX = strafeKeys + arrows + touchTurn;
      let walkY = -forward;
      if (walkX === 0 && walkY === 0 && this.pointer.active) {
        const world = this.renderer.screenToWorld(this.pointer.x, this.pointer.y);
        const f = game.state.player.foot;
        if (world) {
          const dx = world.x - f.x;
          const dy = world.y - f.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 6) { walkX = dx / dist; walkY = dy / dist; }
        }
      }
      controls.walkX = walkX;
      controls.walkY = walkY;
      controls.faceMove = true;
    }
    this.look.dx = 0;
    this.look.dy = 0;
  }
}
