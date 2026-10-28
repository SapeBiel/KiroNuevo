# Notas de trabajo

## Lleida (OSM): DESHECHO por el usuario. No reintroducir.

## Ciudad variable: IMPLEMENTADO, SIN PROBAR (terminal bloqueada por el sandbox)
- cityMap.js: createCity(seed) -> 11 x 8 manzanas 5-8 casillas, calles 2-4 (bordes 3, una avenida 4 por sentido),
  supermanzanas (removedH/removedV, city.segmentOpen.h(j,c)/v(k,r)), plazas con fuente, parques variables.
  city.vRoads/hRoads/cols/rows/blocks/plazas. Si checkConnected falla se regenera sin supermanzanas.
- Semilla: state.citySeed + state.cityLayout (CITY_LAYOUT_VERSION=2); Game.create({seed}) / peekSavedCitySeed().
  Las pruebas usan DEFAULT_CITY_SEED en fresh().
- Adaptados: pathfinding (city.width, LRU 64), mapLayer (dibujo variable, escala <= 4096 px),
  props3d (barreras con city.width, buildFountains), buildings3d (afueras con cols/rows extendidas,
  garaje solo si fw >= 80), renderer3d (fuentes), storage, state, game, tests.
- No queda ningún uso de BLOCK_PITCH / MAP_TILES_* / ROAD_WIDTH.

## Colisiones del jugador: REHECHAS, SIN PROBAR
- playerVehicle.js: ya no se rechaza el movimiento/giro; se mueve en subpasos de 6 px y depenetrate() empuja
  los 3 círculos fuera de las casillas sólidas. respondToWall(): de frente (into > 0.8) para o rebota;
  de refilón resbala, pierde poca velocidad y alinea el morro con la pared. Acelerando contra una pared
  se puede girar en el sitio (runtime.wallContact).

## Gráficos: IMPLEMENTADO, SIN PROBAR
- render3d/postfx.js: escena a RT HalfFloat MSAA, bright pass + blur (1/2 y 1/4), composite ACES + grading + viñeta + grano.
- Etiquetas/pines en OVERLAY_LAYER (1), pintados tras el composite con autoClear=false y shadowMap.autoUpdate=false.
- QUALITY alta/media/baja en renderer3d (settings.graphics, Menú → Gráficos 3D). Nubes (sprites). Cristal = MeshStandard con env.

## Farolas derribables
- Lógica: `js/systems/streetLamps.js` (runtime.brokenLamps Map índice→{age,dirX,dirY,rising}; 10 s; caída 0.55 s; se levanta 0.8 s; espera si el coche está encima). Llamado desde updatePlayerVehicle tras el movimiento. Evento `lampHit`. Frena ×0.94.
- 3D: props3d buildLamps().update(broken, lampPose) (poste gira sobre su base, bombilla oculta, muñón con frustumCulled=false). Luces reales saltan farolas rotas.
- 2D: farolas ya no van en el mapa estático; renderer.drawLampPosts() cada fotograma; noche ignora rotas. Sonido 'lamp'.
