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
| Cliente de la API | `src/lib/api.js`; URL en `src/config.js` |
| Backend real | `backend/Code.gs` (`PERMISOS`, `ACCIONES`) |
| Semilla del catálogo | `public/data/catalogo.json` (sale de `scraping/`) |
| CSP | `vite.config.js` (solo en build) |

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
5. **El stock solo cambia por `vender`, `anularVenta` y `ajustarStock`**, que
   dejan fila en *Movimientos*. `guardarProducto` no toca el stock.
6. **Cada vista cuelga sus listeners de su propio contenedor** (`main.js` crea
   uno nuevo por vista). Reutilizarlo hizo que los listeners de Vender
   reaccionaran en Etiquetas.
7. Colores, tamaños y duraciones solo como tokens (`src/styles/tokens.css`).
8. Tras cambiar `Code.gs`, redesplegar la aplicación web como **versión nueva**
   de la misma implementación (si no, la URL cambia).

## Verificación

`npm run build && npm run preview` y probar en navegador. Hay un recorrido con
Playwright usado durante el desarrollo (tienda móvil/escritorio, carrito →
WhatsApp, panel demo: escanear, cobrar, ingreso, ajuste, reportes, etiquetas,
iframe). El backend real solo se prueba desplegado en Apps Script.
