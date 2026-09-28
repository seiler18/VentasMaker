---
name: agregar-vista-panel
description: Crear o modificar una pestaña del panel de administración (admin.html) — Vender, Inventario, Reportes, Etiquetas, Usuarios, Ajustes u otra nueva. Úsala cuando el usuario pida una pantalla nueva en el panel, cambiar qué ve un rol, o modificar la interfaz de una pestaña existente.
---

# Añadir una vista al panel

## El router

`src/admin/main.js`:

```js
const VISTAS = [
  { id: 'vender', titulo: 'Vender', roles: ['admin', 'vendedor'], vista: vender },
  // …
]
```

Una vista es un módulo `src/admin/<nombre>.js` que exporta una función. Añadir
una pestaña = el módulo + una fila en `VISTAS`.

`roles` decide **qué se muestra**, no qué se permite. El permiso real está en
`PERMISOS` de `backend/Code.gs`, acción por acción. Una vista de solo-admin
cuyas acciones tengan `['admin', 'vendedor']` en el backend es un agujero
aunque el vendedor no vea la pestaña.

## Reglas del módulo

1. **Cuelga los listeners del contenedor que te da `main.js`**, nunca de
   `document` ni de un contenedor reutilizado. `main.js` crea uno nuevo por
   vista y tira el anterior. Antes se reutilizaba y los listeners de *Vender*
   seguían reaccionando dentro de *Etiquetas*.
2. Si la vista deja algo vivo (cámara del escáner, intervalos, listeners
   globales), devuelve una función de limpieza: `main.js` la llama al cambiar
   de pestaña (`limpiarVista`).
3. **Pinta con `html\`\``** de `src/lib/dom.js`: escapa todo lo interpolado.
   Todo texto que venga de la hoja es no confiable (un producto puede llamarse
   `<img onerror=…>`). `crudo()` solo para HTML que genera el propio código.
   Nunca `innerHTML` con datos sin pasar por `html`.
4. **Sin `style="…"`** en el marcado: la CSP lo bloquea en producción y
   `npm run check` lo rechaza. Estilo dinámico por CSSOM
   (`el.style.setProperty('--x', v)`).
5. Colores, tamaños y duraciones solo como tokens de `src/styles/tokens.css`;
   estilos del panel en `src/styles/admin.css`.
6. Llamadas al servidor con `llamar('accion', datos)` de `./estado.js` (elige
   el backend real o el demo). Si la acción no existe, skill
   `agregar-accion-backend`.
7. **Cada acción responde a la vista** (`src/lib/efectos.js`, no `dom.js`):
   - el botón que llama al servidor, dentro de `conBoton(btn, () => llamar(…))`:
     se desactiva, gira, y termina en ✓ verde o sacudida;
   - al terminar, `aviso(msg)` / `aviso(msg, 'error')`; lo importante (una
     venta, un ingreso) con `celebrar({ titulo, detalle })`;
   - fila nueva o cambiada → `destellar(tr)`; la que se va → `await desvanecer(el)`;
   - lo que carga al abrir la vista: silueta (`.linea-esq`) mientras llega y,
     si falla, `panelError(caja, { titulo, detalle: err.message, reintentar })`.
     Nunca un «Cargando…» que se queda para siempre.
   - `err.incierto` (escritura sin respuesta del servidor): decir que no se
     sabe si se guardó y ofrecer revisar, **no** repetirla a ciegas.
8. **No esperes a Apps Script para pintar** (puede tardar un minuto). Los
   productos salen de `inventario` (`estado.js`), que ya está en memoria; si la
   vista los usa, suscríbete con `const baja = inventario.alCambiar(repintar)`
   y devuelve `baja` en la limpieza. Tras guardar, `inventario.aplicar(id,
   cambios)` en vez de recargar la hoja entera.
9. Para abrir WhatsApp u otra pestaña: `window.open(url, '_blank')` y después
   `w.opener = null` (con la opción `'noopener'` devuelve siempre `null`).

## Probar

```bash
npm run dev       # panel en modo demo si API_URL está vacía (demo / demo)
npm run build && npm run preview   # con CSP: aquí se ven los bloqueos
```

Con `API_URL` configurada, `npm run dev` habla con la hoja **real** de la
tienda: cuidado con ventas o ajustes de prueba. Para probar sin tocar datos,
vacía `API_URL` en local (sin commitear) o usa `preview` sobre un build demo.

Recorrido mínimo: entrar como admin y como vendedor, abrir la pestaña, cambiar
a otra y volver (que no se dupliquen listeners), y consola sin errores de CSP.
`playwright-cli` sirve para hacerlo por línea de comandos.
