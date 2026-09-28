/* MODO DEMO — un backend de mentira que corre en el navegador.

   Existe para poder probar el panel entero (vender, escanear, ajustar stock,
   reportes) antes de montar la hoja de Google. Imita las respuestas de
   backend/Code.gs con la semilla del catálogo, y guarda los cambios en
   localStorage de ESTE navegador: no hay datos reales ni nada que proteger,
   por eso la clave de demo puede ser pública.

   En cuanto src/config.js tiene API_URL, este archivo deja de usarse. */

const CLAVE = 'vm_demo'
let db

async function base() {
  if (db) return db
  try { db = JSON.parse(localStorage.getItem(CLAVE) || 'null') } catch { db = null }
  if (!db) {
    const r = await fetch(`${import.meta.env.BASE_URL}data/catalogo.json`)
    const productos = (await r.json()).map((p) => ({ ...p, costo: 0, stock_minimo: 1 }))
    db = { productos, ventas: [], movimientos: [], usuarios: [{ usuario: 'demo', nombre: 'Demo', rol: 'admin', activo: true }], config: {} }
  }
  return db
}
const guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(db)) } catch { /* lleno */ } }
const falla = (m) => { throw new Error(m) }

const ACC = {
  login: (b) => (b.usuario === 'demo' && b.clave === 'demo'
    ? { token: 'demo'.repeat(10), usuario: 'demo', nombre: 'Demo', rol: 'admin', debeCambiar: false }
    : falla('En modo demo: usuario "demo", clave "demo"')),
  sesion: () => ({ usuario: 'demo', nombre: 'Demo', rol: 'admin' }),
  logout: () => ({}),
  cambiarClave: () => falla('No disponible en modo demo'),
  productos: () => ({ productos: db.productos }),
  buscarCodigo: (b) => {
    const c = String(b.codigo).trim().toUpperCase()
    return { producto: db.productos.find((p) => String(p.codigo).toUpperCase() === c || p.sku === c) || null }
  },
  vender: (b) => {
    const ventaId = 'V' + Date.now().toString().slice(-8)
    let total = 0
    b.items.forEach((it) => {
      const p = db.productos.find((x) => x.id === it.id)
      if (!p) falla('Producto no encontrado')
      if (p.stock < it.cantidad) falla(`Stock insuficiente: ${p.nombre} (quedan ${p.stock})`)
    })
    const fecha = new Date().toISOString()
    b.items.forEach((it) => {
      const p = db.productos.find((x) => x.id === it.id)
      p.stock -= it.cantidad
      total += p.precio * it.cantidad
      db.ventas.push({ venta_id: ventaId, fecha, usuario: 'demo', producto_id: p.id, nombre: p.nombre, cantidad: it.cantidad,
        precio_unit: p.precio, subtotal: p.precio * it.cantidad, medio_pago: b.medioPago, anulada: false })
      db.movimientos.push({ fecha, usuario: 'demo', producto_id: p.id, nombre: p.nombre, tipo: 'venta', delta: -it.cantidad, stock_final: p.stock, nota: ventaId })
    })
    const desc = Math.min(Number(b.descuento) || 0, total)
    if (desc) db.ventas.filter((v) => v.venta_id === ventaId).at(-1).subtotal -= desc
    guardar()
    return { ventaId, total: total - desc, stock: b.items.map((it) => ({ id: it.id, stock: db.productos.find((p) => p.id === it.id).stock })) }
  },
  ventasDelDia: () => {
    const hoy = new Date().toDateString()
    const g = {}
    db.ventas.filter((v) => new Date(v.fecha).toDateString() === hoy).forEach((v) => {
      const x = g[v.venta_id] ||= { ventaId: v.venta_id, fecha: v.fecha, usuario: v.usuario, medio: v.medio_pago, anulada: v.anulada, total: 0, items: [] }
      x.total += v.subtotal
      x.items.push({ nombre: v.nombre, cantidad: v.cantidad, subtotal: v.subtotal })
    })
    return { ventas: Object.values(g).reverse() }
  },
  anularVenta: (b) => {
    const vs = db.ventas.filter((v) => v.venta_id === b.ventaId)
    if (vs.some((v) => v.anulada)) falla('La venta ya estaba anulada')
    vs.forEach((v) => { v.anulada = true; const p = db.productos.find((x) => x.id === v.producto_id); if (p) p.stock += v.cantidad })
    guardar(); return {}
  },
  guardarProducto: (b) => {
    const d = b.producto
    if (d.id) {
      // Igual que el backend: el stock no se toca desde la ficha.
      const p = db.productos.find((x) => x.id === d.id)
      const stock = p.stock
      Object.assign(p, d, { stock })
    }
    else {
      const n = Math.max(0, ...db.productos.map((p) => Number(String(p.sku).slice(2)) || 0)) + 1
      d.id = crypto.randomUUID(); d.sku = 'MK' + String(n).padStart(4, '0'); d.stock = Number(d.stock) || 0
      db.productos.push(d)
    }
    guardar(); return { id: d.id, sku: d.sku }
  },
  eliminarProducto: (b) => { db.productos.find((p) => p.id === b.id).visible = false; guardar(); return {} },
  // Uno ({id, delta | nuevo}) o un lote ({items}), todo o nada, como Code.gs.
  ajustarStock: (b) => {
    const lote = Array.isArray(b.items)
    const items = lote ? b.items : [b]
    if (!items.length) falla('El ajuste no tiene productos')
    const cambios = items.map((it) => {
      const p = db.productos.find((x) => x.id === it.id)
      if (!p) falla('Producto no encontrado')
      const final = !lote && it.nuevo !== undefined && it.nuevo !== '' ? Number(it.nuevo) : p.stock + Number(it.delta)
      if (!(final >= 0)) falla('Stock no válido')
      return { p, final }
    })
    const fecha = new Date().toISOString()
    cambios.forEach(({ p, final }) => {
      if (final === p.stock) return
      db.movimientos.push({ fecha, usuario: 'demo', producto_id: p.id, nombre: p.nombre, tipo: b.tipo, delta: final - p.stock, stock_final: final, nota: b.nota })
      p.stock = final
    })
    guardar()
    return lote ? { stock: cambios.map(({ p }) => ({ id: p.id, stock: p.stock })) } : { stock: cambios[0].final }
  },
  subirImagen: () => falla('La subida de imágenes necesita el backend'),
  reporte: (b) => {
    const clave = { dia: (d) => d.slice(0, 10), semana: (d) => d.slice(0, 10), mes: (d) => d.slice(0, 7), anio: (d) => d.slice(0, 4) }[b.periodo]
    const vs = db.ventas.filter((v) => !v.anulada)
    const serie = {}, top = {}, medios = {}, ids = new Set()
    vs.forEach((v) => {
      const k = clave(v.fecha)
      const s = serie[k] ||= { periodo: k, total: 0, unidades: 0, t: new Set() }
      s.total += v.subtotal; s.unidades += v.cantidad; s.t.add(v.venta_id); ids.add(v.venta_id)
      const t = top[v.producto_id] ||= { id: v.producto_id, nombre: v.nombre, unidades: 0, total: 0 }
      t.unidades += v.cantidad; t.total += v.subtotal
      medios[v.medio_pago] = (medios[v.medio_pago] || 0) + v.subtotal
    })
    const filas = Object.values(serie).sort((a, b) => a.periodo.localeCompare(b.periodo)).map((s) => ({ periodo: s.periodo, total: s.total, unidades: s.unidades, transacciones: s.t.size }))
    const total = filas.reduce((a, f) => a + f.total, 0)
    return {
      periodo: b.periodo,
      resumen: { total, unidades: filas.reduce((a, f) => a + f.unidades, 0), transacciones: ids.size, ticketPromedio: ids.size ? Math.round(total / ids.size) : 0 },
      serie: filas, top: Object.values(top).sort((a, b) => b.unidades - a.unidades).slice(0, 15), medios,
      stockBajo: db.productos.filter((p) => p.visible !== false && p.stock <= Math.max(p.stock_minimo || 0, 1)).map((p) => ({ id: p.id, nombre: p.nombre, stock: p.stock })).slice(0, 50),
    }
  },
  movimientos: (b) => ({ movimientos: db.movimientos.filter((m) => !b.id || m.producto_id === b.id).slice(-300).reverse() }),
  usuarios: () => ({ usuarios: db.usuarios }),
  guardarUsuario: () => falla('No disponible en modo demo'),
  config: () => ({ config: db.config }),
  guardarConfig: (b) => { Object.assign(db.config, b.config); guardar(); return {} },
}

export async function llamarDemo(accion, datos = {}) {
  await base()
  if (!ACC[accion]) throw new Error('Acción no válida')
  // Un poco de espera para que la interfaz se comporte como con red real.
  await new Promise((r) => setTimeout(r, 120))
  return { ok: true, srv: 2, ...structuredClone(ACC[accion](structuredClone(datos))) }
}

export function reiniciarDemo() {
  try { localStorage.removeItem(CLAVE) } catch { /* nada */ }
  db = null
}
