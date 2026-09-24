import { API_URL } from '../config.js'

/* Cliente del backend de Apps Script.

   POST con Content-Type text/plain: así la petición es "simple" y el
   navegador no lanza un preflight OPTIONS, que Apps Script no contesta.
   El token va en el CUERPO, nunca en la URL: las URL quedan en historiales,
   registros de proxys y en el Referer.

   El token se guarda en sessionStorage (se borra al cerrar la pestaña). No
   es inmune a un XSS — nada en el navegador lo es —, por eso la otra mitad
   de la defensa es que no haya XSS: escape en dom.js y CSP estricta. */

const CLAVE_TOKEN = 'vm_token'
export const hayBackend = () => Boolean(API_URL)

export const token = {
  get: () => { try { return sessionStorage.getItem(CLAVE_TOKEN) } catch { return null } },
  set: (t) => { try { sessionStorage.setItem(CLAVE_TOKEN, t) } catch { /* modo privado */ } },
  borrar: () => { try { sessionStorage.removeItem(CLAVE_TOKEN) } catch { /* nada */ } },
}

export class ErrorApi extends Error {}

let alCaducar = () => {}
export const onSesionCaducada = (fn) => { alCaducar = fn }

export async function llamar(accion, datos = {}) {
  if (!API_URL) throw new ErrorApi('El backend no está configurado (src/config.js)')
  let r
  try {
    r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...datos, accion, token: token.get() }),
      redirect: 'follow',
      credentials: 'omit',
    })
  } catch {
    throw new ErrorApi('Sin conexión con el servidor')
  }
  let j
  try { j = await r.json() } catch { throw new ErrorApi('Respuesta no válida del servidor') }
  if (!j.ok) {
    if (j.sesion === false) { token.borrar(); alCaducar() }
    throw new ErrorApi(j.error || 'Error')
  }
  return j
}

export async function catalogo() {
  const r = await fetch(`${API_URL}?accion=catalogo`, { credentials: 'omit', redirect: 'follow' })
  const j = await r.json()
  if (!j.ok) throw new Error(j.error || 'Error')
  return j
}
