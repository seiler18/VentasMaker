# 0009 — `npm audit` volvió a bloquear el deploy programado

- **Fecha:** 2026-10-20
- **Estado:** completado
- **Commits:** ver `git log -- package-lock.json`
- **Relacionado:** el mismo síntoma ya se corrigió el 2026-10-06 (`8c6b94a`, `source-map-js`).

## Contexto
GitHub avisó por correo de que «Deploy to GitHub Pages» falló en `build` (17 s) y
que `deploy` quedó omitido. El log mostraba que el paso `npm audit --audit-level=high`
salía con código 1: tres avisos nuevos de `launch-editor` (ejecución de comandos
y escape de `%` en Windows) que llegan como dependencia de `vite` 8.3.0–8.3.2.
El lockfile fijaba `vite 8.3.1`. El código del sitio no cambió: apareció un aviso
en la base de datos de advisories.

Como el flujo corre cada 2 horas (`schedule`), el sitio **no se cayó**: siguió
sirviéndose la última publicación buena. Lo que se estropeaba era la foto del
catálogo (`data/vivo.json`, precios y stock), que dejaba de refrescarse hasta que
alguien arreglara el build.

## Qué se hizo
- `npm audit fix`: `vite` 8.3.1 → 8.3.4 y las dependencias nativas de lightningcss/rolldown
  que lo acompañan (solo cambia `package-lock.json`; `package.json` ya admitía `^8.3.1`).
- Comprobado en local: `npm audit` 0 vulnerabilidades, `npm test` 125/125, `npm run build`
  (incluye `check`) correcto.
- Se revisaron los demás repos con el mismo paso de audit: `FinanzasMaker` tenía la
  misma vulnerabilidad latente (solo despliega al hacer push, por eso no había avisado)
  y se corrigió igual.

## Decisiones y alternativas descartadas
- **Quitar `npm audit` del workflow o bajarlo a `--audit-level=critical`**: el
  deploy dejaría de romperse, pero también dejaría de avisar de lo que importa.
  El paso es parte de lo endurecido tras la auditoría (`SECURITY.md`, L5).
- **Fijar `vite` a una versión exacta**: no evita el problema, la vulnerabilidad
  es de una versión concreta y el siguiente aviso será de otra.

## Consecuencias
- Un aviso nuevo en una dependencia puede romper el build **sin ningún cambio en
  el repo**. Si llega «Some jobs were not successful» y el log dice `npm audit`,
  la receta es `npm audit fix`, `npm test`, `npm run build` y push.
- El deploy programado es quien lo detecta antes; en repos sin `schedule` el
  fallo espera al siguiente push.

## Pendiente
- Nada. Si se repite con frecuencia, valorar activar Dependabot en este repo para
  que proponga el cambio de lockfile antes de que rompa el build.
