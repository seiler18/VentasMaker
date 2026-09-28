/* PEDIDOS — los que los clientes reservan desde el catálogo para retirar.

   El cliente elige «Retiro en tienda», recibe un número (P1042) y llega con
   él. Aquí se ven los pendientes con su detalle y su celular; «Cobrar» abre
   el catálogo en modo caja con el pedido ya cargado (ahí se elige el medio
   de pago y la venta descuenta el stock y marca el pedido como cobrado).
   Un pedido no toca el stock hasta que se cobra: cancelarlo no mueve nada.

   Se pinta al instante con la última lista vista en esta pestaña y se
   actualiza por detrás (Apps Script puede tardar). */
import { html, pintar, $, $$ } from '../lib/dom.js'
import { aviso, conBoton, destellar, panelError } from '../lib/efectos.js'
import { clp, fechaHora } from '../lib/formato.js'
import { icono } from '../lib/iconos.js'
import { llamar } from './estado.js'

const CLAVE = 'vm_pedidos_panel'
const BASE = import.meta.env.BASE_URL
const ESTADOS = {
  pendiente: ['Por cobrar', 'etiqueta-aviso'],
  completado: ['Cobrado', 'etiqueta-ok'],
  cancelado: ['Cancelado', 'etiqueta-error'],
}

const leer = () => { try { return JSON.parse(sessionStorage.getItem(CLAVE) || 'null') } catch { return null } }
const guardar = (l) => { try { sessionStorage.setItem(CLAVE, JSON.stringify(l)) } catch { /* lleno */ } }

/* wa.me necesita el número con código de país: el cliente suele escribir
   "9 1234 5678". */
function waCliente(cel) {
  const d = String(cel || '').replace(/\D/g, '')
  if (d.length === 9 && d.startsWith('9')) return `56${d}`
  if (d.length === 8) return `569${d}`
  return d
}

