/* USUARIOS — quién puede entrar al panel.

   admin: todo. vendedor: vender y ver sus ventas del día; no ve costos, no
   ajusta stock, no anula ventas, no aplica descuentos. Estas reglas las
   impone el backend (PERMISOS en Code.gs); aquí solo se administran. */
import { html, crudo, pintar, $, aviso } from '../lib/dom.js'
import { fechaHora } from '../lib/formato.js'
import { icono } from '../lib/iconos.js'
import { llamar, sesion } from './estado.js'

export default function usuarios(el) {
  pintar(el, html`
    <section class="usr">
      <div class="inv-barra"><h2>Usuarios</h2><button class="btn btn-primario" type="button" id="usr-nuevo">${icono.mas} Nuevo usuario</button></div>
      <div class="tabla-envoltura"><table class="tabla">
        <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último ingreso</th><th></th></tr></thead>
        <tbody id="usr-filas"><tr><td colspan="6" class="vacio">Cargando…</td></tr></tbody>
      </table></div>
    </section>
    <dialog id="dlg-usr" aria-labelledby="dlg-usr-t"></dialog>`)

  let lista = []
  async function cargar() {
    try {
      lista = (await llamar('usuarios')).usuarios
      pintar($('#usr-filas', el), lista.map((u) => html`
        <tr data-u="${u.usuario}">
          <td><code>${u.usuario}</code></td><td>${u.nombre}</td><td>${u.rol}</td>
          <td><span class="etiqueta ${u.activo ? 'etiqueta-ok' : 'etiqueta-error'}">${u.activo ? 'Activo' : 'Desactivado'}</span></td>
          <td>${u.ultimo_login ? fechaHora(u.ultimo_login) : '—'}</td>
          <td class="acciones"><button class="btn btn-borde btn-chico" type="button" data-editar>${icono.editar} Editar</button></td>
        </tr>`))
    } catch (err) { aviso(err.message, 'error') }
  }

  function ficha(u) {
    const nuevo = !u
    u ||= { usuario: '', nombre: '', rol: 'vendedor', activo: true }
    const propio = u.usuario === sesion.usuario
    const d = $('#dlg-usr')
    pintar(d, html`
      <div class="dialogo-cab"><h2 id="dlg-usr-t">${nuevo ? 'Nuevo usuario' : u.usuario}</h2>
        <button class="btn btn-icono" type="button" data-cerrar aria-label="Cerrar">${icono.cerrar}</button></div>
      <form class="dialogo-cuerpo" id="form-usr" novalidate>
        <label class="campo"><span>Usuario (para entrar)</span>
          <input class="entrada" name="usuario" required pattern="[a-z0-9._-]{3,32}" maxlength="32" autocapitalize="none" value="${u.usuario}" ${crudo(nuevo ? '' : 'readonly')}></label>
        <label class="campo"><span>Nombre</span><input class="entrada" name="nombre" maxlength="60" value="${u.nombre}"></label>
        <label class="campo"><span>Rol</span><select class="entrada" name="rol" ${crudo(propio ? 'disabled' : '')}>
          <option value="vendedor" ${crudo(u.rol === 'vendedor' ? 'selected' : '')}>Vendedor — solo vender</option>
          <option value="admin" ${crudo(u.rol === 'admin' ? 'selected' : '')}>Admin — todo</option></select></label>
        <label class="campo"><span>${nuevo ? 'Clave' : 'Nueva clave (vacío = no cambiar)'}</span>
          <input class="entrada" name="clave" type="password" autocomplete="new-password" minlength="10" maxlength="128"></label>
        <p class="ayuda">Mínimo 10 caracteres, con letras y números. Es una clave provisoria: la persona deberá cambiarla al entrar. Cualquier cambio aquí cierra sus sesiones abiertas.</p>
        ${propio ? '' : html`<label class="casilla"><input type="checkbox" name="activo" ${crudo(u.activo ? 'checked' : '')}> Activo (puede entrar)</label>`}
        <p class="error-form" role="alert" id="err-usr"></p>
      </form>
      <div class="dialogo-pie"><button class="btn btn-borde" type="button" data-cerrar>Cancelar</button>
        <button class="btn btn-primario" type="submit" form="form-usr">Guardar</button></div>`)
    d.showModal()
    $('#form-usr', d).addEventListener('submit', async (e) => {
      e.preventDefault()
      const fd = new FormData(e.target)
      const datos = {
        nuevo, usuario: String(fd.get('usuario')).trim().toLowerCase(), nombre: fd.get('nombre'),
        rol: propio ? u.rol : fd.get('rol'), activo: propio ? true : fd.get('activo') === 'on', clave: fd.get('clave') || undefined,
      }
      const err = $('#err-usr', d)
      if (!/^[a-z0-9._-]{3,32}$/.test(datos.usuario)) return (err.textContent = 'Usuario: 3 a 32 letras minúsculas, números, punto o guion.')
      if ((nuevo || datos.clave) && (String(datos.clave || '').length < 10 || !/[a-zA-Z]/.test(datos.clave) || !/\d/.test(datos.clave))) {
        return (err.textContent = 'La clave debe tener al menos 10 caracteres, con letras y números.')
      }
      try {
        await llamar('guardarUsuario', { usuario: datos })
        d.close(); aviso('Usuario guardado'); cargar()
      } catch (x) { err.textContent = x.message }
    })
  }

  $('#usr-nuevo', el).addEventListener('click', () => ficha(null))
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-editar]')) ficha(lista.find((u) => u.usuario === e.target.closest('[data-u]').dataset.u))
  })
  cargar()
}
