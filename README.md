# Parcel Empire: Delivery Tycoon

Juego de gestión y reparto de paquetes en 3D. Empiezas con un almacén, una furgoneta y un único pedido, y acabas dirigiendo una red logística con empleados, camiones y drones.

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
| Andar a pie | `W A S D` (adelante, atrás y de lado; flechas ← → giran). `Mayús` para correr |
| Saltar (a pie) | `Espacio` (una vez por pulsación, solo desde el suelo). En táctil, botón ⤿ |
| Mirar (a pie) | Ratón: haz clic en la vista para capturarlo y `Esc` para soltarlo. En táctil, arrastrar el dedo |
| Conducir | `W A S D` o flechas (también mantener pulsado el ratón/dedo sobre el mapa) |
| Coger de la cinta, empaquetar, registrar en expedición, cargar, sacar cajas, entregar, usar el ordenador, subir y bajar del vehículo | `E` (o el botón que aparece en pantalla) |
| Derrapar (al volante) | Mantener `Espacio` (o `Mayús`) mientras giras a buena velocidad; al soltar tras más de medio segundo, turbo. En táctil, botón ⤿ |
| Cambiar de aplicación en el ordenador de la oficina | `1` Pedidos · `2` Mejoras · `3` Equipo · `4` Empresa · `5` Logros · `0` Inicio |
| Sonido | `M` |
| Cámara 3D: exterior, conductor (con volante y salpicadero) o aérea | `C` (rueda del ratón: zoom) |
| Menú y pausa | `P` |
| Cerrar ventana | `Esc` |

En pantallas táctiles aparecen botones de dirección y de acción.

## Cómo se juega

El reparto se hace en persona, en primera persona: **cinta transportadora → recogida a mano → mesa → empaquetado → expedición → vehículo → puerta del cliente**.

1. **Recibir el pedido:** la aplicación Pedidos del ordenador de la oficina lista los productos de cada pedido, dónde está cada uno (recepción, cinta, cajón, manos, mesa o caja) y el destino. La tarjeta *En las manos* indica siempre el siguiente paso.
2. **Coger de la cinta:** los productos salen uno a uno de recepción (esquina del fondo a la derecha) y avanzan por la cinta. Cada producto tiene su aspecto (un libro es un libro, una botella, una bicicleta, un televisor...). Ponte junto a la cinta, mira el que pasa por delante y pulsa `E`. Si nadie lo coge, cae al **cajón de fin de línea** y se puede coger de ahí; nunca desaparece. Las manos aguantan un volumen de 3: tres productos pequeños o uno voluminoso.
3. **Empaquetar:** en tu mesa (la del cartel *Tu mesa*), `E` deja los productos y `E` otra vez cierra la caja, de un tamaño acorde a lo que lleva dentro. Un pedido con varios productos no se cierra hasta tenerlos todos en la mesa.
4. **Expedición:** lleva la caja a la estantería baja junto a la fachada y pulsa `E` para registrarla (es obligatorio antes de cargarla). Ahí esperan también las cajas de los preparadores; con `E` coges la siguiente.
5. **Cargar:** sal por la puerta peatonal de la fachada (los vehículos no caben) y lleva la caja a la trasera del vehículo, en el patio: `E`. La capacidad del vehículo (huecos) limita lo que puedes llevar.
6. **Conducir:** junto a la puerta del conductor, `E` para subir. Ve al pin de color del destino (con haz de luz y en el minimapa) y aparca en su círculo. En la vista del conductor te guía el Parcel Nav; la mejora *Flecha guía* añade una flecha pequeña.
7. **Entregar:** `E` para bajarte, `E` en la trasera para sacar la caja y llévala andando a la puerta del destinatario (círculo de color). Allí, `E` para cobrar.

El almacén tiene además una **oficina** acristalada (esquina del fondo a la izquierda) con mesa, silla, archivadores, librería, pizarra y ventanas. **Toda la gestión se hace desde su ordenador** (`E` junto a la mesa): no hay panel lateral. Al usarlo se enciende una pantalla de ordenador (el juego queda en pausa) con las aplicaciones Inicio, Pedidos, Mejoras, Equipo, Empresa y Logros; `Esc` o el botón ⏻ lo apagan. Por seguridad, la compra de mejoras además comprueba que estés a pie dentro de la oficina. Las estanterías A-F guardan el stock (son decorado: los productos de los pedidos llegan por la cinta).

Desde el nivel 4, los **preparadores** trabajan a la vista: cada uno tiene un puesto en una de las tres mesas del equipo, reserva un pedido libre, va al cajón de la cinta a por sus productos, los lleva a su mesa, los empaqueta (más rápido con la mejora de preparación) y deja la caja en expedición. Nunca tocan los pedidos que tú has empezado ni lo que llevas en las manos. Los **repartidores** y los drones cogen las cajas de expedición y las entregan solos. Sin preparadores, todos los pedidos se preparan a mano.

