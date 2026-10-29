// Pasos del tutorial. done(game) se evalúa cada fotograma sobre el estado real del juego.
// Cada paso también se da por hecho si ya se ha llegado más lejos (por ejemplo, con una entrega hecha).

const delivered = (game) => game.state.stats.deliveries > 0;
const loadedOrLater = (game) => game.state.player.cargo.length > 0 || delivered(game);

export const TUTORIAL_STEPS = [
  {
    id: 'walk',
    title: 'Muévete por el almacén',
    text: 'Estás dentro del almacén. Anda con W A S D, corre con Mayús, salta con Espacio y mira con el ratón (haz clic en la vista para capturarlo; Esc lo suelta).',
    done: (game) => game.state.player.foot.walked > 40 || game.state.player.mode === 'drive' || delivered(game),
  },
  {
    id: 'pick',
    title: 'Recoge el producto de la cinta',
    text: 'Tu primer pedido es un «Libro de bienvenida». Sale de recepción por la cinta transportadora: ponte a su lado, míralo y pulsa E para cogerlo. Si se te escapa, cae al cajón del final de la cinta.',
    done: (game) => game.state.stats.itemsPicked > 0 || delivered(game),
  },
  {
    id: 'pack',
    title: 'Empaquétalo en tu mesa',
    text: 'Lleva el libro a tu mesa de empaquetado (la del centro, con el suelo marcado). Pulsa E para dejarlo y otra vez E para meterlo en una caja. Los pedidos con varios productos necesitan todos en la mesa.',
    done: (game) => game.state.stats.boxesPacked > 0 || delivered(game),
  },
  {
    id: 'dispatch',
    title: 'Regístralo en expedición',
    text: 'Lleva la caja a la estantería de expedición, junto a la fachada a la derecha, y pulsa E. Después vuelve a pulsar E para cogerla y llevarla a la furgoneta.',
    done: (game) => game.state.stats.boxesDispatched > 0 || loadedOrLater(game),
  },
  {
    id: 'load',
    title: 'Carga la caja',
    text: 'Sal por la puerta peatonal de la fachada y lleva la caja a la parte trasera de la furgoneta, en el patio. Pulsa E para cargarla.',
    done: loadedOrLater,
  },
  {
    id: 'drive',
    title: 'Sube y conduce',
    text: 'Ponte junto a la puerta del conductor (lado izquierdo) y pulsa E para subir. Conduce hasta el pin de color del destino (también sale en el minimapa) y para dentro de su círculo.',
    done: (game) => game.getDeliverableOrders().length > 0 || delivered(game),
  },
  {
    id: 'deliver',
    title: 'Entrega en la puerta',
    text: 'Pulsa E para bajarte, saca la caja de la trasera con E y llévala andando hasta la puerta del destinatario. Allí, E para entregarla y cobrar.',
    done: delivered,
  },
  {
    id: 'upgrade',
    title: 'Invierte tus beneficios',
    text: 'Las mejoras solo se compran desde la oficina. Vuelve al almacén, entra en la oficina acristalada (esquina del fondo a la izquierda), usa el ordenador con E y compra tu primera mejora en Mejoras.',
    done: (game) => Object.values(game.state.upgrades).some((lvl) => lvl > 0),
  },
  {
    id: 'finish',
    title: '¡Ya eres repartidor!',
    text: 'Vuelve al almacén y prepara más pedidos. Desde el nivel 4 podrás contratar preparadores que trabajan en sus puestos del almacén y repartidores que entregan solos.',
    done: (game) => game.state.tutorial.finishAcknowledged === true,
    needsAck: true,
  },
];
