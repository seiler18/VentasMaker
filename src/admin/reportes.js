/* REPORTES — ventas por día, semana, mes y año.

   El cálculo lo hace el servidor sobre la hoja Ventas (las anuladas no
   cuentan). Además, el disparador diario del backend deja las mismas cifras
   escritas en las hojas "Resumen …" de la planilla, para quien prefiera
   mirarlas ahí o hacer sus propios gráficos. */
import { html, pintar, $, aviso } from '../lib/dom.js'
import { clp, num, hoyISO } from '../lib/formato.js'
import { llamar } from './estado.js'
import { descargarCSV } from './csv.js'

const PERIODOS = [
  { id: 'dia', t: 'Diario', dias: 30 },
  { id: 'semana', t: 'Semanal', dias: 7 * 12 },
  { id: 'mes', t: 'Mensual', dias: 365 },
  { id: 'anio', t: 'Anual', dias: 365 * 5 },
]
const MEDIOS = { efectivo: 'Efectivo', debito: 'Débito', credito: 'Crédito', transferencia: 'Transferencia', otro: 'Otro' }

export default function reportes(el) {
  const st = { periodo: 'dia', desde: hoyISO(-29), hasta: hoyISO(), datos: null }

  pintar(el, html`
    <section class="rep">
      <div class="rep-filtros">
        <div class="segmentado" role="group" aria-label="Periodo">
          ${PERIODOS.map((p) => html`<button type="button" data-periodo="${p.id}" aria-pressed="${p.id === st.periodo}">${p.t}</button>`)}
        </div>
        <label class="campo"><span>Desde</span><input class="entrada" type="date" id="rep-desde" value="${st.desde}"></label>
        <label class="campo"><span>Hasta</span><input class="entrada" type="date" id="rep-hasta" value="${st.hasta}"></label>
        <button class="btn btn-borde" type="button" id="rep-csv">Exportar CSV</button>
      </div>
      <div id="rep-cuerpo"><p class="vacio">Cargando…</p></div>
    </section>`)

  async function cargar() {
    const cuerpo = $('#rep-cuerpo', el)
    cuerpo.classList.add('cargando')
    try {
      st.datos = await llamar('reporte', { periodo: st.periodo, desde: st.desde, hasta: st.hasta })
      pintarReporte()
    } catch (err) {
      pintar(cuerpo, html`<p class="vacio">${err.message}</p>`)
    } finally { cuerpo.classList.remove('cargando') }
  }

  function pintarReporte() {
    const r = st.datos
    const totalMedios = Object.values(r.medios).reduce((s, v) => s + v, 0)
    pintar($('#rep-cuerpo', el), html`
      <div class="kpis">
        <div class="kpi"><span>Ventas</span><strong>${clp(r.resumen.total)}</strong></div>
        <div class="kpi"><span>Transacciones</span><strong>${num(r.resumen.transacciones)}</strong></div>
        <div class="kpi"><span>Unidades</span><strong>${num(r.resumen.unidades)}</strong></div>
        <div class="kpi"><span>Ticket promedio</span><strong>${clp(r.resumen.ticketPromedio)}</strong></div>
      </div>

      <div class="panel-bloque">
        <h2>Ventas ${PERIODOS.find((p) => p.id === st.periodo).t.toLowerCase()}s ($)</h2>
        ${r.serie.length ? html`<div class="grafico" id="grafico"></div>` : html`<p class="vacio">No hay ventas en este rango.</p>`}
        ${r.serie.length ? html`
        <details class="tabla-datos"><summary>Ver tabla</summary>
          <table class="tabla tabla-densa"><thead><tr><th>Periodo</th><th class="num">Total</th><th class="num">Transacciones</th><th class="num">Unidades</th></tr></thead>
          <tbody>${[...r.serie].reverse().map((f) => html`<tr><td>${f.periodo}</td><td class="num">${clp(f.total)}</td><td class="num">${f.transacciones}</td><td class="num">${f.unidades}</td></tr>`)}</tbody></table>
        </details>` : ''}
      </div>

      <div class="rep-columnas">
        <div class="panel-bloque">
          <h2>Más vendidos</h2>
          ${!r.top.length ? html`<p class="ayuda">Sin datos.</p>` : html`
          <table class="tabla tabla-densa"><thead><tr><th>Producto</th><th class="num">Unid.</th><th class="num">Total</th></tr></thead>
          <tbody>${r.top.map((t) => html`<tr><td>${t.nombre}</td><td class="num">${t.unidades}</td><td class="num">${clp(t.total)}</td></tr>`)}</tbody></table>`}
        </div>
        <div class="panel-bloque">
          <h2>Medios de pago</h2>
          ${!totalMedios ? html`<p class="ayuda">Sin datos.</p>` : html`
          <ul class="barras-h">${Object.entries(r.medios).sort((a, b) => b[1] - a[1]).map(([m, v]) => html`
            <li><span class="bh-etq">${MEDIOS[m] || m}</span>
              <span class="bh-pista"><span class="bh-barra" data-v="${(v / totalMedios).toFixed(4)}"></span></span>
              <span class="bh-val">${clp(v)} · ${Math.round((v / totalMedios) * 100)}%</span></li>`)}</ul>`}
          <h2 class="sub">Stock bajo</h2>
          ${!r.stockBajo.length ? html`<p class="ayuda">Nada bajo el mínimo.</p>` : html`
          <ul class="lista-simple">${r.stockBajo.map((p) => html`<li><span>${p.nombre}</span><span class="etiqueta ${p.stock <= 0 ? 'etiqueta-error' : 'etiqueta-aviso'}">${p.stock}</span></li>`)}</ul>`}
        </div>
      </div>`)
    // Ancho de las barras por JS y no con style="" en el HTML: la CSP bloquea
    // los atributos style del marcado, pero no los que se fijan por CSSOM.
    el.querySelectorAll('.bh-barra').forEach((b) => b.style.setProperty('--v', b.dataset.v))
    if (r.serie.length) grafico($('#grafico', el), continua(r.serie, st))
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-periodo]')
    if (b) {
      st.periodo = b.dataset.periodo
      const p = PERIODOS.find((x) => x.id === st.periodo)
      st.desde = hoyISO(-(p.dias - 1)); st.hasta = hoyISO()
      $('#rep-desde', el).value = st.desde; $('#rep-hasta', el).value = st.hasta
      el.querySelectorAll('[data-periodo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      cargar()
    }
    if (e.target.closest('#rep-csv')) {
      if (!st.datos?.serie.length) return aviso('No hay datos para exportar', 'error')
      descargarCSV(`ventas-${st.periodo}`, st.datos.serie, ['periodo', 'total', 'transacciones', 'unidades'])
    }
  })
  el.addEventListener('change', (e) => {
    if (e.target.id === 'rep-desde') { st.desde = e.target.value; cargar() }
    if (e.target.id === 'rep-hasta') { st.hasta = e.target.value; cargar() }
  })

  cargar()
}

