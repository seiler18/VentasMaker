import '../styles/tokens.css'
import '../styles/base.css'
import '../styles/admin.css'
import '../styles/efectos.css'

import { protegerMarco } from '../lib/marco.js'
import { html, pintar, $, $$ } from '../lib/dom.js'
import { aviso, conBoton, panelError, sacudir, vigilarRed } from '../lib/efectos.js'
import { icono } from '../lib/iconos.js'
import { token, onSesionCaducada, onActividad } from '../lib/api.js'
import { demo, llamar, sesion, inventario, perfil } from './estado.js'
import { reiniciarDemo } from './demo.js'

import vender from './vender.js'
import pedidos from './pedidos.js'
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
  { id: 'pedidos', titulo: 'Pedidos', roles: ['admin', 'vendedor'], vista: pedidos },
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
    const err = $('.error-form', f)
    err.textContent = ''
    try {
      const r = await conBoton($('button', f), () => llamar('login', { usuario: f.usuario.value, clave: f.clave.value }))
      if (!r) return
      token.set(r.token)
      Object.assign(sesion, { usuario: r.usuario, nombre: r.nombre, rol: r.rol, debeCambiar: !!r.debeCambiar })
      perfil.guardar()
      aviso(`Hola, ${r.nombre || r.usuario}`)
      entrar()
    } catch (x) {
      err.textContent = x.message
      sacudir(f)
      // Un fallo de red no es una clave mala: no se borra lo escrito.
      if (!x.red) { f.clave.value = ''; f.clave.focus() }
    }
  })
  $('[name=usuario]').focus()
}

/* El armazón y la vista se pintan YA; el inventario llega por detrás y las
   vistas se repintan solas (inventario.alCambiar). Antes se esperaba a la
   hoja con la pantalla en blanco, y Apps Script puede tardar un minuto. */
function entrar() {
  // Clave provisoria: el backend rechaza todo salvo cambiarla, así que el
  // panel solo muestra Ajustes hasta que se cambie.
  if (sesion.debeCambiar) {
    pintarShell()
    irA('ajustes')
    aviso('Tu clave es provisoria: cámbiala para empezar a usar el panel.', 'aviso')
    return
  }
  pintarShell()
  irA(location.hash.slice(1))
  inventario.recargar().catch((err) => {
    if (err.sesion === false) return
    aviso(inventario.hayDatos()
      ? `No se pudo actualizar el inventario (${err.message}) Se usa la copia de hace un rato.`
      : `No se pudo cargar el inventario: ${err.message}`, 'error')
  })
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
        ${sesion.debeCambiar ? '' : html`<a class="btn btn-primario btn-chico ir-catalogo" href="${import.meta.env.BASE_URL}#caja" aria-label="Vender en el catálogo" title="El catálogo como punto de venta: escanea, agrega y finaliza la venta">${icono.carro}<span>Vender en el catálogo</span></a>`}
        <span class="quien">${sesion.nombre || sesion.usuario} · ${sesion.rol}</span>
        ${demo ? html`<button class="btn btn-borde btn-chico" type="button" id="reiniciar-demo">Reiniciar demo</button>` : ''}
        <button class="btn btn-borde btn-chico" type="button" id="salir">${icono.salir} Salir</button>
      </div>
    </header>
    <main class="contenido" id="vista"></main>`)
  $('#salir').addEventListener('click', salir)
  $('#reiniciar-demo')?.addEventListener('click', async (e) => {
    if (!confirm('¿Borrar las ventas y cambios de prueba de este navegador?')) return
    const b = e.currentTarget
    reiniciarDemo()
    await conBoton(b, () => inventario.recargar())
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

function olvidarSesion() {
  token.borrar()
  perfil.borrar()
  inventario.vaciar()
  Object.assign(sesion, { usuario: '', nombre: '', rol: '', debeCambiar: false })
}

async function salir(e) {
  // Se cierra en local aunque el servidor tarde: no se espera más de unos
  // segundos por el logout (el token caduca solo en el servidor).
  const espera = new Promise((r) => setTimeout(r, 4000))
  await conBoton(e.currentTarget, () => Promise.race([llamar('logout').catch(() => {}), espera]))
  olvidarSesion()
  pantallaLogin()
  aviso('Sesión cerrada', 'info')
}

window.addEventListener('hashchange', () => { if (sesion.rol) irA(location.hash.slice(1)) })
onSesionCaducada(() => { olvidarSesion(); pantallaLogin('Tu sesión caducó. Vuelve a entrar.') })

// Tras cambiar la clave provisoria, Ajustes avisa y se entra de verdad.
window.addEventListener('vm:clave-cambiada', () => { sesion.debeCambiar = false; perfil.guardar(); entrar() })

// Cierre de diálogos común a todas las vistas.
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-cerrar]')
  if (c) c.closest('dialog').close()
  else if (e.target.tagName === 'DIALOG' && !e.target.classList.contains('celebra')) e.target.close()
})

/* Con sesión abierta en esta pestaña (recargar, volver atrás): se pinta con
   el perfil guardado y se confirma por detrás. Si el servidor dice que la
   sesión ya no vale, onSesionCaducada lleva al login; si solo falla la red,
   se sigue trabajando con lo guardado y el indicador de red lo cuenta. */
async function arrancar() {
  if (!token.get()) return pantallaLogin()
  const guardado = perfil.leer()
  if (guardado?.rol) {
    Object.assign(sesion, guardado)
    inventario.restaurar()
    entrar()
    llamar('sesion').then((r) => {
      const cambio = r.rol !== sesion.rol || !!r.debeCambiar !== sesion.debeCambiar
      Object.assign(sesion, { usuario: r.usuario, nombre: r.nombre, rol: r.rol, debeCambiar: !!r.debeCambiar })
      perfil.guardar()
      if (cambio) entrar()
    }).catch(() => { /* red: lo cuenta el indicador; caducada: onSesionCaducada */ })
    return
  }
  pintar($('#app'), html`
    <main class="login"><div class="login-caja verificando" role="status">
      <span class="rueda" aria-hidden="true"></span><p>Verificando tu sesión…</p>
    </div></main>`)
  try {
    const r = await llamar('sesion')
    Object.assign(sesion, { usuario: r.usuario, nombre: r.nombre, rol: r.rol, debeCambiar: !!r.debeCambiar })
    perfil.guardar()
    entrar()
  } catch (err) {
    if (err.sesion === false) return   // onSesionCaducada ya mostró el login
    const caja = document.createElement('main')
    caja.className = 'contenido'
    $('#app').replaceChildren(caja)
    panelError(caja, { titulo: 'No pudimos conectar con la tienda', detalle: err.message, reintentar: arrancar })
  }
}

vigilarRed(onActividad)
arrancar().catch((err) => {
  console.error(err)
  aviso(err.message, 'error')
  pantallaLogin()
})
