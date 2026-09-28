# VentasMaker — cómo se trabaja aquí

Catálogo público + panel de administración de **Ale ventas Alerce** (Puerto Montt).
Front estático en GitHub Pages (`seiler18/VentasMaker`), backend en Google Apps
Script sobre una hoja de cálculo. Hermano de `../WebMaker/`: hereda su sistema de
tokens, su deploy por Actions y sus reglas (sin framework, sin credenciales en el
repo, `npm run check` dentro del build). Instalación y uso: `README.md`.
Modelo de amenazas y decisiones de seguridad: `SECURITY.md`.

## Mapa

| Qué | Dónde |
|---|---|
| Catálogo, carrito, pedido WhatsApp | `index.html`, `src/tienda/` |
| Panel (una vista por archivo) | `admin.html`, `src/admin/{vender,inventario,reportes,etiquetas,usuarios,ajustes}.js` |
| Router del panel, roles por pestaña | `src/admin/main.js` (`VISTAS`) |
| Backend de mentira para el modo demo | `src/admin/demo.js` — debe imitar a `Code.gs` |
| Escape de HTML | `src/lib/dom.js` (`html`, `crudo`) |
| Avisos, ✓ de confirmación, botones que trabajan, pantalla de error, estado de red | `src/lib/efectos.js`, `src/styles/efectos.css` |
| Página para direcciones que no existen | `404.html` (GitHub Pages la sirve sola) |
| Foto del catálogo que se publica con el sitio | `scripts/foto-catalogo.js` → `data/vivo.json` (en el build) |
| Cliente de la API | `src/lib/api.js`; URL en `src/config.js` |
| Backend real | `backend/Code.gs` (`PERMISOS`, `ACCIONES`) |
| Semilla del catálogo | `public/data/catalogo.json` (sale de `scraping/`) |
| CSP | `vite.config.js` (solo en build) |

## Procedimientos y memoria

**Antes de una tarea, comprueba si hay una skill que la cubra.** Al terminar
algo con sustancia, registra el hito.

| Necesitas… | Skill |
|---|---|
| Montar **otra tienda** con este sistema | `levantar-tienda` |
| Migrar o cargar productos (Treinta, Excel) | `importar-catalogo` |
| Llevar un cambio de `Code.gs` a producción, o el backend no conecta | `desplegar-backend` |
| Publicar el front | `desplegar` |
| Que el panel haga algo nuevo contra la hoja | `agregar-accion-backend` |
| Una pestaña nueva del panel | `agregar-vista-panel` |
| Revisar la seguridad | `auditar-seguridad` |
| Recorrer el sitio en un navegador por línea de comandos | `playwright-cli` |
| Dejar constancia de lo hecho | `registrar-hito` |

Qué se hizo antes y por qué: `.claude/hitos/` (empieza por su `README.md`).

## Reglas

1. **Todo texto de la hoja es no confiable.** Se pinta con `html\`\``, que escapa.
   `crudo()` solo para HTML generado por el propio código. Nunca `innerHTML`
   con datos sin pasar por `html`.
2. **Sin `style="..."` en el marcado**: la CSP lo bloquea. Estilo dinámico por
   CSSOM (`el.style.setProperty`). Lo comprueba `npm run check`.
3. **Una acción nueva del backend = una fila en `PERMISOS`.** Lo que no está ahí
   no se puede llamar. Ocultar un botón en el front no es control de acceso.
4. **Escrituras en la hoja dentro de `conBloqueo_()`** y con valores por
   `celda_()` (inyección de fórmulas).
5. **El stock solo cambia por `vender`, `anularVenta` y `ajustarStock`** (uno
   o en lote con `items`), que dejan fila en *Movimientos*. `guardarProducto`
   no toca el stock.
6. **Cada vista cuelga sus listeners de su propio contenedor** (`main.js` crea
   uno nuevo por vista). Reutilizarlo hizo que los listeners de Vender
   reaccionaran en Etiquetas.
7. Colores, tamaños y duraciones solo como tokens (`src/styles/tokens.css`).
8. Tras cambiar `Code.gs`, redesplegar la aplicación web como **versión nueva**
   de la misma implementación (si no, la URL cambia).
9. **Nunca esperar a Apps Script para pintar.** Se han medido de 2 a 70 s por
   llamada y 404 intermitentes en `script.googleusercontent.com` aunque la
   acción ya se ejecutó. La tienda pinta con copia local o `data/vivo.json` y
   actualiza por detrás; el panel pinta con lo guardado en la pestaña.
10. **Toda acción tiene respuesta visible**: lo que llama al servidor va en
    `conBoton()`; al terminar, `aviso()` (o `celebrar()` si es importante:
    venta, ingreso, pedido); si no carga, `panelError()` con Reintentar.
11. **Una escritura nueva que duplicaría algo al repetirse → a `IDEMPOTENTES`**
    en `Code.gs`. `api.js` reintenta escrituras solo con backend `srv ≥ 2` y
    la misma clave `idem`; si no, informa «no sabemos si se guardó».

## Verificación

`npm test` (backend en Node con simulaciones de Apps Script) y
`npm run build && npm run preview` para probar en navegador con la CSP activa. Hay un recorrido con
Playwright usado durante el desarrollo (tienda móvil/escritorio, carrito →
WhatsApp, panel demo: escanear, cobrar, ingreso, ajuste, reportes, etiquetas,
iframe). Para probar la red mala sin tocar producción: interceptar
`script.google.com` en Playwright y contestar con `doGet`/`doPost` del
`Code.gs` cargado con las simulaciones de `tests/backend.test.mjs`, inyectando
retrasos y 404 (hito 0006). El backend real solo se prueba desplegado en Apps Script.