export default function pedidos(el) {
  const st = { filtro: 'pendiente', q: '', lista: leer() }

  pintar(el, html`
    <section class="pedidos-vista">
      <div class="pedidos-barra">
        <div class="segmentado" role="group" aria-label="Mostrar">
          <button type="button" data-filtro="pendiente" aria-pressed="true">Por cobrar</button>
          <button type="button" data-filtro="todos" aria-pressed="false">Todos</button>
        </div>
        <label class="pedidos-buscar"><span class="oculto-visual">Buscar pedido</span>
          <input class="entrada" id="q-pedido" type="search" placeholder="N° de pedido, nombre o celular" autocomplete="off"></label>
        <button class="btn btn-borde" type="button" id="recargar-pedidos">Actualizar</button>
      </div>
      <p class="ayuda">Los clientes reservan desde el catálogo con «Retiro en tienda» y llegan con su número.
        <strong>Cobrar</strong> abre el catálogo en modo caja con el pedido cargado: ahí eliges el medio de pago y se descuenta el stock.</p>
      <div id="lista-pedidos"></div>
    </section>`)

  const caja = $('#lista-pedidos', el)

  function visibles() {
    const q = st.q.trim().toLowerCase()
    const digitos = q.replace(/\D/g, '')
    return (st.lista || []).filter((p) => (st.filtro === 'todos' || p.estado === 'pendiente') && (!q ||
      p.pedidoId.toLowerCase().includes(q.replace(/[^a-z0-9]/g, '')) ||
      p.cliente.toLowerCase().includes(q) ||
      (digitos.length >= 3 && p.celular.includes(digitos))))
  }

  function ficha(p) {
    const [texto, clase] = ESTADOS[p.estado] || [p.estado, '']
    const wa = waCliente(p.celular)
    return html`
      <li class="pedido-ficha ${p.estado}" data-pedido="${p.pedidoId}">
        <div class="pf-cab">
          <strong class="pf-numero">${p.pedidoId}</strong>
          <span class="etiqueta ${clase}">${texto}</span>
          <span class="pf-fecha">${fechaHora(p.fecha)}</span>
        </div>
        <p class="pf-cliente">${p.cliente}${wa ? html` · <a href="https://wa.me/${wa}" target="_blank" rel="noopener noreferrer">${icono.whatsapp} ${p.celular}</a>` : ''}</p>
        <ul class="pf-items">${p.items.map((i) => html`<li><span>${i.cantidad}× ${i.nombre}</span><span>${clp(i.cantidad * i.precio)}</span></li>`)}</ul>
        ${p.nota ? html`<p class="pf-nota">«${p.nota}»</p>` : ''}
        <div class="pf-pie">
          <strong class="pf-total">${clp(p.total)}</strong>
          ${p.estado === 'pendiente' ? html`
            <button class="btn btn-borde btn-chico" type="button" data-cancelar="${p.pedidoId}">Cancelar</button>
            <a class="btn btn-primario btn-chico" href="${BASE}#pedido=${p.pedidoId}">Cobrar</a>`
          : html`<span class="pf-atendido">${p.ventaId ? `Venta ${p.ventaId}` : ''}${p.atendidoPor ? ` · ${p.atendidoPor}` : ''}</span>`}
        </div>
      </li>`
  }

  function pintarLista() {
    if (!st.lista) {
      pintar(caja, html`<div class="hoy-esqueleto" aria-label="Cargando pedidos">${Array.from({ length: 4 }, () => html`<span class="linea-esq"></span>`)}</div>`)
      return
    }
    const l = visibles()
    const pendientes = st.lista.filter((p) => p.estado === 'pendiente').length
    pintar(caja, html`
      <p class="pedidos-conteo">${pendientes} pedido${pendientes === 1 ? '' : 's'} por cobrar</p>
      ${!l.length ? html`<p class="vacio">${st.q ? 'Ningún pedido coincide con la búsqueda.' : st.filtro === 'pendiente' ? 'No hay pedidos por cobrar.' : 'Todavía no hay pedidos.'}</p>`
        : html`<ul class="pedidos-lista">${l.map(ficha)}</ul>`}`)
  }

  async function cargar() {
    caja.classList.toggle('cargando', Boolean(st.lista))
    try {
      st.lista = (await llamar('pedidos')).pedidos
      guardar(st.lista)
      pintarLista()
    } catch (err) {
      if (!caja.isConnected) return
      if (st.lista) aviso(`No se pudieron actualizar los pedidos: ${err.message}`, 'error')
      else panelError(caja, {
        titulo: 'No se pudieron cargar los pedidos',
        detalle: err.message === 'Acción no válida' ? 'El servidor todavía no tiene pedidos: falta desplegar la versión nueva del backend (Code.gs).' : err.message,
        reintentar: cargar,
      })
    } finally { caja.classList.remove('cargando') }
  }

  el.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-filtro]')
    if (f) {
      st.filtro = f.dataset.filtro
      $$('[data-filtro]', el).forEach((b) => b.setAttribute('aria-pressed', String(b === f)))
      return pintarLista()
    }
    if (e.target.closest('#recargar-pedidos')) return conBoton(e.target.closest('button'), cargar)
    const c = e.target.closest('[data-cancelar]')
    if (c) {
      const id = c.dataset.cancelar
      if (!confirm(`¿Cancelar el pedido ${id}? El cliente ya no podrá retirarlo con ese número.`)) return
      try {
        await conBoton(c, () => llamar('cancelarPedido', { id }))
        const p = st.lista.find((x) => x.pedidoId === id)
        if (p) p.estado = 'cancelado'
        guardar(st.lista)
        pintarLista()
        destellar($(`[data-pedido="${CSS.escape(id)}"]`, el))
        aviso(`Pedido ${id} cancelado`)
      } catch (err) { aviso(err.message, 'error') }
    }
  })
  let espera
  $('#q-pedido', el).addEventListener('input', (e) => {
    clearTimeout(espera)
    espera = setTimeout(() => { st.q = e.target.value; pintarLista() }, 150)
  })

  pintarLista()
  cargar()
  return () => clearTimeout(espera)
}
