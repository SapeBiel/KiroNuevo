// Gestor de vistas: alterna entre el renderizador 2D (Canvas) y el 3D (WebGL / Three.js).
// El 3D se carga bajo demanda; si el navegador no soporta WebGL se queda en 2D.

import { Renderer } from './renderer.js';
import { drawMinimap } from './minimap.js';

export class ViewManager {
  constructor({ game, canvas2d, canvas3d, minimapCanvas, initialMode = '3d', cameraMode = 'chase', onChange = null, onError = null }) {
    this.game = game;
    this.canvas2d = canvas2d;
    this.canvas3d = canvas3d;
    this.minimapCanvas = minimapCanvas;
    this.onChange = onChange;
    this.onError = onError;
    this.renderer2d = new Renderer({ canvas: canvas2d, minimapCanvas, game });
    this.renderer3d = null;
    this.mode = null; // modo visible ahora mismo (null mientras carga el 3D)
    this.loading = false;
    this.unavailable = false;
    this.cameraMode = ['chase', 'driver', 'aerial'].includes(cameraMode) ? cameraMode : 'chase';
    this.minimapTick = 0;

    // Un primer dibujado 2D deja el canvas con contenido aunque el 3D tarde en cargar
    this.renderer2d.update(0);
    this.renderer2d.draw();
    canvas2d.hidden = true;
    canvas3d.hidden = true;

    if (initialMode === '3d') this.setMode('3d');
    else this.show('2d');
  }

  /** Canvas que recibe la entrada del jugador. */
  get canvas() {
    return this.mode === '3d' ? this.canvas3d : this.canvas2d;
  }

  get active() {
    return this.mode === '3d' && this.renderer3d ? this.renderer3d : this.renderer2d;
  }

  show(mode) {
    this.mode = mode;
    this.canvas2d.hidden = mode !== '2d';
    this.canvas3d.hidden = mode !== '3d';
    if (mode === '3d') {
      this.renderer3d.setCameraMode(this.cameraMode);
      this.renderer3d.activate();
    } else {
      this.renderer2d.activate();
    }
    this.onChange?.(mode);
  }

  /** Cambia de modo. Devuelve el modo en el que se queda ('2d' o '3d'). */
  async setMode(mode) {
    if (this.loading) return this.mode;
    if (mode === '2d') {
      if (this.mode !== '2d') this.show('2d');
      return '2d';
    }
    if (this.mode === '3d') return '3d';
    if (this.unavailable) {
      this.onError?.('Tu navegador no puede mostrar el modo 3D.');
      if (this.mode !== '2d') this.show('2d');
      return '2d';
    }
    this.loading = true;
    try {
      if (!this.renderer3d) {
        const { Renderer3D } = await import('../render3d/renderer3d.js');
        this.renderer3d = new Renderer3D({
          canvas: this.canvas3d,
          game: this.game,
          cameraMode: this.cameraMode,
          onContextLost: () => this.fallback('Se perdió el contexto gráfico 3D. Volvemos al modo 2D.'),
        });
      }
      this.show('3d');
    } catch (error) {
      console.error('No se pudo iniciar el modo 3D:', error);
      this.unavailable = true;
      this.renderer3d = null;
      this.show('2d');
      this.onError?.('No se pudo iniciar el modo 3D en este navegador. Se usa el modo 2D.');
    } finally {
      this.loading = false;
    }
    return this.mode;
  }

  fallback(message) {
    this.unavailable = true;
    this.show('2d');
    this.onError?.(message);
  }

  toggleMode() {
    return this.setMode(this.mode === '3d' ? '2d' : '3d');
  }

  toggleCamera() {
    if (this.mode !== '3d' || !this.renderer3d) return this.cameraMode;
    this.cameraMode = this.renderer3d.toggleCameraMode();
    return this.cameraMode;
  }

  resize() {
    this.renderer2d.resize();
    this.renderer3d?.resize();
  }

  screenToWorld(px, py) {
    return this.active.screenToWorld(px, py);
  }

  update(dt) {
    if (this.mode === '3d') this.renderer3d.update(dt);
    else if (this.mode === '2d') this.renderer2d.update(dt);
  }

  draw() {
    if (this.mode === '3d') {
      this.renderer3d.draw();
      // El minimapa sigue siendo 2D: usa el mapa estático del renderizador 2D
      this.minimapTick = (this.minimapTick + 1) % 3;
      if (this.minimapCanvas && this.minimapTick === 0) {
        drawMinimap(this.minimapCanvas, this.game, this.renderer2d.staticCanvas, this.renderer3d.minimapView());
      }
    } else if (this.mode === '2d') {
      this.renderer2d.draw();
    }
  }
}
