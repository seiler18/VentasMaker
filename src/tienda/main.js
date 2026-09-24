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
const POCAS = 3           // "¡Últimas N!" a partir de aquí
const BASE = import.meta.env.BASE_URL
/* Mismo corte que en tienda.css: desde aquí el carrito es un panel fijo a la
   derecha; por debajo, un botón flotante. */
const ESCRITORIO = window.matchMedia('(min-width: 1100px)')
const SIN_MOVIMIENTO = window.matchMedia('(prefers-reduced-motion: reduce)')

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
const soloDigitos = (s) => String(s || '').replace(/\D/g, '')

/* ============================================================
   CARGA
   ============================================================ */

/* Mientras llega el catálogo se pinta la silueta de la página: el visitante
   ve de inmediato dónde va a estar cada cosa, y nada salta al cargar. */
function pintarEsqueleto() {
  pintar($('#app'), html`
    <div class="portada esqueleto-bloque"></div>
    <div class="tienda-cuerpo">
      <div class="catalogo">
        <ul class="productos">${Array.from({ length: 12 }, () => html`
          <li class="producto esqueleto"><div class="producto-media"></div>
            <div class="producto-info"><span class="linea-esq"></span><span class="linea-esq corta"></span><span class="linea-esq precio-esq"></span></div></li>`)}
        </ul>
      </div>
    </div>`)
}

