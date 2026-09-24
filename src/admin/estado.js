/* Estado compartido del panel: la sesión y la copia local del inventario.

   Las vistas leen productos de aquí en vez de pedirlos cada vez: escanear
   tiene que responder al instante, y con 440 productos la lista entera pesa
   menos que un par de imágenes. Tras cada escritura se actualiza la copia
   local con lo que devolvió el servidor, y `recargar()` trae la verdad de la
   hoja (por si alguien la editó a mano). */
import { hayBackend, llamar as llamarApi } from '../lib/api.js'
import { llamarDemo } from './demo.js'
import { normalizar } from '../lib/formato.js'

export const demo = !hayBackend()
export const llamar = demo ? llamarDemo : llamarApi

export const sesion = { usuario: '', nombre: '', rol: '', debeCambiar: false }
export const esAdmin = () => sesion.rol === 'admin'

let productos = []
let porId = new Map()
let porCodigo = new Map()

function indexar() {
  porId = new Map(productos.map((p) => [p.id, p]))
  porCodigo = new Map()
  productos.forEach((p) => {
    if (p.sku) porCodigo.set(String(p.sku).toUpperCase(), p)
    if (p.codigo) porCodigo.set(String(p.codigo).trim().toUpperCase(), p)
    p._n = normalizar(`${p.nombre} ${p.sku} ${p.codigo} ${p.categoria}`)
  })
}

export const inventario = {
  todos: () => productos,
  porId: (id) => porId.get(id),
  porCodigo: (c) => porCodigo.get(String(c).trim().toUpperCase().replace(/\s+/g, '')),
  async recargar() {
    const r = await llamar('productos')
    productos = r.productos
    indexar()
  },
  fijarStock(id, stock) { const p = porId.get(id); if (p) p.stock = stock },
  buscar(q, max = 12) {
    const w = normalizar(q).split(/\s+/).filter(Boolean)
    if (!w.length) return []
    return productos.filter((p) => w.every((x) => p._n.includes(x))).slice(0, max)
  },
  categorias: () => [...new Set(productos.map((p) => p.categoria).filter(Boolean))].sort(),
}
