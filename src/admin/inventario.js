/* INVENTARIO — alta, edición y ajustes de stock.

   El stock NO se edita en la ficha del producto: se cambia con un ajuste
   (ingreso, corrección o merma) que queda registrado en Movimientos con
   usuario, fecha y nota. Es la diferencia entre "el stock es 3" y "el stock
   es 3 porque el martes alguien registró 2 prendas dañadas". */
import { html, crudo, pintar, $, aviso } from '../lib/dom.js'
import { clp, fechaHora } from '../lib/formato.js'
import { icono } from '../lib/iconos.js'
import { urlImagen, prepararImagen } from '../lib/imagen.js'
import { iniciarEscaner } from '../lib/escaner.js'
import { llamar, inventario, demo } from './estado.js'
import { descargarCSV } from './csv.js'

const PAGINA = 80

export default function inventarioVista(el) {
  const f = { q: '', cat: '', filtro: 'todos', max: PAGINA }

  pintar(el, html`
    <section class="inv">
      <div class="inv-barra">
        <input class="entrada" id="inv-q" type="search" placeholder="Buscar por nombre, SKU o código" aria-label="Buscar">
        <select class="entrada" id="inv-cat" aria-label="Categoría">
          <option value="">Todas las categorías</option>
          ${inventario.categorias().map((c) => html`<option>${c}</option>`)}
        </select>
        <select class="entrada" id="inv-filtro" aria-label="Filtro">
          <option value="todos">Todos</option>
          <option value="bajo">Stock bajo</option>
          <option value="agotados">Agotados</option>
          <option value="sin-codigo">Sin código de barras</option>
          <option value="ocultos">Ocultos del catálogo</option>
        </select>
        <button class="btn btn-borde" type="button" id="inv-csv">${icono.descargar} CSV</button>
        <button class="btn btn-primario" type="button" id="inv-nuevo">${icono.mas} Nuevo producto</button>
      </div>
      <p class="inv-resumen" id="inv-resumen"></p>
      <div class="tabla-envoltura">
        <table class="tabla inv-tabla">
          <thead><tr><th scope="col"><span class="oculto-visual">Foto</span></th><th scope="col">Producto</th><th scope="col">Categoría</th>
            <th scope="col" class="num">Precio</th><th scope="col" class="num">Stock</th><th scope="col"><span class="oculto-visual">Acciones</span></th></tr></thead>
          <tbody id="inv-filas"></tbody>
        </table>
      </div>
      <button class="btn btn-borde mas-filas" type="button" id="inv-mas" hidden>Mostrar más</button>
    </section>
    <dialog id="dlg-prod" class="dlg-ancho" aria-labelledby="dlg-prod-t"></dialog>`)

  function lista() {
    const w = f.q.trim() ? inventario.buscar(f.q, 5000) : inventario.todos()
    return w.filter((p) => {
      if (f.cat && p.categoria !== f.cat) return false
      if (f.filtro === 'bajo') return p.visible && p.stock > 0 && p.stock <= Math.max(p.stock_minimo || 0, 1)
      if (f.filtro === 'agotados') return p.stock <= 0
      if (f.filtro === 'sin-codigo') return !p.codigo
      if (f.filtro === 'ocultos') return !p.visible
      return true
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }

  function pintarFilas() {
    const l = lista()
    const todos = inventario.todos()
    $('#inv-resumen', el).textContent =
      `${l.length} de ${todos.length} productos · ${todos.reduce((s, p) => s + Math.max(0, p.stock), 0)} unidades en stock · valor a precio de venta ${clp(todos.reduce((s, p) => s + Math.max(0, p.stock) * p.precio, 0))}`
    pintar($('#inv-filas', el), l.slice(0, f.max).map((p) => {
      const bajo = p.stock <= Math.max(p.stock_minimo || 0, 1)
      return html`
      <tr data-id="${p.id}" class="${p.visible ? '' : 'fila-oculta'}">
        <td>${urlImagen(p.imagen) ? html`<img src="${urlImagen(p.imagen)}" alt="" width="44" height="44" loading="lazy">` : html`<span class="sin-foto mini">${icono.foto}</span>`}</td>
        <td><p class="inv-nombre">${p.nombre}</p><p class="inv-meta">${p.sku}${p.codigo ? html` · ${icono.codigo} ${p.codigo}` : ''}${p.visible ? '' : ' · oculto'}</p></td>
        <td>${p.categoria}</td>
        <td class="num">${clp(p.precio)}</td>
        <td class="num"><span class="etiqueta ${p.stock <= 0 ? 'etiqueta-error' : bajo ? 'etiqueta-aviso' : ''}">${p.stock}</span></td>
        <td class="acciones"><button class="btn btn-borde btn-chico" type="button" data-editar>${icono.editar} Editar</button></td>
      </tr>`
    }))
    $('#inv-mas', el).hidden = l.length <= f.max
  }

  /* ---------- ficha de producto ---------- */

  let pararCamara = null
  async function abrirFicha(p) {
    const nuevo = !p
    p ||= { nombre: '', descripcion: '', categoria: '', precio: '', costo: '', stock: 0, stock_minimo: 1, codigo: '', visible: true, imagen: '' }
    const d = $('#dlg-prod')
    const imgActual = { ruta: p.imagen }
    pintar(d, html`
      <div class="dialogo-cab"><h2 id="dlg-prod-t">${nuevo ? 'Nuevo producto' : p.nombre}</h2>
        <button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button></div>
      <form class="dialogo-cuerpo ficha" id="form-prod" novalidate>
        <div class="ficha-foto">
          <div class="foto-previa" id="foto-previa">${urlImagen(p.imagen) ? html`<img src="${urlImagen(p.imagen)}" alt="">` : html`<span class="sin-foto">${icono.foto}</span>`}</div>
          <label class="btn btn-borde btn-chico">${icono.camara} ${p.imagen ? 'Cambiar foto' : 'Subir foto'}
            <input type="file" accept="image/*" id="foto-archivo" class="oculto-visual" ${crudo(demo ? 'disabled' : '')}></label>
          ${demo ? html`<p class="ayuda">La subida de fotos necesita el backend.</p>` : ''}
        </div>
        <div class="ficha-campos">
          <label class="campo ancho"><span>Nombre *</span><input class="entrada" name="nombre" required maxlength="120" value="${p.nombre}"></label>
          <label class="campo ancho"><span>Descripción (tallas, colores…)</span><textarea class="entrada" name="descripcion" maxlength="1000">${p.descripcion}</textarea></label>
          <label class="campo"><span>Categoría</span><input class="entrada" name="categoria" list="lista-cats" maxlength="60" value="${p.categoria}"></label>
          <datalist id="lista-cats">${inventario.categorias().map((c) => html`<option value="${c}">`)}</datalist>
          <label class="campo"><span>Código de barras</span>
            <span class="con-boton"><input class="entrada" name="codigo" maxlength="64" value="${p.codigo}" inputmode="numeric" placeholder="${p.sku ? `vacío = usa ${p.sku}` : ''}">
            <button class="btn btn-borde btn-icono" type="button" id="escanear-codigo" aria-label="Escanear código">${icono.camara}</button></span></label>
          <label class="campo"><span>Precio de venta *</span><input class="entrada" name="precio" type="number" inputmode="numeric" min="0" step="100" required value="${p.precio}"></label>
          <label class="campo"><span>Costo (no se publica)</span><input class="entrada" name="costo" type="number" inputmode="numeric" min="0" step="100" value="${p.costo || ''}"></label>
          ${nuevo ? html`<label class="campo"><span>Stock inicial</span><input class="entrada" name="stock" type="number" inputmode="numeric" min="0" value="0"></label>` : ''}
          <label class="campo"><span>Avisar con stock ≤</span><input class="entrada" name="stock_minimo" type="number" inputmode="numeric" min="0" value="${p.stock_minimo}"></label>
          <label class="casilla ancho"><input type="checkbox" name="visible" ${crudo(p.visible ? 'checked' : '')}> Visible en el catálogo público</label>
        </div>
        <video id="video-ficha" class="video-ficha" playsinline muted hidden></video>
        <p class="error-form ancho" role="alert" id="error-prod"></p>
      </form>
      ${nuevo ? '' : html`
      <section class="ajuste">
        <h3>Stock actual: <strong id="stock-actual">${p.stock}</strong></h3>
        <form class="ajuste-form" id="form-ajuste">
          <label class="campo"><span>Tipo</span><select class="entrada" name="tipo">
            <option value="ingreso">Ingreso (llegó mercadería)</option>
            <option value="ajuste">Corrección de conteo</option>
            <option value="merma">Merma (dañado, perdido)</option></select></label>
          <label class="campo"><span>Cantidad</span><input class="entrada" name="cantidad" type="number" inputmode="numeric" required placeholder="+5, −2 o total"></label>
          <label class="campo"><span>Cómo</span><select class="entrada" name="como">
            <option value="delta">Sumar / restar</option><option value="total">Fijar el total</option></select></label>
          <label class="campo ancho"><span>Nota</span><input class="entrada" name="nota" maxlength="200"></label>
          <button class="btn btn-borde" type="submit">Aplicar ajuste</button>
        </form>
        <details class="historial" id="historial"><summary>Ver movimientos</summary><div id="movs"></div></details>
      </section>`}
      <div class="dialogo-pie">
        ${nuevo ? '' : html`<button class="btn btn-peligro" type="button" id="ocultar-prod">${p.visible ? 'Ocultar del catálogo' : 'Ya está oculto'}</button>`}
        <button class="btn btn-borde" type="button" data-cerrar>Cancelar</button>
        <button class="btn btn-primario" type="submit" form="form-prod">Guardar</button>
      </div>`)
    d.showModal()

    $('#foto-archivo', d).addEventListener('change', async (e) => {
      const archivo = e.target.files[0]
      if (!archivo) return
      const previa = $('#foto-previa', d)
      previa.classList.add('cargando')
      try {
        const img = await prepararImagen(archivo)
        pintar(previa, html`<img src="${img.previa}" alt="">`)
        const r = await llamar('subirImagen', { base64: img.base64, tipo: img.tipo })
        imgActual.ruta = r.url
        aviso('Foto subida; guarda el producto para aplicarla')
      } catch (err) {
        aviso(err.message, 'error')
      } finally { previa.classList.remove('cargando') }
    })

    $('#escanear-codigo', d).addEventListener('click', async () => {
      const v = $('#video-ficha', d)
      if (pararCamara) { pararCamara(); pararCamara = null; v.hidden = true; return }
      v.hidden = false
      try {
        pararCamara = await iniciarEscaner(v, (codigo) => {
          $('[name=codigo]', d).value = codigo
          pararCamara?.(); pararCamara = null; v.hidden = true
        })
      } catch { v.hidden = true; aviso('No se pudo abrir la cámara', 'error') }
    })

    $('#form-prod', d).addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(e.target)
      const datos = {
        id: p.id, nombre: fd.get('nombre').trim(), descripcion: fd.get('descripcion'), categoria: fd.get('categoria').trim(),
        codigo: fd.get('codigo').trim(), precio: Number(fd.get('precio')), costo: Number(fd.get('costo') || 0),
        stock: Number(fd.get('stock') || 0), stock_minimo: Number(fd.get('stock_minimo') || 0),
        visible: fd.get('visible') === 'on', imagen: imgActual.ruta,
      }
      const err = $('#error-prod', d)
      if (!datos.nombre) return (err.textContent = 'El nombre es obligatorio.')
      if (!(datos.precio >= 0) || fd.get('precio') === '') return (err.textContent = 'Revisa el precio.')
      if (datos.codigo) {
        const otro = inventario.porCodigo(datos.codigo)
        if (otro && otro.id !== p.id) return (err.textContent = `Ese código ya lo tiene: ${otro.nombre}`)
      }
      const b = $('[type=submit][form=form-prod]', d)
      b.disabled = true
      try {
        await llamar('guardarProducto', { producto: datos })
        await inventario.recargar()
        aviso(nuevo ? 'Producto creado' : 'Cambios guardados')
        d.close()
        pintarFilas()
      } catch (x) { err.textContent = x.message; b.disabled = false }
    })

    $('#form-ajuste', d)?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(e.target)
      const n = Number(fd.get('cantidad'))
      if (!Number.isInteger(n)) return aviso('Escribe una cantidad entera', 'error')
      const cuerpo = { id: p.id, tipo: fd.get('tipo'), nota: fd.get('nota') }
      if (fd.get('como') === 'total') cuerpo.nuevo = n
      else cuerpo.delta = fd.get('tipo') === 'merma' ? -Math.abs(n) : n
      try {
        const r = await llamar('ajustarStock', cuerpo)
        inventario.fijarStock(p.id, r.stock)
        $('#stock-actual', d).textContent = r.stock
        e.target.reset()
        aviso(`Stock actualizado: ${r.stock}`)
        pintarFilas()
        if ($('#historial', d).open) cargarMovs()
      } catch (x) { aviso(x.message, 'error') }
    })

    const cargarMovs = async () => {
      const caja = $('#movs', d)
      try {
        const { movimientos } = await llamar('movimientos', { id: p.id })
        pintar(caja, !movimientos.length ? html`<p class="ayuda">Sin movimientos registrados.</p>` : html`
          <table class="tabla tabla-densa"><thead><tr><th>Fecha</th><th>Tipo</th><th class="num">Δ</th><th class="num">Queda</th><th>Usuario</th><th>Nota</th></tr></thead>
          <tbody>${movimientos.map((m) => html`<tr><td>${fechaHora(m.fecha)}</td><td>${m.tipo}</td><td class="num">${m.delta > 0 ? '+' : ''}${m.delta}</td><td class="num">${m.stock_final}</td><td>${m.usuario}</td><td>${m.nota}</td></tr>`)}</tbody></table>`)
      } catch (x) { caja.textContent = x.message }
    }
    $('#historial', d)?.addEventListener('toggle', (e) => { if (e.target.open) cargarMovs() })

    $('#ocultar-prod', d)?.addEventListener('click', async () => {
      if (!p.visible || !confirm(`¿Ocultar "${p.nombre}" del catálogo? Sus ventas pasadas se conservan.`)) return
      try {
        await llamar('eliminarProducto', { id: p.id })
        await inventario.recargar()
        d.close(); pintarFilas(); aviso('Producto oculto')
      } catch (x) { aviso(x.message, 'error') }
    })
  }

  $('#dlg-prod').addEventListener('close', () => { pararCamara?.(); pararCamara = null })

  /* ---------- eventos ---------- */

  let espera
  $('#inv-q', el).addEventListener('input', (e) => { clearTimeout(espera); espera = setTimeout(() => { f.q = e.target.value; f.max = PAGINA; pintarFilas() }, 180) })
  $('#inv-cat', el).addEventListener('change', (e) => { f.cat = e.target.value; f.max = PAGINA; pintarFilas() })
  $('#inv-filtro', el).addEventListener('change', (e) => { f.filtro = e.target.value; f.max = PAGINA; pintarFilas() })
  $('#inv-mas', el).addEventListener('click', () => { f.max += PAGINA; pintarFilas() })
  $('#inv-nuevo', el).addEventListener('click', () => abrirFicha(null))
  $('#inv-csv', el).addEventListener('click', () => descargarCSV('inventario', lista(),
    ['sku', 'codigo', 'nombre', 'categoria', 'precio', 'costo', 'stock', 'stock_minimo', 'visible']))
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-editar]')) abrirFicha(inventario.porId(e.target.closest('[data-id]').dataset.id))
  })

  pintarFilas()
  return () => { pararCamara?.() }
}
