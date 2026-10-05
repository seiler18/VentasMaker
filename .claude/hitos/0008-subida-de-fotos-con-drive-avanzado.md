# 0008 — Subida de fotos con el servicio avanzado de Drive

- **Fecha:** 2026-10-05
- **Estado:** completado (falta redesplegar Apps Script)
- **Commits:** ver `git log -- backend/appsscript.json`

## Contexto
Al subir la foto de un producto desde Inventario, en el celular, el panel
mostraba «No se pudo subir la foto: Error interno». Producción respondía `srv 3`.
`subirImagen` guardaba con `DriveApp` (`createFolder`, `createFile`,
`setSharing`), y `DriveApp` exige el scope `https://www.googleapis.com/auth/drive`
(todo el Drive). `backend/appsscript.json` solo declara `drive.file`, así que
cada llamada lanzaba una excepción sin texto visible para el usuario y `doPost`
devolvía el mensaje genérico. Seguramente nunca funcionó en producción: las
pruebas simulaban `DriveApp: {}` y no ejercían la subida.

## Qué se hizo
- `backend/Code.gs`: `subirImagen` usa `Drive.Files.create` (metadatos + blob,
  dentro de la carpeta) y `Drive.Permissions.create({ role: 'reader', type: 'anyone' })`.
  `carpetaImagenes_` devuelve el id de la carpeta «VentasMaker — imágenes»,
  guardado en `CARPETA_IMG`, y la vuelve a crear si falta o está en la papelera.
  `Code.gs` ya no usa `DriveApp` en ningún lado.
- `backend/appsscript.json`: activa el servicio avanzado `Drive` v3. Los scopes
  no cambian.
- `tests/backend.test.mjs`: simula `Drive` (y ya no `DriveApp`) y prueba la URL
  `lh3`, que la foto quede en la carpeta, el permiso público, que la carpeta se
  reutilice o se recree, y que se rechace un tipo declarado falso.
- Skill `desplegar-backend`: fila nueva en la tabla de diagnóstico.

## Decisiones y alternativas descartadas
- **Ampliar el scope a `drive` completo**: era el cambio más corto, pero el
  script, publicado para «cualquier usuario», tendría acceso a todo el Drive de
  la dueña. Se descartó por mínimo privilegio.
- **Comprimir más o guardar la foto en la hoja (base64)**: el tamaño no era el
  problema (el front ya baja la foto a 800 px en WebP, entre 50 y 100 KB, y si
  pesara de más el error sería «Imagen vacía o demasiado grande»). Además, una
  celda admite 50 000 caracteres y el catálogo se volvería muy pesado.

## Consecuencias
- Para leer o escribir en Drive desde `Code.gs` se usa `Drive.*` (API v3), nunca
  `DriveApp`. Lo mismo vale para cualquier tienda hecha desde VentasMaker.
- Al actualizar el backend hay que pegar también `appsscript.json`, no solo
  `Code.gs`: sin el servicio activado, `Drive` no existe.

## Pendiente
- Que la dueña pegue `Code.gs` y `appsscript.json`, ejecute `instalar` desde el
  editor y publique una **versión nueva** de la misma implementación. Después,
  probar una subida real desde Inventario.
