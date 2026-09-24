import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/admin.css'

import { protegerMarco } from '../lib/marco.js'
import { html, pintar, $, $$, aviso } from '../lib/dom.js'
import { icono } from '../lib/iconos.js'
import { token, onSesionCaducada } from '../lib/api.js'
import { demo, llamar, sesion, esAdmin, inventario } from './estado.js'
import { reiniciarDemo } from './demo.js'

import vender from './vender.js'
import inventarioVista from './inventario.js'
import reportes from './reportes.js'
import etiquetas from './etiquetas.js'
import usuarios from './usuarios.js'
import ajustes from './ajustes.js'

protegerMarco()

/* Cada pestaña declara qué roles la ven. El backend vuelve a comprobarlo
   en cada acción: ocultar un botón aquí es comodidad, no seguridad. */
const VISTAS = [
  { id: 'vender', titulo: 'Vender', roles: ['admin', 'vendedor'], vista: vender },
  { id: 'inventario', titulo: 'Inventario', roles: ['admin'], vista: inventarioVista },
  { id: 'reportes', titulo: 'Reportes', roles: ['admin'], vista: reportes },
  { id: 'etiquetas', titulo: 'Etiquetas', roles: ['admin'], vista: etiquetas },
  { id: 'usuarios', titulo: 'Usuarios', roles: ['admin'], vista: usuarios },
  { id: 'ajustes', titulo: 'Ajustes', roles: ['admin', 'vendedor'], vista: ajustes },
]

let limpiarVista = null

function pantallaLogin(msg = '') {
  limpiarVista?.(); limpiarVista = null
  pintar($('#app'), html`
    <main class="login">
      <form class="login-caja" id="form-login">
        <img src="${import.meta.env.BASE_URL}img/logo.webp" alt="" width="72" height="72">
        <h1>Panel de la tienda</h1>
        ${demo ? html`<p class="demo-aviso"><strong>Modo demo.</strong> Aún no hay backend conectado: los cambios quedan solo en este navegador. Entra con <code>demo</code> / <code>demo</code>.</p>` : ''}
        <label class="campo"><span>Usuario</span>
          <input class="entrada" name="usuario" autocomplete="username" autocapitalize="none" required maxlength="32"></label>
        <label class="campo"><span>Clave</span>
          <input class="entrada" name="clave" type="password" autocomplete="current-password" required maxlength="128"></label>
        <p class="error-form" role="alert">${msg}</p>
        <button class="btn btn-primario" type="submit">Entrar</button>
        <a class="volver" href="${import.meta.env.BASE_URL}">← Volver al catálogo</a>
      </form>
    </main>`)
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault()
    const f = e.target
    const b = $('button', f)
    b.disabled = true
    try {
      const r = await llamar('login', { usuario: f.usuario.value, clave: f.clave.value })
      token.set(r.token)
      Object.assign(sesion, { usuario: r.usuario, nombre: r.nombre, rol: r.rol, debeCambiar: !!r.debeCambiar })
      await entrar()
    } catch (err) {
      $('.error-form', f).textContent = err.message
      b.disabled = false
      f.clave.value = ''
      f.clave.focus()
    }
  })
  $('[name=usuario]').focus()
}

async function entrar() {
  // Clave provisoria: el backend rechaza todo salvo cambiarla, así que el
  // panel solo muestra Ajustes hasta que se cambie.
  if (sesion.debeCambiar) {
    pintarShell()
    irA('ajustes')
    aviso('Tu clave es provisoria: cámbiala para empezar a usar el panel.', 'error')
    return
  }
  pintar($('#app'), html`<p class="vacio">Cargando inventario…</p>`)
  await inventario.recargar()
  pintarShell()
  irA(location.hash.slice(1))
}

function pintarShell() {
  const visibles = VISTAS.filter((v) => v.roles.includes(sesion.rol) && (!sesion.debeCambiar || v.id === 'ajustes'))
  pintar($('#app'), html`
    <header class="barra">
      <div class="barra-marca">
        <img src="${import.meta.env.BASE_URL}img/logo.webp" alt="" width="36" height="36">
        <span>Panel${demo ? html` <span class="etiqueta etiqueta-aviso">DEMO</span>` : ''}</span>
      </div>
      <nav class="pestanas" aria-label="Secciones">
        ${visibles.map((v) => html`<a href="#${v.id}" data-vista="${v.id}">${v.titulo}</a>`)}
      </nav>
      <div class="barra-usuario">
        <span class="quien">${sesion.nombre || sesion.usuario} · ${sesion.rol}</span>
        ${demo ? html`<button class="btn btn-borde btn-chico" type="button" id="reiniciar-demo">Reiniciar demo</button>` : ''}
        <button class="btn btn-borde btn-chico" type="button" id="salir">${icono.salir} Salir</button>
      </div>
    </header>
    <main class="contenido" id="vista"></main>`)
  $('#salir').addEventListener('click', salir)
  $('#reiniciar-demo')?.addEventListener('click', async () => {
    if (!confirm('¿Borrar las ventas y cambios de prueba de este navegador?')) return
    reiniciarDemo()
    await inventario.recargar()
    irA(location.hash.slice(1))
    aviso('Demo reiniciada')
  })
}

function irA(id) {
  const v = sesion.debeCambiar ? VISTAS.find((x) => x.id === 'ajustes')
    : VISTAS.find((x) => x.id === id && x.roles.includes(sesion.rol)) || VISTAS[0]
  if (location.hash.slice(1) !== v.id) history.replaceState(null, '', `#${v.id}`)
  $$('.pestanas a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.vista === v.id)))
  limpiarVista?.()
  // Contenedor NUEVO por vista: las vistas cuelgan listeners delegados de su
  // raíz, y si se reutilizara la misma, los de "Vender" seguirían vivos en
  // "Etiquetas" (las dos usan .paso-input) y reaccionarían a lo que no es suyo.
  const el = document.createElement('main')
  el.className = 'contenido'
  el.id = 'vista'
  $('#vista').replaceWith(el)
  limpiarVista = v.vista(el) || null
}

async function salir() {
  try { await llamar('logout') } catch { /* igual se cierra en local */ }
  token.borrar()
  Object.assign(sesion, { usuario: '', nombre: '', rol: '', debeCambiar: false })
  pantallaLogin()
}

window.addEventListener('hashchange', () => { if (sesion.rol) irA(location.hash.slice(1)) })
onSesionCaducada(() => pantallaLogin('Tu sesión caducó. Vuelve a entrar.'))

// Tras cambiar la clave provisoria, Ajustes avisa y se entra de verdad.
window.addEventListener('vm:clave-cambiada', () => { sesion.debeCambiar = false; entrar() })

// Cierre de diálogos común a todas las vistas.
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-cerrar]')
  if (c) c.closest('dialog').close()
  else if (e.target.tagName === 'DIALOG') e.target.close()
})

async function arrancar() {
  if (token.get()) {
    try {
      const r = await llamar('sesion')
      Object.assign(sesion, r)
      return await entrar()
    } catch { token.borrar() }
  }
  pantallaLogin()
}

arrancar().catch((err) => {
  console.error(err)
  aviso(err.message, 'error')
  pantallaLogin()
})
