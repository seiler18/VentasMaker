import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/tienda.css'
import '../styles/efectos.css'
import '../styles/nav.css'

import { protegerMarco } from '../lib/marco.js'
import { html, crudo, pintar, $, $$ } from '../lib/dom.js'
import { aviso, celebrar, conBoton, desvanecer, panelError, sacudir } from '../lib/efectos.js'
import { clp, normalizar } from '../lib/formato.js'
import { icono } from '../lib/iconos.js'
import { urlImagen } from '../lib/imagen.js'
import { leerHorario, estado, tablaHorario } from '../lib/horario.js'
import { hayBackend, catalogo, llamar, backend, pistaVersion, idAleatorio, token } from '../lib/api.js'
import { TIENDA } from '../config.js'
import { carrito } from './carrito.js'

protegerMarco()

/* Sin backend (modo demo) los pedidos van al backend de mentira del panel,
   que se carga solo si alguien reserva. */
const llamarTienda = (accion, datos, opciones) => hayBackend()
  ? llamar(accion, datos, opciones)
  : import('../admin/demo.js').then((m) => m.llamarDemo(accion, datos))

/* MODO CAJA: quien entró al panel en esta pestaña (token y perfil en
   sessionStorage, los mismos del panel) ve el catálogo como punto de venta:
   escanea o agrega, y "Finalizar venta" la cobra y descuenta el stock. El
   servidor vuelve a comprobar sesión y rol en cada venta; esto solo decide
   qué se pinta. Todo lo de la caja vive en caja.js y solo se descarga aquí. */
