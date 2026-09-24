// Banco de pruebas de backend/Code.gs con simulaciones mínimas de Apps Script.
import fs from 'node:fs'
import vm from 'node:vm'
import crypto from 'node:crypto'

const src = fs.readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8')

// ---------- simulaciones ----------
const aBytes = (x) => typeof x === 'string' ? [...Buffer.from(x, 'utf8')].map((b) => (b > 127 ? b - 256 : b)) : x
const aBuf = (x) => Buffer.from(aBytes(x).map((b) => (b + 256) % 256))
const firmar = (b) => [...b].map((x) => (x > 127 ? x - 256 : x))

class Hoja {
  constructor(n) { this.n = n; this.d = [] }
  getLastRow() { return this.d.length }
  getLastColumn() { return Math.max(0, ...this.d.map((r) => r.length)) }
  getMaxRows() { return 1000 }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.d.length), Math.max(1, this.getLastColumn())) }
  getRange(r, c, nr = 1, nc = 1) {
    const h = this
    return {
      getValues() {
        const out = []
        for (let i = 0; i < nr; i++) { const fila = []; for (let j = 0; j < nc; j++) fila.push(h.d[r - 1 + i]?.[c - 1 + j] ?? ''); out.push(fila) }
        return out
      },
      setValues(v) { v.forEach((fila, i) => fila.forEach((x, j) => h.set(r + i, c + j, x))); return this },
      setValue(x) { h.set(r, c, x); return this },
      setNumberFormat() { return this }, setFontWeight() { return this },
    }
  }
  set(r, c, x) {
    while (this.d.length < r) this.d.push([])
    const f = this.d[r - 1]; while (f.length < c) f.push('')
    // Sheets: un texto que empieza por ' se guarda sin el apóstrofo como texto.
    f[c - 1] = typeof x === 'string' && x.startsWith("'") ? { formulaNeutralizada: x.slice(1) } : x
  }
  deleteRows(i, n) { this.d.splice(i - 1, n) }
  clearContents() { this.d = [] }
  hideSheet() {} setFrozenRows() {}
  protect() { return { setDescription() { return { setWarningOnly() {} } } } }
}
const hojas = {}
const ss = {
  getSheetByName: (n) => hojas[n] || null,
  insertSheet: (n) => (hojas[n] = new Hoja(n)),
}
const cache = new Map(), props = new Map(), logs = []
const G = {
  console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) },
  SpreadsheetApp: { getActive: () => ss, flush() {} },
  CacheService: { getScriptCache: () => ({
    get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k),
    getAll: (ks) => Object.fromEntries(ks.filter((k) => cache.has(k)).map((k) => [k, cache.get(k)])),
    putAll: (o) => Object.entries(o).forEach(([k, v]) => cache.set(k, v)), removeAll: (ks) => ks.forEach((k) => cache.delete(k)),
  }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => JSON.parse(t) }) },
  Session: { getScriptTimeZone: () => 'America/Santiago' },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (a, s) => firmar(crypto.createHash('sha256').update(aBuf(s)).digest()),
    computeHmacSha256Signature: (v, k) => firmar(crypto.createHmac('sha256', aBuf(k)).update(aBuf(v)).digest()),
    base64Encode: (b) => aBuf(b).toString('base64'),
    base64EncodeWebSafe: (b) => aBuf(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
    base64Decode: (s) => firmar(Buffer.from(s, 'base64')),
    getUuid: () => crypto.randomUUID(),
    newBlob: (x) => ({ getBytes: () => aBytes(x) }),
    formatDate: (d, tz, f) => {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {})
      return f.replace('yyyy', p.year).replace('yy', p.year.slice(2)).replace('MM', p.month).replace('dd', p.day)
        .replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second)
    },
  },
  UrlFetchApp: {}, MailApp: { sendEmail: (...a) => logs.push('MAIL ' + a[0]) }, DriveApp: {}, ScriptApp: {},
}
const ctx = vm.createContext(G)
vm.runInContext(src + '\n;globalThis.__T = { doGet, doPost, instalar, generarReportes, restablecerAdmin, HOJAS, agregar_ };', ctx)
const T = ctx.__T
const post = (o) => T.doPost({ postData: { contents: JSON.stringify(o) } })

