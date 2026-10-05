---
name: desplegar-backend
description: Instalar por primera vez o actualizar el backend de Google Apps Script (backend/Code.gs) en la hoja de la tienda, y diagnosticar cuando no conecta. Úsala tras cualquier cambio en backend/Code.gs o backend/appsscript.json, al montar una tienda nueva, o cuando el panel o el catálogo den "Error interno", no carguen, o el editor de Apps Script no abra.
---

# Desplegar el backend (Apps Script)

El backend **no se despliega con git**. `backend/Code.gs` en el repo es la
fuente; la copia que corre vive dentro de la hoja de Google de la tienda, en la
cuenta del negocio. Llevarla allí es un copiar-pegar que hace **la persona
dueña** (tú no tienes ni debes tener su clave de Google).

Cambios que **no** necesitan esto: todo lo de `src/`, `index.html`,
`admin.html`, estilos, `.claude/`, documentación. Esos van con la skill
`desplegar`.

## Antes de pedir el redespliegue

```bash
npm test          # Code.gs corre en Node con simulaciones de Apps Script
```

En verde, y con prueba nueva si cambiaste una acción (skill
`agregar-accion-backend`). El backend real solo se prueba desplegado, así que
esto es lo único que se puede comprobar antes.

## Actualizar (lo normal)

Guía para la dueña, al final de `backend/PASO-A-PASO.md`:

1. Hoja → *Extensiones → Apps Script*.
2. `Código.gs` → Ctrl+A → pegar el `backend/Code.gs` nuevo (o desde
   `https://raw.githubusercontent.com/<usuario>/<repo>/main/backend/Code.gs`)
   → Ctrl+S.
3. *Implementar → Gestionar implementaciones* → la existente → **lápiz** →
   *Versión*: **Nueva versión** → *Implementar*.

**Nunca «Nueva implementación»**: crea otra URL `/exec` y el front, que tiene
la vieja en `src/config.js`, deja de conectar.

Si cambió `appsscript.json` (scopes), pegarlo también y **ejecutar una función
cualquiera desde el editor** (p. ej. `instalar`, que es idempotente) para que
Google pida los permisos nuevos antes de publicar.

## Primera instalación

Lo cubre paso a paso `backend/PASO-A-PASO.md`. Resumen:

1. Hoja nueva en la cuenta del negocio → *Extensiones → Apps Script*.
2. Mostrar `appsscript.json` (engranaje) y pegarlo; pegar `Code.gs`.
3. Ejecutar `instalar` → aceptar permisos → **copiar la clave inicial** del
   registro de ejecución (no se vuelve a mostrar).
4. Ejecutar `importarSemilla` (necesita el front ya publicado: descarga
   `data/catalogo.json` de la URL de Pages) e `instalarDisparadores`.
5. *Implementar → Nueva implementación → Aplicación web*: ejecutar como **Yo**,
   acceso **Cualquier usuario**. Copiar la URL `/exec` → `src/config.js`.

«Cualquier usuario» es correcto: el catálogo se lee sin sesión; todo lo demás
exige token y rol (`PERMISOS`). La URL no es un secreto.

## Verificar

```bash
curl -sL "<API_URL>?accion=catalogo" | head -c 200    # {"ok":true,...
```

Y en el panel, iniciar sesión. Si responde pero el login falla con una cuenta
buena, revisa que no esté bloqueada (5 fallos → 15 min).

## Diagnóstico

| Síntoma | Causa | Qué hacer |
|---|---|---|
| El editor no abre: «Lo sentimos, no se puede abrir el archivo en este momento» | Varias cuentas de Google en el navegador; *Extensiones → Apps Script* abre con la predeterminada, que no es dueña | Ventana de incógnito con **solo** la cuenta del negocio. O cambiar `authuser=0` por `1`/`2` en la URL. Pasó el 2026-09-26 |
| Catálogo: «Error interno»; en el editor todo bien | `SpreadsheetApp.getActive()` es `null` en `doGet`/`doPost` | Ejecutar `instalar()` una vez **desde el editor**: guarda `SHEET_ID` y `ss_()` abre por ID desde entonces |
| *Specified permissions are not sufficient to call SpreadsheetApp.openById* | Falta el scope `spreadsheets` completo | Pegar `appsscript.json` del repo y ejecutar una función para reautorizar |
| El front no conecta tras actualizar | Se creó una implementación nueva | Poner la URL nueva en `src/config.js` y desplegar el front, o volver a la implementación anterior |
| «Falta la hoja …» / «Falta ejecutar instalar()» | Hoja renombrada o instalación incompleta | `instalar()` otra vez: no borra, solo completa |
| «No se pudo subir la foto: Error interno» | El `Code.gs` desplegado usaba `DriveApp`, que exige permiso sobre todo el Drive; el manifiesto solo da `drive.file` | Pegar `Code.gs` **y** `appsscript.json` del repo (activa el servicio avanzado *Drive* v3), ejecutar `instalar` desde el editor y publicar versión nueva. Pasó el 2026-10-05 |
| Se perdió la clave del admin | — | Ejecutar `restablecerAdmin` desde el editor; cierra sus sesiones |
| Cambios hechos a mano en la hoja no salen en el catálogo | Caché del catálogo (6 h). `onEdit` la invalida al editar *Productos* o *Config* a mano; los cambios del panel también | Si se editó por otra vía (script, importación), cualquier escritura del panel la invalida. Comprobar que el script está **vinculado** a la hoja (*Extensiones → Apps Script*): `onEdit` solo corre así |
| El sitio tarda o la consola muestra `404` en `script.googleusercontent.com/macros/echo` | Apps Script lento o con ejecuciones en cola: el 404 del segundo salto llega **aunque la acción se ejecutó**. El 2026-09-28 una llamada vacía tardaba 17–73 s con la mitad en 404, y horas después 2 s, sin incidencia publicada por Google | El front lo tolera (copia local, reintentos, `idem`). Medir: `curl -sL -o /dev/null -w "%{http_code} %{time_total}s\n" "<API_URL>?accion=nada"`. En Apps Script → *Ejecuciones*: duración y errores; cientos por minuto = alguien martillando la URL |
| `importarSemilla`: «Productos ya tiene datos» | Protección deliberada | No repetir; para cargar más, skill `importar-catalogo` (B) |

Tras redesplegar un arreglo de seguridad, actualiza su fila en `SECURITY.md`
(«vale en producción cuando se redespliegue» → fecha del redespliegue).
