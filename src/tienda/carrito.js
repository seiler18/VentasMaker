/* Carrito del visitante. Vive en localStorage porque es una comodidad de
   quien navega (que no se pierda al recargar), no un dato del negocio: el
   pedido real se cierra por WhatsApp y el stock se descuenta cuando la venta
   se registra en el panel.

   Solo se guardan id y cantidad. Precio, nombre y stock se leen SIEMPRE del
   catálogo recién cargado: un carrito viejo no puede arrastrar un precio que
   ya cambió (ni uno editado a mano en el almacenamiento). */

const CLAVE = 'vm_carrito'
let items = leer()
const oyentes = new Set()

function leer() {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) || '{}')
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(items)) } catch { /* modo privado */ }
  oyentes.forEach((fn) => fn())
}

export const carrito = {
  suscribir: (fn) => oyentes.add(fn),
  cantidad: (id) => items[id] || 0,

  poner(id, n, max = Infinity) {
    const c = Math.max(0, Math.min(Math.floor(n) || 0, max, 999))
    if (c) items[id] = c
    else delete items[id]
    guardar()
  },

  vaciar() { items = {}; guardar() },

  /* Cruza el carrito con el catálogo: descarta lo que ya no existe y recorta
     lo que supera el stock actual. */
  lineas(porId) {
    let cambio = false
    const out = []
    for (const [id, n] of Object.entries(items)) {
      const p = porId.get(id)
      if (!p || p.stock <= 0) { delete items[id]; cambio = true; continue }
      const c = Math.min(n, p.stock)
      if (c !== n) { items[id] = c; cambio = true }
      out.push({ p, cantidad: c, subtotal: c * p.precio })
    }
    if (cambio) guardar()
    return out
  },
}
