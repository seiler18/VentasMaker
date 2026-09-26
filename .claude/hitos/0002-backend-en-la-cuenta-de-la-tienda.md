# 0002 — El backend se instala en la cuenta de la tienda

- **Fecha:** 2026-09-24
- **Estado:** completado
- **Commits:** `17cc2a7`

> Reconstruido el 2026-09-26 a partir del commit y de `backend/PASO-A-PASO.md`.

## Contexto

El backend tenía que vivir en una hoja de Google. La pregunta era en qué
cuenta: la de quien programa (más cómodo) o la de la tienda.

## Qué se hizo

- `backend/PASO-A-PASO.md`: guía de diez pasos para alguien no técnico —crear
  la hoja, pegar `appsscript.json` y `Code.gs`, ejecutar `instalar`,
  `importarSemilla` e `instalarDisparadores`, publicar la aplicación web y
  enviar la URL `/exec`—, con qué hacer ante cada pantalla de permisos de
  Google y una tabla de problemas frecuentes.

## Decisiones y alternativas descartadas

**En la cuenta de la tienda.** La hoja guarda inventario, ventas y claves del
panel: tiene que quedar a nombre del negocio. Quien programa nunca necesita la
clave de Google de la dueña; solo recibe un enlace.

**La clave inicial del admin sale una sola vez** en el registro de ejecución y
el panel obliga a cambiarla al entrar. No se guarda en ningún sitio legible;
si se pierde, `restablecerAdmin`.

**«Cualquier usuario» como acceso de la aplicación web**, explicado en la guía:
el catálogo se lee sin sesión; todo lo demás exige usuario y clave del panel.

## Consecuencias

- Cada cambio de `Code.gs` lo lleva la dueña a Apps Script como **versión
  nueva** de la misma implementación. La guía lo explica al final.

## Pendiente

Ninguno.
