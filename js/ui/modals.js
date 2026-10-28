// Ventanas modales: bienvenida, resumen de jornada, menú, ayuda y confirmaciones.

import { escapeHtml, formatInt, formatMoney } from '../core/util.js';
import { levelTitle } from '../config/levels.js';

export class ModalManager {
  constructor(root, onChange) {
    this.root = root;
    this.onChange = onChange;
    this.stack = [];
  }

  get isOpen() {
    return this.stack.length > 0;
  }

  open({ id, title, html, className = '', dismissable = true, onClose = null, onAction = null }) {
    if (id && this.stack.some((m) => m.id === id)) return null;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
      <div class="modal-body">${html}</div></div>`;
    const entry = { id, overlay, dismissable, onClose, previousFocus: document.activeElement };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && dismissable) this.close(entry);
      const actionEl = e.target.closest('[data-modal-action]');
      if (actionEl) {
        const action = actionEl.dataset.modalAction;
        if (action === 'close') this.close(entry);
        else onAction?.(action, entry, actionEl);
      }
    });
    this.root.appendChild(overlay);
    this.stack.push(entry);
    overlay.querySelector('[data-autofocus], button')?.focus();
    this.onChange(this.stack.length);
    return entry;
  }

  close(entry) {
    const index = this.stack.indexOf(entry);
    if (index < 0) return;
    this.stack.splice(index, 1);
    entry.overlay.remove();
    entry.previousFocus?.focus?.({ preventScroll: true });
    entry.onClose?.();
    this.onChange(this.stack.length);
  }

  closeById(id) {
    const entry = this.stack.find((m) => m.id === id);
    if (entry) this.close(entry);
  }

  /** Cierra la ventana superior si se puede descartar. Devuelve true si cerró algo. */
  closeTop() {
    const entry = this.stack[this.stack.length - 1];
    if (!entry || !entry.dismissable) return false;
    this.close(entry);
    return true;
  }
}

export function welcomeHtml() {
  return `
    <div class="modal-hero" aria-hidden="true">📦🚐🏡</div>
    <h2>Parcel Empire</h2>
    <p class="modal-lead">Eres el dueño de una pequeña empresa de mensajería. Tienes un almacén, una furgoneta y un primer pedido.
    Entrega paquetes, reinvierte las ganancias y convierte tu negocio en una gran red logística con empleados, camiones y drones.</p>
    <div class="controls-grid">
      <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> o flechas <span>Conducir</span></div>
      <div><kbd>E</kbd> <span>Cargar y entregar</span></div>
      <div><kbd>Espacio</kbd> <span>Derrapar al girar (suelta para turbo)</span></div>
      <div><kbd>1</kbd>–<kbd>5</kbd> <span>Abrir paneles</span></div>
      <div><kbd>V</kbd> <kbd>C</kbd> <span>Vista 3D / 2D y cámara</span></div>
      <div>Ratón / dedo <span>Mantén pulsado el mapa para ir hacia el puntero</span></div>
    </div>
    <div class="modal-actions"><button class="btn btn-primary btn-lg" data-modal-action="start" data-autofocus>¡Empezar a repartir!</button></div>`;
}

export function helpHtml() {
  return `
    <h2>Cómo se juega</h2>
    <ol class="help-list">
      <li><b>Cargar:</b> ve al almacén (círculo amarillo) y pulsa <kbd>E</kbd>. Solo caben tantos paquetes como huecos tenga tu vehículo.</li>
      <li><b>Entregar:</b> ve al pin de color (con haz de luz y en el minimapa) hasta el círculo de entrega y pulsa <kbd>E</kbd>. Cobrarás al instante. En la vista del conductor te guía el Parcel Nav, y la mejora <i>Flecha guía</i> añade una flecha pequeña.</li>
      <li><b>Derrape:</b> a buena velocidad, gira y mantén <kbd>Espacio</kbd>. Si derrapas más de medio segundo y sueltas sin chocar, ganas un turbo (cuanto más largo el derrape, más dura).</li>
      <li><b>Urgentes:</b> pagan más, pero tienen límite de tiempo. Si llegas tarde cobras menos, nunca pierdes dinero.</li>
      <li><b>Rachas:</b> encadena entregas a tiempo para ganar hasta un +32 % extra.</li>
      <li><b>Mejoras:</b> mejora tu vehículo, el almacén y la empresa. Cada mejora cambia de verdad el juego.</li>
      <li><b>Empleados:</b> desde el nivel 4 puedes contratar repartidores y preparadores. Cobran sueldo al acabar cada jornada.</li>
      <li><b>Ciudad:</b> desbloquea nuevos barrios en el panel Empresa para acceder a pedidos más rentables.</li>
      <li><b>Drones:</b> al llegar al nivel 8 podrás investigar la flota de drones automatizados.</li>
    </ol>
    <div class="controls-grid">
      <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / flechas <span>Conducir</span></div>
      <div><kbd>E</kbd> <span>Interactuar (cargar y entregar)</span></div>
      <div><kbd>Espacio</kbd> o <kbd>Mayús</kbd> <span>Derrapar (mantén pulsado mientras giras)</span></div>
      <div><kbd>1</kbd>–<kbd>5</kbd> <span>Pedidos, Mejoras, Equipo, Empresa, Logros</span></div>
      <div><kbd>M</kbd> <span>Sonido</span></div>
      <div><kbd>V</kbd> <span>Cambiar entre vista 3D y 2D</span></div>
      <div><kbd>C</kbd> <span>Cámara 3D: exterior / conductor / aérea (rueda del ratón: zoom)</span></div>
      <div><kbd>P</kbd> <span>Menú / pausa</span></div>
      <div><kbd>Esc</kbd> <span>Cerrar ventana</span></div>
    </div>
    <div class="modal-actions"><button class="btn btn-primary" data-modal-action="close" data-autofocus>Entendido</button></div>`;
}

const GRAPHICS_LABELS = { alta: 'Alta (brillos y sombras finas)', media: 'Media', baja: 'Baja (equipos lentos)' };

export function menuHtml({ sound, graphics = 'alta' }) {
  return `
    <h2>Menú</h2>
    <p class="muted">El juego está en pausa mientras este menú está abierto. La partida se guarda automáticamente.</p>
    <div class="menu-list">
      <button class="btn btn-primary" data-modal-action="close" data-autofocus>▶ Continuar</button>
      <button class="btn" data-modal-action="save">💾 Guardar ahora</button>
      <button class="btn" data-modal-action="sound">${sound ? '🔊 Sonido: activado' : '🔇 Sonido: desactivado'}</button>
      <button class="btn" data-modal-action="graphics">🎨 Gráficos 3D: ${GRAPHICS_LABELS[graphics] ?? GRAPHICS_LABELS.alta}</button>
      <button class="btn" data-modal-action="help">❓ Cómo se juega</button>
      <button class="btn btn-danger" data-modal-action="reset">🗑 Reiniciar partida</button>
    </div>`;
}

export function renameHtml({ name, icon, typeName, maxLength }) {
  return `
    <h2>${icon} Cambiar nombre</h2>
    <p class="muted">${escapeHtml(typeName)} · ahora se llama <b>${escapeHtml(name)}</b>.</p>
    <label class="field">
      <span>Nuevo nombre</span>
      <input class="text-input" id="rename-input" type="text" maxlength="${maxLength}" autocomplete="off" spellcheck="false"
        value="${escapeHtml(name)}" data-autofocus aria-describedby="rename-error">
    </label>
    <p class="form-error" id="rename-error" role="alert"></p>
    <div class="modal-actions">
      <button class="btn" data-modal-action="close">Cancelar</button>
      <button class="btn btn-primary" data-modal-action="save-name">Guardar</button>
    </div>`;
}

export function confirmResetHtml() {
  return `
    <h2>¿Reiniciar la partida?</h2>
    <p>Perderás todo tu progreso: dinero, mejoras, empleados, vehículos, drones y zonas desbloqueadas. <b>Esta acción no se puede deshacer.</b></p>
    <div class="modal-actions">
      <button class="btn" data-modal-action="close" data-autofocus>Cancelar</button>
      <button class="btn btn-danger" data-modal-action="confirm-reset">Sí, borrar todo y empezar de nuevo</button>
    </div>`;
}

export function summaryHtml(s) {
  const stars = '★'.repeat(s.stars) + '☆'.repeat(3 - s.stars);
  const row = (label, value, cls = '') => `<tr class="${cls}"><td>${label}</td><td>${value}</td></tr>`;
  const expenses = s.fuel + s.salaries + s.upkeep;
  return `
    <div class="modal-hero small" aria-hidden="true">🌅</div>
    <h2>Resumen de la jornada ${s.day}</h2>
    <div class="stars" aria-label="Valoración: ${s.stars} de 3 estrellas">${stars}</div>
    <table class="summary-table">
      ${row('Entregas completadas', formatInt(s.deliveries))}
      ${row('Pedidos tardíos', formatInt(s.late))}
      ${row('Mejor racha', formatInt(s.bestStreak))}
      ${row('Ingresos', `+${formatMoney(s.income)}`, 'is-positive')}
      ${row('Combustible', `-${formatMoney(s.fuel)}`, 'is-negative')}
      ${row('Sueldos', `-${formatMoney(s.salaries)}`, 'is-negative')}
      ${row('Mantenimiento', `-${formatMoney(s.upkeep)}`, 'is-negative')}
      ${row('Gastos totales', `-${formatMoney(expenses)}`, 'is-negative total')}
      ${row('Beneficio neto', `${s.net >= 0 ? '+' : ''}${formatMoney(s.net)}`, `${s.net >= 0 ? 'is-positive' : 'is-negative'} total`)}
    </table>
    ${s.unpaid > 0 ? `<p class="callout warn">No pudiste pagar ${formatMoney(s.unpaid)} de gastos: tu reputación ha bajado.</p>` : ''}
    <p class="muted">Nivel ${s.level} · ${levelTitle(s.level)} · Saldo: ${formatMoney(s.money)}</p>
    <div class="modal-actions"><button class="btn btn-primary btn-lg" data-modal-action="next-day" data-autofocus>Empezar la jornada ${s.day + 1}</button></div>`;
}