/* Barras de una sola serie en SVG propio.
   Una serie → un color, sin leyenda (el título la nombra). Barras finas con
   la punta redondeada y la base recta sobre el eje, 2px de aire entre
   barras, rejilla tenue, y un tooltip por barra con zona de toque de la
   columna entera (no solo de la barra, que en días flojos mide 2px). */
function grafico(caja, serie) {
  const W = 720, H = 240, M = { t: 12, r: 8, b: 28, l: 56 }
  const iw = W - M.l - M.r, ih = H - M.t - M.b
  const max = Math.max(...serie.map((s) => s.total), 1)
  const paso = niceStep(max / 4)
  const tope = Math.ceil(max / paso) * paso
  const y = (v) => M.t + ih - (v / tope) * ih
  const col = iw / serie.length
  const bw = Math.max(2, Math.min(40, col - 2))
  const cada = Math.ceil(serie.length / 10)   // etiquetas del eje x sin pisarse

  const rejilla = []
  for (let v = 0; v <= tope; v += paso) {
    rejilla.push(`<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" class="g-rejilla"/>
      <text x="${M.l - 8}" y="${y(v)}" class="g-eje" text-anchor="end" dominant-baseline="middle">${corto(v)}</text>`)
  }
  const barras = serie.map((s, i) => {
    const x = M.l + i * col + (col - bw) / 2
    const h = Math.max(0, y(0) - y(s.total))
    const r = Math.min(4, bw / 2, h)
    const d = h <= 0 ? '' : `M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + bw - r} Q${x + bw},${y(0) - h} ${x + bw},${y(0) - h + r} V${y(0)} Z`
    const etq = i % cada === 0 ? `<text x="${x + bw / 2}" y="${H - 8}" class="g-eje" text-anchor="middle">${etiquetaX(s.periodo)}</text>` : ''
    return `<g class="g-col" data-i="${i}"><rect x="${M.l + i * col}" y="${M.t}" width="${col}" height="${ih}" class="g-hit"/><path d="${d}" class="g-barra"/>${etq}</g>`
  }).join('')

  // Solo números y fechas generados aquí entran en este SVG; ningún texto
  // del usuario. Por eso es seguro armarlo como cadena.
  caja.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras de ventas por periodo">
    ${rejilla.join('')}<line x1="${M.l}" x2="${W - M.r}" y1="${y(0)}" y2="${y(0)}" class="g-base"/>${barras}</svg>
    <div class="g-tip" hidden></div>`

  const tip = caja.querySelector('.g-tip')
  const mostrar = (g) => {
    const s = serie[g.dataset.i]
    tip.hidden = false
    tip.replaceChildren()
    const t1 = document.createElement('strong'); t1.textContent = s.periodo
    const t2 = document.createElement('span'); t2.textContent = clp(s.total)
    const t3 = document.createElement('span'); t3.textContent = `${s.transacciones} ventas · ${s.unidades} unid.`
    tip.append(t1, t2, t3)
    const rc = g.querySelector('.g-hit').getBoundingClientRect(), rb = caja.getBoundingClientRect()
    const left = Math.min(Math.max(rc.left - rb.left + rc.width / 2, 70), rb.width - 70)
    tip.style.left = `${left}px`
    caja.querySelectorAll('.g-col').forEach((x) => x.classList.toggle('activa', x === g))
  }
  caja.addEventListener('pointerover', (e) => { const g = e.target.closest('.g-col'); if (g) mostrar(g) })
  caja.addEventListener('pointerleave', () => { tip.hidden = true; caja.querySelectorAll('.g-col').forEach((x) => x.classList.remove('activa')) })
}

/* Rellena con cero los días (o meses) sin ventas: un eje de tiempo con
   huecos saltados hace ver consecutivos dos días que no lo son. Semanas y
   años llegan ya en su orden y se dejan como están. */
function continua(serie, st) {
  if (st.periodo !== 'dia' && st.periodo !== 'mes') return serie
  const mapa = new Map(serie.map((s) => [s.periodo, s]))
  const out = []
  const d = new Date(`${st.desde || serie[0].periodo.slice(0, 10)}T12:00:00`)
  const fin = new Date(`${st.hasta || serie.at(-1).periodo.slice(0, 10)}T12:00:00`)
  if (st.periodo === 'mes') d.setDate(1)
  while (d <= fin && out.length < 800) {
    const k = st.periodo === 'dia' ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 7)
    out.push(mapa.get(k) || { periodo: k, total: 0, unidades: 0, transacciones: 0 })
    if (st.periodo === 'dia') d.setDate(d.getDate() + 1)
    else d.setMonth(d.getMonth() + 1)
  }
  return out
}

function niceStep(v) {
  const p = 10 ** Math.floor(Math.log10(v || 1))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p
}
function corto(v) {
  if (v >= 1e6) return `$${(v / 1e6).toLocaleString('es-CL', { maximumFractionDigits: 1 })}M`
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`
  return `$${v}`
}
function etiquetaX(p) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p)
  if (m) return `${m[3]}/${m[2]}`
  return p.replace(/^\d{4}-S/, 'S')
}