Más allá del día a día:

1. **Crecer:** reinvierte en mejoras de vehículo, almacén y empresa; sube de nivel y desbloquea pedidos urgentes, medianos, grandes, frágiles y contratos comerciales. *Preparación más rápida* también te hace andar más deprisa por el almacén.
2. **Cambiar de vehículo:** anda hasta otro vehículo libre aparcado en el patio y pulsa `E` junto a su puerta del conductor (con la carga vacía).
3. **Tu marca:** pulsa el nombre de la empresa (arriba a la izquierda), el botón *Personalizar* de la aplicación Empresa del ordenador o *Menú → Nombre, logotipo y colores* para cambiar el nombre, el eslogan, el logotipo y los colores. Se ven en la barra superior, en el almacén y en la rotulación de toda la flota (si marcas *Pintar toda la flota*, también la carrocería).
4. **Automatizar:** desde el nivel 4 puedes contratar repartidores y preparadores (con ✏️ en la aplicación Equipo del ordenador les cambias el nombre) (necesitas plazas de garaje y un vehículo libre para cada repartidor). Los sueldos y el mantenimiento se pagan al final de cada jornada (5 minutos).
5. **Expandir la ciudad:** abre barrios nuevos desde la aplicación Empresa del ordenador (Residencial → Centro → Comercial → Industrial → Metropolitana).
6. **Drones:** a partir del nivel 8 (y con la sede ampliada) se investiga el Programa de drones, el Centro de control y los drones avanzados y de gran capacidad.

Detalles que conviene saber:

- Los pedidos urgentes pagan más pero tienen plazo. Si llegas tarde cobras menos, nunca pierdes dinero.
- Los envíos frágiles se dañan con golpes fuertes (la recompensa baja) y solo los entrega el jugador.
- Encadenar entregas a tiempo da una bonificación de racha de hasta +32 %.
- Empleados y drones esperan 5 segundos antes de quedarse una caja de expedición, para que el jugador tenga prioridad. Nunca tocan los pedidos que estás preparando ni las cajas que llevas.
- Al recargar, se conserva lo que llevas en las manos y en la mesa, y lo que hay en la cinta y en el cajón. Lo que llevaba un preparador vuelve al cajón y sus cajas terminadas quedan en expedición.
- **Partidas de versiones anteriores:** el almacén ahora es más grande, así que cambia el plano de la ciudad. Esas partidas conservan el dinero, el nivel, las mejoras, la plantilla y la flota, pero estrenan ciudad una vez: sus pedidos en curso se descartan y empiezan al volante junto al almacén.
- Ya no hay vista 2D para elegir. El dibujo 2D solo se usa para el minimapa y como respaldo si el navegador no puede mostrar WebGL.
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
js/render/            Canvas 2D: minimapa y respaldo sin WebGL; views.js elige el 3D o el respaldo
js/render3d/          Three.js: edificios y afueras, vehículos con cabina, interior del almacén,
                      productos (products3d.js), personas (characters3d.js), efectos, cielo y luces
js/vendor/            Three.js (r160, MIT)
js/ui/                Interfaz: HUD, paneles, modales, notificaciones, sonido, entrada
tests/                Pruebas automáticas en el navegador
tools/static-check.ps1 Comprobación estática sin Node (llaves e importaciones)
```

La lógica (`js/core`, `js/systems`, `js/world`) no usa DOM ni canvas; el renderizado y la interfaz solo leen el estado y escuchan eventos.

## Pruebas

- **Pruebas en el navegador:** con el servidor en marcha abre `http://localhost:8080/tests/index.html`. Comprueban ciudad y rutas, conducción y colisiones, la cinta (avance, separación, cajón de fin de línea), el salto, la oficina, los preparadores trabajando de verdad, la expedición obligatoria, el ciclo completo de pedidos y pagos (sin cobros dobles), capacidad, mejoras, empleados, drones, jornadas, guardado/carga, la interfaz y el arranque real de la página. Incluyen una simulación de una hora de juego que informa del ritmo de progresión.
- **Comprobación estática (sin Node):** `powershell -ExecutionPolicy Bypass -File tools\static-check.ps1` revisa el equilibrio de llaves y que cada `import` exista en el módulo de origen.

## Ajustar el equilibrio

Todo el contenido está en `js/config/`: precios y niveles de las mejoras (`upgrades.js`), vehículos, sueldos, drones, zonas, recompensas por paquete (`packages.js`) y constantes generales como la duración de la jornada (`constants.js`).
