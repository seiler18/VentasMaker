/* Foto del catálogo para publicar con el sitio (va dentro de `npm run build`).

   El catálogo se pinta al instante con esta foto (public/data/vivo.json,
   servida por el CDN de GitHub Pages) y después se actualiza con el
   inventario en vivo de Apps Script, que puede tardar un minuto. Sin la
   foto, quien entra por primera vez vería la semilla del scraping (precios
   y stock de cuando se migró) hasta que conteste Apps Script.

   - En CI (o con --vivo) la pide al backend; en local, para no esperar a
     Google en cada build, usa la semilla salvo que se pida.
   - Solo guarda campos de vitrina, y valida las imágenes con las mismas
     reglas que el front: el archivo es público.
   - NUNCA falla el build: si el backend no contesta, publica la semilla. */
import { readFileSync, writeFileSync } from 'node:fs'
import { API_URL } from '../src/config.js'

const raiz = new URL('..', import.meta.url)
const destino = new URL('public/data/vivo.json', raiz)
const INTENTOS = 3
const ESPERA_MS = 60_000
const CONFIG_PUBLICA = ['tienda_nombre', 'tienda_telefono', 'tienda_direccion', 'tienda_ciudad',
                        'tienda_logo', 'horario', 'mensaje_whatsapp', 'despacho', 'retiro', 'mostrar_agotados']

const imagenValida = (r) => /^img\/[A-Za-z0-9._-]+\.(webp|jpe?g|png)$/.test(r) ||
  /^https:\/\/lh3\.googleusercontent\.com\/d\/[A-Za-z0-9_-]+(=w\d+)?$/.test(r)
const texto = (v, max) => String(v ?? '').slice(0, max)

function limpiar(p) {
  const imagen = String(p.imagen || '').trim()
  return {
    id: texto(p.id, 64), sku: texto(p.sku, 32), nombre: texto(p.nombre, 120), descripcion: texto(p.descripcion, 1000),
    categoria: texto(p.categoria, 60), precio: Math.max(0, Math.round(Number(p.precio) || 0)),
    stock: Math.round(Number(p.stock) || 0), imagen: imagenValida(imagen) ? imagen : '',
    creado: Number(p.creado) || 0,
    ...(p.visible === false && { visible: false }),
  }
}

async function pedirVivo() {
  for (let i = 1; i <= INTENTOS; i++) {
    const t0 = Date.now()
    try {
      const r = await fetch(`${API_URL}?accion=catalogo`, { redirect: 'follow', signal: AbortSignal.timeout(ESPERA_MS) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      if (!j.ok || !Array.isArray(j.productos) || !j.productos.length) throw new Error(j.error || 'catálogo vacío')
      console.log(`  intento ${i}: ${j.productos.length} productos en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      return j
    } catch (err) {
      console.log(`  intento ${i}: ${err.message} (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
      if (i < INTENTOS) await new Promise((r) => setTimeout(r, 3000 * i))
    }
  }
  return null
}

const quiereVivo = Boolean(API_URL) && (process.env.CI || process.argv.includes('--vivo'))
let salida = null
if (quiereVivo) {
  console.log('foto del catálogo: pidiendo el inventario en vivo…')
  const j = await pedirVivo()
  if (j) {
    const tienda = {}
    CONFIG_PUBLICA.forEach((k) => { if (j.tienda?.[k] !== undefined) tienda[k] = texto(j.tienda[k], 2000) })
    salida = { generado: Date.now(), srv: Number(j.srv) || 0, tienda, productos: j.productos.filter((p) => p && p.id && p.nombre).map(limpiar) }
  }
}
if (!salida) {
  // generado: 0 → el front la trata como más vieja que cualquier copia propia.
  const semilla = JSON.parse(readFileSync(new URL('public/data/catalogo.json', raiz), 'utf8'))
  salida = { generado: 0, tienda: {}, productos: semilla.map(limpiar) }
  console.log(`foto del catálogo: ${quiereVivo ? 'el backend no respondió; ' : ''}se publica la semilla (${salida.productos.length} productos)`)
} else {
  console.log(`✓ foto del catálogo: ${salida.productos.length} productos en vivo`)
}
writeFileSync(destino, JSON.stringify(salida))
