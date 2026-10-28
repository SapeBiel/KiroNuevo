// Logros. progress(state) devuelve [actual, objetivo].

const total = (s) => s.stats.deliveries;
const earned = (s) => s.stats.totalEarned;

// Objetivo: al menos el 50 % de las entregas son automáticas, con un mínimo de 40 entregas.
function automationProgress(s) {
  const t = s.stats.deliveries;
  const auto = s.stats.workerDeliveries + s.stats.droneDeliveries;
  const percent = t > 0 ? (auto / t) * 100 : 0;
  if (t < 40) return [Math.min(49, Math.floor(percent * (t / 40))), 50];
  return [Math.min(50, Math.floor(percent)), 50];
}

export const ACHIEVEMENTS = [
  { id: 'first_delivery', icon: '🎉', name: 'Primer paquete', desc: 'Completa tu primera entrega.', money: 20, xp: 5, progress: (s) => [total(s), 1] },
  { id: 'deliveries_10', icon: '📬', name: 'Cartero en prácticas', desc: 'Completa 10 entregas.', money: 50, xp: 20, progress: (s) => [total(s), 10] },
  { id: 'earn_1000', icon: '💰', name: 'Primeros mil', desc: 'Gana 1.000 € en total.', money: 100, xp: 30, progress: (s) => [earned(s), 1000] },
  { id: 'first_vehicle', icon: '🚐', name: 'Flota creciente', desc: 'Compra una segunda furgoneta.', money: 150, xp: 40, progress: (s) => [s.vehicles.length, 2] },
  { id: 'first_hire', icon: '🤝', name: 'Primer empleado', desc: 'Contrata a tu primer trabajador.', money: 150, xp: 40, progress: (s) => [s.workers.length, 1] },
  { id: 'streak_5', icon: '🔥', name: 'En racha', desc: 'Encadena 5 entregas seguidas a tiempo.', money: 120, xp: 40, progress: (s) => [s.stats.bestStreak, 5] },
  { id: 'new_zone', icon: '🗺️', name: 'Nuevos horizontes', desc: 'Desbloquea un nuevo barrio.', money: 300, xp: 60, progress: (s) => [Object.values(s.zones).filter(Boolean).length - 1, 1] },
  { id: 'urgent_10', icon: '⚡', name: 'Siempre a tiempo', desc: 'Entrega 10 pedidos urgentes a tiempo.', money: 400, xp: 80, progress: (s) => [s.stats.urgentOnTime, 10] },
  { id: 'deliveries_100', icon: '🏅', name: 'Centenario', desc: 'Realiza 100 entregas.', money: 500, xp: 100, progress: (s) => [total(s), 100] },
  { id: 'level_5', icon: '⭐', name: 'Empresa consolidada', desc: 'Alcanza el nivel 5.', money: 500, xp: 0, progress: (s) => [s.level, 5] },
  { id: 'rep_80', icon: '🌟', name: 'Reputación de oro', desc: 'Alcanza 80 de reputación.', money: 800, xp: 100, progress: (s) => [Math.floor(s.reputation), 80] },
  { id: 'earn_10000', icon: '🏦', name: 'Pequeña fortuna', desc: 'Gana 10.000 € en total.', money: 800, xp: 150, progress: (s) => [earned(s), 10000] },
  { id: 'automation', icon: '⚙️', name: 'Negocio automatizado', desc: 'Con al menos 40 entregas, que la mitad sean de empleados o drones.', money: 1500, xp: 200, progress: automationProgress },
  { id: 'all_zones', icon: '🌆', name: 'Dueño de la ciudad', desc: 'Desbloquea todas las zonas de la ciudad.', money: 5000, xp: 400, progress: (s) => [Object.values(s.zones).filter(Boolean).length, 5] },
  { id: 'first_drone', icon: '🛸', name: 'Era de los drones', desc: 'Compra tu primer dron.', money: 2000, xp: 250, progress: (s) => [s.drones.length, 1] },
  { id: 'drone_fleet', icon: '🐝', name: 'Flota de drones', desc: 'Ten 5 drones en activo.', money: 6000, xp: 500, progress: (s) => [s.drones.length, 5] },
  { id: 'level_10', icon: '👑', name: 'Gigante logístico', desc: 'Alcanza el nivel 10.', money: 4000, xp: 0, progress: (s) => [s.level, 10] },
  { id: 'earn_100000', icon: '🏆', name: 'Imperio del reparto', desc: 'Gana 100.000 € en total.', money: 10000, xp: 800, progress: (s) => [earned(s), 100000] },
];
