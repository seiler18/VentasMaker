/* MODO CAJA — el catálogo como punto de venta.

   Se activa cuando en esta pestaña hay una sesión del panel (el mismo token
   y perfil de sessionStorage). La vendedora ve el catálogo de siempre, pero:
   - la pistola lectora (un "teclado" que escribe el código y un Enter) suma
     el producto a la venta aunque el cursor no esté en ningún campo; también
     la cámara del teléfono;
   - el carrito es "Venta en caja" y termina en "Finalizar venta": se cobra
     con `vender`, que descuenta el stock en la hoja, y el catálogo se
     actualiza con el stock que devuelve el servidor;
   - "Cobrar pedido" trae un pedido reservado por un cliente (P1042) al
     carrito, y la venta lo marca como completado.

   El servidor comprueba sesión y rol en cada llamada: esto solo decide qué
   se pinta. Los listeners de teclado se cuelgan del documento a propósito
   (la pistola escribe donde esté el foco), pero ignoran lo que se teclea a
   mano en los formularios. */
import '../styles/caja.css'

import { html, crudo, pintar, $ } from '../lib/dom.js'
import { aviso, celebrar, conBoton, panelError, sacudir } from '../lib/efectos.js'
import { clp, fechaHora } from '../lib/formato.js'
import { icono } from '../lib/iconos.js'
import { iniciarEscaner } from '../lib/escaner.js'
import { onSesionCaducada } from '../lib/api.js'
import { llamar, inventario, sesion, perfil, capacidad, demo } from '../admin/estado.js'
import { carrito } from './carrito.js'

const MEDIOS = [['efectivo', 'Efectivo'], ['debito', 'Débito'], ['credito', 'Crédito'], ['transferencia', 'Transferencia'], ['otro', 'Otro']]
const NOMBRE_MEDIO = Object.fromEntries(MEDIOS)
const ETIQUETA_COMPROBANTE = {
  efectivo: 'N° de boleta (opcional)', debito: 'N° de voucher (opcional)', credito: 'N° de voucher (opcional)',
  transferencia: 'N° de operación (opcional)', otro: 'N° de comprobante (opcional)',
}
const CLAVE_PEDIDO = 'vm_caja_pedido'
const BASE = import.meta.env.BASE_URL
/* Un lector escribe cada carácter en pocos milisegundos; una persona, en más
   de 60. Con 4 o más caracteres seguidos así y un Enter, es un escaneo. */
const ENTRE_TECLAS_MS = 60
const MIN_CODIGO = 4

const leerSS = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null') } catch { return null } }
const guardarSS = (k, v) => { try { v ? sessionStorage.setItem(k, JSON.stringify(v)) : sessionStorage.removeItem(k) } catch { /* nada */ } }

