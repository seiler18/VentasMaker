/* AJUSTES — datos de la tienda (los que ve el catálogo) y la clave propia. */
import { html, crudo, pintar, $ } from '../lib/dom.js'
import { aviso, conBoton, celebrar, panelError, sacudir } from '../lib/efectos.js'
import { leerHorario } from '../lib/horario.js'
import { llamar, esAdmin, demo, sesion } from './estado.js'
import { token } from '../lib/api.js'
import { TIENDA } from '../config.js'

const DIAS = [['lun', 'Lunes'], ['mar', 'Martes'], ['mie', 'Miércoles'], ['jue', 'Jueves'], ['vie', 'Viernes'], ['sab', 'Sábado'], ['dom', 'Domingo']]

export default function ajustes(el) {
  pintar(el, html`
    <section class="ajustes">
      ${esAdmin() && !sesion.debeCambiar ? html`<div class="panel-bloque" id="bloque-tienda"><span class="linea-esq corta"></span><span class="bloque-esq"></span></div>` : ''}
      <div class="panel-bloque">
        <h2>Cambiar mi clave</h2>
        <form class="form-grid" id="form-clave">
          <label class="campo"><span>Clave actual</span><input class="entrada" name="actual" type="password" autocomplete="current-password" required></label>
          <p class="ayuda ancho">Mínimo 10 caracteres, con letras y números.</p>
          <label class="campo"><span>Clave nueva</span><input class="entrada" name="nueva" type="password" autocomplete="new-password" minlength="10" required></label>
          <label class="campo"><span>Repite la clave nueva</span><input class="entrada" name="repite" type="password" autocomplete="new-password" minlength="10" required></label>
          <button class="btn btn-primario" type="submit">Cambiar clave</button>
        </form>
      </div>
    </section>`)

  $('#form-clave', el).addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = e.target
    if (f.nueva.value !== f.repite.value) { sacudir(f.repite); return aviso('Las claves nuevas no coinciden', 'error') }
    try {
      const r = await conBoton($('[type=submit]', f), () => llamar('cambiarClave', { actual: f.actual.value, nueva: f.nueva.value }))
      if (!r) return
      // El backend cerró todas las sesiones de la cuenta y devuelve una nueva.
      if (r.token) token.set(r.token)
      f.reset()
      await celebrar({ titulo: 'Clave cambiada', detalle: 'Las demás sesiones de tu cuenta se cerraron.' })
      if (sesion.debeCambiar) window.dispatchEvent(new Event('vm:clave-cambiada'))
    } catch (err) { aviso(err.message, 'error') }
  })

  if (esAdmin() && !sesion.debeCambiar) cargarTienda()

  async function cargarTienda() {
    const caja = $('#bloque-tienda', el)
    let cfg
    try { cfg = { ...TIENDA, ...(await llamar('config')).config } } catch (err) {
      if (caja.isConnected) panelError(caja, { compacto: true, titulo: 'No se pudieron cargar los datos de la tienda', detalle: err.message, reintentar: cargarTienda })
      return
    }
    const hor = leerHorario(cfg.horario)
    pintar(caja, html`
      <h2>Datos de la tienda</h2>
      <p class="ayuda">Lo que aparece en el catálogo público. ${demo ? 'En modo demo no se publica.' : 'Los cambios se ven en el catálogo en unos minutos.'}</p>
      <form class="form-grid" id="form-tienda">
        <label class="campo"><span>Nombre</span><input class="entrada" name="tienda_nombre" maxlength="80" value="${cfg.tienda_nombre}"></label>
        <label class="campo"><span>WhatsApp (con código de país, solo números)</span><input class="entrada" name="tienda_telefono" inputmode="tel" pattern="\\d{9,15}" maxlength="15" value="${cfg.tienda_telefono}"></label>
        <label class="campo"><span>Dirección</span><input class="entrada" name="tienda_direccion" maxlength="140" value="${cfg.tienda_direccion}"></label>
        <label class="campo"><span>Ciudad</span><input class="entrada" name="tienda_ciudad" maxlength="60" value="${cfg.tienda_ciudad}"></label>
        <label class="campo ancho"><span>Mensaje inicial del pedido por WhatsApp</span><input class="entrada" name="mensaje_whatsapp" maxlength="200" value="${cfg.mensaje_whatsapp}"></label>
        <fieldset class="horario ancho"><legend>Horario (vacío = cerrado)</legend>
          ${DIAS.map(([k, n]) => {
            const [a = '', c = ''] = (hor[k] || '').split('-')
            return html`<div class="horario-dia"><span>${n}</span>
              <input class="entrada" type="time" name="h_${k}_a" value="${a}" aria-label="${n} abre">
              <input class="entrada" type="time" name="h_${k}_c" value="${c}" aria-label="${n} cierra"></div>`
          })}
        </fieldset>
        <label class="casilla"><input type="checkbox" name="retiro" ${crudo(cfg.retiro !== 'no' ? 'checked' : '')}> Ofrecer retiro en tienda</label>
        <label class="casilla"><input type="checkbox" name="despacho" ${crudo(cfg.despacho !== 'no' ? 'checked' : '')}> Ofrecer despacho a domicilio</label>
        <label class="casilla ancho"><input type="checkbox" name="mostrar_agotados" ${crudo(cfg.mostrar_agotados !== 'no' ? 'checked' : '')}> Mostrar productos agotados en el catálogo (con aviso)</label>
        <label class="campo ancho"><span>Correo para el reporte diario de ventas (vacío = no enviar)</span><input class="entrada" name="email_reporte" type="email" maxlength="120" value="${cfg.email_reporte || ''}"></label>
        <button class="btn btn-primario" type="submit">Guardar datos</button>
      </form>`)
    $('#form-tienda', caja).addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(e.target)
      const horario = {}
      DIAS.forEach(([k]) => {
        const a = fd.get(`h_${k}_a`), c = fd.get(`h_${k}_c`)
        horario[k] = a && c ? `${a}-${c}` : ''
      })
      const tel = String(fd.get('tienda_telefono')).replace(/\D/g, '')
      if (tel.length < 9) { sacudir(e.target.tienda_telefono); return aviso('Revisa el número de WhatsApp (ej. 56912345678)', 'error') }
      try {
        await conBoton($('[type=submit]', e.target), () => llamar('guardarConfig', { config: {
          tienda_nombre: fd.get('tienda_nombre'), tienda_telefono: tel, tienda_direccion: fd.get('tienda_direccion'),
          tienda_ciudad: fd.get('tienda_ciudad'), mensaje_whatsapp: fd.get('mensaje_whatsapp'), horario: JSON.stringify(horario),
          retiro: fd.get('retiro') ? 'si' : 'no', despacho: fd.get('despacho') ? 'si' : 'no',
          mostrar_agotados: fd.get('mostrar_agotados') ? 'si' : 'no', email_reporte: fd.get('email_reporte'),
        } }))
        aviso(demo ? 'Datos guardados (solo en este navegador)' : 'Datos guardados · ya se ven en el catálogo')
      } catch (err) { aviso(err.message, 'error') }
    })
  }
}