const CAJA_APAGADA = 'vm_caja_off'
function leerSS(k) { try { return sessionStorage.getItem(k) } catch { return null } }
function perfilPanel() { try { return JSON.parse(leerSS('vm_perfil') || 'null') } catch { return null } }
// Llegar desde el panel ("Vender en el catálogo", o "Cobrar" un pedido) enciende la caja.
if (/^#(caja|pedido=)/.test(location.hash)) { try { sessionStorage.removeItem(CAJA_APAGADA) } catch { /* nada */ } }
if (location.hash === '#caja') history.replaceState(null, '', location.pathname)
const PERFIL = token.get() && perfilPanel()
const hayCaja = Boolean(PERFIL?.rol && !PERFIL.debeCambiar)
const enCaja = hayCaja && !leerSS(CAJA_APAGADA)
if (enCaja) carrito.usar('vm_carrito_caja')
let caja = null
const cajaLista = enCaja ? import('./caja.js').then((m) => { caja = m.iniciarCaja(ctxCaja()); return caja }) : null

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
  fuente: '',         // '' | 'copia' | 'estatica' | 'vivo' | 'caja': de dónde salieron los productos
  pintado: false,
  firma: '',          // para no repintar si lo que llega es igual a lo que hay
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

/* PINTAR YA, ACTUALIZAR DESPUÉS. Apps Script puede tardar un minuto en
   contestar (se ha medido), así que el catálogo nunca lo espera:
   1. la última copia que vio ESTE navegador (localStorage), al instante;
   2. si no hay, o es más vieja, la foto del catálogo publicada con el sitio
      (data/vivo.json, la genera el deploy desde la hoja; si no existe,
      la semilla data/catalogo.json);
   3. y por detrás, el inventario en vivo, que reemplaza sin saltos lo pintado.
   Si falla lo vivo no se molesta al cliente: ya está viendo el catálogo. */
const CLAVE_COPIA = 'vm_catalogo'
/* 'caja': el inventario completo del panel (con sesión). Manda sobre el
   catálogo público: trae los ocultos y los códigos de barras. */
const RANGO = { '': 0, estatica: 1, copia: 1, vivo: 2, caja: 3 }

function leerCopia() {
  try {
    const c = JSON.parse(localStorage.getItem(CLAVE_COPIA) || 'null')
    return c && Array.isArray(c.datos?.productos) && c.datos.productos.length ? c : null
  } catch { return null }
}
function guardarCopia(datos) {
  try { localStorage.setItem(CLAVE_COPIA, JSON.stringify({ t: Date.now(), srv: datos.srv || 0, datos: { tienda: datos.tienda, productos: datos.productos } })) } catch { /* lleno */ }
}

async function cargarEstatica() {
  if (hayBackend()) {
    try {
      const r = await fetch(`${BASE}data/vivo.json`, { cache: 'no-cache' })
      if (r.ok) {
        const j = await r.json()
        if (Array.isArray(j.productos) && j.productos.length) { pistaVersion(j.srv); return { t: j.generado || 0, datos: j } }
      }
    } catch { /* se usa la semilla */ }
  }
  const r = await fetch(`${BASE}data/catalogo.json`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return { t: 0, datos: { tienda: {}, productos: await r.json() } }
}

/* Los datos de la tienda y la lista de productos se ordenan por separado:
   el inventario de la caja trae solo productos, y los datos de la tienda
   (horario, dirección) siguen llegando del catálogo público. */
const crudos = { tienda: {}, productos: [], fuenteTienda: '' }

function aplicar(datos, fuente) {
  let cambio = false
  if (datos.tienda && Object.keys(datos.tienda).length && RANGO[fuente] >= RANGO[crudos.fuenteTienda]) {
    crudos.tienda = datos.tienda; crudos.fuenteTienda = fuente; cambio = true
  }
  if (Array.isArray(datos.productos) && RANGO[fuente] >= RANGO[estadoUI.fuente]) {
    crudos.productos = datos.productos; estadoUI.fuente = fuente; cambio = true
  }
  if (!cambio || !estadoUI.fuente) return
  const tienda = { ...TIENDA, ...crudos.tienda }
  // En caja se ven también los agotados: quien vende necesita saberlo.
  const mostrarAgotados = enCaja || tienda.mostrar_agotados !== 'no'
  const todos = crudos.productos
    .map((p, i) => ({ ...p, precio: Number(p.precio) || 0, stock: Number(p.stock) || 0,
                      _n: normalizar(`${p.nombre} ${p.descripcion} ${p.categoria}`), _i: i }))
  const productos = todos.filter((p) => p.visible !== false && (mostrarAgotados || p.stock > 0))
  const firma = JSON.stringify([tienda, todos.map((p) => [p.id, p.nombre, p.precio, p.stock, p.imagen, p.categoria, p.descripcion, p.visible])])
  const primera = !estadoUI.pintado
  estadoUI.pintado = true
  if (firma === estadoUI.firma) return
  estadoUI.firma = firma
  const cabeceraAntes = primera ? '' : firmaCabecera()
  estadoUI.tienda = tienda
  estadoUI.productos = productos
  // porId con TODOS: en caja se puede vender un producto oculto del catálogo
  // (se escanea). El catálogo público ya llega sin ocultos.
  estadoUI.porId = new Map(todos.map((p) => [p.id, p]))
  if (primera) return pintarTodo()

  // Ya había catálogo en pantalla: se actualiza sin que se note. Si cambió
  // la cabecera (datos de la tienda o categorías) y nadie está escribiendo
  // ni mirando un detalle, se repinta todo conservando la posición.
  entradaAnimada = false
  const ocupado = document.querySelector('dialog[open]') || document.activeElement?.id === 'q'
  if (firmaCabecera() !== cabeceraAntes && !ocupado) {
    const y = window.scrollY
    pintarTodo()
    window.scrollTo(0, y)
  } else {
    pintarProductos()
    pintarResumenCarrito()
  }
  entradaAnimada = true
}

function firmaCabecera() {
  const t = estadoUI.tienda
  const cuenta = {}
  estadoUI.productos.forEach((p) => { cuenta[p.categoria] = (cuenta[p.categoria] || 0) + 1 })
  return JSON.stringify([t.tienda_nombre, t.tienda_direccion, t.tienda_ciudad, t.horario, t.tienda_logo, t.tienda_telefono, cuenta])
}

async function cargar() {
  const copia = leerCopia()
  if (copia) { pistaVersion(copia.srv); aplicar(copia.datos, 'copia') }
  else pintarEsqueleto()

  // La foto publicada es CDN (rápida): si no había copia, o es más nueva
  // que la copia, se pinta mientras llega lo vivo.
  const estatica = cargarEstatica()
    .then((e) => { if (!copia || e.t > copia.t) aplicar(e.datos, 'estatica') })
    .catch((err) => console.warn('Catálogo publicado no disponible:', err))

  if (hayBackend()) {
    try {
      const vivo = await catalogo()
      guardarCopia({ ...vivo, srv: backend.version })
      aplicar(vivo, 'vivo')
    } catch (err) {
      console.warn('Inventario en vivo no disponible; se muestra la última copia.', err)
    }
  }
  await estatica
  if (!estadoUI.fuente) throw new Error('Sin catálogo')
}

function pantallaSinCatalogo() {
  const t = estadoUI.tienda
  pintar($('#app'), html`
    <main class="sin-catalogo">
      <img class="logo" src="${BASE}img/logo.webp" alt="" width="96" height="96">
      <div id="error-catalogo"></div>
      <a class="btn btn-whatsapp" href="https://wa.me/${soloDigitos(t.tienda_telefono)}" rel="noopener noreferrer" target="_blank">${icono.whatsapp} Pedir por WhatsApp mientras tanto</a>
    </main>`)
  panelError($('#error-catalogo'), {
    titulo: 'No pudimos cargar el catálogo',
    detalle: navigator.onLine === false ? 'Parece que no tienes conexión a internet.' : 'El servidor no respondió.',
    reintentar: () => iniciar(),
  })
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
        <div id="mis-pedidos"></div>
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
          <p class="pie-tienda">${hayCaja && !enCaja
            ? html`<a href="#caja" data-accion="entrar-caja">Volver al modo caja</a>`
            : !enCaja ? html`<a href="${BASE}admin.html" rel="nofollow">Acceso tienda</a>` : ''}</p>
        </footer>
      </div>

      <aside class="panel-carrito" id="panel-carrito" aria-label="${enCaja ? 'Venta en caja' : 'Tu pedido'}"></aside>
    </div>

    <button class="carro-flotante" id="carro-flotante" type="button" aria-label="${enCaja ? 'Ver la venta' : 'Ver carrito'}" hidden>
      <span class="carro-icono">${icono.carro}<span class="insignia" id="carro-n">0</span></span>
      <span class="carro-texto">${enCaja ? 'Ver venta' : 'Ver pedido'}</span>
      <span class="carro-total" id="carro-total"></span>
    </button>
    <button class="volver-arriba" id="volver-arriba" type="button" aria-label="Volver arriba" hidden>
      <svg class="icono" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
    </button>

    ${enCaja ? '' : html`<nav class="pestanas pestanas-tienda" aria-label="Secciones de la tienda">
      <button class="pestana" type="button" data-nav="inicio" aria-current="true">
        <span class="pestana-icono">${icono.inicio}</span><span class="pestana-texto">Tienda</span><span class="pestana-linea" aria-hidden="true"></span></button>
      <button class="pestana" type="button" data-nav="buscar">
        <span class="pestana-icono">${icono.buscar}</span><span class="pestana-texto">Buscar</span><span class="pestana-linea" aria-hidden="true"></span></button>
      <button class="pestana" type="button" data-nav="horario">
        <span class="pestana-icono">${icono.reloj}</span><span class="pestana-texto">Horario</span><span class="pestana-linea" aria-hidden="true"></span></button>
      <button class="pestana" type="button" data-nav="pedido">
        <span class="pestana-icono">${icono.carro}<span class="insignia" id="nav-n" hidden>0</span></span><span class="pestana-texto">Pedido</span><span class="pestana-linea" aria-hidden="true"></span></button>
    </nav>`}

    <dialog id="dlg-producto" class="hoja" aria-labelledby="dp-titulo"></dialog>
    <dialog id="dlg-carrito" class="dialogo-lateral hoja" aria-labelledby="dc-titulo"></dialog>
    <dialog id="dlg-horario" class="hoja" aria-labelledby="dh-titulo"></dialog>
    <dialog id="dlg-listo" class="hoja pedido-listo" aria-labelledby="dl-titulo"></dialog>
  `)
  engancharFiltros()
  pintarProductos()
  pintarResumenCarrito()
  pintarMisPedidos()
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
   pequeño retardo respecto de la anterior de su misma tanda. Al actualizar
   con el inventario en vivo NO se anima: las tarjetas ya estaban ahí. */
let entradaAnimada = true
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
    if (SIN_MOVIMIENTO.matches || !entradaAnimada) li.classList.add('visible')
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
      <h2>${enCaja ? 'Venta en caja' : 'Tu pedido'}</h2>
      ${n ? html`<button class="btn btn-chico pc-vaciar" type="button" data-accion="vaciar">Vaciar</button>` : ''}
    </div>
    ${caja?.pedido ? html`<p class="pc-pedido">${icono.ubicacion} Cobrando el pedido <strong>${caja.pedido.pedidoId}</strong>${caja.pedido.cliente ? ` · ${caja.pedido.cliente}` : ''}</p>` : ''}
    ${!n ? html`
      <div class="pc-vacio">
        <span class="pc-vacio-icono">${enCaja ? icono.codigo : icono.carro}</span>
        <p><strong>${enCaja ? 'Ninguna venta en curso' : 'Tu carrito está vacío'}</strong></p>
        <p>${enCaja ? 'Escanea un código con la pistola o toca Agregar en un producto.' : crudo('Toca <em>Agregar</em> en un producto y aparecerá aquí.')}</p>
      </div>` : html`
      <ul class="lineas pc-lineas">${lineas.map(lineaCarrito)}</ul>
      <div class="pc-pie">
        <p class="total"><span>${n} producto${n === 1 ? '' : 's'}</span><strong>${clp(total)}</strong></p>
        ${enCaja
          ? html`<button class="btn btn-primario pc-continuar" type="button" data-accion="checkout">Finalizar venta</button>`
          : html`<button class="btn btn-primario pc-continuar" type="button" data-accion="checkout">${icono.carro} Continuar pedido</button>`}
      </div>`}`)

  const b = $('#carro-flotante')
  b.hidden = n === 0
  document.body.classList.toggle('con-carro', n > 0)
  $('#carro-n').textContent = n
  $('#carro-total').textContent = clp(total)
  const navN = $('#nav-n')
  if (navN) { navN.textContent = n; navN.hidden = n === 0 }

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

async function abrirCarrito() {
  if (enCaja) await cajaLista
  pintarCarrito()
  const d = $('#dlg-carrito')
  if (!d.open) d.showModal()
}

/* ---------- pedido del cliente ----------
   Retiro en tienda: se RESERVA en el servidor y el cliente recibe un número
   (P1042) con el que llega a la tienda; ahí se cobra y se descuenta el stock.
   Despacho: se coordina por WhatsApp, porque el costo del envío depende de
   la dirección y no se puede cobrar antes de conocerlo. */

const borrador = {}
function leerDatosCliente() {
  try { return JSON.parse(localStorage.getItem('vm_cliente') || '{}') } catch { return {} }
}

/* Con un backend anterior a los pedidos (srv < 3) el retiro se coordina por
   WhatsApp, como antes. Si aún no se sabe la versión se intenta: un backend
   viejo contesta "Acción no válida" y se pasa a WhatsApp. */
let sinReservas = false
const puedeReservar = () => !sinReservas && (!hayBackend() || !backend.version || backend.pedidos)

function pintarCarrito() {
  const d = $('#dlg-carrito')
  const lineas = carrito.lineas(estadoUI.porId)
  const total = lineas.reduce((s, l) => s + l.subtotal, 0)
  if (enCaja && caja) return caja.pintarCobro(d, lineas, total)
  const t = estadoUI.tienda
  const previo = { ...leerDatosCliente(), ...borrador }
  const hayDespacho = t.despacho !== 'no', hayRetiro = t.retiro !== 'no'
  const entrega = !hayRetiro ? 'despacho' : !hayDespacho ? 'retiro' : previo.entrega === 'despacho' ? 'despacho' : 'retiro'
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
            <label class="opcion"><input type="radio" name="entrega" value="retiro" ${crudo(entrega === 'retiro' ? 'checked' : '')}><span>${icono.ubicacion} Retiro en tienda</span></label>
            <label class="opcion"><input type="radio" name="entrega" value="despacho" ${crudo(entrega === 'despacho' ? 'checked' : '')}><span>${icono.carro} Despacho a domicilio</span></label>
          </fieldset>` : html`<input type="hidden" name="entrega" value="${entrega}">`}
          <label class="campo" id="campo-direccion" ${crudo(entrega === 'despacho' ? '' : 'hidden')}><span>Dirección de despacho</span>
            <input class="entrada" name="direccion" maxlength="140" autocomplete="street-address" value="${previo.direccion || ''}"></label>
          <p class="nota-entrega" id="nota-entrega" aria-live="polite"></p>
          <label class="campo"><span>Comentario (opcional)</span>
            <textarea class="entrada" name="nota" maxlength="300" placeholder="Talla, color, horario de retiro…">${previo.nota || ''}</textarea></label>
          <p class="error-form" id="error-pedido" role="alert"></p>
        </form>
      </div>
      <div class="dialogo-pie">
        <button class="btn btn-ancho" id="enviar-pedido" type="submit" form="form-pedido"></button>
      </div>`}
  `)
  const f = $('#form-pedido', d)
  if (!f) return
  // Lo escrito sobrevive a los repintados (cambiar una cantidad repinta todo).
  f.addEventListener('input', (e) => { if (e.target.name) borrador[e.target.name] = e.target.value })
  f.addEventListener('change', (e) => {
    if (e.target.name) borrador[e.target.name] = e.target.value
    if (e.target.name === 'entrega') ponerEntrega(e.target.value, total)
  })
  f.addEventListener('submit', enviarPedido)
  ponerEntrega(entrega, total)
}

/* Lo que cambia con la entrega: cómo sigue el pedido y qué hace el botón. */
function ponerEntrega(entrega, total) {
  const d = $('#dlg-carrito')
  const t = estadoUI.tienda
  const despacho = entrega === 'despacho'
  const reserva = !despacho && puedeReservar()
  $('#campo-direccion', d).hidden = !despacho
  pintar($('#nota-entrega', d), despacho
    ? html`${icono.whatsapp}<span>El despacho lo coordinamos por WhatsApp. <strong>El envío no está incluido en el total</strong>: su costo depende de la dirección y te lo confirmamos antes de enviar.</span>`
    : reserva
      ? html`${icono.ubicacion}<span>Te damos un <strong>número de pedido</strong> al instante. Lo retiras en ${t.tienda_direccion} y pagas en la tienda con efectivo, débito, crédito o transferencia.</span>`
      : html`${icono.whatsapp}<span>Te confirmamos por WhatsApp cuándo puedes retirarlo en ${t.tienda_direccion}.</span>`)
  const b = $('#enviar-pedido', d)
  b.className = `btn btn-ancho ${reserva ? 'btn-primario' : 'btn-whatsapp'}`
  pintar(b, reserva
    ? html`${icono.ubicacion} Reservar para retiro · ${clp(total)}`
    : html`${icono.whatsapp} ${despacho ? 'Coordinar despacho por WhatsApp' : 'Enviar pedido por WhatsApp'} · ${clp(total)}`)
}

async function enviarPedido(e) {
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

  const lineas = carrito.lineas(estadoUI.porId)
  if (datos.entrega === 'despacho' || !puedeReservar()) return pedidoPorWhatsApp(datos, lineas)
  await reservar(datos, lineas, $('#enviar-pedido'))
}

/* Abre WhatsApp. Debe correr en el mismo clic: después de esperar al
   servidor, el navegador ya no deja abrir ventanas. Sin 'noopener' en las
   opciones: con él, window.open devuelve SIEMPRE null y no se podría
   distinguir una ventana bloqueada. Se corta el opener a mano; si el
   navegador la bloqueó (null de verdad), se va en esta pestaña. */
function abrirWhatsApp(texto) {
  const url = `https://wa.me/${soloDigitos(estadoUI.tienda.tienda_telefono)}?text=${encodeURIComponent(texto)}`
  const w = window.open(url, '_blank')
  if (w) w.opener = null
  return { w, url }
}

function pedidoPorWhatsApp(datos, lineas) {
  const t = estadoUI.tienda
  const total = lineas.reduce((s, l) => s + l.subtotal, 0)
  const despacho = datos.entrega === 'despacho'
  // Texto plano hacia WhatsApp: encodeURIComponent evita que un nombre con
  // "&" o saltos de línea rompa o altere la URL.
  const texto = [
    t.mensaje_whatsapp || 'Hola! Me gustaría realizar un pedido',
    '',
    '*Pedido*',
    ...lineas.map((l) => `• ${l.cantidad} × ${l.p.nombre} (${l.p.sku}) — ${clp(l.subtotal)}`),
    '',
    `*Total: ${clp(total)}*${despacho ? ' (sin el envío)' : ''}`,
    '',
    `Nombre: ${datos.nombre.trim()}`,
    `Celular: ${datos.celular.trim()}`,
    `Entrega: ${despacho ? `Despacho a ${datos.direccion.trim()}` : 'Retiro en tienda'}`,
    despacho ? '¿Cuánto sale el envío a esa dirección?' : '',
    datos.nota?.trim() ? `Comentario: ${datos.nota.trim()}` : '',
  ].filter((x, i, a) => x !== '' || a[i - 1] !== '').join('\n')

  const { w, url } = abrirWhatsApp(texto)
  $('#dlg-carrito').close()
  celebrar({
    titulo: '¡Tu pedido está listo!',
    detalle: despacho
      ? 'Se abrió WhatsApp con el detalle. Toca Enviar y te diremos el costo del envío a tu dirección.'
      : 'Se abrió WhatsApp con el detalle. Solo falta tocar Enviar; te responderemos por ahí.',
    acciones: [
      { texto: 'Seguir mirando', primaria: true },
      { texto: 'Vaciar el carrito', fn: () => { carrito.vaciar(); $$('.producto').forEach((li) => refrescarControles(li.dataset.id)); pintarResumenCarrito(); aviso('Carrito vaciado', 'info') } },
    ],
  })
  if (!w) location.href = url
}

/* La misma clave de idempotencia mientras el pedido no cambie: si la
   respuesta se pierde (Apps Script a veces ejecuta y devuelve un 404) y el
   cliente vuelve a tocar Reservar, recibe el MISMO número en vez de dejar
   dos pedidos. */
let reserva = null

async function reservar(datos, lineas, btn) {
  const err = $('#error-pedido')
  const cuerpo = {
    nombre: datos.nombre.trim(), celular: datos.celular.trim(), nota: (datos.nota || '').trim(),
    items: lineas.map((l) => ({ id: l.p.id, cantidad: l.cantidad })),
  }
  const firma = JSON.stringify(cuerpo)
  if (reserva?.firma !== firma) reserva = { firma, idem: idAleatorio() }
  try {
    const r = await conBoton(btn, () => llamarTienda('crearPedido', cuerpo, { idem: reserva.idem }))
    if (!r) return
    reserva = null
    const p = { pedidoId: r.pedidoId, total: r.total, nombre: cuerpo.nombre, fecha: Date.now() }
    recordarPedido(p)
    carrito.vaciar()
    $$('.producto').forEach((li) => refrescarControles(li.dataset.id))
    pintarResumenCarrito()
    $('#dlg-carrito').close()
    mostrarPedido(p, true)
  } catch (x) {
    if (x.message === 'Acción no válida') {
      // Backend anterior a los pedidos: el retiro sigue por WhatsApp.
      sinReservas = true
      ponerEntrega('retiro', lineas.reduce((s, l) => s + l.subtotal, 0))
      err.textContent = 'La reserva en línea no está disponible en este momento. Envía tu pedido por WhatsApp y te confirmamos el retiro.'
      return
    }
    err.textContent = x.red
      ? 'No pudimos confirmar tu reserva porque la conexión falló. Toca Reservar otra vez: si ya había quedado, verás el mismo número de pedido.'
      : x.message
  }
}

/* Los pedidos reservados desde ESTE navegador, para volver a ver el número.
   Nada sensible: número, total y el nombre que escribió el propio cliente. */
const CLAVE_MIS = 'vm_mis_pedidos'
const VIGENCIA_MS = 7 * 24 * 60 * 60 * 1000

function misPedidos() {
  try {
    const l = JSON.parse(localStorage.getItem(CLAVE_MIS) || '[]')
    return Array.isArray(l) ? l.filter((p) => p && /^P\d+$/.test(p.pedidoId) && Date.now() - p.fecha < VIGENCIA_MS) : []
  } catch { return [] }
}
function guardarMisPedidos(l) { try { localStorage.setItem(CLAVE_MIS, JSON.stringify(l)) } catch { /* nada */ } }
function recordarPedido(p) { guardarMisPedidos([p, ...misPedidos().filter((x) => x.pedidoId !== p.pedidoId)].slice(0, 5)); pintarMisPedidos() }
function olvidarPedido(id) { guardarMisPedidos(misPedidos().filter((x) => x.pedidoId !== id)); pintarMisPedidos() }

function pintarMisPedidos() {
  const caja = $('#mis-pedidos')
  if (!caja) return
  const l = enCaja ? [] : misPedidos()
  pintar(caja, !l.length ? '' : html`<div class="mis-pedidos">${l.map((p) => html`
    <p class="mi-pedido" data-pedido="${p.pedidoId}">
      ${icono.ubicacion}<span>Tienes el pedido <strong>${p.pedidoId}</strong> reservado para retiro</span>
      <button class="btn btn-chico btn-borde" type="button" data-accion="ver-pedido">Ver</button>
      <button class="btn btn-chico btn-icono" type="button" data-accion="olvidar-pedido" aria-label="Ocultar el aviso del pedido ${p.pedidoId}">${icono.cerrar}</button>
    </p>`)}</div>`)
}

function mostrarPedido(p, nuevo = false) {
  const d = $('#dlg-listo')
  const t = estadoUI.tienda
  const direccion = `${t.tienda_direccion}${t.tienda_ciudad ? `, ${t.tienda_ciudad}` : ''}`
  pintar(d, html`
    <div class="dialogo-cab">
      <h2 id="dl-titulo">${nuevo ? '¡Pedido reservado!' : 'Tu pedido para retiro'}</h2>
      <button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button>
    </div>
    <div class="dialogo-cuerpo listo-cuerpo">
      ${nuevo ? html`<span class="listo-marca" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg></span>` : ''}
      <p class="listo-etiqueta">Tu número de pedido</p>
      <p class="pedido-numero">${p.pedidoId}</p>
      <ol class="listo-pasos">
        <li>Ven a retirarlo a <strong>${direccion}</strong>. <button class="enlace-horario" type="button" data-accion="horario">${icono.reloj} Ver horario</button></li>
        <li>En caja, di o muestra este número${p.nombre ? ` (a nombre de ${p.nombre})` : ''}.</li>
        <li>Pagas al retirar: efectivo, débito, crédito o transferencia.</li>
      </ol>
      <p class="total"><span>Total estimado</span><strong>${clp(p.total)}</strong></p>
      <p class="listo-ayuda">El precio y la disponibilidad se confirman al retirar. Te conviene guardar una captura de esta pantalla.</p>
    </div>
    <div class="dialogo-pie">
      <button class="btn btn-whatsapp" type="button" data-accion="avisar-pedido">${icono.whatsapp} Avisar por WhatsApp</button>
      <button class="btn btn-primario" type="button" data-cerrar>Listo</button>
    </div>`)
  d.dataset.pedido = p.pedidoId
  d.showModal()
  if (nuevo) navigator.vibrate?.(40)
}

/* Lo que caja.js necesita del catálogo. */
function ctxCaja() {
  return {
    perfil: PERFIL,
    estadoUI,
    aplicar,
    lineaCarrito,
    agregar: agregarProducto,
    abrirCarrito,
    refrescar() {
      $$('.producto').forEach((li) => refrescarControles(li.dataset.id))
      pintarResumenCarrito()
      if ($('#dlg-carrito')?.open) pintarCarrito()
    },
    buscar(q) {
      estadoUI.q = q
      estadoUI.mostrados = TANDA
      if ($('#q')) { $('#q').value = q; pintarProductos() }
    },
    salir() {
      try { sessionStorage.setItem(CAJA_APAGADA, '1') } catch { /* nada */ }
      location.reload()
    },
  }
}

/* Suma una unidad al carrito (la usa el escáner de la caja). */
function agregarProducto(id) {
  const p = estadoUI.porId.get(id)
  if (!p) return false
  const n = carrito.cantidad(id) + 1
  if (n > p.stock) {
    aviso(p.stock <= 0 ? `${p.nombre}: sin stock` : `Solo quedan ${p.stock} unidades de ${p.nombre}`, 'error')
    return false
  }
  carrito.poner(id, n, p.stock)
  refrescarControles(id)
  pintarResumenCarrito(id)
  if ($('#dlg-carrito')?.open) pintarCarrito()
  return true
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

/* Cinta inferior del celular (nav.css la oculta en pantallas anchas). */
function engancharNav() {
  const nav = $('.pestanas-tienda')
  if (!nav) return
  document.body.classList.add('con-nav')
  const suave = () => (SIN_MOVIMIENTO.matches ? 'auto' : 'smooth')
  const marcar = (nombre) => $$('.pestana', nav).forEach((b) => b.setAttribute('aria-current', String(b.dataset.nav === nombre)))
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('[data-nav]')
    if (!b) return
    const ir = b.dataset.nav
    if (ir === 'inicio') { marcar('inicio'); window.scrollTo({ top: 0, behavior: suave() }) }
    else if (ir === 'buscar') {
      marcar('buscar')
      $('.barra-filtros').scrollIntoView({ block: 'start', behavior: suave() })
      $('#q').focus({ preventScroll: true })
    } else if (ir === 'horario') abrirHorario()
    else if (ir === 'pedido') abrirCarrito()
  })
}

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
  engancharNav()
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
  if (accion === 'ver-pedido' || accion === 'olvidar-pedido') {
    const pid = b.closest('[data-pedido]').dataset.pedido
    if (accion === 'olvidar-pedido') return olvidarPedido(pid)
    const p = misPedidos().find((x) => x.pedidoId === pid)
    return p && mostrarPedido(p)
  }
  if (accion === 'avisar-pedido') {
    const p = misPedidos().find((x) => x.pedidoId === $('#dlg-listo').dataset.pedido)
    if (!p) return
    const { w, url } = abrirWhatsApp(`Hola! Reservé el pedido ${p.pedidoId} para retiro en tienda${p.nombre ? `, a nombre de ${p.nombre}` : ''}. Total estimado: ${clp(p.total)}.`)
    if (!w) location.href = url
    return
  }
  if (accion === 'entrar-caja') {
    e.preventDefault()
    try { sessionStorage.removeItem(CAJA_APAGADA) } catch { /* nada */ }
    return location.reload()
  }
  if (accion === 'vaciar') {
    if (!confirm(enCaja ? '¿Vaciar la venta en curso?' : '¿Vaciar el carrito?')) return
    desvanecer($('#panel-carrito .pc-lineas')).then(() => {
      caja?.olvidarPedido()
      carrito.vaciar()
      if ($('#dlg-carrito').open) pintarCarrito()
      $$('.producto').forEach((li) => refrescarControles(li.dataset.id))
      pintarResumenCarrito()
      aviso('Carrito vaciado', 'info')
    })
    return
  }

  const id = b.closest('[data-id]')?.dataset.id
  const p = id && estadoUI.porId.get(id)
  if (!p) return
  if (accion === 'ver') return abrirProducto(id)
  if (accion === 'mas' || accion === 'menos') {
    const antes = carrito.cantidad(id)
    const n = antes + (accion === 'mas' ? 1 : -1)
    if (accion === 'mas' && n > p.stock) { sacudir(b); return aviso(`Solo quedan ${p.stock} unidades de ${p.nombre}`, 'error') }
    const actualizar = () => {
      carrito.poner(id, n, p.stock)
      refrescarControles(id)
      pintarResumenCarrito(accion === 'mas' ? id : null)
      if ($('#dlg-carrito').open) pintarCarrito()
    }
    if (n <= 0) {
      // Sale del pedido: la línea se desvanece antes de irse.
      Promise.all($$(`.lineas .linea[data-id="${CSS.escape(id)}"]`).map(desvanecer)).then(() => {
        actualizar()
        aviso(`Quitaste ${p.nombre} del pedido`, 'info')
      })
      return
    }
    actualizar()
    if (antes === 0) aviso(`${p.nombre} agregado a ${enCaja ? 'la venta' : 'tu pedido'}`)
    // Vuela solo al agregar desde el catálogo o el detalle, no desde el carrito.
    if (accion === 'mas' && !b.closest('.lineas')) volarAlCarrito(b.closest('.producto, .detalle'))
  }
})

function iniciar() {
  return cargar().catch((err) => {
    console.error(err)
    pantallaSinCatalogo()
  })
}

window.addEventListener('offline', () => aviso('Sin conexión a internet: puedes mirar el catálogo, pero para enviar el pedido necesitas conexión.', 'error'))
iniciar()
