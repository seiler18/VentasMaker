import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/tienda.css'

import { protegerMarco } from '../lib/marco.js'
import { html, crudo, pintar, $, $$, aviso } from '../lib/dom.js'
import { clp, normalizar } from '../lib/formato.js'
import { icono } from '../lib/iconos.js'
import { urlImagen } from '../lib/imagen.js'
import { leerHorario, estado, tablaHorario } from '../lib/horario.js'
import { hayBackend, catalogo } from '../lib/api.js'
import { TIENDA } from '../config.js'
import { carrito } from './carrito.js'

protegerMarco()

const TANDA = 48          // tarjetas por tanda: 440 de golpe tardan en móvil
const POCAS = 3           // "¡Últimas unidades!" a partir de aquí

const estadoUI = {
  tienda: { ...TIENDA },
  productos: [],
  porId: new Map(),
  q: '',
  cat: '',
  orden: 'alfa',
  vista: leerPref('vm_vista', 'rejilla'),
  mostrados: TANDA,
}

function leerPref(k, def) { try { return localStorage.getItem(k) || def } catch { return def } }
function guardarPref(k, v) { try { localStorage.setItem(k, v) } catch { /* nada */ } }

/* ============================================================
   CARGA
   ============================================================ */

async function cargar() {
  let datos
  if (hayBackend()) {
    try {
      datos = await catalogo()
    } catch {
      aviso('No se pudo conectar con el inventario en vivo; se muestra la última copia publicada.', 'error')
    }
  }
  if (!datos) {
    const r = await fetch(`${import.meta.env.BASE_URL}data/catalogo.json`)
    datos = { tienda: {}, productos: await r.json() }
  }
  Object.assign(estadoUI.tienda, datos.tienda || {})
  const mostrarAgotados = estadoUI.tienda.mostrar_agotados !== 'no'
  estadoUI.productos = (datos.productos || [])
    .filter((p) => p.visible !== false && (mostrarAgotados || p.stock > 0))
    .map((p, i) => ({ ...p, precio: Number(p.precio) || 0, stock: Number(p.stock) || 0,
                      _n: normalizar(`${p.nombre} ${p.descripcion} ${p.categoria}`), _i: i }))
  estadoUI.porId = new Map(estadoUI.productos.map((p) => [p.id, p]))
  pintarTodo()
}

/* ============================================================
   PINTADO
   ============================================================ */