// ---------- pruebas ----------
let ok = 0, mal = 0
const esperar = (nombre, cond, extra = '') => { cond ? ok++ : mal++; console.log(`${cond ? '✓' : '✗'} ${nombre}${cond ? '' : '  → ' + extra}`) }

T.instalar()
const clave0 = /Clave inicial: (\S+)/.exec(logs.join('\n'))[1]
esperar('instalar crea hojas', ['Productos', 'Ventas', 'Movimientos', 'Usuarios', 'Config', 'Registro'].every((n) => hojas[n]))
esperar('pimiento en propiedades, no en la hoja', props.get('PIMIENTO')?.length >= 40)
esperar('hash no es la clave', !JSON.stringify(hojas.Usuarios.d).includes(clave0))

// productos de prueba (incluye nombre con fórmula)
const ahora = new Date()
T.agregar_('productos', [
  ['p1', 'MK0001', '7801', 'Jeans', 'd', 'Jeans', 10000, 4000, 5, 1, true, 'img/a.webp', ahora, ahora],
  ['p2', 'MK0002', '', '=IMPORTXML("http://x")', '', 'Otros', 2000, 500, 1, 1, true, '', ahora, ahora],
  ['p3', 'MK0003', '', 'Oculto', '', 'Otros', 3000, 100, 9, 1, false, '', ahora, ahora],
])
esperar('fórmula neutralizada al escribir', typeof hojas.Productos.d[2][3] === 'object')

// login
let r = post({ accion: 'login', usuario: 'admin', clave: 'mala' })
esperar('login con clave mala falla', !r.ok)
r = post({ accion: 'login', usuario: 'nadie', clave: 'x' })
esperar('usuario inexistente no deja registro', !JSON.stringify(hojas.Registro.d).includes('nadie'))
r = post({ accion: 'login', usuario: 'ADMIN ', clave: clave0 })
esperar('login correcto (normaliza usuario)', r.ok && r.token, JSON.stringify(r))
esperar('clave inicial es provisoria', r.debeCambiar === true)
let tok = r.token
r = post({ accion: 'productos', token: tok })
esperar('con clave provisoria no se puede operar', !r.ok && r.debeCambiar)
r = post({ accion: 'cambiarClave', token: tok, actual: clave0, nueva: 'corta1' })
esperar('rechaza clave débil', !r.ok)
r = post({ accion: 'cambiarClave', token: tok, actual: clave0, nueva: 'NuevaClave2026' })
esperar('cambia clave y devuelve token nuevo', r.ok && r.token && r.token !== tok, JSON.stringify(r))
esperar('token viejo queda inválido', post({ accion: 'sesion', token: tok }).sesion === false)
tok = r.token
esperar('token nuevo opera', post({ accion: 'productos', token: tok }).ok)

// catálogo público
const cat = T.doGet({ parameter: {} })
esperar('catálogo público sin ocultos', cat.ok && cat.productos.length === 2)
esperar('catálogo público sin costo ni código ni email', !JSON.stringify(cat).match(/costo|"codigo"|email_reporte/))
esperar('acción GET desconocida rechazada', !T.doGet({ parameter: { accion: 'usuarios' } }).ok)

// sin sesión
esperar('acción sin token rechazada', post({ accion: 'vender', items: [] }).sesion === false)
esperar('acción inexistente rechazada', !post({ accion: 'constructor', token: tok }).ok)
esperar('acción __proto__ rechazada', !post({ accion: '__proto__', token: tok }).ok)

