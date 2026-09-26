# 0001 — Nace VentasMaker: catálogo, punto de venta e inventario sobre Google Sheets

- **Fecha:** 2026-09-24
- **Estado:** completado
- **Commits:** `af5e832`, `5d8a086`

> Reconstruido el 2026-09-26 a partir de los commits, `README.md`,
> `SECURITY.md` y `CLAUDE.md`. La conversación en la que se desarrolló no está
> en esta máquina; lo que aquí se cuenta como decisión está escrito en esos
> documentos, no deducido.

## Contexto

Ale ventas Alerce (Puerto Montt) vendía con el catálogo de Treinta
(`catalogo.treinta.co/monik10`), un servicio con mensualidad. El catálogo no
tenía categorías, no publicaba códigos de barras ni costos, y la venta en el
mesón y el inventario iban por fuera.

## Qué se hizo

- **Catálogo público** (`index.html`, `src/tienda/`): búsqueda, categorías,
  carrito y pedido por WhatsApp a la tienda. En el segundo commit, catálogo a
  ancho completo con el panel de pedido fijo, tarjetas de formato uniforme,
  animaciones y ajustes para móvil.
- **Panel** (`admin.html`, `src/admin/`): Vender con lector de códigos o
  cámara, Inventario, Reportes, Etiquetas (código de barras 50×30 mm),
  Usuarios y Ajustes; roles `admin` y `vendedor`.
- **Backend** (`backend/Code.gs`): API `doGet`/`doPost` en Apps Script sobre
  una hoja con pestañas Productos, Ventas, Movimientos, Usuarios, Config,
  Registro y resúmenes diario/semanal/mensual/anual regenerados cada noche.
- **Migración** (`scraping/`): 440 productos y 432 fotos del catálogo anterior,
  SKU interno `MK0001…MK0440`, categoría inferida por reglas, fotos a 600 px
  WebP (60 MB → 11 MB).
- **Modo demo** (`src/admin/demo.js`): sin `API_URL`, el catálogo sale de la
  semilla y el panel funciona con `demo`/`demo` guardando en el navegador.
- **Seguridad antes de publicar**: revisión adversarial del backend y del
  front, banco de pruebas del backend en Node (`npm test`), CSP estricta en el
  build, verificador `npm run check`, CI con permisos mínimos. Hallazgos M1–M5
  y L1–L5 en `SECURITY.md`.

## Decisiones y alternativas descartadas

**Google Sheets + Apps Script como base de datos y API.** Costo $0, y la dueña
ve y corrige sus datos en una planilla que ya sabe usar. El precio está
documentado en `SECURITY.md`: quien pueda **editar** la hoja controla el
backend (M4, riesgo aceptado) y la disponibilidad depende de la cuota de Apps
Script del dueño.

**Pedidos por WhatsApp, no pago en línea.** Los datos del cliente (nombre,
celular, dirección) no se guardan en el servidor: viajan en el mensaje. No hay
nada de clientes que proteger en la hoja.

**Sin framework**, heredando de WebMaker el sistema de tokens, el deploy por
Actions y la regla de «ninguna credencial en el repo».

**El stock sigue visible en el catálogo**, como en Treinta: el cliente ve
cuántas quedan. Ocultarlo es quitar `stock` de `catalogoPublico_()`.

**Modo demo** para poder enseñar y probar el panel entero antes de que exista
la hoja de la tienda.

## Consecuencias

- Todo texto que venga de la hoja es no confiable: se pinta con `html\`\``.
- Una acción nueva del backend exige su fila en `PERMISOS`.
- Cambiar `Code.gs` no se despliega con git: hay que redesplegar en Apps Script.

## Pendiente

- M5: la tienda comparte origen con los demás proyectos de `seiler18.github.io`.
