/* Configuración del front.

   API_URL es la URL /exec de la aplicación web de Apps Script (ver README,
   paso 4). NO es un secreto: cualquiera la ve en el navegador. La seguridad
   no depende de esconderla, sino de que todo lo que no es el catálogo pide
   una sesión válida.

   Mientras esté vacía, la tienda funciona en MODO DEMO con la semilla de
   public/data/catalogo.json, y el panel de administración avisa de que no
   hay backend. */
export const API_URL = 'https://script.google.com/macros/s/AKfycbx51GZPYdjC8p0RDV0nBDel1VunKGk-xuU0uFaSUZBH54AmGgWH55JK7kLeqr_ysfj_Zw/exec'

/* Datos de la tienda por defecto. Con backend, los de la hoja Config mandan. */
export const TIENDA = {
  tienda_nombre: 'Ale ventas Alerce',
  tienda_telefono: '56950446613',
  tienda_direccion: 'Pje. Los Tulipanes 1117, Alerce Sur',
  tienda_ciudad: 'Puerto Montt',
  tienda_logo: 'img/logo.webp',
  horario: JSON.stringify({
    lun: '09:00-22:00', mar: '09:00-22:00', mie: '09:00-19:00', jue: '09:00-22:00',
    vie: '09:00-21:00', sab: '09:00-12:00', dom: '',
  }),
  mensaje_whatsapp: 'Hola! Me gustaría realizar un pedido',
  despacho: 'si',
  retiro: 'si',
  mostrar_agotados: 'si',
}