// ventas
r = post({ accion: 'vender', token: tok, items: [{ id: 'p1', cantidad: 2, precio: 1 }], medioPago: 'debito' })
esperar('venta con precio del servidor', r.ok && r.total === 20000, JSON.stringify(r))
const ventaId = r.ventaId
esperar('stock descontado', r.stock[0].stock === 3)
esperar('venta con más que el stock falla', !post({ accion: 'vender', token: tok, items: [{ id: 'p1', cantidad: 4 }] }).ok)
esperar('cantidad negativa falla', !post({ accion: 'vender', token: tok, items: [{ id: 'p1', cantidad: -3 }] }).ok)
esperar('cantidad decimal no pasa como fracción', !post({ accion: 'vender', token: tok, items: [{ id: 'p1', cantidad: 0.4 }] }).ok)
hojas.Productos.d[3][8] = 'muchos'
esperar('stock con texto en la celda no permite vender', !post({ accion: 'vender', token: tok, items: [{ id: 'p3', cantidad: 1 }] }).ok)
hojas.Productos.d[3][8] = 9
r = post({ accion: 'vender', token: tok, items: [{ id: 'p1', cantidad: 1 }, { id: 'p3', cantidad: 2 }], descuento: 1000 })
esperar('descuento repartido suma exacto', r.ok && r.total === 15000, JSON.stringify(r))
esperar('anular devuelve stock', post({ accion: 'anularVenta', token: tok, ventaId }).ok &&
  post({ accion: 'productos', token: tok }).productos.find((p) => p.id === 'p1').stock === 4)
esperar('anular dos veces falla', !post({ accion: 'anularVenta', token: tok, ventaId }).ok)

// reportes
r = post({ accion: 'reporte', token: tok, periodo: 'dia' })
esperar('reporte diario excluye anuladas', r.ok && r.resumen.total === 15000 && r.resumen.transacciones === 1, JSON.stringify(r.resumen))
for (const p of ['semana', 'mes', 'anio']) esperar(`reporte ${p}`, post({ accion: 'reporte', token: tok, periodo: p }).ok)
T.generarReportes()
esperar('generarReportes escribe resúmenes', hojas['Resumen diario']?.d.length === 2 && hojas['Resumen anual']?.d.length === 2)

// ajuste de stock
r = post({ accion: 'ajustarStock', token: tok, id: 'p2', delta: 5, tipo: 'ingreso', nota: '=HYPERLINK("x")' })
esperar('ingreso suma', r.ok && r.stock === 6)
esperar('nota con fórmula neutralizada', typeof hojas.Movimientos.d.at(-1)[7] === 'object')
esperar('stock negativo rechazado', !post({ accion: 'ajustarStock', token: tok, id: 'p2', nuevo: -1 }).ok)

// productos
r = post({ accion: 'guardarProducto', token: tok, producto: { nombre: 'Nuevo', precio: 500, stock: 3, imagen: 'javascript:alert(1)' } })
esperar('imagen con URL no permitida rechazada', !r.ok)
r = post({ accion: 'guardarProducto', token: tok, producto: { nombre: 'Nuevo', precio: 500, stock: 3, codigo: '7801' } })
esperar('código duplicado rechazado', !r.ok)
r = post({ accion: 'guardarProducto', token: tok, producto: { nombre: 'Nuevo', precio: 500, stock: 3 } })
esperar('producto nuevo con SKU siguiente', r.ok && r.sku === 'MK0004', JSON.stringify(r))
r = post({ accion: 'buscarCodigo', token: tok, codigo: ' 7801 ' })
esperar('buscar por código', r.producto?.id === 'p1')

