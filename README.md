# VentasMaker — catálogo, punto de venta e inventario de Ale ventas Alerce

Reemplazo propio de `catalogo.treinta.co/monik10`, sin mensualidad:

| Pieza | Dónde vive | Costo |
|---|---|---|
| **Catálogo público** (buscar, categorías, carrito, pedido por WhatsApp) | GitHub Pages — `https://seiler18.github.io/VentasMaker/` | $0 |
| **Panel de administración** (vender con escáner, inventario, reportes, etiquetas, usuarios) | `https://seiler18.github.io/VentasMaker/admin.html` | $0 |
| **Base de datos + API** | Una hoja de Google Sheets + Apps Script | $0 |

```
 Cliente (celular)                 Tienda (celular / PC + lector de códigos)
   │  catálogo, carrito               │  login, escanear, cobrar, ajustar stock
   ▼                                  ▼
 GitHub Pages ──────── fetch ────────► Apps Script (doGet / doPost)
 (HTML/CSS/JS estático)                 │  sesión, permisos, bloqueo
   │                                    ▼
   └─ pedido ─► WhatsApp de la tienda   Google Sheet
                                         Productos · Ventas · Movimientos
                                         Usuarios · Config · Registro
                                         Resumen diario/semanal/mensual/anual
```

## Qué se trajo del sitio anterior

`scraping/scrape.py` descargó los **440 productos** publicados (nombre, descripción,
precio, stock) y sus **432 fotos**; `scraping/build_semilla.py` los convirtió en
`public/data/catalogo.json` con:

- **SKU interno** `MK0001…MK0440` (sirve como código de barras para lo que no trae).
- **Categoría inferida** por palabras clave (Jeans, Poleras, Calzas y pantalones,
  Vestidos y faldas, Panties y calcetines, Fiestas Patrias, Juguetes, …): el sitio
  anterior no tenía ninguna.
- Fotos reducidas a 600px WebP (60 MB → 11 MB).

El sitio anterior **no publica códigos de barras ni costos**: esos datos hay que
traerlos del Excel (ver «Importar el Excel» abajo).

## Puesta en marcha (una sola vez, ~15 minutos)

> Guía detallada, con cada clic y los problemas frecuentes, para quien no es
> técnico: [`backend/PASO-A-PASO.md`](backend/PASO-A-PASO.md).

> Hazlo con la **cuenta de Google de la tienda**: la hoja y los datos quedan a su
> nombre, no al de quien programó el sitio.

1. **Crear la hoja.** En Google Drive → Nuevo → Hojas de cálculo. Nómbrala
   «VentasMaker».
2. **Pegar el backend.** En la hoja: *Extensiones → Apps Script*. Borra lo que
   haya en `Código.gs` y pega el contenido de `backend/Code.gs`. En *Configuración
   del proyecto* marca «Mostrar el archivo de manifiesto appsscript.json» y
   reemplázalo por `backend/appsscript.json`. Guarda.
3. **Instalar.** En el editor elige la función `instalar` y pulsa *Ejecutar*.
   Acepta los permisos. En el *Registro de ejecución* aparece:
   `Usuario: admin   Clave inicial: xxxxxxxxxxxxxx` → **cópiala**, no se vuelve
   a mostrar (si se pierde: ejecutar `restablecerAdmin`).
   Después ejecuta `importarSemilla` (carga los 440 productos) e
   `instalarDisparadores` (reporte diario a las 23:00).
4. **Publicar la API.** *Implementar → Nueva implementación → Aplicación web*.
   Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier usuario**. Copia la URL
   que termina en `/exec`.
5. **Conectar el front.** Pega esa URL en `src/config.js` → `API_URL` y publica
   (`git push`, ver abajo). Desde ese momento el catálogo muestra el stock real y
   el panel deja el modo demo.
6. **Entrar** a `/admin.html` con `admin` y la clave inicial → *Ajustes* →
   cambiar la clave. En *Usuarios* crea una cuenta **vendedor** para quien
   atiende el mesón.

> Cada vez que cambies `Code.gs`: *Implementar → Gestionar implementaciones →
> editar → Versión nueva*. Si creas una implementación nueva, la URL cambia.

## Uso diario

- **Vender:** el cursor queda en el campo de código. Con lector USB/Bluetooth solo
  se dispara; con el celular, botón de cámara. Cada lectura suma 1. *Cobrar*
  descuenta el stock y registra la venta.
- **Llegó mercadería:** *Vender → Ingreso de mercadería*, escanear cada prenda,
  *Registrar ingreso*.
- **Un producto sin código:** *Etiquetas* → imprime su SKU como código de barras
  (50×30 mm). Si trae código de fábrica y el sistema no lo conoce, al escanearlo
  aparece «Asignar a un producto…».
- **Pedidos de WhatsApp:** llegan al teléfono de la tienda con el detalle y el
  total. El stock se descuenta cuando se registra la venta en el panel (canal
  «local» por ahora).
- **Reportes:** panel *Reportes* (día / semana / mes / año, más vendidos, medios
  de pago, stock bajo, exportar CSV) y, en la hoja, las pestañas *Resumen …* que
  se reescriben cada noche. Con un correo en *Ajustes* llega el resumen del día.

## Importar el Excel

La hoja es la base de datos, así que importar es copiar y pegar. Columnas de
*Productos* (el script las busca por **nombre de encabezado**, el orden da igual):

`id · sku · codigo · nombre · descripcion · categoria · precio · costo · stock · stock_minimo · visible · imagen · creado · actualizado`

- Para **agregar códigos de barras** a los productos existentes: pega la columna
  del Excel en `codigo` haciendo calzar por nombre (BUSCARV/XLOOKUP).
- Los **productos nuevos** conviene crearlos desde el panel (*Inventario → Nuevo
  producto*): así el script les asigna `id` y `sku` y registra el stock inicial
  en *Movimientos*. Si se pegan muchos de una vez en la hoja, cada fila necesita
  un `id` único (p. ej. `=CONCATENAR("X";FILA())` convertido a valor) y un `sku`.
- `visible` = casilla o `si`. `precio`, `costo` y `stock` solo números.

## Desarrollo

```bash
npm install
npm run dev       # http://localhost:5173/VentasMaker/
npm run check     # estilos con tokens, imágenes de la semilla, CSP, secretos
npm run build     # check + build (falla si el check falla)
npm run preview   # sirve dist/ igual que en producción, con la CSP activa
```

Push a `main` → GitHub Actions → `gh-pages` (~2 min). Sin `API_URL`, el sitio
funciona en **modo demo**: catálogo desde la semilla y panel con usuario
`demo` / `demo` guardando en el navegador.

Seguridad: ver [`SECURITY.md`](SECURITY.md).