function pintarTodo() {
  const t = estadoUI.tienda
  document.title = `${t.tienda_nombre} — Catálogo`
  const hor = leerHorario(t.horario)
  const est = estado(hor)
  const cats = [...new Set(estadoUI.productos.map((p) => p.categoria).filter(Boolean))].sort()

  pintar($('#app'), html`
    <header class="cabecera">
      <div class="portada" role="img" aria-label="Portada de ${t.tienda_nombre}"></div>
      <div class="contenedor cabecera-info">
        <img class="logo" src="${urlImagen(t.tienda_logo) || `${import.meta.env.BASE_URL}img/logo.webp`}" alt="Logo de ${t.tienda_nombre}" width="96" height="96">
        <div class="cabecera-texto">
          <h1>${t.tienda_nombre}</h1>
          <p class="cabecera-datos">
            <span class="etiqueta ${est.abierto ? 'etiqueta-ok' : 'etiqueta-error'}">${icono.reloj} ${est.texto}</span>
            <span class="dato">${icono.ubicacion} ${t.tienda_direccion}${t.tienda_ciudad ? `, ${t.tienda_ciudad}` : ''}</span>
          </p>
          <button class="enlace-horario" type="button" data-accion="horario">Ver horario</button>
        </div>
      </div>
    </header>

    <div class="barra-filtros">
      <div class="contenedor filtros">
        <label class="buscador">
          ${icono.buscar}
          <span class="oculto-visual">Buscar producto</span>
          <input class="entrada" id="q" type="search" placeholder="Buscar producto" value="${estadoUI.q}" autocomplete="off" enterkeyhint="search">
        </label>
        <div class="filtros-fila">
          <label class="oculto-visual" for="orden">Ordenar por</label>
          <select class="entrada orden" id="orden">
            ${[['alfa', 'Alfabéticamente'], ['precio-asc', 'Precio de menor a mayor'], ['precio-desc', 'Precio de mayor a menor'], ['nuevos', 'Más nuevos']]
              .map(([v, l]) => html`<option value="${v}" ${crudo(estadoUI.orden === v ? 'selected' : '')}>${l}</option>`)}
          </select>
          <div class="vistas" role="group" aria-label="Vista">
            <button class="btn btn-borde btn-icono" type="button" data-vista="rejilla" aria-pressed="${estadoUI.vista === 'rejilla'}" aria-label="Ver en cuadrícula">${icono.rejilla}</button>
            <button class="btn btn-borde btn-icono" type="button" data-vista="lista" aria-pressed="${estadoUI.vista === 'lista'}" aria-label="Ver en lista">${icono.lista}</button>
          </div>
        </div>
      </div>
      <nav class="contenedor categorias" aria-label="Categorías">
        <button class="chip" type="button" data-cat="" aria-pressed="${!estadoUI.cat}">Ver todos</button>
        ${cats.map((c) => html`<button class="chip" type="button" data-cat="${c}" aria-pressed="${estadoUI.cat === c}">${c}</button>`)}
      </nav>
    </div>

    <main class="contenedor">
      <p class="conteo" id="conteo" aria-live="polite"></p>
      <ul class="productos" id="productos" data-vista="${estadoUI.vista}" aria-label="Lista de productos"></ul>
      <div id="centinela" aria-hidden="true"></div>
    </main>

    <footer class="pie contenedor">
      <p>${t.tienda_nombre} · ${t.tienda_direccion}${t.tienda_ciudad ? `, ${t.tienda_ciudad}` : ''}</p>
      <p><a href="https://wa.me/${soloDigitos(t.tienda_telefono)}" rel="noopener noreferrer" target="_blank">${icono.whatsapp} +${soloDigitos(t.tienda_telefono)}</a></p>
    </footer>

    <button class="carro-flotante" id="carro-flotante" type="button" aria-label="Ver carrito" hidden>
      ${icono.carro}<span id="carro-n">0</span><span class="carro-total" id="carro-total"></span>
    </button>

    <dialog id="dlg-producto" aria-labelledby="dp-titulo"></dialog>
    <dialog id="dlg-carrito" class="dialogo-lateral" aria-labelledby="dc-titulo"></dialog>
    <dialog id="dlg-horario" aria-labelledby="dh-titulo"></dialog>
  `)
  engancharFiltros()
  pintarProductos()
  pintarCarroFlotante()
}

