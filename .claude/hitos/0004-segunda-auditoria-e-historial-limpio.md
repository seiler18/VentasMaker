# 0004 — Segunda auditoría, historial limpio y redespliegue

- **Fecha:** 2026-09-26
- **Estado:** completado
- **Commits:** `8414a87` (y la reescritura del historial, que cambió los hashes
  de todos los commits anteriores)

## Contexto

Revisión de seguridad de todos los repositorios del portafolio, esta vez del
repositorio entero e historial incluido, no solo del código nuevo.

## Qué se hizo

- `backend/Code.gs`:
  - **L6** — `cambiarClave` comparte el contador de fallos del login (5 fallos
    → 15 min, cada fallo al Registro). Antes, con un token robado se podía
    adivinar la clave actual sin límite, cambiarla y quedarse con la cuenta
    pasadas las 6 h de la sesión.
  - **I2** — `vender` indexa productos y cantidades con `Object.create(null)`:
    un id `__proto__` pasaba como «existe».
- `tests/backend.test.mjs` — 5 pruebas nuevas (71 en total); fallan con el
  código anterior.
- `SECURITY.md` — L6, L7 e I2 en la tabla.
- **Historial reescrito** con `git filter-branch` y force push: los 6 commits
  publicados llevaban `Co-Authored-By: Claude …`, contra la convención de
  `../CLAUDE.md`. Árbol final idéntico; autoría intacta.
- **Redespliegue en Apps Script** hecho por la dueña el mismo día: L6 e I2 ya
  corren en producción.

## Decisiones y alternativas descartadas

**L7 (freno global de 20 logins/minuto) se acepta.** Cualquiera puede agotarlo
y dejar a todos sin iniciar sesión mientras dure el ataque. Apps Script no
entrega la IP del cliente, así que no hay freno por origen; quitar el global
es peor, porque el mismo ataque agotaría la cuota del dueño y tumbaría catálogo
y caja. Las sesiones ya abiertas siguen funcionando.

**Nada que rotar.** La búsqueda en todas las revisiones no encontró claves,
tokens ni IDs de hoja; solo claves ficticias de las pruebas.

## Consecuencias

- Los hashes de los commits anteriores a esta fecha cambiaron. Los hitos
  0001–0003 citan ya los nuevos.
- **Trampa del editor:** al redesplegar, *Extensiones → Apps Script* respondió
  «no se puede abrir el archivo». Eran varias cuentas de Google en el mismo
  navegador: el editor abre con la predeterminada, que no es la dueña. Se
  resolvió con una ventana de incógnito solo con la cuenta de la tienda. Queda
  en la skill `desplegar-backend`.

## Pendiente

- M5 (origen propio) sigue abierto.
