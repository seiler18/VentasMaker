/* ETIQUETAS — imprime códigos de barras para lo que no trae uno.

   Casi toda la ropa de la tienda no tiene código de fábrica. Cada producto
   tiene un SKU interno (MK0001…); esta vista lo imprime como Code 128 en
   etiquetas para pegar o colgar, y desde ahí el escáner lo lee igual que un
   EAN. Si el producto sí tiene código propio, se imprime ese.

   JsBarcode se carga solo al entrar aquí. */
import { html, crudo, pintar, $, aviso } from '../lib/dom.js'
import { clp } from '../lib/formato.js'
import { icono } from '../lib/iconos.js'
import { inventario } from './estado.js'

export default function etiquetas(el) {
  const elegidos = new Map()   // id → copias
  const f = { q: '', filtro: 'sin-codigo' }

  pintar(el, html`
    <section class="etq">
      <div class="etq-config">
        <p class="ayuda">Elige productos y cuántas etiquetas de cada uno. Se imprime en hoja carta/A4 (etiquetas de 50 × 30 mm) o en impresora térmica de etiquetas.</p>
        <div class="inv-barra">
          <input class="entrada" id="etq-q" type="search" placeholder="Buscar" aria-label="Buscar">
          <select class="entrada" id="etq-filtro" aria-label="Filtro">
            <option value="sin-codigo">Sin código de fábrica</option>
            <option value="todos">Todos</option>
          </select>
          <button class="btn btn-borde" type="button" id="etq-todos">Agregar los listados (copias = stock)</button>
          <button class="btn btn-borde" type="button" id="etq-limpiar">Limpiar</button>
          <button class="btn btn-primario" type="button" id="etq-imprimir">${icono.imprimir} Imprimir <span id="etq-n">0</span></button>
        </div>
      </div>
      <div class="tabla-envoltura">
        <table class="tabla tabla-densa">
          <thead><tr><th>Producto</th><th>Código a imprimir</th><th class="num">Stock</th><th class="num">Copias</th></tr></thead>
          <tbody id="etq-filas"></tbody>
        </table>
      </div>
    </section>
    <div id="hoja-etiquetas" class="hoja-etiquetas" aria-hidden="true"></div>`)

  const lista = () => (f.q.trim() ? inventario.buscar(f.q, 5000) : inventario.todos())
    .filter((p) => p.visible && (f.filtro === 'todos' || !p.codigo))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  function pintarFilas() {
    pintar($('#etq-filas', el), lista().slice(0, 200).map((p) => html`
      <tr data-id="${p.id}">
        <td>${p.nombre}</td>
        <td><code>${p.codigo || p.sku}</code></td>
        <td class="num">${p.stock}</td>
        <td class="num"><input class="entrada paso-input" type="number" min="0" max="500" inputmode="numeric" value="${elegidos.get(p.id) || 0}" aria-label="Copias de ${p.nombre}"></td>
      </tr>`))
    contar()
  }
  const contar = () => { $('#etq-n', el).textContent = [...elegidos.values()].reduce((s, n) => s + n, 0) }

  el.addEventListener('change', (e) => {
    if (!e.target.classList.contains('paso-input')) return
    const id = e.target.closest('[data-id]').dataset.id
    const n = Math.max(0, Math.min(500, Math.floor(Number(e.target.value)) || 0))
    if (n) elegidos.set(id, n); else elegidos.delete(id)
    contar()
  })
  let espera
  $('#etq-q', el).addEventListener('input', (e) => { clearTimeout(espera); espera = setTimeout(() => { f.q = e.target.value; pintarFilas() }, 180) })
  $('#etq-filtro', el).addEventListener('change', (e) => { f.filtro = e.target.value; pintarFilas() })
  $('#etq-todos', el).addEventListener('click', () => { lista().forEach((p) => { if (p.stock > 0) elegidos.set(p.id, Math.min(p.stock, 500)) }); pintarFilas() })
  $('#etq-limpiar', el).addEventListener('click', () => { elegidos.clear(); pintarFilas() })
  $('#etq-imprimir', el).addEventListener('click', imprimir)

  async function imprimir() {
    const total = [...elegidos.values()].reduce((s, n) => s + n, 0)
    if (!total) return aviso('Elige al menos una etiqueta', 'error')
    if (total > 2000) return aviso('Máximo 2000 etiquetas por impresión', 'error')
    const { default: JsBarcode } = await import('jsbarcode')
    const hoja = $('#hoja-etiquetas', el)
    const etiquetasHtml = []
    for (const [id, n] of elegidos) {
      const p = inventario.porId(id)
      if (!p) continue
      for (let i = 0; i < n; i++) {
        etiquetasHtml.push(html`<div class="etiqueta-imp"><p class="ei-nombre">${p.nombre}</p><svg class="ei-codigo" data-codigo="${p.codigo || p.sku}"></svg><p class="ei-precio">${clp(p.precio)}</p></div>`)
      }
    }
    pintar(hoja, crudo(etiquetasHtml.join('')))
    hoja.querySelectorAll('.ei-codigo').forEach((svg) => {
      const c = svg.dataset.codigo
      const ean = /^\d{13}$/.test(c) ? 'EAN13' : /^\d{8}$/.test(c) ? 'EAN8' : 'CODE128'
      try {
        // background '' = sin rectángulo de fondo: JsBarcode lo pinta con un
        // atributo style que la CSP bloquearía, y quedaría un bloque negro.
        JsBarcode(svg, c, { format: ean, height: 40, width: 1.6, fontSize: 12, margin: 0, background: '', displayValue: true })
      } catch {
        JsBarcode(svg, c, { format: 'CODE128', height: 40, width: 1.6, fontSize: 12, margin: 0, background: '' })
      }
    })
    window.print()
  }

  pintarFilas()
}
