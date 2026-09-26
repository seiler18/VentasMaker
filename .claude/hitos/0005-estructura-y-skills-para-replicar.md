# 0005 — Estructura de nivel A y skills para replicar la tienda

- **Fecha:** 2026-09-26
- **Estado:** completado
- **Commits:** el de este hito

## Contexto

VentasMaker era el único proyecto vivo del portafolio sin `.claude/`: su
memoria estaba repartida entre el historial de git, `README.md` y
`SECURITY.md`, y el procedimiento para montar otra tienda igual no estaba
escrito en ninguna parte.

## Qué se hizo

- `.claude/settings.json` — permisos para los comandos de trabajo (`npm run
  dev/check/build/preview`, `npm test`, `gh run`), prohibido el force push y
  leer `.env`, `.xlsx` y `.csv` (una exportación de la hoja trae hashes de
  claves y ventas); plugin Context7, como el resto de proyectos.
- `.claude/skills/`:
  - `levantar-tienda` — orquesta una tienda nueva de principio a fin, con la
    lista de todos los archivos que llevan datos de la tienda.
  - `importar-catalogo` — scraping desde Treinta, fotos, semilla, y carga
    desde Excel.
  - `desplegar-backend` — primera instalación, actualización y diagnóstico de
    Apps Script.
  - `desplegar` — front a GitHub Pages.
  - `agregar-accion-backend` — `PERMISOS`, `ACCIONES`, `demo.js` y pruebas.
  - `agregar-vista-panel` — pestañas del panel.
  - `auditar-seguridad` — la revisión que alimenta `SECURITY.md`.
  - `registrar-hito`.
  - `playwright-cli` — copiada de `ceder`; es con la que se recorrió el panel
    durante el desarrollo.
- `.claude/hitos/` — este índice y los hitos 0001–0004, reconstruidos.
- `.gitignore` — `.claude/settings.local.json` y `.playwright-cli/`.

## Decisiones y alternativas descartadas

**VentasMaker es la plantilla de sí mismo.** Se valoró sacar una carpeta
`plantilla/` como la de WebMaker y se descartó: hoy hay una sola tienda, y
separar plantilla de instancia sin una segunda tienda que lo pida es adivinar
qué es genérico. `levantar-tienda` copia el repo y lista qué personalizar.
Cuando exista la segunda tienda, lo que se repita en las dos es lo que merece
subir a una plantilla.

**Hitos reconstruidos, y dicho así.** La conversación de desarrollo no está en
esta máquina. Los hitos 0001–0003 cuentan solo lo que dicen los commits y la
documentación, y lo advierten al principio.

**Impeccable no se copió.** Está en los sitios de WebMaker, pero en VentasMaker
no hay rastro de que se usara, y son 2 MB.

## Consecuencias

- Antes de una tarea, comprobar si hay skill que la cubra.
- Una tienda nueva sale de `levantar-tienda`; lo que se aprenda montándola
  vuelve aquí.

## Pendiente

Ninguno.
