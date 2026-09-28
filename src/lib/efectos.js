/* Confirmaciones, errores y esperas: que cada acción tenga respuesta visible.

   - aviso()       mensaje breve abajo, con icono y barra de tiempo.
   - celebrar()    confirmación grande (✓ que se dibuja) para lo importante:
                   una venta, un ingreso, un pedido enviado. Con tipo 'error'
                   muestra una ✗ y espera a que la cierren.
   - conBoton()    el botón muestra que trabaja, y después ✓ o sacudida.
   - destellar() / desvanecer()   una fila nueva o cambiada se ilumina; una
                   que sale se desvanece antes de irse.
   - panelError()  pantalla de "no se pudo cargar" con Reintentar.
   - vigilarRed()  barra y aviso cuando Google tarda, y el estado sin conexión.

   Los mensajes se ponen con textContent: pueden traer texto del servidor.
   Las duraciones salen de tokens.css (regla 7): la animación marca el ritmo
   y el código escucha su fin; con movimiento reducido (sin animaciones) se
   usa un temporizador con la misma duración. */
import { html, crudo, pintar } from './dom.js'

const SIN_MOVIMIENTO = window.matchMedia('(prefers-reduced-motion: reduce)')
const HAY_POPOVER = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype

export function duracion(token, porDefecto) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const n = parseFloat(v)
  if (!Number.isFinite(n)) return porDefecto
  return v.endsWith('ms') ? n : v.endsWith('s') ? n * 1000 : n
}

/* Espera el fin de la animación CSS de `el` (o un tiempo, sin animaciones). */
function alTerminar(el, token, porDefecto, fn) {
  let hecho = false
  const una = () => { if (!hecho) { hecho = true; fn() } }
  if (SIN_MOVIMIENTO.matches) return setTimeout(una, token ? duracion(token, porDefecto) : 0)
  el.addEventListener('animationend', (e) => { if (e.target === el) una() }, { once: true })
  // Red de seguridad: si la animación no llega a correr (pestaña oculta).
  setTimeout(una, (token ? duracion(token, porDefecto) : porDefecto) + 400)
}

/* Lo que va en la capa superior (avisos, estado de red) debe verse también
   encima de un <dialog> modal abierto; `popover` lo pone ahí. Se vuelve a
   mostrar para quedar por encima del último diálogo abierto. */
function alFrente(el) {
  if (!HAY_POPOVER) return
  try { if (el.matches(':popover-open')) el.hidePopover(); el.showPopover() } catch { /* nada */ }
}

const ICONO_TIPO = {
  ok: '<path d="M5 12.5l4.2 4.2L19 7"/>',
  error: '<path d="M12 7v6M12 17h.01"/><circle cx="12" cy="12" r="9"/>',
  aviso: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  red: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01"/>',
}
const svgTipo = (tipo) => crudo(`<svg class="icono" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONO_TIPO[tipo] || ICONO_TIPO.info}</svg>`)

/* ============================================================
   AVISOS
   ============================================================ */

const MAX_AVISOS = 4

function cajaAvisos() {
  let caja = document.getElementById('avisos')
  if (!caja) {
    caja = document.createElement('div')
    caja.id = 'avisos'
    if (HAY_POPOVER) caja.popover = 'manual'
    document.body.append(caja)
  }
  alFrente(caja)
  return caja
}

function quitarAviso(n) {
  if (n.classList.contains('saliendo')) return
  n.classList.add('saliendo')
  alTerminar(n, null, 300, () => {
    const caja = n.parentElement
    n.remove()
    if (caja && !caja.children.length && HAY_POPOVER) { try { caja.hidePopover() } catch { /* nada */ } }
  })
}

/* tipo: 'ok' | 'error' | 'aviso' | 'info'. Pasar el ratón por encima
   detiene la cuenta atrás (la barra se pausa y con ella el cierre). */
export function aviso(msg, tipo = 'ok', { persistente = false } = {}) {
  const caja = cajaAvisos()
  const n = document.createElement('div')
  n.className = `aviso aviso-${tipo}`
  n.setAttribute('role', tipo === 'error' ? 'alert' : 'status')
  pintar(n, html`
    <span class="aviso-icono">${svgTipo(tipo)}</span>
    <span class="aviso-texto"></span>
    <button class="aviso-cerrar" type="button" aria-label="Cerrar aviso">
      <svg class="icono" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
    ${persistente ? '' : html`<span class="aviso-tiempo" aria-hidden="true"></span>`}`)
  n.querySelector('.aviso-texto').textContent = msg
  n.querySelector('.aviso-cerrar').addEventListener('click', () => quitarAviso(n))
  caja.append(n)
  while (caja.children.length > MAX_AVISOS) caja.firstElementChild.remove()
  if (!persistente) {
    const barra = n.querySelector('.aviso-tiempo')
    const token = tipo === 'error' ? '--dura-aviso-error' : '--dura-aviso'
    if (SIN_MOVIMIENTO.matches) setTimeout(() => quitarAviso(n), duracion(token, 5000))
    else barra.addEventListener('animationend', () => quitarAviso(n), { once: true })
  }
  if (tipo === 'error') navigator.vibrate?.([60, 40, 60])
  return { cerrar: () => quitarAviso(n), texto: (t) => { n.querySelector('.aviso-texto').textContent = t } }
}

