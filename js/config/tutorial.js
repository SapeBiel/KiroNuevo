// Pasos del tutorial. done(game) se evalúa cada fotograma sobre el estado real del juego.

export const TUTORIAL_STEPS = [
  {
    id: 'move',
    title: 'Conduce la furgoneta',
    text: 'Usa W A S D o las flechas del teclado (o mantén pulsado el ratón sobre el mapa) para moverte por las calles.',
    done: (game) => game.state.player.distanceDriven > 120,
  },
  {
    id: 'depot',
    title: 'Ve al almacén',
    text: 'Tu primer pedido ya está preparado. Conduce hasta el almacén amarillo, dentro del círculo marcado.',
    done: (game) => game.isPlayerInDepot() || game.state.player.cargo.length > 0,
  },
  {
    id: 'load',
    title: 'Carga el paquete',
    text: 'Pulsa E (o el botón de la pantalla) para cargar el paquete en la furgoneta. Tiene capacidad limitada.',
    done: (game) => game.state.player.cargo.length > 0 || game.state.stats.deliveries > 0,
  },
  {
    id: 'drive',
    title: 'Busca el destino',
    text: 'El destino tiene un pin de color y un haz de luz, y aparece en el minimapa. Llega hasta su círculo de entrega.',
    done: (game) => game.getDeliverableOrders().length > 0 || game.state.stats.deliveries > 0,
  },
  {
    id: 'deliver',
    title: 'Entrega el pedido',
    text: 'Ya estás en la zona de entrega. Pulsa E para confirmar y cobrar.',
    done: (game) => game.state.stats.deliveries > 0,
  },
  {
    id: 'upgrade',
    title: 'Invierte tus beneficios',
    text: 'Abre el panel de Mejoras (tecla 2) y compra tu primera mejora. Cada euro que reinviertas hace crecer la empresa.',
    done: (game) => Object.values(game.state.upgrades).some((lvl) => lvl > 0),
  },
  {
    id: 'finish',
    title: '¡Ya eres repartidor!',
    text: 'Acepta más pedidos en el panel de Pedidos (tecla 1), sube de nivel y desbloquea empleados, camiones y drones.',
    done: (game) => game.state.tutorial.finishAcknowledged === true,
    needsAck: true,
  },
];
