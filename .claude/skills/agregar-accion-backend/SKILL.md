---
name: agregar-accion-backend
description: Añadir o cambiar una acción del backend de Apps Script (una operación que el panel o el catálogo piden al servidor), con su permiso, su versión de demo y sus pruebas. Úsala cuando haga falta que el panel haga algo nuevo contra la hoja (un reporte, un campo, una operación de stock, una exportación) o cambie lo que devuelve una acción existente.
---

# Añadir una acción al backend

Una acción toca **cuatro sitios**. Si falta uno, o no funciona, o funciona en
demo y falla en producción, o abre un agujero.

| # | Dónde | Qué |
|---|---|---|
| 1 | `backend/Code.gs` → `PERMISOS` | la fila con los roles que pueden llamarla |
| 2 | `backend/Code.gs` → `ACCIONES` | la implementación |
| 3 | `src/admin/demo.js` | la imitación para el modo demo |
| 4 | `tests/backend.test.mjs` | pruebas, incluida la de «rol sin permiso» |

Y el front la llama con `llamar('nombreAccion', datos)` de `src/lib/api.js`.

## 1. Permiso — lista blanca

```js
const PERMISOS = {
  // …
  miAccion: ['admin'],          // o ['admin', 'vendedor']
};
```

**Lo que no está en `PERMISOS` no se puede llamar.** Ocultar un botón en el
front no es control de acceso: cualquiera puede hacer el `POST` a mano. Ante la
duda, `['admin']`.

`doPost` ya comprueba sesión, versión de cuenta y rol antes de llegar a tu
código; no lo repitas.

## 2. Implementación

```js
const ACCIONES = {
  miAccion: (b, ses) => {
    const nombre = texto_(b.nombre, 80);          // recorta y valida texto
    const cant = entero_(b.cantidad, 0);          // entero o el valor por defecto
    if (cant < 1 || cant > 1000) falla_('Cantidad fuera de rango');
    return conBloqueo_(() => {
      const tabla = leer_('productos');            // se lee DENTRO del bloqueo
      // …
      actualizarFila_('productos', fila._fila, { campo: valor });
      registrar_(ses.usuario, 'miAccion', detalle);
      return { ok: true, /* … */ };
    });
  },
};
```

Reglas que no son opcionales:

- **Toda escritura dentro de `conBloqueo_()`**, y la lectura que decide la
  escritura también: si se lee antes, dos peticiones simultáneas ven el mismo
  stock y ambas lo dan por bueno.
- **Todo texto hacia la hoja por `celda_()`** (`agregar_` y `actualizarFila_`
  ya lo hacen): neutraliza fórmulas (`=`, `+`, `-`, `@`). Un nombre de
  producto `=IMPORTXML(…)` se ejecutaría en la planilla de la dueña.
- **El precio lo pone el servidor**, nunca el cliente. Cantidades enteras y
  acotadas.
- **Mapas por id con `Object.create(null)`**, no `{}`: un id `__proto__`
  mandado por el cliente pasaría el «existe».
- **Errores para el usuario con `falla_('mensaje')`**; cualquier otra excepción
  sale como «Error interno» sin detalles (a propósito).
- **El stock solo cambia por `vender`, `anularVenta` y `ajustarStock`**, que
  dejan fila en *Movimientos*. Si tu acción necesita mover stock, llama a esa
  lógica; no escribas la columna directamente.
- **Nada sensible hacia el vendedor**: costo, márgenes, correo de reportes.
  El catálogo público (`catalogoPublico_`) solo expone campos de vitrina.
- Una columna nueva: añádela al final de su lista en `HOJAS`. `instalar()` la
  agrega sola a las hojas existentes (se lee por encabezado, no por posición).

## 3. Modo demo

`src/admin/demo.js` debe responder **lo mismo** que `Code.gs` (misma forma de
datos, mismos errores visibles), sobre `localStorage`. Si no, el panel funciona
en demo y se rompe con la hoja real, o al revés.

## 4. Pruebas

`tests/backend.test.mjs` carga `Code.gs` en Node con simulaciones de
`SpreadsheetApp`, `CacheService`, `LockService`, etc. `tok` es la sesión del
admin y `tv` la del vendedor `caja`; el patrón:

```js
r = post({ accion: 'miAccion', token: tok, cantidad: 2 })
esperar('miAccion hace lo que debe', r.ok /* && … */, JSON.stringify(r))
esperar('miAccion rechaza cantidad 0', !post({ accion: 'miAccion', token: tok, cantidad: 0 }).ok)
```

Y si es de solo admin, añádela a la lista del bucle «vendedor sin permiso»
(busca `vendedor sin permiso` en el archivo): comprueba que el servidor la
rechaza con el token del vendedor.

Mínimo: el caso bueno, el **rol sin permiso** y una entrada inválida. Si
arreglas un fallo, escribe primero la prueba que lo demuestra y comprueba que
falla con el código anterior.

```bash
npm test
```

## 5. Después

1. Front: la llamada en la vista (skill `agregar-vista-panel` si es pantalla
   nueva) → skill `desplegar`.
2. Backend: skill `desplegar-backend` (**versión nueva** de la misma
   implementación). Hasta que la dueña lo haga, el front nuevo llama a una
   acción que producción no conoce: coordina el orden o haz el front tolerante.
3. Si cambió un control de seguridad, `SECURITY.md`.