export function iniciarCaja(ctx) {
  Object.assign(sesion, ctx.perfil)
  const esAdmin = () => sesion.rol === 'admin'
  const st = { pedido: leerSS(CLAVE_PEDIDO), cobro: {}, ocupado: false }
  if (st.pedido) st.cobro = { cliente: st.pedido.cliente, contacto: st.pedido.celular }
  let pararCamara = null

  /* ---------- barra de la caja ---------- */

  const barra = document.createElement('div')
  barra.className = 'caja-barra'
  barra.setAttribute('role', 'region')
  barra.setAttribute('aria-label', 'Modo caja')
  pintar(barra, html`
    <p class="caja-marca"><span class="caja-punto" aria-hidden="true"></span><strong>Modo caja</strong>
      <span class="caja-quien">${sesion.nombre || sesion.usuario}${demo ? ' · demo' : ''}</span></p>
    <form class="caja-escaneo" id="caja-form" autocomplete="off">
      <label class="oculto-visual" for="caja-codigo">Código de barras</label>
      <input class="entrada" id="caja-codigo" placeholder="Escanea o escribe un código" enterkeyhint="done">
      <button class="btn btn-borde btn-icono" type="button" id="caja-camara" aria-label="Escanear con la cámara">${icono.camara}</button>
    </form>
    <p class="caja-ultimo" id="caja-ultimo" aria-live="polite"></p>
    <div class="caja-acciones">
      <button class="btn btn-primario btn-chico" type="button" id="caja-pedido">Cobrar pedido</button>
      <a class="btn btn-borde btn-chico" href="${BASE}admin.html">Panel</a>
      <button class="btn btn-chico caja-salir" type="button" id="caja-salir">Salir del modo caja</button>
    </div>`)
  document.body.prepend(barra)
  document.body.classList.add('en-caja')

  const dlgPedidos = document.createElement('dialog')
  dlgPedidos.className = 'hoja dlg-pedidos'
  dlgPedidos.setAttribute('aria-labelledby', 'dpd-titulo')
  const dlgCamara = document.createElement('dialog')
  dlgCamara.className = 'dlg-camara'
  dlgCamara.setAttribute('aria-label', 'Escáner')
  pintar(dlgCamara, html`
    <div class="dialogo-cab"><h2>Escanear</h2><button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button></div>
    <div class="camara"><video id="caja-video" playsinline muted></video><div class="mira" aria-hidden="true"></div></div>
    <p class="camara-ultimo" id="camara-ultimo" aria-live="polite">Apunta al código de barras</p>`)
  document.body.append(dlgPedidos, dlgCamara)

  const campo = $('#caja-codigo', barra)
  const ultimo = $('#caja-ultimo', barra)

  /* ---------- inventario con códigos ----------
     El catálogo público no trae los códigos de barras ni los ocultos: con
     sesión se usa el inventario del panel (el guardado en la pestaña al
     instante, y el de la hoja por detrás). */
  const alInventario = () => { if (inventario.hayDatos()) ctx.aplicar({ productos: inventario.todos() }, 'caja') }
  inventario.alCambiar(alInventario)
  if (inventario.restaurar()) alInventario()
  inventario.recargar().catch((err) => {
    if (err.sesion === false) return
    aviso(`No se pudo traer el inventario de la hoja (${err.message}). Se vende con el catálogo publicado.`, 'error')
  })
  // Confirma la sesión por detrás (si caducó, onSesionCaducada lo cuenta).
  llamar('sesion').then((r) => {
    Object.assign(sesion, { usuario: r.usuario, nombre: r.nombre, rol: r.rol, debeCambiar: !!r.debeCambiar })
    perfil.guardar()
  }).catch(() => { /* red: se sigue con lo guardado */ })

  onSesionCaducada(() => {
    celebrar({
      tipo: 'error', titulo: 'Tu sesión del panel caducó',
      detalle: 'Para seguir vendiendo, vuelve a entrar al panel. La venta en curso queda guardada en este equipo.',
      acciones: [{ texto: 'Entrar al panel', primaria: true, fn: () => { location.href = `${BASE}admin.html` } }, { texto: 'Cerrar' }],
    })
  })

  /* ---------- lectura de códigos ---------- */

  function porSku(c) {
    const k = c.toUpperCase()
    for (const p of ctx.estadoUI.porId.values()) if (String(p.sku).toUpperCase() === k) return p
    return null
  }

  async function leerCodigo(texto) {
    const c = String(texto).trim()
    if (!c) return
    let p = inventario.porCodigo(c) || porSku(c)
    if (!p && /^[0-9A-Za-z-]{4,}$/.test(c)) {
      // Puede ser un producto creado en otro equipo después de cargar.
      campo.classList.add('buscando')
      try {
        const r = (await llamar('buscarCodigo', { codigo: c })).producto
        if (r) { inventario.aplicar(r.id, r); p = inventario.porId(r.id) }
      } catch { /* sigue: se prueba por nombre */ } finally { campo.classList.remove('buscando') }
    }
    if (p) {
      const prod = ctx.estadoUI.porId.get(p.id)
      if (prod && ctx.agregar(prod.id)) {
        campo.value = ''
        ultimo.textContent = `✓ ${prod.nombre} (${carrito.cantidad(prod.id)})`
        if (dlgCamara.open) $('#camara-ultimo', dlgCamara).textContent = ultimo.textContent
        return
      }
      if (!prod) aviso(`${p.nombre} no está en el catálogo cargado. Recarga la página.`, 'error')
      sacudir(campo)
      return
    }
    if (/^\d{4,}$/.test(c)) {
      // Seleccionado: la próxima lectura lo reemplaza en vez de pegarse detrás.
      if (campo.value.trim() === c) campo.select()
      sacudir(campo)
      navigator.vibrate?.([80, 60, 80])
      aviso(`No hay ningún producto con el código ${c}. Se asigna desde el panel: Vender → «Asignar a un producto».`, 'error')
      return
    }
    // No es un código: se busca por nombre en el catálogo.
    ctx.buscar(c)
    ultimo.textContent = `Buscando «${c}» en el catálogo`
  }

  $('#caja-form', barra).addEventListener('submit', (e) => { e.preventDefault(); leerCodigo(campo.value) })

  /* La pistola escribe donde esté el foco. Si está en el buscador o en un
     campo del cobro, lo que tecleó se quita de ahí y se trata como escaneo. */
  let tecleado = '', ultimaTecla = 0
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
    const t = e.target
    if (t === campo) return
    const ahora = performance.now()
    if (ahora - ultimaTecla > ENTRE_TECLAS_MS) tecleado = ''
    ultimaTecla = ahora
    if (e.key === 'Enter') {
      const codigo = tecleado
      tecleado = ''
      if (codigo.length < MIN_CODIGO) return
      e.preventDefault()
      e.stopPropagation()
      if ((t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.value.endsWith(codigo)) {
        t.value = t.value.slice(0, -codigo.length)
        t.dispatchEvent(new Event('input', { bubbles: true }))
      }
      leerCodigo(codigo)
      return
    }
    if (e.key.length === 1) tecleado += e.key
  }, true)

  /* ---------- cámara ---------- */

  $('#caja-camara', barra).addEventListener('click', async () => {
    dlgCamara.showModal()
    $('#camara-ultimo', dlgCamara).textContent = 'Apunta al código de barras'
    try {
      pararCamara = await iniciarEscaner($('#caja-video', dlgCamara), leerCodigo)
    } catch (err) {
      $('#camara-ultimo', dlgCamara).textContent = err.name === 'NotAllowedError'
        ? 'Sin permiso para usar la cámara. Actívalo en la configuración del navegador.'
        : 'No se pudo abrir la cámara en este dispositivo.'
    }
  })
  dlgCamara.addEventListener('close', () => { pararCamara?.(); pararCamara = null })

  /* ---------- cobro ---------- */

  function pintarCobro(d, lineas, total) {
    const b = st.cobro, ped = st.pedido
    const medio = b.medio || 'efectivo'
    const descuento = Math.max(0, Math.round(Number(b.descuento) || 0))
    pintar(d, html`
      <div class="dialogo-cab">
        <h2 id="dc-titulo">Finalizar venta</h2>
        <button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button>
      </div>
      ${!lineas.length ? html`
        <div class="dialogo-cuerpo pc-vacio"><span class="pc-vacio-icono">${icono.codigo}</span><p><strong>Ninguna venta en curso</strong></p>
          <p>Escanea un producto o toca Agregar en el catálogo.</p></div>` : html`
        <div class="dialogo-cuerpo">
          ${ped ? html`
          <div class="cobro-pedido">
            <p>${icono.ubicacion}<span>Pedido <strong>${ped.pedidoId}</strong> reservado por ${ped.cliente || 'un cliente'}${ped.celular ? ` · ${ped.celular}` : ''}
              ${ped.total && ped.total !== total ? html`<br><small>Al reservar sumaba ${clp(ped.total)}; se cobra con los precios y cantidades de hoy.</small>` : ''}</span></p>
            <button class="btn btn-chico btn-borde" type="button" data-caja="quitar-pedido">No es este pedido</button>
          </div>` : ''}
          <ul class="lineas">${lineas.map(ctx.lineaCarrito)}</ul>
          <p class="total"><span>Total${descuento ? ` (con ${clp(descuento)} de descuento)` : ''}</span><strong id="cobro-total">${clp(total - descuento)}</strong></p>

          <form id="form-cobro" class="form-pedido" novalidate>
            <h3>Cliente <span class="opcional">— para saber a quién se vendió</span></h3>
            <div class="campos-2">
              <label class="campo"><span>Nombre</span>
                <input class="entrada" name="cliente" maxlength="60" autocomplete="off" value="${b.cliente ?? ''}"></label>
              <label class="campo"><span>Celular o correo</span>
                <input class="entrada" name="contacto" maxlength="60" autocomplete="off" value="${b.contacto ?? ''}"></label>
            </div>
            <fieldset class="medios">
              <legend>Medio de pago</legend>
              ${MEDIOS.map(([v, t]) => html`<label class="opcion"><input type="radio" name="medio" value="${v}" ${crudo(medio === v ? 'checked' : '')}><span>${t}</span></label>`)}
            </fieldset>
            <label class="campo"><span id="etiqueta-comprobante">${ETIQUETA_COMPROBANTE[medio]}</span>
              <input class="entrada" name="comprobante" maxlength="40" autocomplete="off" value="${b.comprobante || ''}"></label>
            ${esAdmin() ? html`<label class="campo"><span>Descuento ($)</span>
              <input class="entrada" name="descuento" type="number" inputmode="numeric" min="0" step="100" value="${descuento}"></label>` : ''}
            <label class="campo"><span>Nota (opcional)</span>
              <input class="entrada" name="nota" maxlength="200" autocomplete="off" value="${b.nota || ''}"></label>
            ${capacidad.version && !capacidad.pedidos ? html`<p class="ayuda-cobro">El servidor todavía no guarda el cliente ni el comprobante: falta desplegar la versión nueva del backend. La venta y el stock sí se registran.</p>` : ''}
            <p class="error-form" id="error-cobro" role="alert"></p>
          </form>
        </div>
        <div class="dialogo-pie">
          <button class="btn btn-primario btn-ancho btn-grande" id="finalizar" type="submit" form="form-cobro">Finalizar venta · ${clp(total - descuento)}</button>
        </div>`}`)
    const f = $('#form-cobro', d)
    if (!f) return
    const guardar = (e) => {
      if (!e.target.name) return
      b[e.target.name] = e.target.value
      if (e.target.name === 'medio') $('#etiqueta-comprobante', d).textContent = ETIQUETA_COMPROBANTE[e.target.value]
      if (e.target.name === 'descuento') {
        const neto = total - Math.max(0, Math.round(Number(e.target.value) || 0))
        $('#cobro-total', d).textContent = clp(neto)
        $('#finalizar', d).textContent = `Finalizar venta · ${clp(neto)}`
      }
    }
    f.addEventListener('input', guardar)
    f.addEventListener('change', guardar)
    f.addEventListener('submit', finalizar)
  }

  async function finalizar(e) {
    e.preventDefault()
    if (st.ocupado) return
    const err = $('#error-cobro')
    const lineas = carrito.lineas(ctx.estadoUI.porId)
    if (!lineas.length) return
    const total = lineas.reduce((s, l) => s + l.subtotal, 0)
    const b = st.cobro
    const descuento = Math.max(0, Math.round(Number(b.descuento) || 0))
    if (descuento > total) { err.textContent = 'El descuento supera el total.'; return sacudir($('[name=descuento]')) }
    const medio = b.medio || 'efectivo'
    const datos = {
      items: lineas.map((l) => ({ id: l.p.id, cantidad: l.cantidad })),
      medioPago: medio, descuento,
      cliente: String(b.cliente || '').trim(), contacto: String(b.contacto || '').trim(),
      comprobante: String(b.comprobante || '').trim(), nota: String(b.nota || '').trim(),
      ...(st.pedido && { pedidoId: st.pedido.pedidoId }),
    }
    err.textContent = ''
    st.ocupado = true
    try {
      const r = await conBoton($('#finalizar'), () => llamar('vender', datos))
      if (!r) return
      r.stock.forEach((s) => {
        inventario.fijarStock(s.id, s.stock)
        const p = ctx.estadoUI.porId.get(s.id)
        if (p) p.stock = s.stock
      })
      carrito.vaciar()
      olvidarPedido()
      st.cobro = {}
      $('#dlg-carrito').close()
      ctx.refrescar()
      ultimo.textContent = `Última venta: ${clp(r.total)} · ${r.ventaId}`
      await celebrar({
        titulo: '¡Gracias por la compra!',
        detalle: [clp(r.total), NOMBRE_MEDIO[medio], datos.cliente, r.pedidoId && `pedido ${r.pedidoId}`, r.ventaId].filter(Boolean).join(' · '),
      })
    } catch (x) {
      if (x.incierto) {
        // No se sabe si quedó: la venta sigue en pantalla y se pide mirar antes de repetir.
        await celebrar({ tipo: 'error', titulo: 'No sabemos si se registró', detalle: x.message, acciones: [
          { texto: 'Revisar ventas de hoy', primaria: true, fn: () => { location.href = `${BASE}admin.html#vender` } },
          { texto: 'Cerrar' },
        ] })
      } else {
        if (err.isConnected) err.textContent = x.message
        aviso(x.message, 'error')
        // El stock pudo cambiar desde otro equipo: se trae el real.
        inventario.recargar().catch(() => {})
      }
    } finally {
      st.ocupado = false
    }
  }

  /* ---------- pedidos reservados desde el catálogo ---------- */

  function olvidarPedido() {
    st.pedido = null
    guardarSS(CLAVE_PEDIDO, null)
  }

  function cargarPedido(p) {
    const error = $('#error-buscar', dlgPedidos)
    if (p.estado !== 'pendiente') {
      const msg = `El pedido ${p.pedidoId} ya está ${p.estado}${p.ventaId ? ` (venta ${p.ventaId})` : ''}.`
      if (error) error.textContent = msg
      return aviso(msg, 'error')
    }
    if (carrito.lineas(ctx.estadoUI.porId).length && st.pedido?.pedidoId !== p.pedidoId &&
        !confirm('Hay productos en la venta en curso. ¿Reemplazarlos por los del pedido?')) return
    carrito.vaciar()
    const problemas = []
    p.items.forEach((it) => {
      const prod = ctx.estadoUI.porId.get(it.id)
      if (!prod || prod.stock <= 0) return problemas.push(`${it.nombre}: sin stock`)
      if (prod.stock < it.cantidad) problemas.push(`${it.nombre}: pidió ${it.cantidad}, quedan ${prod.stock}`)
      carrito.poner(it.id, Math.min(it.cantidad, prod.stock), prod.stock)
    })
    st.pedido = { pedidoId: p.pedidoId, cliente: p.cliente, celular: p.celular, total: p.total }
    guardarSS(CLAVE_PEDIDO, st.pedido)
    st.cobro = { cliente: p.cliente, contacto: p.celular }
    if (dlgPedidos.open) dlgPedidos.close()
    ctx.refrescar()
    if (problemas.length) aviso(`Revisa el pedido ${p.pedidoId} con el cliente — ${problemas.join('; ')}`, 'aviso', { persistente: true })
    if (carrito.lineas(ctx.estadoUI.porId).length) ctx.abrirCarrito()
  }

  const errorPedidos = (x) => x.message === 'Acción no válida'
    ? 'El servidor todavía no tiene pedidos: falta desplegar la versión nueva del backend (Code.gs).'
    : x.message

  async function buscarPedido(id, btn) {
    const error = $('#error-buscar', dlgPedidos)
    error.textContent = ''
    try {
      const r = await conBoton(btn, () => llamar('pedidos', { id }))
      if (!r) return
      if (!r.pedido) { error.textContent = `No encontramos el pedido ${id}. Revisa el número con el cliente.`; return sacudir($('[name=id]', dlgPedidos)) }
      cargarPedido(r.pedido)
    } catch (x) { error.textContent = errorPedidos(x) }
  }

  let pendientes = []
  async function cargarPendientes() {
    const caja = $('#lista-pendientes', dlgPedidos)
    if (!caja) return
    try {
      pendientes = (await llamar('pedidos')).pedidos.filter((p) => p.estado === 'pendiente')
      if (!caja.isConnected) return
      pintar(caja, !pendientes.length ? html`<p class="vacio">No hay pedidos pendientes.</p>` : html`
        <ul class="pendientes">${pendientes.map((p) => html`
          <li class="pendiente">
            <div>
              <p class="pendiente-cab"><strong>${p.pedidoId}</strong> · ${p.cliente} · ${fechaHora(p.fecha)}</p>
              <p class="pendiente-items">${p.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(', ')}</p>
            </div>
            <button class="btn btn-primario btn-chico" type="button" data-cobrar="${p.pedidoId}">Cobrar ${clp(p.total)}</button>
          </li>`)}
        </ul>`)
    } catch (x) {
      if (!caja.isConnected) return
      panelError(caja, { compacto: true, titulo: 'No se pudieron cargar los pedidos', detalle: errorPedidos(x), reintentar: cargarPendientes })
    }
  }

  function abrirPedidos() {
    pintar(dlgPedidos, html`
      <div class="dialogo-cab">
        <h2 id="dpd-titulo">Cobrar un pedido</h2>
        <button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button>
      </div>
      <div class="dialogo-cuerpo">
        <form class="buscar-pedido" id="form-buscar-pedido" autocomplete="off" novalidate>
          <label class="campo"><span>N° de pedido que trae el cliente</span>
            <input class="entrada entrada-pedido" name="id" placeholder="P1042" maxlength="12" autocapitalize="characters" enterkeyhint="search"></label>
          <button class="btn btn-primario" type="submit">Buscar</button>
        </form>
        <p class="error-form" id="error-buscar" role="alert"></p>
        <h3>Pendientes</h3>
        <div id="lista-pendientes"><div class="hoy-esqueleto">${Array.from({ length: 3 }, () => html`<span class="linea-esq"></span>`)}</div></div>
      </div>`)
    dlgPedidos.showModal()
    const f = $('#form-buscar-pedido', dlgPedidos)
    f.addEventListener('submit', (e) => {
      e.preventDefault()
      const id = f.id.value.trim()
      if (!id) return sacudir(f.id)
      buscarPedido(id, $('button[type=submit]', f))
    })
    f.id.focus()
    cargarPendientes()
  }

  dlgPedidos.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cobrar]')
    const p = b && pendientes.find((x) => x.pedidoId === b.dataset.cobrar)
    if (p) cargarPedido(p)
  })

  $('#caja-pedido', barra).addEventListener('click', abrirPedidos)
  $('#caja-salir', barra).addEventListener('click', () => ctx.salir())
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-caja="quitar-pedido"]')) return
    olvidarPedido()
    st.cobro = {}
    ctx.refrescar()
    aviso('La venta ya no está ligada a ese pedido', 'info')
  })

  /* Desde el panel (pestaña Pedidos → Cobrar): #pedido=P1042 */
  const m = /^#pedido=([A-Za-z0-9]{1,20})$/.exec(location.hash)
  if (m) {
    history.replaceState(null, '', location.pathname)
    const listo = inventario.hayDatos() ? Promise.resolve() : inventario.recargar().catch(() => {})
    listo.then(() => llamar('pedidos', { id: m[1] }))
      .then((r) => r.pedido ? cargarPedido(r.pedido) : aviso(`No encontramos el pedido ${m[1]}`, 'error'))
      .catch((x) => aviso(errorPedidos(x), 'error'))
  }

  return {
    get pedido() { return st.pedido },
    pintarCobro,
    olvidarPedido,
  }
}