// usuarios y roles
r = post({ accion: 'guardarUsuario', token: tok, usuario: { nuevo: true, usuario: 'caja', nombre: 'Caja', rol: 'vendedor', clave: 'Provisoria123' } })
esperar('crear vendedor', r.ok, JSON.stringify(r))
esperar('crear usuario existente falla', !post({ accion: 'guardarUsuario', token: tok, usuario: { nuevo: true, usuario: 'caja', rol: 'admin', clave: 'OtraClave1234' } }).ok)
r = post({ accion: 'login', usuario: 'caja', clave: 'Provisoria123' })
let tv = r.token
esperar('vendedor con clave provisoria', r.debeCambiar === true)
tv = post({ accion: 'cambiarClave', token: tv, actual: 'Provisoria123', nueva: 'CajaPropia2026' }).token
esperar('vendedor puede vender', post({ accion: 'vender', token: tv, items: [{ id: 'p2', cantidad: 1 }] }).ok)
esperar('vendedor no ve costo en productos', post({ accion: 'productos', token: tv }).productos.every((p) => !('costo' in p)))
esperar('vendedor no ve costo en buscarCodigo', !('costo' in post({ accion: 'buscarCodigo', token: tv, codigo: '7801' }).producto))
esperar('vendedor no puede descuento', !post({ accion: 'vender', token: tv, items: [{ id: 'p2', cantidad: 1 }], descuento: 100 }).ok)
for (const a of ['ajustarStock', 'anularVenta', 'reporte', 'usuarios', 'guardarUsuario', 'guardarConfig', 'guardarProducto', 'subirImagen']) {
  esperar(`vendedor sin permiso: ${a}`, /permiso/.test(post({ accion: a, token: tv }).error || ''))
}
esperar('ventasDelDia del vendedor solo propias', post({ accion: 'ventasDelDia', token: tv }).ventas.every((v) => v.usuario === 'caja'))
// ascender y luego degradar: la sesión debe caer
post({ accion: 'guardarUsuario', token: tok, usuario: { usuario: 'caja', nombre: 'Caja', rol: 'admin', activo: true } })
esperar('cambiar rol cierra la sesión del afectado', post({ accion: 'sesion', token: tv }).sesion === false)
post({ accion: 'guardarUsuario', token: tok, usuario: { usuario: 'caja', rol: 'vendedor', activo: false } })
esperar('usuario desactivado no entra', !post({ accion: 'login', usuario: 'caja', clave: 'CajaPropia2026' }).ok)
esperar('admin no se quita su rol', !post({ accion: 'guardarUsuario', token: tok, usuario: { usuario: 'admin', rol: 'vendedor' } }).ok)

// config
post({ accion: 'guardarConfig', token: tok, config: { tienda_nombre: '=1+1', PIMIENTO: 'x', email_reporte: 'a@b.cl' } })
const cfg = post({ accion: 'config', token: tok }).config
esperar('config ignora claves no permitidas', !('PIMIENTO' in cfg) && props.get('PIMIENTO') !== 'x')
esperar('email no sale en catálogo público', !JSON.stringify(T.doGet({ parameter: {} })).includes('a@b.cl'))

// fuerza bruta
for (let i = 0; i < 6; i++) post({ accion: 'login', usuario: 'admin', clave: 'mala' + i })
esperar('bloqueo por usuario tras 5 fallos', /15 minutos/.test(post({ accion: 'login', usuario: 'admin', clave: 'NuevaClave2026' }).error || ''))
for (let i = 0; i < 25; i++) post({ accion: 'login', usuario: 'x' + i, clave: 'y' })
esperar('freno global de logins por minuto', /un minuto/.test(post({ accion: 'login', usuario: 'otro', clave: 'y' }).error || ''))

// logout
post({ accion: 'logout', token: tok })
esperar('logout invalida el token', post({ accion: 'sesion', token: tok }).sesion === false)

// cuerpo inválido
esperar('JSON inválido', !T.doPost({ postData: { contents: '{x' } }).ok)
esperar('error interno no filtra detalles', (() => { const x = post({ accion: 'login', usuario: {}, clave: [] }); return !x.ok && !/stack|Code\.gs/.test(JSON.stringify(x)) })())

console.log(`\n${ok} bien, ${mal} mal`)
const errs = logs.filter((l) => l.startsWith('ERR'))
if (errs.length) console.log('Errores internos registrados:\n' + errs.join('\n'))
if (mal) process.exitCode = 1
