[Español](README.es.md)

# Mods de DFO Online

Mods del lado del cliente para **DFO Online** (la versión de escritorio), más el cargador compartido en el que se ejecutan. Los **mods** son solo de interfaz de usuario (UI) durante la ejecución: leen los propios datos del juego, nunca escriben en un servidor y nunca modifican un personaje ni una partida guardada. Los **cargadores e instaladores no son solo de interfaz** — parchean la versión local del juego en el disco (una etiqueta de página, `boot.js`, el registro de mods, algunos scripts del juego) y reaplican todo después de una actualización. No se sube nada a la red.

El repositorio contiene tres componentes:

- **`modloader/`** — el cargador y el kit de herramientas del instalador. Etiqueta la página del juego, sirve `assets/dfo-mods/boot.js`, mantiene el registro de los mods instalados y reaplica todo después de una actualización del juego.
- **`skillhud-mod/`** — el mod **Rastreador de Habilidades** (Skill Tracker): un panel HUD que muestra los usos de las habilidades rastreadas para el siguiente punto, configurable desde el menú ESC.
- **`uitweaks-mod/`** — el mod **Ajustes de Interfaz** (UI Tweaks): etiquetas de nivel de objeto y colores de material en la placa del mundo (montones de botín), configurable desde el menú ESC.

```text
README.md                 este archivo
modloader/
  boot.js                 servido como assets/dfo-mods/boot.js
  install.mjs             instalar/comprobar/desinstalar el cargador; --install-watch
  sync.mjs                autosincronización: cargador + cada mod registrado
  lib/
    game.mjs              almacén de versiones + descubrimiento de semilla (Linux/Windows/macOS)
    store.mjs             abrir una versión servida; superposición; leer/escribir/eliminar
    marker.mjs            Game/.dfo-mods/installed.json (cargador + mods)
    registry.mjs          registry.js servido + manifiesto del espacio de trabajo
    loader.mjs            asegurar/comprobar/eliminar el cargador
    autosync.mjs          unidades systemd (Linux) / launchd (macOS)
skillhud-mod/
  skillhud.js             el mod (HUD + panel ESC)
  install.mjs             sus parches + registro
uitweaks-mod/
  uitweaks.js             el mod (etiquetas/colores de placa + panel ESC)
  install.mjs             sus parches + registro
```

`modloader/mods.json` se genera en cada máquina y no se rastrea en el repositorio.

## Requisitos