/* ============================================================
   CONFIRMACIÓN GRANDE
   ============================================================ */

/* Devuelve una promesa que se cumple al cerrarse. Con tipo 'ok' se cierra
   sola; con 'error' espera a que la persona la cierre (o elija una acción).
   acciones: [{ texto, primaria?, fn? }] */
export function celebrar({ titulo, detalle = '', tipo = 'ok', acciones = [] }) {
  return new Promise((resolver) => {
    const d = document.createElement('dialog')
    d.className = `celebra celebra-${tipo}`
    d.setAttribute('aria-labelledby', 'celebra-titulo')
    const ok = tipo === 'ok'
    pintar(d, html`
      <div class="celebra-marca" aria-hidden="true">
        <svg viewBox="0 0 80 80">
          <circle class="celebra-aro" cx="40" cy="40" r="34"/>
          ${ok ? crudo('<path class="celebra-trazo" d="M24 41.5l10.5 10.5L57 29.5"/>')
               : crudo('<path class="celebra-trazo" d="M28 28l24 24M52 28 28 52"/>')}
        </svg>
        ${ok ? html`<span class="celebra-chispas">${Array.from({ length: 10 }, () => html`<i></i>`)}</span>` : ''}
      </div>
      <h2 id="celebra-titulo"></h2>
      <p class="celebra-detalle"></p>
      ${acciones.length || !ok ? html`<div class="celebra-acciones">
        ${(acciones.length ? acciones : [{ texto: 'Entendido', primaria: true }]).map((a, i) =>
          html`<button class="btn ${a.primaria ? 'btn-primario' : 'btn-borde'}" type="button" data-i="${i}">${a.texto}</button>`)}
      </div>` : html`<span class="celebra-tiempo" aria-hidden="true"></span>`}`)
    d.querySelector('h2').textContent = titulo
    d.querySelector('.celebra-detalle').textContent = detalle
    d.querySelectorAll('.celebra-chispas i').forEach((c, i) => c.style.setProperty('--n', String(i)))
    let elegida = null
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]')
      if (b) { elegida = acciones[Number(b.dataset.i)] || null; d.close() }
      else if (e.target === d || ok) d.close()   // clic fuera, o en cualquier parte si es un ✓
    })
    d.addEventListener('close', () => {
      d.remove()
      elegida?.fn?.()
      resolver(elegida)
    })
    // Los avisos de éxito previos sobran bajo una confirmación grande.
    document.querySelectorAll('#avisos .aviso:not(.aviso-error)').forEach(quitarAviso)
    document.body.append(d)
    d.showModal()
    if (ok && !acciones.length) {
      const barra = d.querySelector('.celebra-tiempo')
      if (SIN_MOVIMIENTO.matches) setTimeout(() => d.open && d.close(), duracion('--dura-celebra', 1900))
      else barra.addEventListener('animationend', () => d.open && d.close(), { once: true })
      navigator.vibrate?.(40)
    } else {
      navigator.vibrate?.([60, 40, 60])
    }
  })
}

/* ============================================================
   BOTONES, FILAS
   ============================================================ */

function marcar(el, clase, token, porDefecto) {
  if (!el?.isConnected) return
  el.classList.remove('btn-hecho', 'btn-fallo')
  void el.offsetWidth
  el.classList.add(clase)
  alTerminar(el, token, porDefecto, () => el.classList.remove(clase))
}

/* Ejecuta `fn` con el botón en estado "trabajando" (desactivado, con giro y
   aria-busy); al terminar, ✓ verde breve o sacudida. Devuelve lo que
   devuelva `fn` y deja pasar su error para que quien llama lo muestre. */
export async function conBoton(btn, fn) {
  if (btn?.getAttribute('aria-busy') === 'true') return undefined
  const estabaDesactivado = btn?.disabled
  if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.classList.add('btn-cargando') }
  try {
    const r = await fn()
    marcar(btn, 'btn-hecho', '--dura-hecho', 1100)
    return r
  } catch (err) {
    marcar(btn, 'btn-fallo', null, 450)
    throw err
  } finally {
    if (btn) {
      btn.classList.remove('btn-cargando')
      btn.removeAttribute('aria-busy')
      btn.disabled = Boolean(estabaDesactivado)
    }
  }
}

