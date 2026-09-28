# 0006 — Apps Script lento: pintar sin esperarlo, reintentos seguros y respuesta visible a cada acción

- **Fecha:** 2026-09-28
- **Estado:** completado en el repo; **falta redesplegar `Code.gs`** (ver Pendiente)
- **Commits:** pendiente de commit

## Contexto

El 2026-09-28 por la mañana el catálogo tardaba más de un minuto en mostrar
productos y el panel daba «error de conexión». La consola mostraba
`Failed to load resource: 404`. El cambio del día anterior (`6e73bf6`, etiquetas
`<meta>` para compartir) no tenía relación.

Medido con `curl` y un navegador headless contra producción:

- La petición que falla es `script.googleusercontent.com/macros/echo` (el
  segundo salto de Apps Script), con la página de Google «No se pudo abrir el
  archivo en este momento».
- Una llamada que **no toca la hoja** (`?accion=nada`) tardaba 17–73 s y la
  mitad respondía 404. El catálogo tardó 85 s en pintarse.
- El panel de estado de Google Workspace no reportaba incidencias. Horas
  después la misma medición daba 1,7–2,1 s: fue intermitente y del lado de
  Google (o de la cola de ejecuciones de la cuenta), no del código.

El problema de fondo era de diseño: la tienda **esperaba** a Apps Script antes
de pintar, sin tiempo máximo; el panel hacía `sesion` → `productos` en serie
antes de mostrar nada; guardar un producto hacía otra recarga completa; un
ingreso de mercadería era una llamada por producto; y un 404 llega **aunque la
acción ya se ejecutó**, así que reintentar un cobro a mano podía registrar
la venta dos veces.

## Qué se hizo

**Backend (`backend/Code.gs`)**
- `conIdem_()`: las escrituras de `IDEMPOTENTES` aceptan una clave `idem`
  (ligada al usuario). La primera ejecución deja `en_curso`; un reintento
  mientras corre recibe `enCurso`, y después la misma respuesta con
  `repetida: true`. Si la acción falla, la marca se borra.
- `VERSION_API = 2`, que viaja como `srv` en toda respuesta: el front sabe si
  puede reintentar escrituras y mandar lotes.
- `ajustarStock` acepta `items: [{id, delta}]` (todo o nada, un movimiento
  por producto): el ingreso de mercadería pasa de N llamadas a una.
- `memo_`: la hoja, cada pestaña y su encabezado se abren una vez por
  ejecución (una venta de tres productos llamaba a `openById` y releía el
  encabezado una decena de veces).
- Caché del catálogo de 5 min → 6 h (`CATALOGO_SEG`); `onEdit` la invalida al
  editar *Productos* o *Config* a mano.
- 18 pruebas nuevas en `tests/backend.test.mjs` (89 en total).

**Front**
- `src/lib/api.js`: tiempo máximo por intento, 3 intentos en lecturas, 2 en
  escrituras solo con `srv ≥ 2`, `idem` en cada escritura; errores con `red`
  e `incierto`; `onActividad()` para el indicador de red.
- `src/lib/efectos.js` + `src/styles/efectos.css`: `aviso` (icono, barra de
  tiempo que se pausa con el puntero, en capa superior con `popover` para
  verse encima de los diálogos), `celebrar` (✓ que se dibuja, o ✗ con
  acciones), `conBoton`, `destellar`, `desvanecer`, `sacudir`, `panelError`
  y `vigilarRed` (barra arriba y píldora «Google está tardando…»).
  `aviso` salió de `dom.js`.
- Tienda (`src/tienda/main.js`): pinta con la copia de `localStorage` o con
  `data/vivo.json` y aplica lo vivo por detrás sin re-animar ni perder la
  posición; si no hay nada, pantalla de error con Reintentar y WhatsApp.
  Avisos al agregar y quitar, ✓ al enviar el pedido.
- Panel: `estado.js` guarda perfil e inventario en `sessionStorage`, avisa a
  las vistas (`alCambiar`) y deduplica recargas; `main.js` pinta el armazón al
  instante y verifica sesión e inventario por detrás, y distingue sesión
  caducada (→ login) de fallo de red (→ error con Reintentar). Todas las vistas
  con `conBoton`, esqueletos y `panelError`; guardar aplica en local en vez de
  recargar la hoja; la venta aparece en «Ventas de hoy» sin otra llamada.
- `scripts/foto-catalogo.js` (dentro de `npm run build`): en CI pide el
  catálogo vivo y lo publica como `data/vivo.json`; si Google no responde,
  publica la semilla y el deploy sigue. El workflow se ejecuta además cada
  2 horas para refrescarla.
- `404.html` propia (GitHub Pages la sirve para cualquier ruta inexistente).
- Arreglado de paso: la hora de «Ventas de hoy» salía como «m.» (se cortaba
  «10:49 a. m.» por espacios) → `hora()` en `formato.js`.

## Decisiones y alternativas descartadas

**Reintentar escrituras solo con idempotencia en el servidor.** Reintentar en
el front sin más habría duplicado ventas: el 404 llega después de ejecutar. Sin
`srv ≥ 2` el front no reintenta y dice «no sabemos si se guardó: revisa antes
de repetirlo». Así el front nuevo es seguro contra el backend viejo, y se pudo
publicar antes de que la dueña redespliegue.

**Ampliar `ajustarStock` en vez de una acción `ingresarStock`.** La regla 5 dice
que el stock solo cambia por tres acciones; un lote dentro de la misma acción
la respeta y no añade una fila a `PERMISOS`.

**Caché en `sessionStorage` (panel) y `localStorage` (tienda).** El inventario del
panel lleva costos: va a `sessionStorage`, con el mismo alcance y exposición
que el token, que ya da acceso a eso. El catálogo público va a `localStorage`
porque no tiene nada privado y así sobrevive entre visitas.

**Foto publicada en vez de solo la copia local.** Quien entra por primera vez
no tiene copia; sin `vivo.json` vería la semilla del scraping (precios de la
migración) hasta que conteste Google. Descartado un «calentador» por
disparador de tiempo: consume la cuota diaria de disparadores y no está claro
que evite el arranque en frío de la aplicación web.

**Sin avisos de error en la tienda por fallos del backend.** El cliente ya ve el
catálogo; un aviso rojo solo asusta. Se registra en consola como `warn`.

## Consecuencias

- Reglas 9–11 nuevas en `CLAUDE.md` (no esperar a Apps Script, respuesta
  visible a toda acción, `IDEMPOTENTES`). Skills `agregar-vista-panel`,
  `agregar-accion-backend`, `desplegar-backend` y `levantar-tienda`
  actualizadas; `SECURITY.md` con los controles nuevos.
- Verificado con un recorrido de Playwright sobre el build (CSP activa) donde
  `script.google.com` se contestaba con el `Code.gs` real en Node, inyectando
  retrasos de 5–6 s, caídas y el 404 tras ejecutar: 41/41, incluido «404 tras
  cobrar → una sola venta en la hoja». Modo demo: 3/3. `foto-catalogo.js
  --vivo` contra producción: 440 productos en 5,6 s.

## Pendiente

- **Redesplegar `backend/Code.gs` como versión nueva** (skill
  `desplegar-backend`). Hasta entonces el front funciona, pero sin reintentar
  escrituras, sin ingreso en lote y con la caché de 5 min.
- El workflow programado se pausa solo tras 60 días sin actividad en el repo.
