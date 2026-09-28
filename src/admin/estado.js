/* Estado compartido del panel: la sesión y la copia local del inventario.

   Las vistas leen productos de aquí en vez de pedirlos cada vez: escanear
   tiene que responder al instante, y con 440 productos la lista entera pesa
   menos que un par de imágenes. Tras cada escritura se actualiza la copia
   local con lo que devolvió el servidor, y `recargar()` trae la verdad de la
   hoja (por si alguien la editó a mano).

   La copia y el perfil (nombre y rol) se guardan también en sessionStorage,
   junto al token: al recargar la página el panel se pinta al instante con
   ellos y los confirma con el servidor por detrás, en vez de dejar a la
   vendedora mirando "Cargando…" mientras Apps Script despierta. Mismo
   alcance que el token (esta pestaña, se borra al cerrarla); el servidor
   sigue comprobando sesión y rol en cada acción. */
import { hayBackend, llamar as llamarApi, backend } from '../lib/api.js'
import { llamarDemo } from './demo.js'
import { normalizar } from '../lib/formato.js'

export const demo = !hayBackend()
export const llamar = demo ? llamarDemo : llamarApi
/* Qué entiende el backend conectado (el demo imita siempre la última versión). */
export const capacidad = demo ? { reintentaEscrituras: true, ajusteEnLote: true } : backend

export const sesion = { usuario: '', nombre: '', rol: '', debeCambiar: false }
export const esAdmin = () => sesion.rol === 'admin'

const CLAVE_PERFIL = 'vm_perfil'
const CLAVE_INV = 'vm_inv'
const leerSS = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null') } catch { return null } }
const guardarSS = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)) } catch { /* lleno o privado */ } }
const borrarSS = (k) => { try { sessionStorage.removeItem(k) } catch { /* nada */ } }

export const perfil = {
  leer: () => leerSS(CLAVE_PERFIL),
  guardar() { guardarSS(CLAVE_PERFIL, { usuario: sesion.usuario, nombre: sesion.nombre, rol: sesion.rol, debeCambiar: sesion.debeCambiar }) },
  borrar() { borrarSS(CLAVE_PERFIL); borrarSS(CLAVE_INV) },
}

let productos = []
let porId = new Map()
let porCodigo = new Map()
let estadoCarga = 'vacio'      // vacio | cargando | listo | error
let ultimoError = null
let enCurso = null
const oyentes = new Set()

function indexar() {
  porId = new Map(productos.map((p) => [p.id, p]))
  porCodigo = new Map()
  productos.forEach((p) => {
    if (p.sku) porCodigo.set(String(p.sku).toUpperCase(), p)
    if (p.codigo) porCodigo.set(String(p.codigo).trim().toUpperCase(), p)
    p._n = normalizar(`${p.nombre} ${p.sku} ${p.codigo} ${p.categoria}`)
  })
}

function cambio() {
  if (!demo) guardarSS(CLAVE_INV, productos.map(({ _n, ...p }) => p))
  oyentes.forEach((fn) => { try { fn() } catch (e) { console.error(e) } })
}

export const inventario = {
  todos: () => productos,
  porId: (id) => porId.get(id),
  porCodigo: (c) => porCodigo.get(String(c).trim().toUpperCase().replace(/\s+/g, '')),
  get estado() { return estadoCarga },
  get error() { return ultimoError },
  hayDatos: () => productos.length > 0,

  /* Suscripción: la vista repinta cuando llega o cambia el inventario.
     Devuelve la función para darse de baja (la vista la llama al salir). */
  alCambiar(fn) { oyentes.add(fn); return () => oyentes.delete(fn) },

  /* Lo guardado en esta pestaña, si lo hay: pintar ya y confirmar después. */
  restaurar() {
    const g = leerSS(CLAVE_INV)
    if (!Array.isArray(g) || !g.length) return false
    productos = g
    indexar()
    estadoCarga = 'listo'
    return true
  },

  /* Trae la hoja. Varias vistas pueden pedirlo a la vez: una sola llamada. */
  recargar() {
    if (enCurso) return enCurso
    if (!productos.length) { estadoCarga = 'cargando'; oyentes.forEach((fn) => fn()) }
    enCurso = llamar('productos')
      .then((r) => {
        productos = r.productos
        indexar()
        estadoCarga = 'listo'
        ultimoError = null
        cambio()
      })
      .catch((err) => {
        ultimoError = err
        if (!productos.length) estadoCarga = 'error'
        oyentes.forEach((fn) => fn())
        throw err
      })
      .finally(() => { enCurso = null })
    return enCurso
  },

  /* Recarga sin bloquear a nadie: tras una escritura, para recoger lo que
     hayan cambiado otros. Si falla, la copia local ya está bien. */
  refrescar() { inventario.recargar().catch(() => {}) },

  fijarStock(id, stock) { const p = porId.get(id); if (p) { p.stock = stock; cambio() } },

  /* Aplica en la copia local lo que se acaba de guardar en el servidor,
     para no esperar otra ida y vuelta a Apps Script. */
  aplicar(id, cambios) {
    const p = porId.get(id)
    if (p) Object.assign(p, cambios)
    else productos.push({ id, ...cambios })
    indexar()
    cambio()
  },

  vaciar() { productos = []; indexar(); estadoCarga = 'vacio'; ultimoError = null },

  buscar(q, max = 12) {
    const w = normalizar(q).split(/\s+/).filter(Boolean)
    if (!w.length) return []
    return productos.filter((p) => w.every((x) => p._n.includes(x))).slice(0, max)
  },
  categorias: () => [...new Set(productos.map((p) => p.categoria).filter(Boolean))].sort(),
}
