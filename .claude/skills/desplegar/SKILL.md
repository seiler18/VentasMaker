---
name: desplegar
description: Publicar los cambios del front (catálogo y panel) en GitHub Pages y verificar que el deploy salió bien. Úsala cuando el usuario diga "sube los cambios", "publica", "deploy", "que se vea en la web", o pregunte por qué el sitio no se actualizó. Para cambios en backend/Code.gs usa desplegar-backend.
---

# Desplegar el front

## Qué va por aquí y qué no

| Cambiaste… | Cómo llega a producción |
|---|---|
| `src/`, `index.html`, `admin.html`, `public/`, estilos, `src/config.js` | **esta skill** (`git push`) |
| `backend/Code.gs`, `backend/appsscript.json` | skill `desplegar-backend` (copiar-pegar en Apps Script). El push solo actualiza la copia del repo |
| `.claude/`, `README.md`, `SECURITY.md`, `CLAUDE.md` | push; no cambia nada visible |

## Cómo funciona

```
git push origin main
   └─> Actions (.github/workflows/deploy.yml)
         build:  npm ci --ignore-scripts → npm audit → npm run build (check + vite)
         deploy: sube dist/ como artefacto de Pages → actions/deploy-pages
```

~2 minutos. No hay rama `gh-pages`: Pages está configurado con *Source:
GitHub Actions*. El trabajo que compila no puede escribir en el repo; el que
publica solo escribe en Pages.

## Antes de subir

```bash
npm test          # si tocaste algo que el backend también hace (demo.js imita a Code.gs)
npm run build     # incluye npm run check
npm run preview   # sirve dist/ con la CSP activa: el único modo que la aplica
```

`npm run check` rechaza: colores o duraciones fuera de `tokens.css`, imágenes
de la semilla que no existen (mayúsculas), `style=""` en el marcado (la CSP lo
bloquea) y patrones de secretos. Si falla aquí, falla en Actions.

**La CSP solo existe en el build** (`vite.config.js`): algo que funciona en
`npm run dev` puede romperse publicado. Si añades un servicio externo, su
dominio va en la directiva que corresponda del `CSP` de `vite.config.js`.

Revisión en `preview` (la hace el usuario, o `playwright-cli`):

- [ ] El catálogo carga, busca y filtra por categoría
- [ ] Carrito → «Enviar pedido» abre WhatsApp con el detalle
- [ ] `admin.html`: login, y la pestaña que cambiaste funciona
- [ ] En móvil (~390 px)
- [ ] La consola no muestra violaciones de CSP

## Subir

```bash
git status
git add <archivos>
git commit -m "qué cambió, concreto y en español"
git push origin main
```

## Verificar

```bash
gh run list --limit 3
gh run watch
URL="https://seiler18.github.io/VentasMaker/"
curl -s -o /dev/null -w "catálogo: %{http_code}\n" "$URL"
curl -s -o /dev/null -w "panel:    %{http_code}\n" "${URL}admin.html"
JS=$(curl -s "$URL" | grep -o 'assets/[^"]*\.js' | head -1)
curl -s -o /dev/null -w "js:       %{http_code}\n" "$URL$JS"
```

`index.html` no lleva hash y Pages lo cachea unos minutos: Ctrl+Shift+R.

## Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| Actions rojo en `npm audit` | Dependencia con vulnerabilidad alta | `npm audit fix` (sin `--force`), probar, subir |
| Actions rojo en `check` | Ver arriba | Arreglar en local, no desactivar la regla |
| En producción no carga nada y en dev sí | CSP bloqueando algo nuevo | Consola del navegador; añadir el dominio al `CSP` |
| El panel dice «modo demo» en producción | `API_URL` vacía en `src/config.js` | Poner la URL `/exec` |
| El catálogo muestra datos viejos | Caché del catálogo (5 min) o del navegador | Esperar / Ctrl+Shift+R |
