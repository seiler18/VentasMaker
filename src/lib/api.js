import { API_URL } from '../config.js'

/* Cliente del backend de Apps Script.

   POST con Content-Type text/plain: así la petición es "simple" y el
   navegador no lanza un preflight OPTIONS, que Apps Script no contesta.
   El token va en el CUERPO, nunca en la URL: las URL quedan en historiales,
   registros de proxys y en el Referer.

   El token se guarda en sessionStorage (se borra al cerrar la pestaña). No
   es inmune a un XSS — nada en el navegador lo es —, por eso la otra mitad
   de la defensa es que no haya XSS: escape en dom.js y CSP estricta.

   RED POCO FIABLE. Apps Script contesta en dos saltos (script.google.com →
   302 → script.googleusercontent.com) y en esta cuenta se han medido de 2 a
   70 s por llamada, con 404 intermitentes en el segundo salto AUNQUE la
   acción ya se ejecutó. Por eso:
   - cada intento tiene un tiempo máximo;
   - las lecturas se reintentan solas;
   - las escrituras llevan una clave `idem` y solo se reintentan si el
     backend anunció que la entiende (srv ≥ 2): así un cobro repetido
     devuelve la misma venta en vez de registrar otra. Con un backend viejo,
     un fallo ambiguo se informa como "incierto" y NO se repite. */

const CLAVE_TOKEN = 'vm_token'
export const hayBackend = () => Boolean(API_URL)

export const token = {
  get: () => { try { return sessionStorage.getItem(CLAVE_TOKEN) } catch { return null } },
  set: (t) => { try { sessionStorage.setItem(CLAVE_TOKEN, t) } catch { /* modo privado */ } },
  borrar: () => { try { sessionStorage.removeItem(CLAVE_TOKEN) } catch { /* nada */ } },
}

/* `red`: no hubo respuesta útil del servidor (sin conexión, tiempo agotado,
   404/5xx). `incierto`: una escritura de la que no se sabe si se aplicó. */
export class ErrorApi extends Error {
  constructor(msg, extra = {}) { super(msg); Object.assign(this, extra) }
}

let alCaducar = () => {}
export const onSesionCaducada = (fn) => { alCaducar = fn }

/* Lecturas: repetirlas no cambia nada. Todo lo demás es escritura. */
const LECTURAS = new Set(['login', 'logout', 'sesion', 'productos', 'buscarCodigo', 'ventasDelDia',
                          'reporte', 'movimientos', 'usuarios', 'config'])
const ESPERA_LECTURA = 45_000
const ESPERA_ESCRITURA = 90_000   // abortar no detiene al servidor: se espera más
const INTENTOS_LECTURA = 3
const INTENTOS_ESCRITURA = 2
const PAUSAS = [1200, 3500]       // entre intentos
const PAUSA_EN_CURSO = 4000       // la primera ejecución de una escritura sigue en marcha
const MAX_EN_CURSO = 8

/* Versión del backend que ha contestado (0 = aún no se sabe o es anterior
   a que existiera el campo). */
let srv = 0
export const backend = {
  get version() { return srv },
  get reintentaEscrituras() { return srv >= 2 },
  get ajusteEnLote() { return srv >= 2 },
}

/* ---------- actividad de red (para el indicador del panel) ---------- */

const oyentes = new Set()
let enVuelo = 0
export function onActividad(fn) { oyentes.add(fn); return () => oyentes.delete(fn) }
const emitir = (e) => oyentes.forEach((fn) => { try { fn({ ...e, enVuelo }) } catch { /* nada */ } })

const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

function idAleatorio() {
  const b = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

class ErrorRed extends Error {}

function textoRed(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'Sin conexión a internet.'
  if (err.message === 'tiempo') return 'Google Sheets no respondió a tiempo.'
  if (/^HTTP/.test(err.message)) return `Google Sheets no respondió bien (${err.message.replace('HTTP ', 'error ')}).`
  return 'No se pudo conectar con Google Sheets.'
}

/* Un intento: fetch con tiempo máximo. Cualquier cosa que no sea un JSON
   del backend es ErrorRed (reintentable); el JSON con ok:false no lo es. */
async function pedir(url, opciones, ms) {
  const ctl = new AbortController()
  const reloj = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { ...opciones, redirect: 'follow', credentials: 'omit', signal: ctl.signal })
    if (!r.ok) throw new ErrorRed(`HTTP ${r.status}`)
    try { return await r.json() } catch { throw new ErrorRed('respuesta') }
  } catch (err) {
    if (err instanceof ErrorRed) throw err
    throw new ErrorRed(ctl.signal.aborted ? 'tiempo' : 'red')
  } finally {
    clearTimeout(reloj)
  }
}

export async function llamar(accion, datos = {}) {
  if (!API_URL) throw new ErrorApi('El backend no está configurado (src/config.js)')
  const escritura = !LECTURAS.has(accion)
  const cuerpo = JSON.stringify({ ...datos, accion, token: token.get(), ...(escritura && { idem: idAleatorio() }) })
  const opciones = { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: cuerpo }
  const max = escritura ? INTENTOS_ESCRITURA : INTENTOS_LECTURA

  enVuelo++
  emitir({ tipo: 'inicio', accion })
  let bien = false
  try {
    let fallos = 0, enCurso = 0
    for (;;) {
      let j
      try {
        j = await pedir(API_URL, opciones, escritura ? ESPERA_ESCRITURA : ESPERA_LECTURA)
      } catch (err) {
        fallos++
        const puede = fallos < max && (!escritura || backend.reintentaEscrituras)
        if (!puede) {
          throw escritura
            ? new ErrorApi(`${textoRed(err)} No sabemos si se guardó: revisa antes de repetirlo.`, { red: true, incierto: true })
            : new ErrorApi(`${textoRed(err)} Probamos ${fallos} ${fallos === 1 ? 'vez' : 'veces'}.`, { red: true })
        }
        emitir({ tipo: 'reintento', accion, intento: fallos + 1, de: max })
        await pausa(PAUSAS[fallos - 1] ?? PAUSAS.at(-1))
        continue
      }
      if (j.srv) srv = j.srv
      if (!j.ok && j.enCurso && ++enCurso <= MAX_EN_CURSO) {
        emitir({ tipo: 'reintento', accion, enCurso: true })
        await pausa(PAUSA_EN_CURSO)
        continue
      }
      if (!j.ok) {
        if (j.sesion === false) { token.borrar(); alCaducar() }
        throw new ErrorApi(j.error || 'Error', { sesion: j.sesion, debeCambiar: j.debeCambiar })
      }
      bien = true
      return j
    }
  } finally {
    enVuelo--
    emitir({ tipo: 'fin', accion, bien })
  }
}

/* Catálogo público (GET, sin sesión). El catálogo ya se pinta con una copia
   local mientras esto llega, así que dos intentos bastan. */
export async function catalogo({ intentos = 2, espera = 35_000 } = {}) {
  for (let i = 1; ; i++) {
    try {
      const j = await pedir(`${API_URL}?accion=catalogo`, {}, espera)
      if (!j.ok) throw new ErrorApi(j.error || 'Error')
      if (j.srv) srv = j.srv
      return j
    } catch (err) {
      if (i >= intentos) throw err instanceof ErrorRed ? new ErrorApi(textoRed(err), { red: true }) : err
      await pausa(PAUSAS[i - 1] ?? PAUSAS.at(-1))
    }
  }
}