function filtrados() {
  const q = normalizar(estadoUI.q)
  const palabras = q ? q.split(/\s+/) : []
  let lista = estadoUI.productos.filter((p) =>
    (!estadoUI.cat || p.categoria === estadoUI.cat) && palabras.every((w) => p._n.includes(w)))
  const cmp = {
    'alfa': (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    'precio-asc': (a, b) => a.precio - b.precio,
    'precio-desc': (a, b) => b.precio - a.precio,
    'nuevos': (a, b) => (b.creado || 0) - (a.creado || 0) || b._i - a._i,
  }[estadoUI.orden]
  return [...lista].sort(cmp)
}

function tarjeta(p) {
  const img = urlImagen(p.imagen)
  const n = carrito.cantidad(p.id)
  const agotado = p.stock <= 0
  return html`
    <li class="producto ${agotado ? 'agotado' : ''}" data-id="${p.id}">
      <button class="producto-foto" type="button" data-accion="ver" aria-label="Ver ${p.nombre}">
        ${img ? html`<img src="${img}" alt="" loading="lazy" decoding="async" width="300" height="300">`
              : html`<span class="sin-foto">${icono.foto}</span>`}
        ${agotado ? html`<span class="etiqueta etiqueta-error sello">Agotado</span>`
          : p.stock <= POCAS ? html`<span class="etiqueta etiqueta-aviso sello">¡Últimas ${p.stock}!</span>` : ''}
      </button>
      <div class="producto-info">
        <h2 class="producto-nombre">${p.nombre}</h2>
        ${p.descripcion ? html`<p class="producto-desc">${p.descripcion}</p>` : ''}
        <p class="producto-precio">${clp(p.precio)}</p>
        <div class="producto-accion">${controlCantidad(p, n)}</div>
      </div>
    </li>`
}

function controlCantidad(p, n) {
  if (p.stock <= 0) return html`<span class="texto-agotado">Producto agotado</span>`
  if (!n) return html`<button class="btn btn-primario btn-chico agregar" type="button" data-accion="mas">${icono.mas} Agregar</button>`
  return html`
    <div class="paso" role="group" aria-label="Cantidad de ${p.nombre}">
      <button class="btn btn-borde btn-chico btn-icono" type="button" data-accion="menos" aria-label="Quitar uno">${n === 1 ? icono.basura : icono.menos}</button>
      <span class="paso-n" aria-live="polite">${n}</span>
      <button class="btn btn-borde btn-chico btn-icono" type="button" data-accion="mas" aria-label="Agregar uno" ${crudo(n >= p.stock ? 'disabled' : '')}>${icono.mas}</button>
    </div>`
}

let observador
function pintarProductos() {
  const lista = filtrados()
  const ul = $('#productos')
  ul.dataset.vista = estadoUI.vista
  $('#conteo').textContent = `${lista.length} producto${lista.length === 1 ? '' : 's'}`
  if (!lista.length) {
    pintar(ul, html`<li class="vacio">${estadoUI.q ? 'No encontramos resultados para tu búsqueda. Intenta con otra palabra.' : 'Por el momento no hay productos para mostrar.'}</li>`)
    return
  }
  pintar(ul, lista.slice(0, estadoUI.mostrados).map(tarjeta))
  // Carga por tandas al acercarse al final, como el catálogo original.
  observador?.disconnect()
  if (lista.length > estadoUI.mostrados) {
    observador = new IntersectionObserver((e) => {
      if (e[0].isIntersecting) {
        const desde = estadoUI.mostrados
        estadoUI.mostrados += TANDA
        ul.insertAdjacentHTML('beforeend', lista.slice(desde, estadoUI.mostrados).map(tarjeta).join(''))
        if (lista.length <= estadoUI.mostrados) observador.disconnect()
      }
    }, { rootMargin: '600px' })
    observador.observe($('#centinela'))
  }
}

function refrescarTarjeta(id) {
  const li = $(`.producto[data-id="${CSS.escape(id)}"]`)
  const p = estadoUI.porId.get(id)
  if (li && p) pintar($('.producto-accion', li), controlCantidad(p, carrito.cantidad(id)))
}

function pintarCarroFlotante() {
  const lineas = carrito.lineas(estadoUI.porId)
  const n = lineas.reduce((s, l) => s + l.cantidad, 0)
  const b = $('#carro-flotante')
  b.hidden = n === 0
  $('#carro-n').textContent = n
  $('#carro-total').textContent = clp(lineas.reduce((s, l) => s + l.subtotal, 0))
}

/* ============================================================
   DIÁLOGOS
   ============================================================ */

function abrirProducto(id) {
  const p = estadoUI.porId.get(id)
  if (!p) return
  const d = $('#dlg-producto')
  const img = urlImagen(p.imagen)
  pintar(d, html`
    <div class="dialogo-cab">
      <h2 id="dp-titulo">${p.nombre}</h2>
      <button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button>
    </div>
    <div class="dialogo-cuerpo detalle">
      ${img ? html`<img class="detalle-foto" src="${img}" alt="${p.nombre}" width="600" height="600">` : ''}
      <p class="producto-precio grande">${clp(p.precio)}</p>
      ${p.descripcion ? html`<p class="detalle-desc">${p.descripcion}</p>` : ''}
      <p>${p.stock <= 0 ? html`<span class="etiqueta etiqueta-error">Agotado</span>`
          : html`<span class="etiqueta ${p.stock <= POCAS ? 'etiqueta-aviso' : 'etiqueta-ok'}">${p.stock} disponible${p.stock === 1 ? '' : 's'}</span>`}
         ${p.categoria ? html`<span class="etiqueta">${p.categoria}</span>` : ''}</p>
    </div>
    <div class="dialogo-pie" data-id="${p.id}">
      <div class="producto-accion">${controlCantidad(p, carrito.cantidad(p.id))}</div>
    </div>`)
  d.showModal()
}

function abrirCarrito() {
  const d = $('#dlg-carrito')
  pintarCarrito()
  d.showModal()
}

function pintarCarrito() {
  const d = $('#dlg-carrito')
  const t = estadoUI.tienda
  const lineas = carrito.lineas(estadoUI.porId)
  const total = lineas.reduce((s, l) => s + l.subtotal, 0)
  const previo = { ...leerDatosCliente(), ...borrador }
  const hayDespacho = t.despacho !== 'no', hayRetiro = t.retiro !== 'no'
  pintar(d, html`
    <div class="dialogo-cab">
      <h2 id="dc-titulo">Carrito de compras</h2>
      <button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button>
    </div>
    ${!lineas.length ? html`
      <div class="dialogo-cuerpo vacio"><p><strong>Tu carrito está vacío</strong></p><p>Agrega algunos productos para comenzar.</p></div>` : html`
      <div class="dialogo-cuerpo">
        <ul class="lineas">
          ${lineas.map((l) => html`
            <li class="linea" data-id="${l.p.id}">
              ${urlImagen(l.p.imagen) ? html`<img src="${urlImagen(l.p.imagen)}" alt="" width="56" height="56" loading="lazy">` : html`<span class="sin-foto chica">${icono.foto}</span>`}
              <div class="linea-info">
                <p class="linea-nombre">${l.p.nombre}</p>
                <p class="linea-precio">${clp(l.p.precio)} c/u</p>
              </div>
              <div class="producto-accion">${controlCantidad(l.p, l.cantidad)}</div>
              <p class="linea-sub">${clp(l.subtotal)}</p>
            </li>`)}
        </ul>
        <p class="total"><span>Total</span><strong>${clp(total)}</strong></p>
        <button class="btn btn-borde btn-chico vaciar" type="button" data-accion="vaciar">${icono.basura} Vaciar carrito</button>

        <form id="form-pedido" class="form-pedido" novalidate>
          <h3>Tus datos para el pedido</h3>
          <label class="campo"><span>Nombre</span>
            <input class="entrada" name="nombre" required maxlength="60" autocomplete="name" value="${previo.nombre || ''}"></label>
          <label class="campo"><span>Celular</span>
            <input class="entrada" name="celular" required inputmode="tel" maxlength="15" autocomplete="tel" placeholder="9 1234 5678" value="${previo.celular || ''}"></label>
          ${hayDespacho && hayRetiro ? html`
          <fieldset class="entrega">
            <legend>Entrega</legend>
            <label><input type="radio" name="entrega" value="retiro" ${crudo(previo.entrega !== 'despacho' ? 'checked' : '')}> Retiro en tienda</label>
            <label><input type="radio" name="entrega" value="despacho" ${crudo(previo.entrega === 'despacho' ? 'checked' : '')}> Despacho a domicilio</label>
          </fieldset>` : html`<input type="hidden" name="entrega" value="${hayDespacho ? 'despacho' : 'retiro'}">`}
          <label class="campo" id="campo-direccion" ${crudo(previo.entrega === 'despacho' || (hayDespacho && !hayRetiro) ? '' : 'hidden')}><span>Dirección de despacho</span>
            <input class="entrada" name="direccion" maxlength="140" autocomplete="street-address" value="${previo.direccion || ''}"></label>
          <label class="campo"><span>Comentario (opcional)</span>
            <textarea class="entrada" name="nota" maxlength="300" placeholder="Talla, color, horario de retiro…">${previo.nota || ''}</textarea></label>
          <p class="error-form" id="error-pedido" role="alert"></p>
        </form>
      </div>
      <div class="dialogo-pie">
        <button class="btn btn-whatsapp" type="submit" form="form-pedido">${icono.whatsapp} Enviar pedido por WhatsApp</button>
      </div>`}
  `)
  const f = $('#form-pedido', d)
  if (f) {
    // Lo escrito sobrevive a los repintados del carrito (cambiar una cantidad
    // repinta el diálogo entero).
    f.addEventListener('input', (e) => { if (e.target.name) borrador[e.target.name] = e.target.value })
    f.addEventListener('change', (e) => {
      if (e.target.name) borrador[e.target.name] = e.target.value
      if (e.target.name === 'entrega') $('#campo-direccion', d).hidden = e.target.value !== 'despacho'
    })
    f.addEventListener('submit', enviarPedido)
  }
}

const borrador = {}

function leerDatosCliente() {
  try { return JSON.parse(localStorage.getItem('vm_cliente') || '{}') } catch { return {} }
}

function soloDigitos(s) { return String(s || '').replace(/\D/g, '') }

function enviarPedido(e) {
  e.preventDefault()
  const f = e.target
  const datos = Object.fromEntries(new FormData(f))
  const err = $('#error-pedido')
  const cel = soloDigitos(datos.celular)
  if (!datos.nombre.trim()) return (err.textContent = 'Escribe tu nombre.')
  if (cel.length < 8 || cel.length > 12) return (err.textContent = 'Revisa el número de celular.')
  if (datos.entrega === 'despacho' && !String(datos.direccion || '').trim()) return (err.textContent = 'Escribe la dirección de despacho.')
  err.textContent = ''

  try {
    localStorage.setItem('vm_cliente', JSON.stringify({
      nombre: datos.nombre.trim(), celular: datos.celular.trim(), entrega: datos.entrega, direccion: (datos.direccion || '').trim(),
    }))
  } catch { /* nada */ }

  const t = estadoUI.tienda
  const lineas = carrito.lineas(estadoUI.porId)
  const total = lineas.reduce((s, l) => s + l.subtotal, 0)
  // Texto plano hacia WhatsApp: encodeURIComponent evita que un nombre con
  // "&" o saltos de línea rompa o altere la URL.
  const texto = [
    t.mensaje_whatsapp || 'Hola! Me gustaría realizar un pedido',
    '',
    '*Pedido*',
    ...lineas.map((l) => `• ${l.cantidad} × ${l.p.nombre} (${l.p.sku}) — ${clp(l.subtotal)}`),
    '',
    `*Total: ${clp(total)}*`,
    '',
    `Nombre: ${datos.nombre.trim()}`,
    `Celular: ${datos.celular.trim()}`,
    `Entrega: ${datos.entrega === 'despacho' ? `Despacho a ${datos.direccion.trim()}` : 'Retiro en tienda'}`,
    datos.nota?.trim() ? `Comentario: ${datos.nota.trim()}` : '',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n')

  const tel = soloDigitos(t.tienda_telefono)
  window.open(`https://wa.me/${tel}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
}

function abrirHorario() {
  const d = $('#dlg-horario')
  pintar(d, html`
    <div class="dialogo-cab">
      <h2 id="dh-titulo">Horario de atención</h2>
      <button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button>
    </div>
    <div class="dialogo-cuerpo">
      <table class="tabla-horario">
        <tbody>${tablaHorario(leerHorario(estadoUI.tienda.horario)).map((f) => html`<tr><th scope="row">${f.dia}</th><td>${f.tramo}</td></tr>`)}</tbody>
      </table>
    </div>`)
  d.showModal()
}

/* ============================================================
   EVENTOS (delegados: las tarjetas se repintan a menudo)
   ============================================================ */

function engancharFiltros() {
  let espera
  $('#q').addEventListener('input', (e) => {
    clearTimeout(espera)
    espera = setTimeout(() => { estadoUI.q = e.target.value; estadoUI.mostrados = TANDA; pintarProductos() }, 180)
  })
  $('#orden').addEventListener('change', (e) => { estadoUI.orden = e.target.value; estadoUI.mostrados = TANDA; pintarProductos() })
  $$('[data-vista]').forEach((b) => b.addEventListener('click', () => {
    estadoUI.vista = b.dataset.vista
    guardarPref('vm_vista', estadoUI.vista)
    $$('[data-vista]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    $('#productos').dataset.vista = estadoUI.vista
  }))
  $$('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    estadoUI.cat = b.dataset.cat
    estadoUI.mostrados = TANDA
    $$('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    pintarProductos()
  }))
  $('#carro-flotante').addEventListener('click', abrirCarrito)
}

document.addEventListener('click', (e) => {
  const cerrar = e.target.closest('[data-cerrar]')
  if (cerrar) return cerrar.closest('dialog').close()
  // Clic en el fondo del diálogo = cerrar.
  if (e.target.tagName === 'DIALOG') return e.target.close()

  const b = e.target.closest('[data-accion]')
  if (!b) return
  const accion = b.dataset.accion
  if (accion === 'horario') return abrirHorario()
  if (accion === 'vaciar') { carrito.vaciar(); pintarCarrito(); pintarProductos(); pintarCarroFlotante(); return }

  const id = b.closest('[data-id]')?.dataset.id
  const p = id && estadoUI.porId.get(id)
  if (!p) return
  if (accion === 'ver') return abrirProducto(id)
  if (accion === 'mas' || accion === 'menos') {
    const n = carrito.cantidad(id) + (accion === 'mas' ? 1 : -1)
    if (accion === 'mas' && n > p.stock) return aviso(`Solo quedan ${p.stock} unidades`, 'error')
    carrito.poner(id, n, p.stock)
    refrescarTarjeta(id)
    pintarCarroFlotante()
    if ($('#dlg-producto').open) pintar($('#dlg-producto .producto-accion'), controlCantidad(p, carrito.cantidad(id)))
    if ($('#dlg-carrito').open) pintarCarrito()
  }
})

cargar().catch((err) => {
  console.error(err)
  pintar($('#app'), html`<p class="vacio">No se pudo cargar el catálogo. Revisa tu conexión y recarga la página.</p>`)
})
