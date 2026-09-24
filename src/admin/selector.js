/* Diálogo para buscar y elegir un producto. Devuelve una promesa con el
   producto elegido, o null si se cierra sin elegir. */
import { html, pintar, $ } from '../lib/dom.js'
import { clp } from '../lib/formato.js'
import { icono } from '../lib/iconos.js'
import { inventario } from './estado.js'

export function elegirProducto(titulo) {
  return new Promise((resolver) => {
    const d = document.createElement('dialog')
    d.className = 'dlg-selector'
    pintar(d, html`
      <div class="dialogo-cab"><h2>${titulo}</h2><button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button></div>
      <div class="dialogo-cuerpo">
        <input class="entrada" type="search" placeholder="Buscar por nombre o SKU" aria-label="Buscar producto">
        <ul class="sugerencias"></ul>
      </div>`)
    document.body.append(d)
    let elegido = null
    const lista = $('.sugerencias', d)
    const pintarLista = (q) => pintar(lista, inventario.buscar(q, 30).map((p) => html`
      <li><button type="button" class="sugerencia" data-id="${p.id}">
        <span>${p.nombre}</span><span class="sug-meta">${p.sku}${p.codigo ? ` · ${p.codigo}` : ' · sin código'} · ${clp(p.precio)}</span>
      </button></li>`))
    $('input', d).addEventListener('input', (e) => pintarLista(e.target.value))
    lista.addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]')
      if (b) { elegido = inventario.porId(b.dataset.id); d.close() }
    })
    d.addEventListener('close', () => { d.remove(); resolver(elegido) })
    d.showModal()
  })
}