- La **versión de escritorio** de DFO Online: AppImage de Linux, `.exe` de Windows o `.app` de macOS.
- [Node.js](https://nodejs.org/) 18 o superior — solo para los instaladores.
- Las dos carpetas mencionadas anteriormente, una al lado de la otra (un clon de este repositorio te proporciona eso).

**No se admite jugar en el navegador.** La versión de navegador es servida por el sitio web; no hay una versión local que parchear ni un almacén de versiones para superponer. Estas herramientas editan archivos en la máquina que ejecuta la versión de escritorio.

## Instalación

### Rastreador de Habilidades (también instala el cargador)

```bash
cd skillhud-mod
node install.mjs
```

Encuentra la versión que el juego ejecutará y la copia empaquetada de esa versión (la "semilla") por sí mismo, instala el cargador compartido si es necesario, aplica los parches de este mod y reporta la versión que parcheó. En Linux, ejecútalo **mientras el juego se está ejecutando**: la copia empaquetada reside dentro del montaje del AppImage para esa sesión.

Luego inicia o reinicia el juego.

### Ajustes de Interfaz (también instala el cargador)

```bash
cd uitweaks-mod
node install.mjs
```

Mismas reglas: instala el cargador compartido si es necesario, parchea los dos fragmentos del juego que construyen la placa del mundo, escribe `assets/dfo-uitweaks.js` y se registra a sí mismo. Luego inicia o reinicia el juego.

### Solo el cargador

```bash
node modloader/install.mjs
```

Esto instala la etiqueta de página, `assets/dfo-mods/boot.js`, un `assets/dfo-mods/registry.js` vacío y el registro de estado instalado. No carga ningún mod hasta que el instalador de un mod registre uno.

### Comprobaciones y desinstalación

```bash
node modloader/install.mjs --check        # 0 saludable, 1 obsoleto, 2 nada parcheable aún
node skillhud-mod/install.mjs --check
node uitweaks-mod/install.mjs --check

node skillhud-mod/install.mjs --uninstall  # solo este mod; el cargador/mods permanecen
node uitweaks-mod/install.mjs --uninstall
node modloader/install.mjs --uninstall     # se niega si hay mods registrados
node modloader/install.mjs --uninstall --force
```

Volver a ejecutar un instalador es seguro e idempotente; no se reescribe nada cuando ya está en su lugar.

### Dónde residen las cosas

| | datos del juego (parcheados aquí) | versión empaquetada (leída desde) |
|---|---|---|
| **Linux** (AppImage) | `~/.config/Daggerfall JavaScript/Game/` | el montaje del AppImage en ejecución (`/tmp/.mount_*/resources/app.asar`) |
| **Windows** (instalador) | `%APPDATA%\Daggerfall JavaScript\Game\` | `<carpeta de instalación>\resources\app.asar` |
| **Windows** (portátil) | igual | la carpeta donde se descomprime el `.exe` portátil — **inicia el juego, luego ejecuta el instalador mientras está en ejecución** |
| **macOS** | `~/Library/Application Support/Daggerfall JavaScript/Game/` | `/Applications/DFO Online.app/Contents/Resources/app.asar` |

La carpeta de datos se puede mover con la propia variable de entorno del juego `DAGGER_USER_DATA`; los instaladores también la respetan.

Si la detección automática falla (ruta de instalación inusual, exe portátil que ya se ha cerrado, una segunda copia del juego), indícale la versión manualmente:

```bash
node install.mjs --app="/ruta/a/resources/app.asar"
# también acepta: la carpeta resources/, la carpeta de la app, o DFO Online.app
node install.mjs --app="C:\Program Files\DFO Online"
```

`--seed=<dist extraído>` es el último recurso para una versión extraída en el disco (`.../resources/app/dist`, con `game-seed.json` junto a `dist`).

## Uso de los mods

Todo está en el **menú ESC (pausa) del juego → Mods** (tema Mejorado / Enhanced):

- **Recargar todo** en la barra inferior reimporta cada mod registrado (esa barra también lleva los créditos, el enlace al repositorio y las versiones cargadas).
- **Recargar** junto al nombre de un mod reimporta ese mod.
- La sección de cada mod contiene sus ajustes. Para el **Rastreador de Habilidades**: opacidad del panel, espaciado de filas, **Mostrar/Ocultar panel**, restablecer posición y la lista de verificación de habilidades rastreadas (tres columnas cuando el panel es lo suficientemente ancho, dos cuando no lo es).

Una recarga vuelve a leer el registro: un mod cuyo `MOD_BUILD` cambió se desmonta y reemplaza; un mod eliminado del registro se descarga; una importación sin cambios nunca afecta a la página. **No hay atajos de teclado para los mods.**

Las mismas funciones existen para las DevTools (Herramientas de desarrollador): `globalThis.__dfoReloadMods()`, `globalThis.__dfoModsReloadOne('skillhud')`, `globalThis.__dfoModsList()`.

## Reinstalación automática

Una actualización del juego reemplaza la versión servida, por lo que el cargador y cada mod deben ser reaplicados. Instala el programador compartido una vez:

```bash
node modloader/install.mjs --install-watch
```

Ejecuta `node modloader/sync.mjs` cuando `Game/state.json` o el `config.json` del lanzador cambien (una actualización preparada/activada, un lanzamiento):

- **Linux** — unidades de usuario de systemd `dfo-mod-sync.path` + `.service` (`journalctl --user -u dfo-mod-sync`).
- **macOS** — LaunchAgent `dev.dfo.modloader` (`~/Library/Logs/dfo-modloader.log`).
- **Windows** — sin observador de archivos; ejecuta `node modloader/sync.mjs` después de una actualización.

`sync.mjs` ejecuta el instalador del cargador, y luego cada mod listado en el `modloader/mods.json` generado, cada uno con `--if-needed`. El código de salida 2 ("nada parcheable en este momento") no es un fallo.

`node modloader/install.mjs --remove-watch` elimina el programador.
`node skillhud-mod/install.mjs --install-watch` hace lo mismo desde la carpeta del mod después de instalarlo.

## Después de una actualización del juego

Una **actualización de canal** prepara una nueva versión del juego mientras juegas; el siguiente lanzamiento la utiliza. Los instaladores apuntan a esa versión preparada, no a la que está a punto de ser eliminada.

Una **actualización del lanzador** (nuevo AppImage / `.exe` / `.dmg`) restablece el almacén y el juego ejecuta la versión empaquetada dentro de él, en la cual no se puede escribir. Las herramientas entonces construyen una **superposición local**: una carpeta de versión hecha de la versión empaquetada más los mods, numerada una versión por encima de la semilla (por ejemplo, `0.1.12919` → `0.1.12920`), y apuntan el juego hacia ella. La próxima versión real la reemplazará. Si llega un parche mientras la página del juego ya se está cargando, reinicia una vez.

## El cargador

`modloader/boot.js` (servido como `assets/dfo-mods/boot.js`) importa el registro servido:

```js
// assets/dfo-mods/registry.js
export const MODS = [
  { id: 'skillhud', name: 'Rastreador de Habilidades', spec: '../dfo-skillhud.js' },
];
```

`spec` es relativo a `assets/dfo-mods/` (la propia carpeta del módulo de registro, donde también reside `boot.js`). Un módulo de mod exporta:

| exportación | propósito |
|---|---|
| `MOD_BUILD` | un hash del texto del módulo (el instalador lo inyecta); un valor diferente al recargar significa "reemplazar la instancia en ejecución" |
| `install()` | montar el mod — llamado por el cargador, **nunca en tiempo de importación** |
| `unmount()` | eliminar todo lo que `install()` añadió |
| `mountPane(container)` | opcional; el cargador le da su propia sección en ESC → Mods |

El panel de Mods renderiza una sección por mod, encabezada con el `name` del registro. Las recargas usan el mismo ciclo de vida: desmontar, reimportar, instalar. El panel se desplaza en su propio pozo (la ventana del juego a su alrededor no se mueve), y su pie de página lleva los créditos, el enlace al repositorio y los hashes `MOD_BUILD` cargados.

### Añadir un mod

Crea una carpeta junto a `modloader/` con un instalador y un módulo, y usa el kit de herramientas del cargador:

```js
import { prepare, finalizeOverlay } from '../modloader/lib/store.mjs';
import { readMarker, writeMarker, setModEntry } from '../modloader/lib/marker.mjs';
import { ensureLoader, loaderStatus, loaderRecord } from '../modloader/lib/loader.mjs';
import { upsertRegistry, upsertManifest } from '../modloader/lib/registry.mjs';

const build = prepare({ log: console.log });      // abre la versión que el juego ejecutará
const store = build.store;
const loader = ensureLoader(store, { log: console.log }); // etiqueta del cargador + boot + registro

// parchear/leer/escribir a través de store:
//   store.findChunk({ ... })
//   store.write('assets/my-mod.js', bytes, { owned: true })
//   store.remove('assets/some-patch.js')

upsertRegistry(store, { id: 'mymod', name: 'Mi Mod', spec: '../my-mod.js' });
store.commit();                                    // index.json, atómicamente
finalizeOverlay(build);                            // nombra una superposición nueva
upsertManifest({ id: 'mymod', name: 'Mi Mod', dir: '../my-mod' });
```

Luego registra el cargador y el mod en el marcador (`Game/.dfo-mods/installed.json`) para que `--check` pueda verificarlos, y admite `--check`, `--if-needed`, `--uninstall` y `--install-watch`. `skillhud-mod/` es la implementación de referencia.

## Rastreador de Habilidades

Un panel HUD — una pieza nativa del sistema de diseño del HUD del juego — que rastrea las habilidades que eliges y muestra sus usos para el siguiente punto:

```text
31/69  Golpe Crítico (Critical Strike)
```

Cuando se acumulan suficientes usos para que la siguiente comprobación de habilidad otorgue el punto, la columna de usos se ilumina (color latón, con un brillo suave) — es el momento de descansar o merodear y dejar pasar el tiempo del juego. En el límite propio de una habilidad, la columna de usos muestra **máx** y se atenúa: 100 para una habilidad no dominada, 200 bajo **Habilidades Maestras**. Lee los mismos datos del personaje que muestran las propias pantallas de habilidades del juego.

El panel no lleva línea de título — es una pieza del HUD, y el editor Alt+U lo nombra "Rastreador de habilidades".

El panel usa los propios tokens de diseño `:root` del juego (`--bone`, `--dim`, `--brass`, `--brass-hi`, `--dfo-text-font`) con alternativas del tema clásico, por lo que sigue cualquier **Revisión General → Revisión de UI / tema Plus** que esté activo.

### Integración

- **Alt+U (editor de diseño del HUD)**: el panel vive dentro de la raíz `.hud` y se registra como una pieza de la tabla del editor (`{id:'dfoLT', sel:'.hud .dfo-lt', name:'Rastreador de habilidades'}`). Arrastrar, escalar, el interruptor de ocultar ✕, el restablecimiento con doble clic y la persistencia de la posición (`hudLayout`) son maquinaria del propio juego. Si una página ya se estaba ejecutando cuando se instaló el mod y omitió la pieza, el mod tiene un pequeño arrastre de respaldo que escribe la misma preferencia; una recarga hace que todo sea nativo.
- **ESC → Mods → Rastreador de Habilidades**: el panel de configuración descrito anteriormente.
- **Mostrar/ocultar**: el botón **Mostrar/Ocultar panel** del panel es la única vía. No hay atajos de teclado para los mods; el enfoque del teclado y la entrada del puntero del juego no se tocan.
- **Solo dentro del mundo**: el panel está oculto hasta que el juego le entrega al rastreador un personaje activo, por lo que la pantalla de título y el menú principal nunca lo muestran. Funciona con cualquier tema de HUD (Enhanced lo anida bajo `.hud`; classic lo deja en el cuerpo de la página). La entrada **Mods** del menú principal aún se abre y muestra los ajustes; el rastreador aparece cuando se carga un personaje.

### Qué parchea

1. `assets/worldTick-*.js` — la comprobación de habilidad mantiene `window.__playerEntity` apuntando al personaje activo, y el gancho de depuración de la aplicación ya no lo elimina. El alias de llamada minificada del gancho se captura, nunca se codifica de forma rígida.
2. `assets/enhancedMenu-*.js` — una entrada de riel (`Mods`) y un brazo de despacho que llama a `globalThis.__dfoModsPane`.
3. el fragmento del editor de diseño (ej. `revenantCard-*.js`) — la pieza `dfoLT` y la tabla de piezas exportada como `hz`.
4. `assets/dfo-skillhud.js` — el mod en sí.

El cargador posee la etiqueta de la página, `assets/dfo-mods/boot.js` y `assets/dfo-mods/registry.js`. Todo está anclado en la estructura, no en hashes de fragmentos o nombres minificados; un ancla faltante aborta antes de escribir.

### Las matemáticas

El panel refleja la propia pantalla de habilidades del juego, incluyendo el nivel que el juego realmente usa:

    need = floor(value * skillMult * advancementMultiplier * 1.04^L * 2/5) + 1
    have = floor(uses * (65536 - (reflexes-2 << 13)) / 65536)

Para los personajes en línea, `L` no es el nivel del personaje (cambiado en 0.1.12011): es `max(level, skillSumLevel)`, donde la suma de habilidades cuenta todas las habilidades primarias, todas las habilidades principales excepto la más baja, y la habilidad menor más alta, cada una con un límite suave (los valores por encima de 100 cuentan como 100 a menos que estén dominados; los valores dominados comprimen 101–200 en 100–140 más las bonificaciones de hitos de 125/150/175/200). Esa suma se mapea a un nivel 1–45 a través de la propia curva del juego. Para los personajes sin conexión, `L` es el nivel del personaje. Las habilidades dominadas por encima de 100 usan los multiplicadores de costo de 1.5×/2×/4× (100–124 / 125–149 / 150–199) y el almacenamiento de `skillProgress` del juego.

## Ajustes de Interfaz

Cada fila de objeto en la placa del mundo (el panel de mira sobre un montón de botín, un cadáver, un contenedor) lleva su grado de material, su palabra de material y su tipo:

```text
T5 · Sable de Plata · Hoja Larga
T4 · Yelmo de Acero · Placas
T2 · Grebas · Malla
```

- **T\<n\>** es el nivel del objeto en el orden de materiales de Daggerfall por el que el propio juego clasifica: **Cuero 1, Malla 2, Hierro 3, Acero 4, Plata 5, Élfico 6, Enano 7, Mithril 8, Adamantita 9, Ébano 10, Orco 11, Daédrico 12**. La armadura empaqueta su clase en el byte alto y el grado de metal en el bajo (`Yelmo de Acero` = 513, `Yelmo Daédrico` = 521), por lo que el cuero y la malla son sus propios niveles y las placas toman el de su metal.
- La palabra del material se añade solo cuando el nombre del juego ya no la lleva (el juego prefija Acero y superiores, no Hierro; una coraza de cuero ya dice Cuero).
- Las armas muestran la habilidad a la que pertenecen, desde el índice de plantilla (los IDs canónicos de Daggerfall, 113–131, por lo que los artefactos y las armas renombradas aún reportan la habilidad correcta), con un nombre de respaldo para contenido añadido.
- Las armaduras muestran la clase que la propia hoja de objetos del juego llama **Tipo** (Type): Cuero, Malla o Placas.
- La munición (pellets, flechas) no lleva grado ni tipo — conserva su nombre simple, porque su campo de material no es un metal.
- Las gemas tampoco llevan grado ni tipo, pero cada una se imprime en su propio color: Rubí rojo, Esmeralda verde, Zafiro azul, Diamante blanco hielo, Jade verde suave, Turquesa cian, Malaquita verde profundo, Ámbar dorado, Perla crema. El color proviene del índice de plantilla de la gema (Rubí 0 … Ámbar 7, Perla 77), con un nombre de respaldo para gemas añadidas.
- Las gemas graduadas también funcionan — **Astillas, Defectuosa, Impecable, Perfecta** (índices `1900 + grade*8 + stone`, y el juego ya pone la palabra en el nombre, por lo que `Esmeralda Astillada` se mantiene). El nombre conserva el color de la piedra; las gemas nunca obtienen un punto al frente (a diferencia de los metales), por lo que el grado se lee desde la propia palabra.

Las filas se colorean por material (un punto, más el nombre en el color del material). Las gemas se colorean por su propia piedra. La paleta **Clásica** usa los colores de Daggerfall:

| nivel | material | color | hex |
|---|---|---|---|
| 1 | Cuero | marrón | `#8B4513` |
| 2 | Malla | plateado | `#C0C0C0` |
| 3 | Hierro | gris oscuro | `#4A4A4A` |
| 4 | Acero | gris medio | `#808080` |
| 5 | Plata | plateado pálido | `#D3D3D3` |
| 6 | Élfico | plateado brillante | `#E0E0E0` |
| 7 | Enano | dorado | `#DAA520` |
| 8 | Mithril | azul marino | `#191970` |
| 9 | Adamantita | negro mate | `#2F2F2F` |
| 10 | Ébano | negro brillante | `#1A1A1A` |
| 11 | Orco | verde | `#2E8B57` |
| 12 | Daédrico | rojo | `#B22222` |

El punto siempre usa el hex exacto. El nombre también mantiene el mismo color, excepto donde eso sería ilegible sobre el fondo casi negro de la placa (Hierro, Mithril, Adamantita, Ébano obtienen una tinta aclarada del mismo tono). La paleta **Brillante** son los mismos doce niveles en colores más claros y de alto contraste.

Una fila que el propio juego marca como mágica/rara/legendaria mantiene el punto de rareza del juego, y el nombre aún toma el color del material. Todo prioriza el texto: el `T<n>` está ahí incluso cuando el color está desactivado.

La placa en sí se ensancha para que quepa un objeto por línea y **ya no cambia de ancho al desplazarse**: el juego la limita a 300 px, lo que envuelve una etiqueta de nivel + nombre + tipo, por lo que las placas de lista obtienen unos fijos 480 px (`min(480px, 92vw)`) y cada fila se mantiene en una línea; un nombre genuinamente más largo se trunca con puntos suspensivos en lugar de desbordarse. La lista muestra **10 filas** por defecto en lugar de las 6 del juego; **Filas de lista** en el panel establece de 3 a 20. La placa cuelga debajo de la mira y crece hacia abajo, por lo que una lista alta se levanta lo justo para mantener su parte inferior libre de la banda de la barra de acción/HUD (nunca tanto que su parte superior salga de la pantalla).

**ESC → Mods → Ajustes de Interfaz** tiene **Etiquetas de nivel** (desactivado restaura los nombres simples del juego), **Color por material**, el **Esquema de color** (Clásico / Brillante) y **Filas de lista**. Los ajustes residen en `localStorage['dfoUiTweaks.config.v1']`.

### Qué parchea

1. `assets/propBodies-*.js` — el constructor de filas de objetos de la placa llama a `__dfoUiTweaks.lootLabel(item, name)` para la etiqueta de cada fila y lleva el nivel como `tier`.
2. `assets/deepWaterRuntime-*.js` — el renderizador de la placa copia `tier` en la fila como `data-tier`; la hoja de estilos del mod aplica los colores basándose en ello.
3. `assets/propBodies-*.js` — el enmarcador de filas de la placa (cuántas filas del montón se muestran a la vez, y qué porción alrededor de la seleccionada) toma su conteo de filas del mod en lugar del 6 fijo.
4. `assets/dfo-uitweaks.js` — el mod en sí (la lógica de etiqueta/tipo/material, los ajustes y la hoja de estilos).

Ambos parches del juego están anclados en la expresión exacta de la fila y la declaración del renderizador, no en hashes de fragmentos o nombres minificados; un ancla faltante aborta antes de escribir. El mod solo lee el objeto del ítem que el juego ya le entrega al constructor de filas — no se escriben datos del juego.

## Solución de problemas

- `node modloader/install.mjs --check` y `node skillhud-mod/install.mjs --check` dicen qué está mal ("no instalado", "instalado para vX, sirviendo vY", "el juego ejecuta su copia empaquetada").
- Si la copia empaquetada no se pudo leer: inicia el juego una vez y reinténtalo (el AppImage de Linux necesita su montaje; el portátil de Windows necesita su carpeta descomprimida), o pasa `--app=`.
- Fuerza una reinstalación completa eliminando `Game/.dfo-mods/installed.json`.
- Si el panel de **Mods** está en blanco justo después de una actualización del juego, el juego se inició antes de que terminara la sincronización: el índice en memoria de la sesión en ejecución aún no nombraba `boot.js` y el registro, por lo que la página nunca cargó el cargador. La pestaña Mods aún puede aparecer porque su fragmento era un archivo existente. **Reinicia el juego una vez** y el panel, sus ajustes y el crédito/enlace se cargarán normalmente.
- En el juego, ESC → Mods → **Recargar** registra el resultado del cargador en la consola de DevTools. Con DevTools abierto para un personaje activo, esto imprime los números detrás de una fila:

```text
__dfoMods.active.get('skillhud').module.debugSkill(34)
```
## Notas

- Las copias de seguridad de los propios archivos de la versión residen en `Game/.dfo-mods/originals.json`, indexadas por versión. La desinstalación solo restaura la versión que se está desinstalando. La antigua carpeta `.skillhud-backup/` se migra en el primer uso.
- `Game/.dfo-mods/installed.json` registra el cargador y cada mod. Es local a la máquina.
- Desinstalar el Rastreador de Habilidades deja el cargador y otros mods en su lugar; elimina el propio cargador con `node modloader/install.mjs --uninstall`.
- La superposición está un número de versión por delante de la semilla. Si la siguiente versión real tiene exactamente ese número, el canal del juego la omite; la actualización del lanzador de escritorio aún la entrega, y todo se reaplica a la nueva semilla después.
- Una actualización del lanzador siempre deja el juego en su copia empaquetada hasta que las herramientas construyan una superposición o llegue una versión de canal; ese es el comportamiento del almacén del juego, no una limitación del mod.
