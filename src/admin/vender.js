/* VENDER — el punto de venta.

   Flujo pensado para el mesón: el cursor vive en el campo de código. Un
   lector USB/Bluetooth "teclea" el código y un Enter; la cámara del
   teléfono hace lo mismo desde el diálogo del escáner. Cada lectura suma una
   unidad al ticket. "Cobrar" registra la venta y descuenta el stock en la
   hoja en una sola operación del servidor.

   Modo INGRESO (solo admin): el mismo escaneo, pero suma al stock. Sirve
   para recibir mercadería: se escanea cada prenda que llega y se confirma. */
import { html, pintar, $, aviso } from '../lib/dom.js'
import { clp, fechaHora } from '../lib/formato.js'
import { icono } from '../lib/iconos.js'
import { urlImagen } from '../lib/imagen.js'
import { iniciarEscaner } from '../lib/escaner.js'
import { llamar, inventario, esAdmin } from './estado.js'
import { elegirProducto } from './selector.js'

const MEDIOS = [['efectivo', 'Efectivo'], ['debito', 'Débito'], ['credito', 'Crédito'], ['transferencia', 'Transferencia'], ['otro', 'Otro']]

export default function vender(el) {
  const st = { modo: 'venta', lineas: new Map(), ocupado: false }
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
        <div id="ventas-hoy"><p class="vacio">Cargando…</p></div>
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
      try { p = (await llamar('buscarCodigo', { codigo: c })).producto } catch { /* sigue */ }
      if (p) await inventario.recargar()
      p = p && inventario.porId(p.id)
    }
    if (p) return sumar(p, 1)
    const coinciden = inventario.buscar(c)
    if (coinciden.length === 1) return sumar(coinciden[0], 1)
    if (coinciden.length) return mostrarSugerencias(coinciden)
    noEncontrado(c)
  }

  function noEncontrado(c) {
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

  function sumar(p, n) {
    const actual = st.lineas.get(p.id)?.cantidad || 0
    if (st.modo === 'venta' && actual + n > p.stock) {
      aviso(p.stock <= 0 ? `${p.nombre}: sin stock` : `${p.nombre}: solo quedan ${p.stock}`, 'error')
      navigator.vibrate?.([80, 60, 80])
      return
    }
    if (actual + n <= 0) st.lineas.delete(p.id)
    else st.lineas.set(p.id, { p, cantidad: actual + n })
    $('#sugerencias', el).innerHTML = ''
    campo.value = ''
    pintarTicket()
    if ($('#dlg-camara').open) $('#camara-ultimo').textContent = `✓ ${p.nombre} (${actual + n})`
  }

  /* ---------- ticket ---------- */

  function pintarTicket() {
    const lineas = [...st.lineas.values()]
    const total = lineas.reduce((s, l) => s + l.cantidad * l.p.precio, 0)
    const unidades = lineas.reduce((s, l) => s + l.cantidad, 0)
    const venta = st.modo === 'venta'
    pintar($('#ticket', el), !lineas.length
      ? html`<p class="vacio ticket-vacio">${venta ? 'Escanea un producto para empezar la venta.' : 'Escanea lo que llegó: cada lectura suma una unidad al stock.'}</p>`
      : html`
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
  }

  async function cobrar() {
    if (st.ocupado || !st.lineas.size) return
    const descuento = Number($('#descuento', el)?.value || 0)
    const lineas = [...st.lineas.values()]
    const total = lineas.reduce((s, l) => s + l.cantidad * l.p.precio, 0) - descuento
    if (descuento < 0 || total < 0) return aviso('Descuento no válido', 'error')
    if (!confirm(`¿Registrar la venta por ${clp(total)}?`)) return
    st.ocupado = true
    $('#cobrar', el).disabled = true
    try {
      const r = await llamar('vender', {
        items: lineas.map((l) => ({ id: l.p.id, cantidad: l.cantidad })),
        medioPago: $('#medio', el).value,
        descuento,
      })
      r.stock.forEach((s) => inventario.fijarStock(s.id, s.stock))
      st.lineas.clear()
      pintarTicket()
      aviso(`Venta ${r.ventaId} registrada · ${clp(r.total)}`)
      cargarVentas()
    } catch (err) {
      aviso(err.message, 'error')
      // El stock pudo cambiar desde otro dispositivo: se trae el real.
      inventario.recargar().then(pintarTicket).catch(() => {})
    } finally {
      st.ocupado = false
      const b = $('#cobrar', el); if (b) b.disabled = false
      enfocar()
    }
  }

  async function registrarIngreso() {
    if (st.ocupado || !st.lineas.size) return
    const nota = $('#nota-ingreso', el).value
    st.ocupado = true
    $('#registrar-ingreso', el).disabled = true
    let hechos = 0
    try {
      for (const l of st.lineas.values()) {
        const r = await llamar('ajustarStock', { id: l.p.id, delta: l.cantidad, tipo: 'ingreso', nota })
        inventario.fijarStock(l.p.id, r.stock)
        st.lineas.delete(l.p.id)
        hechos++
      }
      aviso(`Ingreso registrado en ${hechos} producto${hechos === 1 ? '' : 's'}`)
    } catch (err) {
      // Lo que ya se registró salió del ticket; lo que queda es lo pendiente.
      aviso(`${err.message}. Quedan en la lista los productos sin registrar.`, 'error')
    } finally {
      st.ocupado = false
      pintarTicket()
      enfocar()
    }
  }

  /* ---------- ventas del día ---------- */

  async function cargarVentas() {
    const caja = $('#ventas-hoy', el)
    if (!caja) return
    try {
      const { ventas } = await llamar('ventasDelDia')
      const validas = ventas.filter((v) => !v.anulada)
      const total = validas.reduce((s, v) => s + v.total, 0)
      pintar(caja, html`
        <p class="hoy-total"><strong>${clp(total)}</strong><span>${validas.length} venta${validas.length === 1 ? '' : 's'}</span></p>
        ${!ventas.length ? html`<p class="vacio">Todavía no hay ventas hoy.</p>` : html`
        <ul class="ventas">
          ${ventas.map((v) => html`
            <li class="venta ${v.anulada ? 'anulada' : ''}">
              <div class="venta-cab">
                <span>${fechaHora(v.fecha).split(' ').pop()} · ${v.medio}</span>
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
    } catch (err) {
      pintar(caja, html`<p class="vacio">${err.message}</p>`)
    }
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
      const p = inventario.porId(delta.closest('[data-id]').dataset.id)
      sumar(p, Number(delta.dataset.delta))
      return
    }
    if (t.closest('#cobrar')) return cobrar()
    if (t.closest('#registrar-ingreso')) return registrarIngreso()
    if (t.closest('#cancelar')) { st.lineas.clear(); pintarTicket(); return enfocar() }
    const anular = t.closest('[data-anular]')
    if (anular) {
      if (!confirm(`¿Anular la venta ${anular.dataset.anular}? El stock se devolverá al inventario.`)) return
      try {
        await llamar('anularVenta', { ventaId: anular.dataset.anular })
        await inventario.recargar()
        aviso('Venta anulada')
        cargarVentas()
      } catch (err) { aviso(err.message, 'error') }
    }
  })

  el.addEventListener('change', (e) => {
    if (e.target.classList.contains('paso-input')) {
      const p = inventario.porId(e.target.closest('[data-id]').dataset.id)
      const actual = st.lineas.get(p.id).cantidad
      sumar(p, Math.max(1, Math.floor(Number(e.target.value)) || 1) - actual)
      pintarTicket()
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
    try {
      await llamar('guardarProducto', { producto: { ...p, codigo } })
      await inventario.recargar()
      aviso(`Código asignado a ${p.nombre}`)
      $('#sugerencias', el).innerHTML = ''
      sumar(inventario.porId(p.id), 1)
    } catch (err) { aviso(err.message, 'error') }
    enfocar()
  }

  pintarTicket()
  cargarVentas()
  return () => cerrarCamara()
}

