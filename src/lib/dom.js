/* Plantillas HTML con escape automático.

   Todo lo que llega de la hoja (nombres, descripciones, notas) lo pudo
   escribir cualquiera con acceso a la planilla, así que se trata como no
   confiable: `html` escapa CADA valor interpolado salvo que venga envuelto
   en `crudo()` — que solo se usa con HTML generado por el propio código
   (iconos, fragmentos ya escapados). Así un "<img onerror=…>" en el nombre
   de un producto se ve como texto y no se ejecuta. */

class Crudo {
  constructor(s) { this.s = s }
  toString() { return this.s }
}

export const crudo = (s) => new Crudo(String(s))

export function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function valor(v) {
  if (v instanceof Crudo) return v.s
  if (Array.isArray(v)) return v.map(valor).join('')
  if (v === false || v === null || v === undefined) return ''
  return esc(v)
}

export function html(partes, ...vals) {
  let s = partes[0]
  vals.forEach((v, i) => { s += valor(v) + partes[i + 1] })
  return new Crudo(s)
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel)
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)]

export function pintar(el, contenido) {
  el.innerHTML = valor(contenido)
}

/* Aviso breve abajo de la pantalla. textContent, nunca innerHTML: los
   mensajes de error pueden traer texto del servidor. */
export function aviso(msg, tipo = 'ok') {
  let caja = document.getElementById('avisos')
  if (!caja) {
    caja = document.createElement('div')
    caja.id = 'avisos'
    caja.setAttribute('role', 'status')
    caja.setAttribute('aria-live', 'polite')
    document.body.append(caja)
  }
  const n = document.createElement('div')
  n.className = `aviso aviso-${tipo}`
  n.textContent = msg
  caja.append(n)
  setTimeout(() => n.remove(), tipo === 'error' ? 6000 : 3000)
}
