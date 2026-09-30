/* Iconos en SVG propio en vez de Font Awesome por CDN: son una docena, pesan
   menos que la hoja de estilos de FA y no abren la CSP a otro origen. */
import { crudo } from './dom.js'

const t = (d, extra = '') => crudo(
  `<svg class="icono" viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${extra}>${d}</svg>`)

const trazo = (d) => t(d, 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"')

export const icono = {
  // Cinta de navegación inferior (celular)
  inicio: trazo('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  pedidos: trazo('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"/>'),
  inventario: trazo('<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>'),
  reportes: trazo('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  etiquetas: trazo('<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>'),
  usuarios: trazo('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>'),
  ajustes: trazo('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  puntos: trazo('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  carro: trazo('<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.2a2 2 0 0 0 2 1.6h8.2a2 2 0 0 0 2-1.5L22 7H6"/>'),
  buscar: trazo('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  mas: trazo('<path d="M12 5v14M5 12h14"/>'),
  menos: trazo('<path d="M5 12h14"/>'),
  basura: trazo('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  cerrar: trazo('<path d="M6 6l12 12M18 6 6 18"/>'),
  camara: trazo('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  codigo: trazo('<path d="M4 5v14M7 5v14M11 5v14M14 5v14M17 5v14M20 5v14"/>'),
  rejilla: trazo('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
  lista: trazo('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
  ubicacion: trazo('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  reloj: trazo('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  salir: trazo('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>'),
  editar: trazo('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  imprimir: trazo('<path d="M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z"/>'),
  descargar: trazo('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  foto: trazo('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-8 8"/>'),
  whatsapp: t('<path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.5-.3z"/>'),
}
