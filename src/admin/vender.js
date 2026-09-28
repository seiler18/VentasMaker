/* VENDER — el punto de venta.

   Flujo pensado para el mesón: el cursor vive en el campo de código. Un
   lector USB/Bluetooth "teclea" el código y un Enter; la cámara del
   teléfono hace lo mismo desde el diálogo del escáner. Cada lectura suma una
   unidad al ticket. "Cobrar" registra la venta y descuenta el stock en la
   hoja en una sola operación del servidor.

   Modo INGRESO (solo admin): el mismo escaneo, pero suma al stock. Sirve
   para recibir mercadería: se escanea cada prenda que llega y se confirma.

   Cada paso responde a la vista: la línea que entra se ilumina, la que sale
   se desvanece, un código desconocido sacude el campo, y cobrar termina en
   un ✓ grande (o en un error que dice qué hacer). */
import { html, pintar, $ } from '../lib/dom.js'
import { aviso, celebrar, conBoton, destellar, desvanecer, panelError, sacudir } from '../lib/efectos.js'
import { clp, hora } from '../lib/formato.js'
import { icono } from '../lib/iconos.js'
import { urlImagen } from '../lib/imagen.js'
import { iniciarEscaner } from '../lib/escaner.js'
import { llamar, inventario, esAdmin, sesion, capacidad } from './estado.js'
import { elegirProducto } from './selector.js'

const MEDIOS = [['efectivo', 'Efectivo'], ['debito', 'Débito'], ['credito', 'Crédito'], ['transferencia', 'Transferencia'], ['otro', 'Otro']]
const NOMBRE_MEDIO = Object.fromEntries(MEDIOS)