/* Sacude un elemento (un campo con error, un botón que no puede). */
export function sacudir(el) { marcar(el, 'sacude', null, 450) }

export function destellar(el) {
  if (!el) return
  el.classList.remove('destella'); void el.offsetWidth; el.classList.add('destella')
  alTerminar(el, null, 1300, () => el.classList.remove('destella'))
}

/* Desvanece y resuelve cuando ya no se ve (quien llama decide si lo quita). */
export function desvanecer(el) {
  return new Promise((r) => {
    if (!el?.isConnected) return r()
    el.classList.add('se-va')
    alTerminar(el, null, 400, r)
  })
}

/* ============================================================
   PANTALLA DE ERROR
   ============================================================ */

/* Sustituye el contenido de `el` por un error con salida: qué pasó, qué
   hacer, y un botón Reintentar que vuelve a llamar a `reintentar`. */
export function panelError(el, { titulo = 'No se pudo cargar', detalle = '', reintentar, compacto = false } = {}) {
  pintar(el, html`
    <div class="panel-error ${compacto ? 'compacto' : ''}" role="alert">
      <span class="pe-icono" aria-hidden="true">${svgTipo('red')}</span>
      <h2 class="pe-titulo"></h2>
      <p class="pe-detalle"></p>
      ${compacto ? '' : html`<p class="pe-ayuda">Suele ser pasajero: Google Sheets a veces tarda en responder. Si persiste, revisa tu conexión o inténtalo en unos minutos.</p>`}
      ${reintentar ? html`<button class="btn btn-primario" type="button" data-reintentar>Reintentar</button>` : ''}
    </div>`)
  el.querySelector('.pe-titulo').textContent = titulo
  el.querySelector('.pe-detalle').textContent = detalle
  const b = el.querySelector('[data-reintentar]')
  b?.addEventListener('click', () => conBoton(b, async () => { await reintentar() }).catch(() => {}))
}

/* ============================================================
   ESTADO DE LA RED
   ============================================================ */

/* Barra fina arriba mientras hay peticiones; si tardan, una píldora que lo
   dice (y cuándo se reintenta). Además, aviso al perder y recuperar la
   conexión. `onActividad` viene de api.js. */
const LENTO_MS = 4000
const MUY_LENTO_MS = 18000
const APARECE_MS = 250

export function vigilarRed(onActividad) {
  const barra = document.createElement('div')
  barra.className = 'red-barra'
  barra.hidden = true
  barra.setAttribute('aria-hidden', 'true')
  const pildora = document.createElement('div')
  pildora.className = 'red-pildora'
  pildora.setAttribute('role', 'status')
  if (HAY_POPOVER) pildora.popover = 'manual'
  pildora.hidden = true
  document.body.append(barra, pildora)

  let desde = 0, tics = [], reintento = ''
  const decir = (tipo, texto) => {
    pintar(pildora, html`${svgTipo(tipo)}<span></span>`)
    pildora.querySelector('span').textContent = texto
    pildora.dataset.tipo = tipo
    if (pildora.hidden) { pildora.hidden = false; alFrente(pildora) }
  }
  const callar = () => {
    pildora.hidden = true
    if (HAY_POPOVER) { try { pildora.hidePopover() } catch { /* nada */ } }
  }
  const limpiar = () => { tics.forEach(clearTimeout); tics = [] }

  onActividad((e) => {
    if (e.tipo === 'inicio' && e.enVuelo === 1) {
      desde = Date.now(); reintento = ''
      limpiar()
      tics.push(setTimeout(() => { barra.hidden = false }, APARECE_MS))
      tics.push(setTimeout(() => decir('info', 'Conectando con Google Sheets…'), LENTO_MS))
      tics.push(setTimeout(() => decir('aviso', 'Google está tardando más de lo normal. Seguimos esperando…'), MUY_LENTO_MS))
    }
    if (e.tipo === 'reintento') {
      reintento = e.enCurso ? 'Terminando la operación anterior…' : `Reintentando (${e.intento} de ${e.de})…`
      decir('aviso', reintento)
    }
    if (e.tipo === 'fin' && e.enVuelo === 0) {
      limpiar()
      barra.hidden = true
      const tardo = Date.now() - desde
      // "Listo" solo si salió bien: si falló, el error ya se muestra donde toca.
      if (!pildora.hidden && tardo > LENTO_MS && e.bien) {
        decir('ok', 'Listo')
        tics.push(setTimeout(callar, 1200))
      } else callar()
    }
  })

  let sinRed = null
  window.addEventListener('offline', () => { sinRed = aviso('Sin conexión a internet. Lo que hagas no se guardará hasta que vuelva.', 'error', { persistente: true }) })
  window.addEventListener('online', () => { sinRed?.cerrar(); sinRed = null; aviso('Conexión recuperada', 'ok') })
}
