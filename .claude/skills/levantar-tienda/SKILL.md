---
name: levantar-tienda
description: Montar una tienda nueva (catálogo público + panel de ventas con escáner + inventario en Google Sheets) partiendo de VentasMaker, de principio a fin. Úsala cuando el usuario diga "hazme una tienda para X", "quiero el mismo sistema para otro negocio", "clona VentasMaker", o quiera reemplazar una plataforma de catálogo con mensualidad (Treinta, Jumpseller, Shopify básico) por una propia sin costo.
---

# Levantar una tienda nueva desde VentasMaker

VentasMaker **es** la plantilla: no hay una carpeta aparte de la que copiar.
Una tienda nueva es un repositorio nuevo con este código, sus datos y su propio
backend en la cuenta de Google **del negocio**.

Orquesta las demás skills en este orden. No te saltes el paso 1.

## 1. Briefing (antes de tocar código)

Pide y deja escrito en `briefing.md` del repo nuevo:

| Dato | Para qué |
|---|---|
| Nombre de la tienda, ciudad, dirección | `src/config.js`, `Code.gs → instalar()`, `index.html` |
| WhatsApp (formato `569XXXXXXXX`, sin `+`) | adonde llegan los pedidos |
| Horario por día | `horario` en Config |
| ¿Despacho? ¿Retiro? ¿Mostrar agotados? | banderas de Config |
| De dónde sale el catálogo: plataforma anterior (URL), Excel, o cero | skill `importar-catalogo` |
| Logo y una foto de portada | `public/img/logo.webp`, `public/img/portada.webp` |
| Cuenta de Google **del negocio** | ahí vive la hoja; no la tuya |
| ¿Dominio propio u organización de GitHub? | ver paso 2 |

**Regla previa a todo:** no se inventan datos del negocio. Lo que no esté en el
briefing se pregunta.

## 2. Repositorio y origen

Cada tienda en su **propio origen**. Si se publica como otro proyecto de
`seiler18.github.io`, comparte origen con todos los demás sitios de esa cuenta
y un fallo en cualquiera puede leer la sesión del panel (hallazgo M5 de
`SECURITY.md`). En orden de preferencia:

1. Dominio propio de la tienda (p. ej. `nombretienda.cl`) → `base: '/'`.
2. Organización de GitHub gratuita solo para la tienda
   (`nombretienda.github.io`, repo con ese nombre) → `base: '/'`.
3. Como proyecto de `seiler18` (lo que hace VentasMaker hoy) →
   `base: '/NOMBRE-REPO/'`. Aceptable solo si el usuario lo decide sabiendo lo
   anterior.

Copia **sin historial** (el de VentasMaker es de otra tienda):

```bash
# desde C:\Desarrollo_JS
git clone --depth 1 git@github.com:seiler18/VentasMaker.git NuevaTienda
cd NuevaTienda && rm -rf .git && git init -b main
```

Borra lo que es de Ale ventas Alerce y no sirve a la nueva:
`public/data/catalogo.json`, `public/img/*` (salvo que reuses iconos),
`scraping/productos_treinta.json`, `.claude/hitos/*` (deja el `README.md` con
la tabla vacía). El `.claude/skills/` se queda: son las skills de la tienda.

## 3. Personalizar — la lista completa

Esto es todo lo que lleva datos de la tienda. Búscalo siempre con grep por si
apareció algo nuevo:

```bash
git grep -n -i "ale ventas\|alerce\|monik10\|56950446613\|/VentasMaker/" -- ':!public/data' ':!scraping/*.json'
```

| Archivo | Qué cambia |
|---|---|
| `src/config.js` | `TIENDA` entero; `API_URL = ''` hasta el paso 6 |
| `backend/Code.gs` → `instalar()` | los valores iniciales de Config (nombre, teléfono, dirección, ciudad, horario) |
| `backend/Code.gs` → `importarSemilla()` | la `url` del `catalogo.json` publicado de la tienda nueva |
| `vite.config.js` | `base` según el paso 2 |
| `index.html` | `<title>`, `description`, `og:title`, `og:image` (URL absoluta) |
| `public/img/logo.webp`, `portada.webp`, `public/favicon.png` | identidad (skill `optimizar-imagenes` de WebMaker para el peso) |
| `src/styles/tokens.css` | paleta: **solo aquí** hay colores (`npm run check` lo exige) |
| `README.md`, `backend/PASO-A-PASO.md`, `SECURITY.md` | nombre de la tienda, URLs, `raw.githubusercontent.com/<repo>` |
| `CLAUDE.md` | primera línea: qué tienda es |
| `scraping/scrape.py` | solo si se migra desde Treinta (ver `importar-catalogo`) |

## 4. Catálogo semilla

Skill `importar-catalogo`. Termina con `public/data/catalogo.json` y las fotos
en `public/img/`, y `npm run check` en verde.

## 5. Publicar el front en modo demo

Skill `desplegar`. Con `API_URL` vacía el sitio funciona en **modo demo**
(catálogo desde la semilla, panel con `demo`/`demo` guardando en el
navegador): ya se puede enseñar al cliente.

**El orden importa:** `importarSemilla()` del backend descarga el
`catalogo.json` **desde el sitio publicado**. Si el front no está arriba, el
paso 6 falla.

## 6. Backend en la cuenta del negocio

Skill `desplegar-backend`, apartado «Primera instalación». Lo hace la persona
dueña con `backend/PASO-A-PASO.md` (actualizado en el paso 3); tú solo recibes
la URL `/exec`.

## 7. Conectar y verificar

1. `API_URL` en `src/config.js` → skill `desplegar`.
2. `curl -s "<API_URL>?accion=catalogo" | head -c 200` → empieza por `{"ok":true`.
3. Recorrido con `playwright-cli` (o lo hace el usuario): catálogo carga los
   productos reales; carrito → abre WhatsApp con el pedido; panel → login con
   `admin` pide cambiar la clave.
4. La dueña crea las cuentas **vendedor** y revisa *Ajustes*.

## 8. Registrar

Skill `registrar-hito`: el `0001` de la tienda nueva. Si al montarla encontraste
algo que le pasaría igual a la siguiente, corrígelo **también en VentasMaker**
(código o skill) y regístralo allí.

## Trampas ya pagadas

| Síntoma | Causa | Dónde está resuelto |
|---|---|---|
| Catálogo público: «Error interno» aunque `instalar()` funcionó | `getActive()` es `null` en `doGet`/`doPost` | `ss_()` guarda el ID de la hoja; ejecutar `instalar()` desde el editor una vez |
| `instalar()`: *Specified permissions are not sufficient…* | scope `spreadsheets.currentonly` | `appsscript.json` con `spreadsheets` completo |
| *Extensiones → Apps Script* da «no se puede abrir el archivo» | varias cuentas de Google abiertas: el editor abre con la predeterminada | ventana de incógnito solo con la cuenta del negocio |
| La URL del backend cambió y el front dejó de conectar | se usó «Nueva implementación» en vez de «Versión nueva» | skill `desplegar-backend` |
| Una imagen se ve en local y da 404 publicada | GitHub Pages distingue mayúsculas | `npm run check` (punto 3) |