export default function vender(el) {
  const st = { modo: 'venta', lineas: new Map(), ocupado: false, ventas: null }
  let pararCamara = null

  pintar(el, html`
    <section class="pos">
      <div class="pos-izq">
        ${esAdmin() ? html`
        <div class="segmentado" role="group" aria-label="Modo">
          <button type="button" data-modo="venta" aria-pressed="true">Venta</button>
          <button type="button" data-modo="ingreso" aria-pressed="false">Ingreso de mercadería</button>
        </div>` : ''}
        <form class="escaneo" id="form-codigo" autocomplete="off">
          <label class="oculto-visual" for="codigo">Código de barras o nombre</label>
          <input class="entrada entrada-codigo" id="codigo" placeholder="Escanea o escribe código / nombre" enterkeyhint="done" autofocus>
          <button class="btn btn-primario btn-icono" type="button" id="abrir-camara" aria-label="Escanear con la cámara">${icono.camara}</button>
        </form>
        <ul class="sugerencias" id="sugerencias" aria-label="Coincidencias"></ul>
        <div id="ticket"></div>
      </div>
      <aside class="pos-der">
        <h2>Ventas de hoy</h2>
        <div id="ventas-hoy">${esqueletoVentas()}</div>
      </aside>
    </section>

    <dialog id="dlg-camara" class="dlg-camara" aria-label="Escáner">
      <div class="dialogo-cab"><h2>Escanear</h2><button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button></div>
      <div class="camara">
        <video id="video" playsinline muted></video>
        <div class="mira" aria-hidden="true"></div>
      </div>
      <p class="camara-ultimo" id="camara-ultimo" aria-live="polite">Apunta al código de barras</p>
    </dialog>
  `)

  const campo = $('#codigo', el)
  const enfocar = () => { if (!$('dialog[open]')) campo.focus() }

  /* ---------- lectura de códigos ---------- */

  async function leerCodigo(texto) {
    const c = String(texto).trim()
    if (!c) return
    let p = inventario.porCodigo(c)
    if (!p && /^[0-9A-Za-z-]{4,}$/.test(c)) {
      // Puede ser un producto creado en otro dispositivo después de cargar.
      campo.classList.add('buscando')
      try {
        const r = (await llamar('buscarCodigo', { codigo: c })).producto
        if (r) { inventario.aplicar(r.id, r); p = inventario.porId(r.id) }
      } catch { /* sigue: se prueba por nombre */ } finally { campo.classList.remove('buscando') }
    }
    if (p) return sumar(p, 1)
    const coinciden = inventario.buscar(c)
    if (coinciden.length === 1) return sumar(coinciden[0], 1)
    if (coinciden.length) return mostrarSugerencias(coinciden)
    noEncontrado(c)
  }

  function noEncontrado(c) {
    sacudir(campo)
    navigator.vibrate?.([80, 60, 80])
    pintar($('#sugerencias', el), html`
      <li class="no-encontrado">
        <span>No hay ningún producto con el código <strong>${c}</strong>.</span>
        ${esAdmin() ? html`<button class="btn btn-borde btn-chico" type="button" data-asignar="${c}">Asignar a un producto…</button>` : ''}
      </li>`)
  }

  function mostrarSugerencias(lista) {
    pintar($('#sugerencias', el), lista.map((p) => html`
      <li><button type="button" class="sugerencia" data-id="${p.id}">
        <span>${p.nombre}</span><span class="sug-meta">${p.sku}${p.codigo ? ` · ${p.codigo}` : ''} · stock ${p.stock} · ${clp(p.precio)}</span>
      </button></li>`))
  }

  async function sumar(p, n) {
    const actual = st.lineas.get(p.id)?.cantidad || 0
    if (st.modo === 'venta' && actual + n > p.stock) {
      aviso(p.stock <= 0 ? `${p.nombre}: sin stock` : `${p.nombre}: solo quedan ${p.stock}`, 'error')
      sacudir($(`.ticket-linea[data-id="${CSS.escape(p.id)}"]`, el) || campo)
      return
    }
    $('#sugerencias', el).innerHTML = ''
    campo.value = ''
    if (actual + n <= 0) {
      await desvanecer($(`.ticket-linea[data-id="${CSS.escape(p.id)}"]`, el))
      st.lineas.delete(p.id)
      pintarTicket()
      return
    }
    st.lineas.set(p.id, { p, cantidad: actual + n })
    pintarTicket()
    const li = $(`.ticket-linea[data-id="${CSS.escape(p.id)}"]`, el)
    if (n > 0) destellar(li)
    if ($('#dlg-camara').open) $('#camara-ultimo').textContent = `✓ ${p.nombre} (${actual + n})`
  }

  /* ---------- ticket ---------- */

  function vacioTicket(venta) {
    if (!inventario.hayDatos() && inventario.estado === 'error') {
      return html`<div class="ticket-vacio" id="ticket-error"></div>`
    }
    if (!inventario.hayDatos()) {
      return html`<p class="vacio ticket-vacio"><span class="rueda" aria-hidden="true"></span> Cargando inventario… ya puedes escanear códigos.</p>`
    }
    return html`<p class="vacio ticket-vacio">${venta ? 'Escanea un producto para empezar la venta.' : 'Escanea lo que llegó: cada lectura suma una unidad al stock.'}</p>`
  }

  function pintarTicket() {
    const lineas = [...st.lineas.values()]
    const total = lineas.reduce((s, l) => s + l.cantidad * l.p.precio, 0)
    const unidades = lineas.reduce((s, l) => s + l.cantidad, 0)
    const venta = st.modo === 'venta'
    const medio = $('#medio', el)?.value
    pintar($('#ticket', el), !lineas.length ? vacioTicket(venta) : html`
      <ul class="ticket">
        ${lineas.map((l) => html`
          <li class="ticket-linea" data-id="${l.p.id}">
            ${urlImagen(l.p.imagen) ? html`<img src="${urlImagen(l.p.imagen)}" alt="" width="48" height="48">` : html`<span class="sin-foto mini">${icono.foto}</span>`}
            <div class="tl-info">
              <p class="tl-nombre">${l.p.nombre}</p>
              <p class="tl-meta">${l.p.sku} · ${clp(l.p.precio)} · stock ${l.p.stock}${venta ? '' : html` → <strong>${l.p.stock + l.cantidad}</strong>`}</p>
            </div>
            <div class="paso">
              <button class="btn btn-borde btn-chico btn-icono" type="button" data-delta="-1" aria-label="Uno menos">${l.cantidad === 1 ? icono.basura : icono.menos}</button>
              <input class="entrada paso-input" type="number" inputmode="numeric" min="1" value="${l.cantidad}" aria-label="Cantidad">
              <button class="btn btn-borde btn-chico btn-icono" type="button" data-delta="1" aria-label="Uno más">${icono.mas}</button>
            </div>
            ${venta ? html`<p class="tl-sub">${clp(l.cantidad * l.p.precio)}</p>` : ''}
          </li>`)}
      </ul>
      <div class="cobro">
        ${venta ? html`
          <div class="cobro-fila">
            <label class="campo"><span>Medio de pago</span>
              <select class="entrada" id="medio">${MEDIOS.map(([v, t]) => html`<option value="${v}">${t}</option>`)}</select></label>
            ${esAdmin() ? html`<label class="campo"><span>Descuento ($)</span>
              <input class="entrada" id="descuento" type="number" inputmode="numeric" min="0" step="100" value="0"></label>` : ''}
          </div>
          <p class="cobro-total"><span>${unidades} unidad${unidades === 1 ? '' : 'es'}</span><strong id="total-final">${clp(total)}</strong></p>
          <div class="cobro-botones">
            <button class="btn btn-borde" type="button" id="cancelar">Cancelar</button>
            <button class="btn btn-primario btn-grande" type="button" id="cobrar">Cobrar ${clp(total)}</button>
          </div>` : html`
          <p class="cobro-total"><span>Ingreso</span><strong>+${unidades} unidad${unidades === 1 ? '' : 'es'}</strong></p>
          <label class="campo"><span>Nota (proveedor, factura…)</span><input class="entrada" id="nota-ingreso" maxlength="200"></label>
          <div class="cobro-botones">
            <button class="btn btn-borde" type="button" id="cancelar">Cancelar</button>
            <button class="btn btn-primario btn-grande" type="button" id="registrar-ingreso">Registrar ingreso</button>
          </div>`}
      </div>`)
    // Repintar no debe perder el medio de pago elegido.
    if (medio && $('#medio', el)) $('#medio', el).value = medio
    const caja = $('#ticket-error', el)
    if (caja) {
      panelError(caja, { compacto: true, titulo: 'No se pudo cargar el inventario', detalle: inventario.error?.message || '',
        reintentar: () => inventario.recargar() })
    }
  }

  async function cobrar() {
    if (st.ocupado || !st.lineas.size) return
    const descuento = Number($('#descuento', el)?.value || 0)
    const lineas = [...st.lineas.values()]
    const total = lineas.reduce((s, l) => s + l.cantidad * l.p.precio, 0) - descuento
    if (descuento < 0 || total < 0) { sacudir($('#descuento', el)); return aviso('Descuento no válido', 'error') }
    if (!confirm(`¿Registrar la venta por ${clp(total)}?`)) return
    const medio = $('#medio', el).value
    st.ocupado = true
    try {
      const r = await conBoton($('#cobrar', el), () => llamar('vender', {
        items: lineas.map((l) => ({ id: l.p.id, cantidad: l.cantidad })),
        medioPago: medio,
        descuento,
      }))
      r.stock.forEach((s) => inventario.fijarStock(s.id, s.stock))
      st.lineas.clear()
      pintarTicket()
      agregarVentaLocal({ ventaId: r.ventaId, fecha: new Date().toISOString(), usuario: sesion.usuario, medio, anulada: false,
        total: r.total, items: lineas.map((l) => ({ nombre: l.p.nombre, cantidad: l.cantidad })) })
      await celebrar({ titulo: '¡Venta registrada!', detalle: `${clp(r.total)} · ${NOMBRE_MEDIO[medio] || medio} · ${r.ventaId}` })
    } catch (err) {
      if (err.incierto) {
        // No se sabe si quedó: se deja el ticket y se pide mirar antes de repetir.
        await celebrar({ tipo: 'error', titulo: 'No sabemos si se registró', detalle: err.message, acciones: [
          { texto: 'Revisar ventas de hoy', primaria: true, fn: () => cargarVentas() },
          { texto: 'Cerrar' },
        ] })
      } else {
        aviso(err.message, 'error')
        // El stock pudo cambiar desde otro dispositivo: se trae el real.
        inventario.recargar().then(pintarTicket).catch(() => {})
      }
    } finally {
      st.ocupado = false
      enfocar()
    }
  }

  /* Con el backend nuevo, todo el ingreso va en una llamada (todo o nada).
     Con el anterior, producto a producto: lo que ya se registró sale del
     ticket y lo que queda es lo pendiente. */
  async function registrarIngreso() {
    if (st.ocupado || !st.lineas.size) return
    const nota = $('#nota-ingreso', el).value
    const lineas = [...st.lineas.values()]
    const unidades = lineas.reduce((s, l) => s + l.cantidad, 0)
    st.ocupado = true
    let hechos = 0
    try {
      await conBoton($('#registrar-ingreso', el), async () => {
        if (capacidad.ajusteEnLote) {
          const r = await llamar('ajustarStock', { tipo: 'ingreso', nota, items: lineas.map((l) => ({ id: l.p.id, delta: l.cantidad })) })
          r.stock.forEach((s) => inventario.fijarStock(s.id, s.stock))
          hechos = lineas.length
          st.lineas.clear()
        } else {
          for (const l of lineas) {
            const r = await llamar('ajustarStock', { id: l.p.id, delta: l.cantidad, tipo: 'ingreso', nota })
            inventario.fijarStock(l.p.id, r.stock)
            st.lineas.delete(l.p.id)
            hechos++
          }
        }
      })
      pintarTicket()
      await celebrar({ titulo: 'Ingreso registrado', detalle: `+${unidades} unidad${unidades === 1 ? '' : 'es'} en ${hechos} producto${hechos === 1 ? '' : 's'}` })
    } catch (err) {
      pintarTicket()
      aviso(hechos ? `${err.message} Se registraron ${hechos}; quedan en la lista los productos sin registrar.`
        : err.message, 'error')
    } finally {
      st.ocupado = false
      enfocar()
    }
  }

  /* ---------- ventas del día ---------- */

  function esqueletoVentas() {
    return html`<div class="hoy-esqueleto" aria-label="Cargando ventas">${Array.from({ length: 3 }, () => html`<span class="linea-esq"></span>`)}</div>`
  }

  function pintarVentas(nueva) {
    const caja = $('#ventas-hoy', el)
    if (!caja || !st.ventas) return
    const ventas = st.ventas
    const validas = ventas.filter((v) => !v.anulada)
    const total = validas.reduce((s, v) => s + v.total, 0)
    pintar(caja, html`
      <p class="hoy-total"><strong>${clp(total)}</strong><span>${validas.length} venta${validas.length === 1 ? '' : 's'}</span></p>
      ${!ventas.length ? html`<p class="vacio">Todavía no hay ventas hoy.</p>` : html`
      <ul class="ventas">
        ${ventas.map((v) => html`
          <li class="venta ${v.anulada ? 'anulada' : ''}" data-venta="${v.ventaId}">
            <div class="venta-cab">
              <span>${hora(v.fecha)} · ${NOMBRE_MEDIO[v.medio] || v.medio}</span>
              <strong>${clp(v.total)}</strong>
            </div>
            <p class="venta-items">${v.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(', ')}</p>
            <div class="venta-pie">
              <span class="etiqueta">${v.ventaId}</span>
              ${v.anulada ? html`<span class="etiqueta etiqueta-error">Anulada</span>`
                : esAdmin() ? html`<button class="btn btn-peligro btn-chico" type="button" data-anular="${v.ventaId}">Anular</button>` : ''}
            </div>
          </li>`)}
      </ul>`}`)
    if (nueva) {
      destellar($(`[data-venta="${CSS.escape(nueva)}"]`, caja))
      const t = $('.hoy-total strong', caja)
      t.classList.remove('salta'); void t.offsetWidth; t.classList.add('salta')
    }
  }

  function agregarVentaLocal(v) {
    if (!st.ventas) return cargarVentas()
    st.ventas.unshift(v)
    pintarVentas(v.ventaId)
  }

  async function cargarVentas() {
    const caja = $('#ventas-hoy', el)
    if (!caja) return
    if (!st.ventas) pintar(caja, esqueletoVentas())
    else caja.classList.add('cargando')
    try {
      st.ventas = (await llamar('ventasDelDia')).ventas
      pintarVentas()
    } catch (err) {
      if (!caja.isConnected) return
      panelError(caja, { compacto: true, titulo: 'No se pudieron cargar las ventas de hoy', detalle: err.message, reintentar: cargarVentas })
    } finally { caja.classList.remove('cargando') }
  }

  /* ---------- cámara ---------- */

  async function abrirCamara() {
    const d = $('#dlg-camara')
    d.showModal()
    $('#camara-ultimo').textContent = 'Apunta al código de barras'
    try {
      pararCamara = await iniciarEscaner($('#video'), leerCodigo)
    } catch (err) {
      $('#camara-ultimo').textContent = err.name === 'NotAllowedError'
        ? 'Sin permiso para usar la cámara. Actívalo en la configuración del navegador.'
        : 'No se pudo abrir la cámara en este dispositivo.'
    }
  }

  function cerrarCamara() { pararCamara?.(); pararCamara = null; enfocar() }

  /* ---------- eventos ---------- */

  let espera
  campo.addEventListener('input', () => {
    clearTimeout(espera)
    const v = campo.value.trim()
    // Un lector teclea muy rápido; se espera un poco para no buscar por
    // cada dígito. Los textos cortos o numéricos no sugieren (son códigos).
    espera = setTimeout(() => {
      if (v.length >= 3 && !/^\d+$/.test(v)) mostrarSugerencias(inventario.buscar(v, 8))
      else if (!v) $('#sugerencias', el).innerHTML = ''
    }, 200)
  })
  $('#form-codigo', el).addEventListener('submit', (e) => {
    e.preventDefault()
    clearTimeout(espera)
    leerCodigo(campo.value)
  })
  $('#abrir-camara', el).addEventListener('click', abrirCamara)
  $('#dlg-camara').addEventListener('close', cerrarCamara)

  el.addEventListener('click', async (e) => {
    const t = e.target
    const modo = t.closest('[data-modo]')
    if (modo) {
      st.modo = modo.dataset.modo
      st.lineas.clear()
      el.querySelectorAll('[data-modo]').forEach((b) => b.setAttribute('aria-pressed', String(b === modo)))
      pintarTicket()
      return enfocar()
    }
    const sug = t.closest('.sugerencia')
    if (sug) { sumar(inventario.porId(sug.dataset.id), 1); return enfocar() }
    const asignar = t.closest('[data-asignar]')
    if (asignar) return asignarCodigo(asignar.dataset.asignar)
    const delta = t.closest('[data-delta]')
    if (delta) {
      const p = st.lineas.get(delta.closest('[data-id]').dataset.id)?.p
      if (p) sumar(p, Number(delta.dataset.delta))
      return
    }
    if (t.closest('#cobrar')) return cobrar()
    if (t.closest('#registrar-ingreso')) return registrarIngreso()
    if (t.closest('#cancelar')) {
      await desvanecer($('.ticket', el))
      st.lineas.clear(); pintarTicket()
      aviso(st.modo === 'venta' ? 'Venta cancelada' : 'Ingreso cancelado', 'info')
      return enfocar()
    }
    const anular = t.closest('[data-anular]')
    if (anular) {
      const id = anular.dataset.anular
      if (!confirm(`¿Anular la venta ${id}? El stock se devolverá al inventario.`)) return
      try {
        await conBoton(anular, () => llamar('anularVenta', { ventaId: id }))
        const v = st.ventas?.find((x) => x.ventaId === id)
        if (v) v.anulada = true
        pintarVentas()
        destellar($(`[data-venta="${CSS.escape(id)}"]`, el))
        aviso(`Venta ${id} anulada · stock devuelto`)
        inventario.refrescar()
      } catch (err) { aviso(err.message, 'error') }
    }
  })

  el.addEventListener('change', (e) => {
    if (e.target.classList.contains('paso-input')) {
      const l = st.lineas.get(e.target.closest('[data-id]').dataset.id)
      if (l) sumar(l.p, Math.max(1, Math.floor(Number(e.target.value)) || 1) - l.cantidad)
    }
    if (e.target.id === 'descuento') {
      const total = [...st.lineas.values()].reduce((s, l) => s + l.cantidad * l.p.precio, 0) - Number(e.target.value || 0)
      $('#total-final', el).textContent = clp(total)
      $('#cobrar', el).textContent = `Cobrar ${clp(total)}`
    }
  })

  async function asignarCodigo(codigo) {
    const p = await elegirProducto(`Asignar el código ${codigo} a…`)
    if (!p) return enfocar()
    const b = $('[data-asignar]', el)
    try {
      await conBoton(b, () => llamar('guardarProducto', { producto: { ...p, codigo } }))
      inventario.aplicar(p.id, { codigo })
      aviso(`Código ${codigo} asignado a ${p.nombre}`)
      $('#sugerencias', el).innerHTML = ''
      sumar(inventario.porId(p.id), 1)
    } catch (err) { aviso(err.message, 'error') }
    enfocar()
  }

  /* Cuando llega (o se refresca) el inventario: las líneas del ticket toman
     el producto actualizado (stock y precio al día) y se repinta. */
  const baja = inventario.alCambiar(() => {
    st.lineas.forEach((l, id) => { const p = inventario.porId(id); if (p) l.p = p })
    if (!st.ocupado) pintarTicket()
  })

  pintarTicket()
  cargarVentas()
  return () => { cerrarCamara(); baja() }
}
