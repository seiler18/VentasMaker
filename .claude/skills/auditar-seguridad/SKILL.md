---
name: auditar-seguridad
description: Revisar la seguridad de VentasMaker (o de una tienda hecha con él) — backend de Apps Script, front, CI e historial — y dejar el resultado en SECURITY.md. Úsala antes de publicar una tienda nueva, tras un cambio grande en backend/Code.gs, o cuando el usuario pida "revisa la seguridad", "audita", "¿es seguro?".
---

# Auditar la seguridad

`SECURITY.md` es la fuente: modelo de amenazas, controles, tabla de hallazgos
con estado y lo que queda en manos de la dueña. Esta skill es **cómo** se
revisa; el resultado va allí.

## 1. Pruebas y verificador

```bash
npm test          # banco del backend: debe quedar en verde
npm run build     # check: CSP, style="", secretos
npm audit
```

## 2. Backend (`backend/Code.gs`)

Contrasta cada punto con el código, no con lo que dice `SECURITY.md`:

- [ ] Cada clave de `ACCIONES` tiene fila en `PERMISOS`, y ninguna acción que
      escriba o lea costos tiene `vendedor`.
- [ ] `doPost` exige sesión antes de despachar, salvo `login`.
- [ ] Escrituras dentro de `conBloqueo_()`; textos por `celda_()`.
- [ ] Precio calculado en el servidor; cantidades enteras y acotadas.
- [ ] Mapas por id sin prototipo (`Object.create(null)`).
- [ ] Intentos de clave limitados en `login_` **y** en `cambiarClave`
      (contador compartido).
- [ ] Cambiar clave/rol/desactivar sube la versión de la cuenta (mata sesiones).
- [ ] `catalogoPublico_` y `CONFIG_PUBLICA` no exponen costo, código de barras
      ni el correo de reportes.
- [ ] Los errores internos salen como «Error interno», sin traza.
- [ ] Imágenes: solo admin, tipo por firma de bytes, tamaño máximo.

## 3. Front

- [ ] Ningún `innerHTML` / `insertAdjacentHTML` con datos que no pasen por
      `html\`\``: `grep -rn "innerHTML\|insertAdjacentHTML" src/`.
- [ ] CSP de `vite.config.js` sin `unsafe-inline` ni `unsafe-eval`;
      `connect-src` solo `script.google.com` y `script.googleusercontent.com`.
- [ ] `target="_blank"` con `rel="noopener noreferrer"`; `window.open` con
      `noopener`.
- [ ] El token de sesión viaja en el cuerpo del POST, nunca en la URL.
- [ ] Anti-clickjacking (`src/lib/marco.js`) activo.

## 4. CI e historial

- [ ] `.github/workflows/deploy.yml`: `permissions: {}` arriba y mínimos por
      trabajo; acciones fijadas por SHA; `npm ci --ignore-scripts`.
- [ ] Nada sensible versionado, **en todas las revisiones**:

```bash
git grep -n -I -E "gh[opsu]_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{35}|PRIVATE KEY|PIMIENTO\s*=" $(git rev-list --all)
git log --all --name-only --format= | grep -iE "\.xlsx$|\.csv$|\.env" | sort -u
```

- [ ] Sin `Co-Authored-By` de Claude en los mensajes (convención de
      `../CLAUDE.md`): `git log --format=%B | grep -ci "co-authored-by: claude"`.

## 5. Registrar

En `SECURITY.md`:

- Cada hallazgo nuevo en la tabla con id (`M` media, `L` baja, `I` info),
  severidad y estado. **Corregido** solo si está en el código; si es del
  backend, añade «vale en producción cuando se redespliegue» hasta que la dueña
  lo haga (skill `desplegar-backend`), y luego la fecha.
- Lo aceptado, con el porqué (p. ej. L7: Apps Script no da la IP del cliente).
- La fecha de la revisión en el primer párrafo.

Y un hito (skill `registrar-hito`) si hubo cambios con sustancia.

## Riesgos de diseño que no se «arreglan»

Conviene repetirlos a la dueña en cada auditoría (sección «Lo que queda en
manos de la dueña» de `SECURITY.md`):

- **Editar la hoja = ser admin** (M4): el script vive en la hoja. Compartirla
  solo como *Lector* con quien no sea admin.
- **Origen compartido** (M5) mientras la tienda viva en `seiler18.github.io`.
- **Verificación en dos pasos** en la cuenta de Google dueña y en GitHub.
