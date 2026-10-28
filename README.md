# Parcel Empire: Delivery Tycoon

Juego de gestión y reparto de paquetes en 3D (con vista 2D cenital opcional). Empiezas con un almacén, una furgoneta y un único pedido, y acabas dirigiendo una red logística con empleados, camiones y drones.

Está hecho con JavaScript moderno (módulos ES nativos), Canvas y [Three.js](https://threejs.org/) r160, incluido en `js/vendor/` (licencia MIT). **No necesita instalar nada ni compilar.**

## Cómo arrancarlo

Los módulos ES no se pueden cargar abriendo `index.html` con doble clic, así que hace falta un servidor local. Elige una opción:

**Opción 1 · Windows (no requiere instalar nada)**

1. Haz doble clic en `iniciar.bat` (o ejecuta `powershell -ExecutionPolicy Bypass -File serve.ps1`).
2. Se abre el navegador en `http://localhost:8080/`. Para otro puerto: `serve.ps1 -Port 8081`.
3. Cierra la ventana (o pulsa `Ctrl+C`) para detener el servidor.

**Opción 2 · Si tienes Node.js o Python**

```
npx serve .
python -m http.server 8080
```

Después abre la dirección que indique el comando.

## La ciudad

Cada partida nueva genera una ciudad distinta a partir de una semilla aleatoria (se guarda con la partida, así que al cargarla vuelve la misma ciudad). Hay 11 × 8 manzanas de tamaños variados, calles de 2 a 4 casillas de ancho con una gran avenida en cada sentido, supermanzanas donde desaparece un tramo de calle (centros comerciales, naves, torres o grandes parques, que crean calles en T), plazas peatonales con fuente por las que se puede circular y nombres de calle barajados. Al reiniciar la partida sale una ciudad nueva.

Las partidas guardadas con la versión anterior (ciudad fija) conservan el progreso, pero estrenan ciudad: sus pedidos en curso se descartan y la furgoneta vuelve al almacén.

## Gráficos 3D

El modo 3D usa un post-procesado propio: imagen HDR con antialiasing, brillo (bloom) en luces, faros y ventanas de noche, mapeo de tonos ACES, corrección de color según la hora (cálida al atardecer, azulada de noche), viñeta y un grano muy suave. Las torres de cristal reflejan el cielo y hay nubes que se mueven con el viento. Las etiquetas y pines se pintan encima, sin filtros, para que se lean bien.

En **Menú → Gráficos 3D** se elige la calidad (se guarda): **Alta** (todo, sombras de 4096 px), **Media** (sin brillo, sombras de 2048 px, resolución algo menor) o **Baja** (sin post-procesado ni nubes, para ordenadores lentos).

## Controles

| Acción | Teclas |
| --- | --- |
| Conducir | `W A S D` o flechas (también mantener pulsado el ratón/dedo sobre el mapa) |
| Cargar en el almacén / entregar en destino | `E` (o el botón que aparece en pantalla) |
| Derrapar | Mantener `Espacio` (o `Mayús`) mientras giras a buena velocidad; al soltar tras más de medio segundo, turbo. En táctil, botón ⤿ |
| Abrir paneles | `1` Pedidos · `2` Mejoras · `3` Equipo · `4` Empresa · `5` Logros |
| Sonido | `M` |
| Vista 3D / 2D | `V` |
| Cámara 3D: exterior, conductor (con volante y salpicadero) o aérea | `C` (rueda del ratón: zoom) |
| Menú y pausa | `P` |
| Cerrar ventana | `Esc` |

En pantallas táctiles aparecen botones de dirección y de acción.

## Cómo se juega

1. **Cargar:** conduce al almacén (círculo amarillo) y pulsa `E`. La capacidad del vehículo (huecos) limita lo que puedes llevar.
2. **Entregar:** ve al pin de color (con haz de luz y en el minimapa) hasta el círculo de entrega y pulsa `E`. Cobras al instante. En la vista del conductor te guía el Parcel Nav; la mejora *Flecha guía* (Mejoras → Vehículos) añade una flecha pequeña que solo señala entregas.
3. **Crecer:** reinvierte en mejoras de vehículo, almacén y empresa; sube de nivel y desbloquea pedidos urgentes, medianos, grandes, frágiles y contratos comerciales.
4. **Automatizar:** desde el nivel 4 puedes contratar repartidores y preparadores (con ✏️ en el panel Equipo les cambias el nombre) (necesitas plazas de garaje y un vehículo libre para cada repartidor). Los sueldos y el mantenimiento se pagan al final de cada jornada (5 minutos).
5. **Expandir la ciudad:** abre barrios nuevos desde el panel Empresa (Residencial → Centro → Comercial → Industrial → Metropolitana).
6. **Drones:** a partir del nivel 8 (y con la sede ampliada) se investiga el Programa de drones, el Centro de control y los drones avanzados y de gran capacidad.

Detalles que conviene saber:

- Los pedidos urgentes pagan más pero tienen plazo. Si llegas tarde cobras menos, nunca pierdes dinero.
- Los envíos frágiles se dañan con golpes fuertes (la recompensa baja) y solo los entrega el jugador.
- Encadenar entregas a tiempo da una bonificación de racha de hasta +32 %.
- Empleados y drones esperan 5 segundos antes de quedarse un pedido listo, para que el jugador tenga prioridad.
- El gasto de combustible y los sueldos nunca dejan el saldo en negativo.
- La partida se guarda sola (localStorage) cada pocos segundos y al comprar o subir de nivel. Los trayectos automáticos en curso se reinician al recargar: sus pedidos vuelven al almacén.

## Estructura

```
index.html            Página y esqueleto de la interfaz
css/style.css         Estilos
js/config/            Datos: mejoras, vehículos, empleados, drones, zonas, logros, tutorial
js/core/              Estado, bucle de juego (Game), guardado, eventos, utilidades
js/world/             Generación de la ciudad, colisiones y rutas
js/systems/           Lógica: pedidos, economía, mejoras, flota, empleados, drones, misiones...
js/render/            Canvas 2D: mapa, vehículos, drones, efectos, minimapa, noche; views.js alterna 2D/3D
js/render3d/          Three.js: edificios y afueras, vehículos con cabina, efectos, cielo y luces
js/vendor/            Three.js (r160, MIT)
js/ui/                Interfaz: HUD, paneles, modales, notificaciones, sonido, entrada
tests/                Pruebas automáticas en el navegador
tools/static-check.ps1 Comprobación estática sin Node (llaves e importaciones)
```

La lógica (`js/core`, `js/systems`, `js/world`) no usa DOM ni canvas; el renderizado y la interfaz solo leen el estado y escuchan eventos.

## Pruebas

- **Pruebas en el navegador:** con el servidor en marcha abre `http://localhost:8080/tests/index.html`. Comprueban ciudad y rutas, conducción y colisiones, el ciclo completo de pedidos y pagos (sin cobros dobles), capacidad, mejoras, empleados, drones, jornadas, guardado/carga, la interfaz y el arranque real de la página. Incluyen una simulación de una hora de juego que informa del ritmo de progresión.
- **Comprobación estática (sin Node):** `powershell -ExecutionPolicy Bypass -File tools\static-check.ps1` revisa el equilibrio de llaves y que cada `import` exista en el módulo de origen.

## Ajustar el equilibrio

Todo el contenido está en `js/config/`: precios y niveles de las mejoras (`upgrades.js`), vehículos, sueldos, drones, zonas, recompensas por paquete (`packages.js`) y constantes generales como la duración de la jornada (`constants.js`).
