# 0003 — El backend real queda conectado

- **Fecha:** 2026-09-24
- **Estado:** completado
- **Commits:** `58e647c`, `8fdaec0`, `9c77cc3`

> Reconstruido el 2026-09-26 a partir de los mensajes de esos commits, que
> cuentan causa y arreglo.

## Contexto

Con la hoja instalada en la cuenta de la tienda, `instalar()` funcionaba desde
el editor pero el catálogo público respondía «Error interno».

## Qué se hizo

- `58e647c` — `ss_()` en `Code.gs`: guarda el ID de la hoja la primera vez que
  hay contexto (el editor) y desde entonces la abre con `openById`.
- `8fdaec0` — `appsscript.json` pasa de `spreadsheets.currentonly` a
  `spreadsheets`: `openById` no funciona con el scope restringido
  (*Specified permissions are not sufficient…*).
- `9c77cc3` — `API_URL` en `src/config.js`. Verificado en navegador headless
  contra la aplicación publicada: el catálogo trae los 440 productos de la hoja
  y el login rechaza credenciales inválidas.

## Decisiones y alternativas descartadas

**Abrir por ID guardado, no por `getActive()`.** Apps Script solo da la hoja
«activa» con contexto de interfaz (editor o disparador simple). En `doGet`,
`doPost` y en el disparador instalable del reporte nocturno, `getActive()`
devuelve `null`. Un ID en las Propiedades del script no depende de nada.

**Scope completo de hojas.** Es más amplio que «solo esta hoja», pero es el
mínimo que admite `openById`. La guía de instalación lo sigue describiendo como
«ver y editar esta hoja» porque en la práctica el script solo abre esa.

**La URL `/exec` en el código, a la vista.** No es un secreto: viaja en cada
petición del navegador. La seguridad depende de la sesión y de `PERMISOS`.

## Consecuencias

- Hay que ejecutar `instalar()` desde el editor **antes** de usar la aplicación
  web; el error lo dice explícitamente.

## Pendiente

Ninguno.