async function cargar() {
  pintarEsqueleto()
  let datos
  if (hayBackend()) {
    try { datos = await catalogo() } catch {
      aviso('No se pudo conectar con el inventario en vivo; se muestra la última copia publicada.', 'error')
    }
  }
  if (!datos) {
    const r = await fetch(`${BASE}data/catalogo.json`)
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
   ARMAZÓN
   ============================================================ */

function pintarTodo() {
  const t = estadoUI.tienda
  document.title = `${t.tienda_nombre} — Catálogo`
  const est = estado(leerHorario(t.horario))
  const cuenta = new Map()
  estadoUI.productos.forEach((p) => p.categoria && cuenta.set(p.categoria, (cuenta.get(p.categoria) || 0) + 1))
  const cats = [...cuenta.keys()].sort((a, b) => a.localeCompare(b, 'es'))
  const direccion = `${t.tienda_direccion}${t.tienda_ciudad ? `, ${t.tienda_ciudad}` : ''}`

  pintar($('#app'), html`
    <header class="cabecera">
      <div class="portada" role="img" aria-label="Portada de ${t.tienda_nombre}"></div>
      <div class="cabecera-info">
        <img class="logo" src="${urlImagen(t.tienda_logo) || `${BASE}img/logo.webp`}" alt="Logo de ${t.tienda_nombre}" width="104" height="104">
        <div class="cabecera-texto">
          <h1>${t.tienda_nombre}</h1>
          <p class="cabecera-datos">
            <span class="estado ${est.abierto ? 'abierto' : 'cerrado'}"><span class="punto" aria-hidden="true"></span>${est.texto}</span>
            <span class="dato">${icono.ubicacion} ${direccion}</span>
            <button class="enlace-horario" type="button" data-accion="horario">${icono.reloj} Ver horario</button>
          </p>
        </div>
      </div>
    </header>

    <div class="tienda-cuerpo">
      <div class="catalogo">
        <div class="barra-filtros">
          <label class="buscador">
            ${icono.buscar}
            <span class="oculto-visual">Buscar producto</span>
            <input class="entrada" id="q" type="search" placeholder="Buscar producto" value="${estadoUI.q}" autocomplete="off" enterkeyhint="search">
          </label>
          <nav class="categorias" aria-label="Categorías">
            <button class="chip" type="button" data-cat="" aria-pressed="${!estadoUI.cat}">Ver todos <span class="chip-n">${estadoUI.productos.length}</span></button>
            ${cats.map((c) => html`<button class="chip" type="button" data-cat="${c}" aria-pressed="${estadoUI.cat === c}">${c} <span class="chip-n">${cuenta.get(c)}</span></button>`)}
          </nav>
        </div>

        <div class="barra-orden">
          <p class="conteo" id="conteo" aria-live="polite"></p>
          <div class="orden-grupo">
            <label class="oculto-visual" for="orden">Ordenar por</label>
            <select class="entrada orden" id="orden">
              ${[['alfa', 'Alfabéticamente'], ['precio-asc', 'Precio: menor a mayor'], ['precio-desc', 'Precio: mayor a menor'], ['nuevos', 'Más nuevos']]
                .map(([v, l]) => html`<option value="${v}" ${crudo(estadoUI.orden === v ? 'selected' : '')}>${l}</option>`)}
            </select>
            <div class="vistas" role="group" aria-label="Vista">
              <button class="btn btn-borde btn-icono" type="button" data-vista="rejilla" aria-pressed="${estadoUI.vista === 'rejilla'}" aria-label="Ver en cuadrícula">${icono.rejilla}</button>
              <button class="btn btn-borde btn-icono" type="button" data-vista="lista" aria-pressed="${estadoUI.vista === 'lista'}" aria-label="Ver en lista">${icono.lista}</button>
            </div>
          </div>
        </div>

        <main>
          <ul class="productos" id="productos" data-vista="${estadoUI.vista}" aria-label="Lista de productos"></ul>
          <div id="centinela" aria-hidden="true"></div>
        </main>

        <footer class="pie">
          <p>${t.tienda_nombre} · ${direccion}</p>
          <p><a href="https://wa.me/${soloDigitos(t.tienda_telefono)}" rel="noopener noreferrer" target="_blank">${icono.whatsapp} +${soloDigitos(t.tienda_telefono)}</a></p>
        </footer>
      </div>

      <aside class="panel-carrito" id="panel-carrito" aria-label="Tu pedido"></aside>
    </div>

    <button class="carro-flotante" id="carro-flotante" type="button" aria-label="Ver carrito" hidden>
      <span class="carro-icono">${icono.carro}<span class="insignia" id="carro-n">0</span></span>
      <span class="carro-texto">Ver pedido</span>
      <span class="carro-total" id="carro-total"></span>
    </button>
    <button class="volver-arriba" id="volver-arriba" type="button" aria-label="Volver arriba" hidden>
      <svg class="icono" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    </button>

    <dialog id="dlg-producto" class="hoja" aria-labelledby="dp-titulo"></dialog>
    <dialog id="dlg-carrito" class="dialogo-lateral hoja" aria-labelledby="dc-titulo"></dialog>
    <dialog id="dlg-horario" class="hoja" aria-labelledby="dh-titulo"></dialog>
  `)
  engancharFiltros()
  pintarProductos()
  pintarResumenCarrito()
}

/* ============================================================
   PRODUCTOS
   ============================================================ */

function filtrados() {
  const palabras = normalizar(estadoUI.q).split(/\s+/).filter(Boolean)
  const lista = estadoUI.productos.filter((p) =>
    (!estadoUI.cat || p.categoria === estadoUI.cat) && palabras.every((w) => p._n.includes(w)))
  const cmp = {
    'alfa': (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    'precio-asc': (a, b) => a.precio - b.precio,
    'precio-desc': (a, b) => b.precio - a.precio,
    'nuevos': (a, b) => (b.creado || 0) - (a.creado || 0) || b._i - a._i,
  }[estadoUI.orden]
  return lista.sort(cmp)
}

/* Anatomía FIJA de la tarjeta, para que todas las de una fila tengan el
   precio a la misma altura sin importar la foto ni el texto:
     foto   → caja cuadrada; la imagen la llena recortada (object-fit: cover),
              sea vertical, horizontal o cuadrada.
     nombre → siempre 2 líneas de alto (recorta con … si es más largo).
     detalle→ siempre 1 línea de alto, AUNQUE esté vacío.
     pie    → precio + botón, empujados al fondo de la tarjeta. */
function tarjeta(p) {
  const img = urlImagen(p.imagen)
  const agotado = p.stock <= 0
  return html`
    <li class="producto ${agotado ? 'agotado' : ''}" data-id="${p.id}">
      <div class="producto-media">
        <button class="producto-foto" type="button" data-accion="ver" aria-label="Ver detalle de ${p.nombre}">
          ${img ? html`<img src="${img}" alt="" loading="lazy" decoding="async" width="300" height="300">`
                : html`<span class="sin-foto">${icono.foto}</span>`}
          <span class="ver-detalle" aria-hidden="true">Ver detalle</span>
        </button>
        ${agotado ? html`<span class="sello sello-agotado">Agotado</span>`
          : p.stock <= POCAS ? html`<span class="sello">¡Últimas ${p.stock}!</span>` : ''}
      </div>
      <div class="producto-info">
        <div class="producto-texto">
          <h2 class="producto-nombre" title="${p.nombre}">${p.nombre}</h2>
          ${p.descripcion ? html`<p class="producto-desc">${p.descripcion}</p>` : ''}
        </div>
        <div class="producto-pie">
          <p class="producto-precio">${clp(p.precio)}</p>
          <div class="producto-accion">${controlCantidad(p, carrito.cantidad(p.id))}</div>
        </div>
      </div>
    </li>`
}

function controlCantidad(p, n) {
  if (p.stock <= 0) return html`<span class="texto-agotado">Sin stock</span>`
  if (!n) return html`<button class="btn btn-primario btn-chico agregar" type="button" data-accion="mas">${icono.carro} Agregar</button>`
  return html`
    <div class="paso" role="group" aria-label="Cantidad de ${p.nombre}">
      <button class="btn btn-borde btn-chico btn-icono" type="button" data-accion="menos" aria-label="Quitar uno">${n === 1 ? icono.basura : icono.menos}</button>
      <span class="paso-n" aria-live="polite">${n}</span>
      <button class="btn btn-borde btn-chico btn-icono" type="button" data-accion="mas" aria-label="Agregar uno" ${crudo(n >= p.stock ? 'disabled' : '')}>${icono.mas}</button>
    </div>`
}

/* Entrada escalonada: cada tarjeta aparece al acercarse a la pantalla, con un
   pequeño retardo respecto de la anterior de su misma tanda. */
const revelador = new IntersectionObserver((entradas) => {
  let i = 0
  for (const e of entradas) {
    if (!e.isIntersecting) continue
    e.target.style.setProperty('--i', String(i++ % 8))
    e.target.classList.add('visible')
    revelador.unobserve(e.target)
  }
}, { rootMargin: '0px 0px -40px 0px' })

function observar(ul) {
  $$('.producto:not(.visible)', ul).forEach((li) => {
    if (SIN_MOVIMIENTO.matches) li.classList.add('visible')
    else revelador.observe(li)
  })
}

let paginador
function pintarProductos() {
  const lista = filtrados()
  const ul = $('#productos')
  ul.dataset.vista = estadoUI.vista
  pintar($('#conteo'), html`${lista.length} producto${lista.length === 1 ? '' : 's'}${estadoUI.cat ? html`<span class="conteo-cat"> en ${estadoUI.cat}</span>` : ''}`)
  paginador?.disconnect()
  if (!lista.length) {
    pintar(ul, html`<li class="vacio vacio-busqueda">${icono.buscar}<strong>${estadoUI.q ? 'No encontramos resultados' : 'Sin productos por ahora'}</strong>
      <span>${estadoUI.q ? 'Prueba con otra palabra o revisa la categoría.' : 'Vuelve pronto.'}</span></li>`)
    return
  }
  pintar(ul, lista.slice(0, estadoUI.mostrados).map(tarjeta))
  observar(ul)
  if (lista.length > estadoUI.mostrados) {
    paginador = new IntersectionObserver((e) => {
      if (!e[0].isIntersecting) return
      const desde = estadoUI.mostrados
      estadoUI.mostrados += TANDA
      ul.insertAdjacentHTML('beforeend', lista.slice(desde, estadoUI.mostrados).map(tarjeta).join(''))
      observar(ul)
      if (lista.length <= estadoUI.mostrados) paginador.disconnect()
    }, { rootMargin: '800px' })
    paginador.observe($('#centinela'))
  }
}

function refrescarControles(id) {
  const p = estadoUI.porId.get(id)
  if (!p) return
  $$(`[data-id="${CSS.escape(id)}"] .producto-accion`).forEach((caja) => {
    pintar(caja, controlCantidad(p, carrito.cantidad(id)))
    caja.classList.remove('pop'); void caja.offsetWidth; caja.classList.add('pop')
  })
}

/* ============================================================
   CARRITO: panel fijo (escritorio) y botón flotante (móvil)
   ============================================================ */

function lineaCarrito(l) {
  const img = urlImagen(l.p.imagen)
  return html`
    <li class="linea" data-id="${l.p.id}">
      ${img ? html`<img src="${img}" alt="" width="56" height="56" loading="lazy">` : html`<span class="sin-foto chica">${icono.foto}</span>`}
      <div class="linea-info">
        <p class="linea-nombre">${l.p.nombre}</p>
        <p class="linea-precio">${clp(l.p.precio)} c/u</p>
      </div>
      <p class="linea-sub">${clp(l.subtotal)}</p>
      <div class="producto-accion">${controlCantidad(l.p, l.cantidad)}</div>
    </li>`
}

function pintarResumenCarrito(destacar) {
  const lineas = carrito.lineas(estadoUI.porId)
  const n = lineas.reduce((s, l) => s + l.cantidad, 0)
  const total = lineas.reduce((s, l) => s + l.subtotal, 0)

  pintar($('#panel-carrito'), html`
    <div class="pc-cab">
      <span class="carro-icono" id="pc-icono">${icono.carro}${n ? html`<span class="insignia">${n}</span>` : ''}</span>
      <h2>Tu pedido</h2>
      ${n ? html`<button class="btn btn-chico pc-vaciar" type="button" data-accion="vaciar">Vaciar</button>` : ''}
    </div>
    ${!n ? html`
      <div class="pc-vacio">
        <span class="pc-vacio-icono">${icono.carro}</span>
        <p><strong>Tu carrito está vacío</strong></p>
        <p>Toca <em>Agregar</em> en un producto y aparecerá aquí.</p>
      </div>` : html`
      <ul class="lineas pc-lineas">${lineas.map(lineaCarrito)}</ul>
      <div class="pc-pie">
        <p class="total"><span>${n} producto${n === 1 ? '' : 's'}</span><strong>${clp(total)}</strong></p>
        <button class="btn btn-whatsapp pc-continuar" type="button" data-accion="checkout">${icono.whatsapp} Continuar pedido</button>
      </div>`}`)

  const b = $('#carro-flotante')
  b.hidden = n === 0
  document.body.classList.toggle('con-carro', n > 0)
  $('#carro-n').textContent = n
  $('#carro-total').textContent = clp(total)

  if (destacar) {
    const li = $(`#panel-carrito .linea[data-id="${CSS.escape(destacar)}"]`)
    li?.classList.add('recien')
    li?.scrollIntoView({ block: 'nearest' })
  }
}

/* La foto del producto "vuela" hasta el carrito: confirma la acción sin
   ningún texto, y enseña dónde quedó lo agregado. */
function volarAlCarrito(origenLi) {
  const destino = ESCRITORIO.matches ? $('#pc-icono') : $('#carro-flotante')
  const img = origenLi?.querySelector('.producto-media img, .detalle-foto')
  const golpe = () => {
    const el = ESCRITORIO.matches ? $('#pc-icono') : $('#carro-flotante')
    el?.classList.remove('rebota'); void el?.offsetWidth; el?.classList.add('rebota')
  }
  if (SIN_MOVIMIENTO.matches || !img || !destino || destino.hidden) return golpe()
  const a = img.getBoundingClientRect(), b = destino.getBoundingClientRect()
  if (!a.width || !b.width) return golpe()
  const clon = img.cloneNode()
  clon.className = 'volando'
  clon.removeAttribute('loading')
  Object.assign(clon.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px` })
  document.body.append(clon)
  const dx = b.left + b.width / 2 - (a.left + a.width / 2)
  const dy = b.top + b.height / 2 - (a.top + a.height / 2)
  const anim = clon.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1, borderRadius: '14px' },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 60}px) scale(0.5)`, opacity: 0.95, borderRadius: '50%', offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.12)`, opacity: 0.3, borderRadius: '50%' },
  ], { duration: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vuelo')) || 650, easing: 'cubic-bezier(0.5, 0, 0.2, 1)' })
  anim.onfinish = () => { clon.remove(); golpe() }
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
    <div class="dialogo-cuerpo detalle" data-id="${p.id}">
      <div class="detalle-media">${img ? html`<img class="detalle-foto" src="${img}" alt="${p.nombre}" width="600" height="600">` : html`<span class="sin-foto">${icono.foto}</span>`}</div>
      <div class="detalle-info">
        <p class="producto-precio grande">${clp(p.precio)}</p>
        <p class="detalle-etiquetas">${p.stock <= 0 ? html`<span class="etiqueta etiqueta-error">Agotado</span>`
            : html`<span class="etiqueta ${p.stock <= POCAS ? 'etiqueta-aviso' : 'etiqueta-ok'}">${p.stock} disponible${p.stock === 1 ? '' : 's'}</span>`}
           ${p.categoria ? html`<span class="etiqueta">${p.categoria}</span>` : ''}</p>
        ${p.descripcion ? html`<p class="detalle-desc">${p.descripcion}</p>` : ''}
        <div class="producto-accion">${controlCantidad(p, carrito.cantidad(p.id))}</div>
      </div>
    </div>`)
  d.showModal()
}

function abrirCarrito() {
  pintarCarrito()
  $('#dlg-carrito').showModal()
}

const borrador = {}
function leerDatosCliente() {
  try { return JSON.parse(localStorage.getItem('vm_cliente') || '{}') } catch { return {} }
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
      <h2 id="dc-titulo">Finalizar pedido</h2>
      <button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button>
    </div>
    ${!lineas.length ? html`
      <div class="dialogo-cuerpo pc-vacio"><span class="pc-vacio-icono">${icono.carro}</span><p><strong>Tu carrito está vacío</strong></p><p>Agrega algunos productos para comenzar.</p></div>` : html`
      <div class="dialogo-cuerpo">
        <ul class="lineas">${lineas.map(lineaCarrito)}</ul>
        <p class="total"><span>Total</span><strong>${clp(total)}</strong></p>

        <form id="form-pedido" class="form-pedido" novalidate>
          <h3>Tus datos para el pedido</h3>
          <label class="campo"><span>Nombre</span>
            <input class="entrada" name="nombre" required maxlength="60" autocomplete="name" value="${previo.nombre || ''}"></label>
          <label class="campo"><span>Celular</span>
            <input class="entrada" name="celular" required inputmode="tel" maxlength="15" autocomplete="tel" placeholder="9 1234 5678" value="${previo.celular || ''}"></label>
          ${hayDespacho && hayRetiro ? html`
          <fieldset class="entrega">
            <legend>Entrega</legend>
            <label class="opcion"><input type="radio" name="entrega" value="retiro" ${crudo(previo.entrega !== 'despacho' ? 'checked' : '')}><span>${icono.ubicacion} Retiro en tienda</span></label>
            <label class="opcion"><input type="radio" name="entrega" value="despacho" ${crudo(previo.entrega === 'despacho' ? 'checked' : '')}><span>${icono.carro} Despacho a domicilio</span></label>
          </fieldset>` : html`<input type="hidden" name="entrega" value="${hayDespacho ? 'despacho' : 'retiro'}">`}
          <label class="campo" id="campo-direccion" ${crudo(previo.entrega === 'despacho' || (hayDespacho && !hayRetiro) ? '' : 'hidden')}><span>Dirección de despacho</span>
            <input class="entrada" name="direccion" maxlength="140" autocomplete="street-address" value="${previo.direccion || ''}"></label>
          <label class="campo"><span>Comentario (opcional)</span>
            <textarea class="entrada" name="nota" maxlength="300" placeholder="Talla, color, horario de retiro…">${previo.nota || ''}</textarea></label>
          <p class="error-form" id="error-pedido" role="alert"></p>
        </form>
      </div>
      <div class="dialogo-pie">
        <button class="btn btn-whatsapp btn-ancho" type="submit" form="form-pedido">${icono.whatsapp} Enviar pedido por WhatsApp · ${clp(total)}</button>
      </div>`}
  `)
  const f = $('#form-pedido', d)
  if (f) {
    // Lo escrito sobrevive a los repintados (cambiar una cantidad repinta todo).
    f.addEventListener('input', (e) => { if (e.target.name) borrador[e.target.name] = e.target.value })
    f.addEventListener('change', (e) => {
      if (e.target.name) borrador[e.target.name] = e.target.value
      if (e.target.name === 'entrega') $('#campo-direccion', d).hidden = e.target.value !== 'despacho'
    })
    f.addEventListener('submit', enviarPedido)
  }
}

function enviarPedido(e) {
  e.preventDefault()
  const datos = Object.fromEntries(new FormData(e.target))
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

  window.open(`https://wa.me/${soloDigitos(t.tienda_telefono)}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener')
}

function abrirHorario() {
  const d = $('#dlg-horario')
  const hoy = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][new Date().getDay()]
  pintar(d, html`
    <div class="dialogo-cab">
      <h2 id="dh-titulo">Horario de atención</h2>
      <button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button>
    </div>
    <div class="dialogo-cuerpo">
      <table class="tabla-horario">
        <tbody>${tablaHorario(leerHorario(estadoUI.tienda.horario)).map((f) => html`<tr class="${f.dia === hoy ? 'hoy' : ''}"><th scope="row">${f.dia}</th><td>${f.tramo}</td></tr>`)}</tbody>
      </table>
    </div>`)
  d.showModal()
}

/* ============================================================
   EVENTOS
   ============================================================ */

function engancharFiltros() {
  let espera
  $('#q').addEventListener('input', (e) => {
    clearTimeout(espera)
    espera = setTimeout(() => { estadoUI.q = e.target.value; estadoUI.mostrados = TANDA; pintarProductos() }, 180)
  })
  $('#orden').addEventListener('change', (e) => { estadoUI.orden = e.target.value; estadoUI.mostrados = TANDA; pintarProductos() })
  $$('.vistas [data-vista]').forEach((b) => b.addEventListener('click', () => {
    estadoUI.vista = b.dataset.vista
    guardarPref('vm_vista', estadoUI.vista)
    $$('.vistas [data-vista]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    $('#productos').dataset.vista = estadoUI.vista
  }))
  $$('[data-cat]').forEach((b) => b.addEventListener('click', () => {
    estadoUI.cat = b.dataset.cat
    estadoUI.mostrados = TANDA
    $$('[data-cat]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
    // En móvil la fila de categorías se desliza: el chip elegido se centra.
    b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: SIN_MOVIMIENTO.matches ? 'auto' : 'smooth' })
    pintarProductos()
    const cat = $('.catalogo')
    if (cat.getBoundingClientRect().top < 0) $('.barra-orden').scrollIntoView({ block: 'start', behavior: 'smooth' })
  }))
  $('#carro-flotante').addEventListener('click', abrirCarrito)
  const arriba = $('#volver-arriba')
  arriba.addEventListener('click', () => window.scrollTo({ top: 0, behavior: SIN_MOVIMIENTO.matches ? 'auto' : 'smooth' }))
  let tic = false
  window.addEventListener('scroll', () => {
    if (tic) return
    tic = true
    requestAnimationFrame(() => { arriba.hidden = window.scrollY < 1200; tic = false })
  }, { passive: true })
}

document.addEventListener('click', (e) => {
  const cerrar = e.target.closest('[data-cerrar]')
  if (cerrar) return cerrar.closest('dialog').close()
  if (e.target.tagName === 'DIALOG') return e.target.close()   // clic en el fondo

  const b = e.target.closest('[data-accion]')
  if (!b) return
  const accion = b.dataset.accion
  if (accion === 'horario') return abrirHorario()
  if (accion === 'checkout') return abrirCarrito()
  if (accion === 'vaciar') {
    if (!confirm('¿Vaciar el carrito?')) return
    carrito.vaciar()
    if ($('#dlg-carrito').open) pintarCarrito()
    $$('.producto').forEach((li) => refrescarControles(li.dataset.id))
    pintarResumenCarrito()
    return
  }

  const id = b.closest('[data-id]')?.dataset.id
  const p = id && estadoUI.porId.get(id)
  if (!p) return
  if (accion === 'ver') return abrirProducto(id)
  if (accion === 'mas' || accion === 'menos') {
    const antes = carrito.cantidad(id)
    const n = antes + (accion === 'mas' ? 1 : -1)
    if (accion === 'mas' && n > p.stock) return aviso(`Solo quedan ${p.stock} unidades`, 'error')
    carrito.poner(id, n, p.stock)
    refrescarControles(id)
    pintarResumenCarrito(accion === 'mas' ? id : null)
    if ($('#dlg-carrito').open) pintarCarrito()
    // Vuela solo al agregar desde el catálogo o el detalle, no desde el carrito.
    if (accion === 'mas' && !b.closest('.lineas')) volarAlCarrito(b.closest('.producto, .detalle'))
  }
})

cargar().catch((err) => {
  console.error(err)
  pintar($('#app'), html`<p class="vacio">No se pudo cargar el catálogo. Revisa tu conexión y recarga la página.</p>`)
})
