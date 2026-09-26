---
name: importar-catalogo
description: Traer el catálogo de una tienda (productos, precios, stock, fotos) a VentasMaker, desde la plataforma anterior por scraping o desde un Excel, y dejarlo como semilla o cargado en la hoja. Úsala cuando haya que migrar productos de Treinta u otra plataforma, cargar una planilla de productos, añadir códigos de barras o costos en bloque, o rehacer la semilla del catálogo.
---

# Importar un catálogo

Hay dos destinos distintos, y conviene no confundirlos:

| Destino | Qué es | Cuándo |
|---|---|---|
| **Semilla** `public/data/catalogo.json` + `public/img/` | catálogo inicial versionado; lo usa el modo demo y lo carga `importarSemilla()` | tienda nueva, antes del backend |
| **La hoja** (pestaña *Productos*) | la base de datos real | tienda ya funcionando |

Con el backend ya instalado, **la semilla deja de importar**: `importarSemilla()`
se niega si *Productos* tiene datos (a propósito, para no pisar ventas reales).

## A. Desde Treinta (`catalogo.treinta.co/<tienda>`)

Así se migró Ale ventas Alerce: 440 productos, 432 fotos.

### 1. Datos — `scraping/scrape.py`

El catálogo público de Treinta es una app Next.js que pide los productos con
una *server action* sin autenticación, paginada de a 100. El script necesita
dos valores que se sacan del navegador:

1. Abre el catálogo con DevTools → *Network*, filtra por `Fetch/XHR`.
2. Baja hasta que cargue otra página de productos. La petición `POST` a la URL
   del catálogo lleva:
   - cabecera **`Next-Action`** → `ACTION`
   - en el cuerpo, **`storeId`** → `STORE`
3. Cámbialos en `scrape.py` junto con la URL, y ejecuta desde `scraping/`:

```bash
cd scraping && python scrape.py      # → productos_treinta.json
```

> `ACTION` **cambia cada vez que Treinta publica una versión nueva** de su
> front. Si el script devuelve HTML o falla al parsear la línea `1:`, lo
> primero es volver a copiarlo del navegador.

Es solo lectura de lo que cualquier visitante ve, y son datos de la propia
tienda. No se hacen pruebas intrusivas a una plataforma de terceros.

### 2. Fotos → `scraping/img/<id>.webp`

Cada producto trae `imageUrl`. Se descargan a `scraping/img_orig/` y se
reducen a **600 px WebP** (en la migración original: 60 MB → 11 MB). El script
que lo hizo no quedó versionado; con ImageMagick 7
(`C:\Program Files\ImageMagick-7.1.2-Q16-HDRI`, no siempre en el PATH):

```bash
cd scraping && mkdir -p img
for f in img_orig/*; do
  id=$(basename "${f%.*}")
  magick "$f" -resize '600x600>' -strip -quality 78 "img/$id.webp"
done
```

El nombre **tiene que ser el `id` del producto**: es lo que busca
`build_semilla.py`. `scraping/img_orig/` y `scraping/img/` están en
`.gitignore`: lo publicado es la copia de `public/img/`.

### 3. Semilla — `scraping/build_semilla.py`

```bash
cd scraping && python build_semilla.py   # → ../public/data/catalogo.json + ../public/img/
```

Hace tres cosas que la plataforma anterior no tenía:

- **SKU interno** `MK0001…` por orden alfabético: sirve de código de barras
  para lo que no trae uno (skill de etiquetas en el panel). Para otra tienda,
  cambia el prefijo `MK`.
- **Categoría inferida** por las reglas `REGLAS` (regex sobre el nombre
  normalizado). **Gana la primera que calce**: «Chaqueta de huaso» tiene que
  ser *Típico* antes que *Chaqueta*. Revisa el `Counter` que imprime al final;
  si *Otros* es grande, faltan reglas.
- Normaliza espacios del nombre y fuerza números en precio y stock.

### 4. Comprobar

```bash
npm run check    # falla si una imagen de la semilla no existe o hay SKU repetido
npm run dev      # modo demo con la semilla nueva
```

## B. Desde un Excel

### Tienda nueva (a la semilla)

Convierte el Excel a la forma de `catalogo.json` (una lista de objetos con
`id, sku, codigo, nombre, descripcion, categoria, precio, stock, visible,
imagen`). Un script de Python de un solo uso en `scraping/` basta. `id` único
y estable, `sku` único, `codigo` como **texto**.

### Tienda funcionando (a la hoja)

La hoja es la base de datos: importar es copiar y pegar. El script localiza
cada columna **por su encabezado**, así que el orden da igual:

`id · sku · codigo · nombre · descripcion · categoria · precio · costo · stock · stock_minimo · visible · imagen · creado · actualizado`

- **Añadir códigos de barras o costos** a lo existente: BUSCARV/XLOOKUP por
  nombre o SKU hacia la columna `codigo` / `costo`. La columna `codigo` debe
  quedar en formato **texto** (un código que empieza por 0 pierde el cero si
  Sheets lo toma como número, y ya no calza al escanear).
- **Productos nuevos**: mejor desde el panel (*Inventario → Nuevo producto*):
  el script asigna `id` y `sku` y deja el stock inicial en *Movimientos*. Si
  se pegan muchos de una vez, cada fila necesita `id` único y `sku`.
- `visible` = casilla o `si`. `precio`, `costo`, `stock`: solo números. Un
  texto en `stock` o `precio` **bloquea la venta** de ese producto (a
  propósito).
- El catálogo público tarda hasta **5 minutos** en reflejar cambios hechos a
  mano en la hoja (caché). Los del panel se ven al instante.

**Nunca** subas al repo un Excel ni un CSV exportado de la hoja: traen hashes
de claves y ventas. `.gitignore` ya los excluye; no lo fuerces con `git add -f`.
