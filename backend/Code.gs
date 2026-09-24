/* ============================================================
   VentasMaker — backend en Google Apps Script

   La hoja de cálculo ES la base de datos. Este script se publica como
   aplicación web y el front (GitHub Pages) le habla por fetch:

     GET  ?accion=catalogo        → catálogo público (sin costo ni datos internos)
     POST {accion, token, ...}    → todo lo demás; exige sesión salvo `login`

   Por qué POST con Content-Type text/plain: es una "petición simple" para
   CORS, así que el navegador no manda preflight OPTIONS — que Apps Script no
   sabe contestar. El cuerpo sigue siendo JSON.

   SEGURIDAD (ver SECURITY.md en el repo):
   - Las claves se guardan como HMAC-SHA256 iterado con sal por usuario y un
     "pimiento" que vive en las Propiedades del script, NO en la hoja: quien
     vea la hoja no puede probar claves sin ese valor.
   - La sesión es un token aleatorio que viaja en el cuerpo (nunca en la URL,
     que queda en los registros). En el servidor solo se guarda su hash, en
     CacheService, con caducidad.
   - Intentos de login limitados por usuario.
   - Todo lo que se escribe en la hoja pasa por `celda_()`, que neutraliza la
     inyección de fórmulas (=, +, -, @ al inicio).
   - Las escrituras van dentro de LockService para que dos ventas simultáneas
     no descuenten sobre el mismo stock leído.
   - El precio de una venta lo pone el SERVIDOR con el de la hoja; el front
     solo manda id y cantidad.
   ============================================================ */

const HOJAS = {
  productos: ['id', 'sku', 'codigo', 'nombre', 'descripcion', 'categoria', 'precio', 'costo',
              'stock', 'stock_minimo', 'visible', 'imagen', 'creado', 'actualizado'],
  ventas:    ['venta_id', 'fecha', 'usuario', 'producto_id', 'sku', 'nombre', 'cantidad',
              'precio_unit', 'descuento', 'subtotal', 'medio_pago', 'canal', 'nota', 'anulada'],
  movimientos: ['fecha', 'usuario', 'producto_id', 'nombre', 'tipo', 'delta', 'stock_final', 'nota'],
  usuarios:  ['usuario', 'nombre', 'rol', 'sal', 'hash', 'activo', 'creado', 'ultimo_login', 'debe_cambiar'],
  config:    ['clave', 'valor'],
  registro:  ['fecha', 'usuario', 'accion', 'detalle'],
};
const NOMBRE_HOJA = {
  productos: 'Productos', ventas: 'Ventas', movimientos: 'Movimientos',
  usuarios: 'Usuarios', config: 'Config', registro: 'Registro',
};

const ROLES = ['admin', 'vendedor'];
const SESION_SEG = 6 * 60 * 60;        // máximo que admite CacheService
const MAX_FALLOS = 5;                  // intentos de login antes del bloqueo
const BLOQUEO_SEG = 15 * 60;
const ITERACIONES = 2000;              // HMAC encadenado: frena la fuerza bruta
const MAX_IMG_BYTES = 1.5 * 1024 * 1024;
const MEDIOS_PAGO = ['efectivo', 'debito', 'credito', 'transferencia', 'otro'];
const LOGINS_POR_MINUTO = 20;          // freno global: ver login_
const MAX_REGISTRO = 5000;             // filas de Registro que se conservan

/* Qué puede hacer cada rol. Lo que no aparece aquí no existe. */
const PERMISOS = {
  sesion:          ['admin', 'vendedor'],
  logout:          ['admin', 'vendedor'],
  cambiarClave:    ['admin', 'vendedor'],
  productos:       ['admin', 'vendedor'],
  buscarCodigo:    ['admin', 'vendedor'],
  vender:          ['admin', 'vendedor'],
  ventasDelDia:    ['admin', 'vendedor'],
  guardarProducto: ['admin'],
  eliminarProducto:['admin'],
  ajustarStock:    ['admin'],
  subirImagen:     ['admin'],
  anularVenta:     ['admin'],
  reporte:         ['admin'],
  movimientos:     ['admin'],
  usuarios:        ['admin'],
  guardarUsuario:  ['admin'],
  config:          ['admin'],
  guardarConfig:   ['admin'],
};

/* Claves de Config que el catálogo público puede ver. El resto (correo del
   reporte, etc.) no sale nunca por el GET. */
const CONFIG_PUBLICA = ['tienda_nombre', 'tienda_telefono', 'tienda_direccion', 'tienda_ciudad',
                        'tienda_logo', 'horario', 'mensaje_whatsapp', 'despacho', 'retiro',
                        'mostrar_agotados'];

/* ============================================================
   ENTRADA HTTP
   ============================================================ */

function doGet(e) {
  try {
    const accion = (e && e.parameter && e.parameter.accion) || 'catalogo';
    if (accion !== 'catalogo') return json_({ ok: false, error: 'Acción no válida' });
    return json_({ ok: true, ...catalogoPublico_() });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'Error interno' });
  }
}

function doPost(e) {
  let body;
  try {
    if (!e || !e.postData || e.postData.contents.length > 4 * 1024 * 1024) {
      return json_({ ok: false, error: 'Petición no válida' });
    }
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'JSON no válido' });
  }
  try {
    const accion = String(body.accion || '');
    if (accion === 'login') return json_(login_(body));

    if (!Object.prototype.hasOwnProperty.call(PERMISOS, accion)) {
      return json_({ ok: false, error: 'Acción no válida' });
    }
    const ses = sesion_(body.token);
    if (!ses) return json_({ ok: false, error: 'Sesión caducada', sesion: false });
    // Con clave provisoria (la inicial, o una que puso un admin) solo se
    // puede cambiarla: nadie más que el dueño de la cuenta debe conocer la
    // clave con la que se trabaja.
    if (ses.debe && ['sesion', 'logout', 'cambiarClave'].indexOf(accion) === -1) {
      return json_({ ok: false, error: 'Debes cambiar tu clave antes de seguir', debeCambiar: true });
    }
    if (PERMISOS[accion].indexOf(ses.rol) === -1) {
      registrar_(ses.usuario, 'denegado', accion);
      return json_({ ok: false, error: 'No tienes permiso para esto' });
    }
    return json_({ ok: true, ...ACCIONES[accion](body, ses) });
  } catch (err) {
    // Los errores "de usuario" se lanzan con ErrorVisible y su texto se
    // devuelve tal cual. Cualquier otro puede llevar detalles internos
    // (nombres de hoja, trazas), así que al cliente solo le llega un genérico.
    if (err instanceof ErrorVisible) return json_({ ok: false, error: err.message });
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'Error interno' });
  }
}

class ErrorVisible extends Error {}
function falla_(msg) { throw new ErrorVisible(msg); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ============================================================
   ACCIONES
   ============================================================ */

const ACCIONES = {
  sesion: (b, ses) => ({ usuario: ses.usuario, nombre: ses.nombre, rol: ses.rol, debeCambiar: !!ses.debe }),

  logout: (b) => {
    CacheService.getScriptCache().remove('ses_' + sha256_(String(b.token)));
    return {};
  },

  cambiarClave: (b, ses) => {
    const actual = String(b.actual || ''), nueva = String(b.nueva || '');
    validarClave_(nueva);
    const tabla = leer_('usuarios');
    const fila = tabla.filas.find(u => u.usuario === ses.usuario);
    if (!fila || !claveCorrecta_(actual, fila)) falla_('La clave actual no es correcta');
    if (claveCorrecta_(nueva, fila)) falla_('La clave nueva debe ser distinta de la actual');
    const sal = aleatorio_();
    conBloqueo_(() => actualizarFila_('usuarios', fila._fila, { sal: sal, hash: hashClave_(nueva, sal), debe_cambiar: false }));
    // Cierra TODAS las sesiones de la cuenta (un token robado no sobrevive al
    // cambio de clave) y abre una nueva para quien acaba de cambiarla.
    cerrarSesiones_(ses.usuario);
    registrar_(ses.usuario, 'cambiarClave', '');
    return { token: abrirSesion_({ usuario: ses.usuario, nombre: ses.nombre, rol: ses.rol, debe: false }) };
  },

  productos: (b, ses) => {
    const filas = leer_('productos').filas.map(limpiarProducto_);
    // El costo es dato de gestión: el vendedor no lo necesita para vender.
    if (ses.rol !== 'admin') filas.forEach(p => delete p.costo);
    return { productos: filas };
  },

  buscarCodigo: (b, ses) => {
    const cod = normCodigo_(b.codigo);
    if (!cod) falla_('Código vacío');
    const p = leer_('productos').filas.find(x =>
      normCodigo_(x.codigo) === cod || normCodigo_(x.sku) === cod);
    if (!p) return { producto: null };
    const r = limpiarProducto_(p);
    if (ses.rol !== 'admin') delete r.costo;
    return { producto: r };
  },

  vender: (b, ses) => {
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length || items.length > 200) falla_('La venta no tiene productos');
    const medio = MEDIOS_PAGO.indexOf(b.medioPago) >= 0 ? b.medioPago : 'efectivo';
    const canal = b.canal === 'whatsapp' ? 'whatsapp' : 'local';
    const descuentoTotal = entero_(b.descuento, 0);
    if (descuentoTotal < 0) falla_('Descuento no válido');
    if (descuentoTotal > 0 && ses.rol !== 'admin') falla_('Solo un admin puede aplicar descuentos');

    return conBloqueo_(() => {
      // Se lee DENTRO del bloqueo: si se leyera antes, dos ventas simultáneas
      // verían el mismo stock y ambas lo darían por disponible.
      const tabla = leer_('productos');
      const porId = {};
      tabla.filas.forEach(p => porId[p.id] = p);

      // Agrupa por producto: el mismo código escaneado dos veces es una línea.
      const cant = {};
      items.forEach(it => {
        const id = String(it.id || '');
        const c = entero_(it.cantidad, 0);
        if (!porId[id]) falla_('Producto no encontrado');
        if (c <= 0 || c > 1000) falla_('Cantidad no válida');
        cant[id] = (cant[id] || 0) + c;
      });
      Object.keys(cant).forEach(id => {
        // "!(x >= c)" y no "x < c": si alguien escribió texto en la celda de
        // stock, Number() da NaN, "NaN < c" es falso y la venta pasaría.
        if (!(Number(porId[id].stock) >= cant[id])) {
          falla_('Stock insuficiente: ' + porId[id].nombre + ' (quedan ' + porId[id].stock + ')');
        }
      });

      Object.keys(cant).forEach(id => {
        const pr = Number(porId[id].precio);
        if (!Number.isFinite(pr) || pr < 0) falla_('Precio no válido en la hoja: ' + porId[id].nombre);
      });
      const total = Object.keys(cant).reduce((s, id) => s + cant[id] * Number(porId[id].precio), 0);
      if (descuentoTotal > total) falla_('El descuento supera el total');

      const ventaId = 'V' + Utilities.formatDate(new Date(), zona_(), 'yyMMddHHmmss') + '-' +
                      aleatorio_().slice(0, 4).toUpperCase();
      const ahora = new Date();
      const filasVenta = [], filasMov = [];
      let descRestante = descuentoTotal;
      const ids = Object.keys(cant);
      ids.forEach((id, i) => {
        const p = porId[id];
        const bruto = cant[id] * Number(p.precio);
        // El descuento se reparte proporcional; el último absorbe el redondeo
        // para que la suma de subtotales sea exactamente total − descuento.
        const d = i === ids.length - 1 ? descRestante : Math.round(descuentoTotal * bruto / (total || 1));
        descRestante -= d;
        const stockFinal = Number(p.stock) - cant[id];
        actualizarFila_('productos', p._fila, { stock: stockFinal, actualizado: ahora });
        p.stock = stockFinal;
        filasVenta.push([ventaId, ahora, ses.usuario, id, p.sku, p.nombre, cant[id], Number(p.precio),
                         d, bruto - d, medio, canal, texto_(b.nota, 200), false]);
        filasMov.push([ahora, ses.usuario, id, p.nombre, 'venta', -cant[id], stockFinal, ventaId]);
      });
      agregar_('ventas', filasVenta);
      agregar_('movimientos', filasMov);
      invalidarCatalogo_();
      return {
        ventaId: ventaId,
        total: total - descuentoTotal,
        stock: ids.map(id => ({ id: id, stock: porId[id].stock })),
      };
    });
  },

  ventasDelDia: (b, ses) => {
    const hoy = Utilities.formatDate(new Date(), zona_(), 'yyyy-MM-dd');
    const filas = leer_('ventas').filas.filter(v =>
      Utilities.formatDate(new Date(v.fecha), zona_(), 'yyyy-MM-dd') === hoy &&
      (ses.rol === 'admin' || v.usuario === ses.usuario));
    return { ventas: agruparVentas_(filas) };
  },

  anularVenta: (b, ses) => {
    const ventaId = String(b.ventaId || '');
    return conBloqueo_(() => {
      const ventas = leer_('ventas').filas.filter(v => v.venta_id === ventaId);
      if (!ventas.length) falla_('Venta no encontrada');
      if (ventas.some(v => si_(v.anulada))) falla_('La venta ya estaba anulada');
      const prods = leer_('productos');
      const ahora = new Date();
      const mov = [];
      ventas.forEach(v => {
        actualizarFila_('ventas', v._fila, { anulada: true });
        const p = prods.filas.find(x => x.id === v.producto_id);
        if (p) {
          const st = Number(p.stock) + Number(v.cantidad);
          actualizarFila_('productos', p._fila, { stock: st, actualizado: ahora });
          p.stock = st;
          mov.push([ahora, ses.usuario, p.id, p.nombre, 'anulacion', Number(v.cantidad), st, ventaId]);
        }
      });
      if (mov.length) agregar_('movimientos', mov);
      registrar_(ses.usuario, 'anularVenta', ventaId);
      invalidarCatalogo_();
      return {};
    });
  },

  guardarProducto: (b, ses) => {
    const d = b.producto || {};
    const nombre = texto_(d.nombre, 120);
    if (!nombre) falla_('El nombre es obligatorio');
    const precio = entero_(d.precio, -1);
    if (precio < 0) falla_('Precio no válido');
    const datos = {
      nombre: nombre,
      descripcion: texto_(d.descripcion, 1000),
      categoria: texto_(d.categoria, 60),
      codigo: texto_(d.codigo, 64),
      precio: precio,
      costo: Math.max(0, entero_(d.costo, 0)),
      stock_minimo: Math.max(0, entero_(d.stock_minimo, 0)),
      visible: d.visible !== false,
      imagen: urlImagen_(d.imagen),
      actualizado: new Date(),
    };
    return conBloqueo_(() => {
      const tabla = leer_('productos');
      if (datos.codigo) {
        const dup = tabla.filas.find(p => normCodigo_(p.codigo) === normCodigo_(datos.codigo) && p.id !== d.id);
        if (dup) falla_('Ese código ya lo tiene: ' + dup.nombre);
      }
      if (d.id) {
        const p = tabla.filas.find(x => x.id === String(d.id));
        if (!p) falla_('Producto no encontrado');
        // El stock NO se cambia desde aquí: va por ajustarStock para que
        // quede en Movimientos quién lo tocó y por qué.
        actualizarFila_('productos', p._fila, datos);
        registrar_(ses.usuario, 'editarProducto', p.id + ' ' + nombre);
        invalidarCatalogo_();
        return { id: p.id };
      }
      const id = Utilities.getUuid();
      const sku = siguienteSku_(tabla.filas);
      const stock = Math.max(0, entero_(d.stock, 0));
      const fila = Object.assign({ id: id, sku: sku, stock: stock, creado: new Date() }, datos);
      agregar_('productos', [HOJAS.productos.map(c => fila[c] === undefined ? '' : fila[c])]);
      if (stock) agregar_('movimientos', [[new Date(), ses.usuario, id, nombre, 'ingreso', stock, stock, 'alta de producto']]);
      registrar_(ses.usuario, 'crearProducto', id + ' ' + nombre);
      invalidarCatalogo_();
      return { id: id, sku: sku };
    });
  },

  eliminarProducto: (b, ses) => {
    // No se borra la fila: las ventas pasadas la referencian. Se oculta.
    return conBloqueo_(() => {
      const p = leer_('productos').filas.find(x => x.id === String(b.id));
      if (!p) falla_('Producto no encontrado');
      actualizarFila_('productos', p._fila, { visible: false, actualizado: new Date() });
      registrar_(ses.usuario, 'ocultarProducto', p.id + ' ' + p.nombre);
      invalidarCatalogo_();
      return {};
    });
  },

  ajustarStock: (b, ses) => {
    const tipo = ['ingreso', 'ajuste', 'merma'].indexOf(b.tipo) >= 0 ? b.tipo : 'ajuste';
    return conBloqueo_(() => {
      const p = leer_('productos').filas.find(x => x.id === String(b.id));
      if (!p) falla_('Producto no encontrado');
      const actual = Number(p.stock) || 0;
      let final;
      if (b.nuevo !== undefined && b.nuevo !== null && b.nuevo !== '') final = entero_(b.nuevo, -1);
      else final = actual + entero_(b.delta, 0);
      if (final < 0 || final > 1000000) falla_('Stock no válido');
      if (final === actual) return { stock: actual };
      actualizarFila_('productos', p._fila, { stock: final, actualizado: new Date() });
      agregar_('movimientos', [[new Date(), ses.usuario, p.id, p.nombre, tipo, final - actual, final, texto_(b.nota, 200)]]);
      invalidarCatalogo_();
      return { stock: final };
    });
  },

  subirImagen: (b, ses) => {
    const tipo = String(b.tipo || '');
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(tipo) === -1) falla_('Formato de imagen no permitido');
    const bytes = Utilities.base64Decode(String(b.base64 || ''));
    if (!bytes.length || bytes.length > MAX_IMG_BYTES) falla_('Imagen vacía o demasiado grande');
    // Comprobación por "número mágico": que el tipo declarado sea verdad.
    if (!esImagen_(bytes, tipo)) falla_('El archivo no es una imagen válida');
    const carpeta = carpetaImagenes_();
    const archivo = carpeta.createFile(Utilities.newBlob(bytes, tipo, 'p_' + Date.now() + '.' + tipo.split('/')[1]));
    archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    registrar_(ses.usuario, 'subirImagen', archivo.getId());
    return { url: 'https://lh3.googleusercontent.com/d/' + archivo.getId() + '=w800' };
  },

  reporte: (b) => reporte_(String(b.periodo || 'dia'), b.desde, b.hasta),

  movimientos: (b) => {
    const id = b.id ? String(b.id) : '';
    let filas = leer_('movimientos').filas;
    if (id) filas = filas.filter(m => m.producto_id === id);
    return { movimientos: filas.slice(-300).reverse().map(sinFila_) };
  },

  usuarios: () => ({
    usuarios: leer_('usuarios').filas.map(u => ({
      usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: si_(u.activo),
      ultimo_login: u.ultimo_login,
    })),
  }),

  guardarUsuario: (b, ses) => {
    const d = b.usuario || {};
    const usuario = String(d.usuario || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(usuario)) falla_('Usuario: 3 a 32 letras, números, punto o guion');
    const rol = ROLES.indexOf(d.rol) >= 0 ? d.rol : 'vendedor';
    return conBloqueo_(() => {
      const tabla = leer_('usuarios');
      const fila = tabla.filas.find(u => u.usuario === usuario);
      // Alta y edición separadas: si no, escribir en "Nuevo usuario" un nombre
      // que ya existe le cambiaría la clave y el rol a otra persona.
      if (d.nuevo === true && fila) falla_('Ese usuario ya existe');
      if (d.nuevo !== true && !fila) falla_('Usuario no encontrado');
      const cambios = { nombre: texto_(d.nombre, 60), rol: rol, activo: d.activo !== false };
      if (d.clave) {
        validarClave_(String(d.clave));
        cambios.sal = aleatorio_();
        cambios.hash = hashClave_(String(d.clave), cambios.sal);
        // Clave puesta por otra persona = provisoria.
        cambios.debe_cambiar = usuario !== ses.usuario;
      }
      if (fila) {
        // Que el último admin activo no pueda quitarse a sí mismo el acceso.
        if (usuario === ses.usuario && (rol !== 'admin' || cambios.activo === false)) {
          falla_('No puedes quitarte el rol admin ni desactivarte a ti mismo');
        }
        actualizarFila_('usuarios', fila._fila, cambios);
        // El rol y el estado viajan dentro de la sesión: cualquier cambio a
        // otra cuenta la obliga a volver a entrar con los permisos nuevos.
        if (usuario !== ses.usuario || cambios.hash) cerrarSesiones_(usuario);
      } else {
        if (!d.clave) falla_('Un usuario nuevo necesita clave');
        const n = Object.assign({ usuario: usuario, creado: new Date(), ultimo_login: '' }, cambios);
        agregar_('usuarios', [HOJAS.usuarios.map(c => n[c] === undefined ? '' : n[c])]);
      }
      registrar_(ses.usuario, 'guardarUsuario', usuario + ' rol=' + rol);
      return {};
    });
  },

  config: () => ({ config: leerConfig_() }),

  guardarConfig: (b, ses) => {
    const permitidas = CONFIG_PUBLICA.concat(['email_reporte']);
    const datos = b.config || {};
    conBloqueo_(() => {
      const tabla = leer_('config');
      Object.keys(datos).forEach(k => {
        if (permitidas.indexOf(k) === -1) return;
        const v = texto_(datos[k], 2000);
        const fila = tabla.filas.find(f => f.clave === k);
        if (fila) actualizarFila_('config', fila._fila, { valor: v });
        else agregar_('config', [[k, celda_(v)]]);
      });
    });
    registrar_(ses.usuario, 'guardarConfig', Object.keys(datos).join(','));
    invalidarCatalogo_();
    return {};
  },
};

/* ============================================================
   CATÁLOGO PÚBLICO
   ============================================================ */

function catalogoPublico_() {
  const cache = CacheService.getScriptCache();
  const partes = cache.get('cat_n');
  if (partes) {
    // CacheService admite 100 KB por clave; el catálogo se guarda troceado.
    const claves = [];
    for (let i = 0; i < Number(partes); i++) claves.push('cat_' + i);
    const t = cache.getAll(claves);
    if (claves.every(k => t[k])) return JSON.parse(claves.map(k => t[k]).join(''));
  }
  const cfg = leerConfig_();
  const mostrarAgotados = cfg.mostrar_agotados !== 'no';
  const productos = leer_('productos').filas
    .filter(p => si_(p.visible) && (mostrarAgotados || Number(p.stock) > 0))
    .map(p => ({
      id: p.id, sku: p.sku, nombre: p.nombre, descripcion: p.descripcion, categoria: p.categoria,
      precio: Number(p.precio) || 0, stock: Number(p.stock) || 0, imagen: p.imagen,
      creado: p.creado ? new Date(p.creado).getTime() : 0,
    }));
  const tienda = {};
  CONFIG_PUBLICA.forEach(k => { if (cfg[k] !== undefined) tienda[k] = cfg[k]; });
  const res = { tienda: tienda, productos: productos };
  const txt = JSON.stringify(res);
  const trozo = 90000, obj = {};
  let n = 0;
  for (let i = 0; i < txt.length; i += trozo) obj['cat_' + (n++)] = txt.slice(i, i + trozo);
  obj.cat_n = String(n);
  try { cache.putAll(obj, 300); } catch (e) { /* sin caché: se sirve igual */ }
  return res;
}

function invalidarCatalogo_() {
  CacheService.getScriptCache().remove('cat_n');
}

/* ============================================================
   REPORTES
   ============================================================ */

function reporte_(periodo, desde, hasta) {
  const z = zona_();
  const clave = {
    dia:    f => Utilities.formatDate(f, z, 'yyyy-MM-dd'),
    semana: f => semanaIso_(f),
    mes:    f => Utilities.formatDate(f, z, 'yyyy-MM'),
    anio:   f => Utilities.formatDate(f, z, 'yyyy'),
  }[periodo];
  if (!clave) falla_('Periodo no válido');
  const d0 = desde ? new Date(desde + 'T00:00:00') : null;
  const d1 = hasta ? new Date(hasta + 'T23:59:59') : null;
  const ventas = leer_('ventas').filas.filter(v => {
    if (si_(v.anulada)) return false;
    const f = new Date(v.fecha);
    return (!d0 || f >= d0) && (!d1 || f <= d1);
  });
  const serie = {}, top = {}, medios = {}, idsVenta = {};
  ventas.forEach(v => {
    const k = clave(new Date(v.fecha));
    const s = serie[k] || (serie[k] = { periodo: k, total: 0, unidades: 0, ventas: {} });
    s.total += Number(v.subtotal) || 0;
    s.unidades += Number(v.cantidad) || 0;
    s.ventas[v.venta_id] = 1;
    const t = top[v.producto_id] || (top[v.producto_id] = { id: v.producto_id, nombre: v.nombre, unidades: 0, total: 0 });
    t.unidades += Number(v.cantidad) || 0;
    t.total += Number(v.subtotal) || 0;
    medios[v.medio_pago] = (medios[v.medio_pago] || 0) + (Number(v.subtotal) || 0);
    idsVenta[v.venta_id] = 1;
  });
  const filas = Object.keys(serie).sort().map(k => ({
    periodo: k, total: serie[k].total, unidades: serie[k].unidades,
    transacciones: Object.keys(serie[k].ventas).length,
  }));
  const total = filas.reduce((s, f) => s + f.total, 0);
  const trans = Object.keys(idsVenta).length;
  return {
    periodo: periodo,
    resumen: { total: total, unidades: filas.reduce((s, f) => s + f.unidades, 0),
               transacciones: trans, ticketPromedio: trans ? Math.round(total / trans) : 0 },
    serie: filas,
    top: Object.values(top).sort((a, b) => b.unidades - a.unidades).slice(0, 15),
    medios: medios,
    stockBajo: leer_('productos').filas
      .filter(p => si_(p.visible) && Number(p.stock) <= Math.max(Number(p.stock_minimo) || 0, 1))
      .map(p => ({ id: p.id, nombre: p.nombre, stock: Number(p.stock) })).slice(0, 50),
  };
}

function semanaIso_(f) {
  const d = new Date(Utilities.formatDate(f, zona_(), 'yyyy-MM-dd') + 'T12:00:00Z');
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia + 3);
  const primerJueves = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const n = 1 + Math.round(((d - primerJueves) / 86400000 - 3 + ((primerJueves.getUTCDay() + 6) % 7)) / 7);
  return d.getUTCFullYear() + '-S' + (n < 10 ? '0' : '') + n;
}

/* Lo ejecuta el disparador diario (ver instalarDisparadores). Reescribe las
   cuatro hojas de resumen y, si hay correo configurado, manda el del día. */
function generarReportes() {
  const ss = SpreadsheetApp.getActive();
  [['dia', 'Resumen diario'], ['semana', 'Resumen semanal'], ['mes', 'Resumen mensual'], ['anio', 'Resumen anual']]
    .forEach(([periodo, nombre]) => {
      const r = reporte_(periodo);
      const h = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
      h.clearContents();
      const filas = [['Periodo', 'Total ($)', 'Unidades', 'Transacciones']]
        .concat(r.serie.map(f => [f.periodo, f.total, f.unidades, f.transacciones]));
      h.getRange(1, 1, filas.length, 4).setValues(filas);
      h.getRange(1, 1, 1, 4).setFontWeight('bold');
      h.setFrozenRows(1);
    });

  // Registro crece con cada login y cada acción: se conservan las últimas
  // MAX_REGISTRO filas para no acercarse al límite de celdas de la planilla.
  const reg = hoja_('registro');
  const sobran = reg.getLastRow() - 1 - MAX_REGISTRO;
  if (sobran > 0) reg.deleteRows(2, sobran);

  const correo = leerConfig_().email_reporte;
  if (correo && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
    const hoy = Utilities.formatDate(new Date(), zona_(), 'yyyy-MM-dd');
    const r = reporte_('dia', hoy, hoy);
    const clp = n => '$' + Math.round(n).toLocaleString('es-CL');
    const cuerpo = [
      'Resumen de ventas ' + hoy, '',
      'Total: ' + clp(r.resumen.total),
      'Transacciones: ' + r.resumen.transacciones,
      'Unidades: ' + r.resumen.unidades,
      'Ticket promedio: ' + clp(r.resumen.ticketPromedio), '',
      'Más vendidos:',
    ].concat(r.top.slice(0, 10).map(t => '  ' + t.unidades + ' × ' + t.nombre + ' — ' + clp(t.total)))
     .concat(['', 'Stock bajo:'], r.stockBajo.slice(0, 20).map(p => '  ' + p.nombre + ': ' + p.stock));
    MailApp.sendEmail(correo, 'Ventas del día ' + hoy, cuerpo.join('\n'));
  }
}

/* ============================================================
   INSTALACIÓN (se ejecutan a mano desde el editor de Apps Script)
   ============================================================ */

/* 1) Crea las hojas, el pimiento y el primer admin. La clave inicial se
      muestra UNA vez en el registro de ejecución: cópiala y cámbiala al
      entrar. No se guarda en ningún sitio legible. */
function instalar() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(HOJAS).forEach(k => {
    let h = ss.getSheetByName(NOMBRE_HOJA[k]);
    if (!h) h = ss.insertSheet(NOMBRE_HOJA[k]);
    if (h.getLastRow() === 0) {
      h.getRange(1, 1, 1, HOJAS[k].length).setValues([HOJAS[k]]).setFontWeight('bold');
      h.setFrozenRows(1);
    } else {
      // Hoja de una versión anterior: se agregan al final las columnas nuevas.
      const cab = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(c => String(c).trim());
      const faltan = HOJAS[k].filter(c => cab.indexOf(c) === -1);
      if (faltan.length) h.getRange(1, cab.length + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold');
    }
  });
  // sku y codigo como TEXTO: un código de barras que empieza por 0 perdería
  // el cero si Sheets lo tomara como número, y ya no calzaría al escanear.
  const hp = ss.getSheetByName('Productos');
  hp.getRange(1, HOJAS.productos.indexOf('sku') + 1, hp.getMaxRows(), 2).setNumberFormat('@');

  // Las hojas con claves no deben verse por error al compartir la planilla.
  ss.getSheetByName('Usuarios').hideSheet();
  ss.getSheetByName('Usuarios').protect().setDescription('Solo el script').setWarningOnly(true);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PIMIENTO')) props.setProperty('PIMIENTO', aleatorio_() + aleatorio_());

  if (!leer_('config').filas.length) {
    agregar_('config', [
      ['tienda_nombre', 'Ale ventas Alerce'],
      ['tienda_telefono', '56950446613'],
      ['tienda_direccion', 'Los Tulipanes 1117, Alerce Sur'],
      ['tienda_ciudad', 'Puerto Montt'],
      ['tienda_logo', 'img/logo.webp'],
      ['horario', JSON.stringify({ lun: '09:00-22:00', mar: '09:00-22:00', mie: '09:00-19:00',
                                   jue: '09:00-22:00', vie: '09:00-21:00', sab: '09:00-12:00', dom: '' })],
      ['mensaje_whatsapp', 'Hola! Me gustaría realizar un pedido'],
      ['despacho', 'si'],
      ['retiro', 'si'],
      ['mostrar_agotados', 'si'],
      ['email_reporte', ''],
    ]);
  }

  if (!leer_('usuarios').filas.length) {
    const clave = aleatorio_().slice(0, 14);
    const sal = aleatorio_();
    agregar_('usuarios', [['admin', 'Administradora', 'admin', sal, hashClave_(clave, sal), true, new Date(), '', true]]);
    console.log('Usuario: admin   Clave inicial: ' + clave + '   ← el panel pedirá cambiarla al entrar');
  }
  console.log('Listo. Siguiente paso: importarSemilla() y después instalarDisparadores().');
}

/* 2) Carga los productos del catálogo antiguo desde el sitio publicado.
      Solo si la hoja Productos está vacía, para no pisar datos reales. */
function importarSemilla() {
  const url = 'https://seiler18.github.io/VentasMaker/data/catalogo.json';
  if (leer_('productos').filas.length) throw new Error('Productos ya tiene datos; no se importa.');
  const datos = JSON.parse(UrlFetchApp.fetch(url).getContentText());
  const ahora = new Date();
  const filas = datos.map(p => {
    let img = '';
    try { img = urlImagen_(p.imagen); } catch (e) { /* ruta rara: sin foto */ }
    const f = Object.assign({}, p, { imagen: img, costo: '', stock_minimo: 1, creado: ahora, actualizado: ahora });
    return HOJAS.productos.map(c => f[c] === undefined ? '' : (typeof f[c] === 'string' ? celda_(f[c]) : f[c]));
  });
  agregar_('productos', filas);
  const h = SpreadsheetApp.getActive().getSheetByName('Productos');
  h.getRange(2, HOJAS.productos.indexOf('codigo') + 1, filas.length, 1).setNumberFormat('@');
  h.getRange(2, HOJAS.productos.indexOf('sku') + 1, filas.length, 1).setNumberFormat('@');
  console.log('Importados ' + filas.length + ' productos.');
}

/* 3) Reporte diario a las 23:00 (hora de Chile). */
function instalarDisparadores() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('generarReportes').timeBased().everyDays(1).atHour(23).create();
  console.log('Disparador diario instalado.');
}

/* Emergencia: si se pierde la clave del admin. Genera una nueva y la muestra
   en el registro. Solo se puede correr desde el editor (dueño de la hoja). */
function restablecerAdmin() {
  const t = leer_('usuarios');
  const f = t.filas.find(u => u.usuario === 'admin');
  const clave = aleatorio_().slice(0, 14), sal = aleatorio_();
  if (f) actualizarFila_('usuarios', f._fila, { sal: sal, hash: hashClave_(clave, sal), activo: true, rol: 'admin', debe_cambiar: true });
  else agregar_('usuarios', [['admin', 'Administradora', 'admin', sal, hashClave_(clave, sal), true, new Date(), '', true]]);
  cerrarSesiones_('admin');
  console.log('Usuario: admin   Clave nueva: ' + clave);
}

/* ============================================================
   AUTENTICACIÓN
   ============================================================ */

function login_(b) {
  const usuario = String(b.usuario || '').trim().toLowerCase().slice(0, 32);
  const clave = String(b.clave || '').slice(0, 128);
  const cache = CacheService.getScriptCache();

  // Freno GLOBAL antes de cualquier trabajo caro. Cada intento cuesta leer la
  // hoja y 2000 HMAC; sin esto, alguien rotando usuarios inventados (para
  // esquivar el bloqueo por usuario) agotaría las ejecuciones simultáneas del
  // dueño y dejaría sin servicio el catálogo y la caja.
  const kMin = 'logins_' + Math.floor(Date.now() / 60000);
  const enEsteMinuto = Number(cache.get(kMin) || 0);
  if (enEsteMinuto >= LOGINS_POR_MINUTO) {
    return { ok: false, error: 'Demasiados intentos en este momento. Espera un minuto.' };
  }
  cache.put(kMin, String(enEsteMinuto + 1), 120);

  const kFallos = 'fallo_' + sha256_(usuario);
  const fallos = Number(cache.get(kFallos) || 0);
  if (fallos >= MAX_FALLOS) {
    return { ok: false, error: 'Demasiados intentos. Espera 15 minutos.' };
  }
  const u = leer_('usuarios').filas.find(x => x.usuario === usuario);
  // Se calcula el hash aunque el usuario no exista: así el tiempo de respuesta
  // no delata qué usuarios son reales.
  const valido = u ? claveCorrecta_(clave, u) : (hashClave_(clave, 'x'), false);
  if (!valido || !si_(u.activo)) {
    // Solo los fallos contra cuentas reales dejan contador y registro: los de
    // usuarios inventados no deben poder llenar la caché ni la hoja.
    if (u) {
      cache.put(kFallos, String(fallos + 1), BLOQUEO_SEG);
      registrar_(usuario, 'loginFallido', '');
    }
    return { ok: false, error: 'Usuario o clave incorrectos' };
  }
  cache.remove(kFallos);
  const debe = si_(u.debe_cambiar);
  const token = abrirSesion_({ usuario: u.usuario, nombre: u.nombre, rol: u.rol, debe: debe });
  actualizarFila_('usuarios', u._fila, { ultimo_login: new Date() });
  registrar_(u.usuario, 'login', '');
  return { ok: true, token: token, usuario: u.usuario, nombre: u.nombre, rol: u.rol, debeCambiar: debe, caduca: SESION_SEG };
}

/* La sesión lleva la VERSIÓN de la cuenta en el momento de entrar. Cambiar la
   clave, el rol o desactivar la cuenta sube la versión (cerrarSesiones_), y
   toda sesión con una versión vieja deja de valer al instante, sin tener que
   recordar qué tokens existen (en CacheService eso no es fiable). */
function abrirSesion_(datos) {
  const token = aleatorio_() + aleatorio_();
  datos.ver = versionCuenta_(datos.usuario);
  CacheService.getScriptCache().put('ses_' + sha256_(token), JSON.stringify(datos), SESION_SEG);
  return token;
}

function sesion_(token) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 200) return null;
  const v = CacheService.getScriptCache().get('ses_' + sha256_(token));
  if (!v) return null;
  const ses = JSON.parse(v);
  return ses.ver === versionCuenta_(ses.usuario) ? ses : null;
}

function versionCuenta_(usuario) {
  return Number(PropertiesService.getScriptProperties().getProperty('ver_' + usuario) || 0);
}

function cerrarSesiones_(usuario) {
  PropertiesService.getScriptProperties().setProperty('ver_' + usuario, String(versionCuenta_(usuario) + 1));
}

function hashClave_(clave, sal) {
  const pimiento = PropertiesService.getScriptProperties().getProperty('PIMIENTO');
  if (!pimiento) throw new Error('Falta ejecutar instalar()');
  let h = Utilities.computeHmacSha256Signature(sal + ':' + clave, pimiento);
  for (let i = 1; i < ITERACIONES; i++) {
    h = Utilities.computeHmacSha256Signature(h, Utilities.newBlob(pimiento + sal).getBytes());
  }
  return Utilities.base64Encode(h);
}

function claveCorrecta_(clave, fila) {
  const a = hashClave_(clave, String(fila.sal));
  const b = String(fila.hash);
  // Comparación de tiempo constante.
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function validarClave_(c) {
  if (c.length < 10 || c.length > 128) falla_('La clave debe tener entre 10 y 128 caracteres');
  if (!/[a-zA-Z]/.test(c) || !/[0-9]/.test(c)) falla_('La clave debe tener letras y números');
}

function aleatorio_() {
  // getUuid usa un generador criptográfico; se pasa por SHA-256 para
  // quitarle los bits fijos de versión del UUID.
  return sha256_(Utilities.getUuid() + Utilities.getUuid() + Date.now()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
}

function sha256_(s) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}

/* ============================================================
   ACCESO A LA HOJA
   ============================================================ */

function hoja_(k) {
  const h = SpreadsheetApp.getActive().getSheetByName(NOMBRE_HOJA[k]);
  if (!h) throw new Error('Falta la hoja ' + NOMBRE_HOJA[k] + '. Ejecuta instalar().');
  return h;
}

/* Lee una hoja como objetos, localizando cada columna por su ENCABEZADO: así
   se pueden reordenar o añadir columnas en la planilla sin romper el script. */
function leer_(k) {
  const h = hoja_(k);
  const datos = h.getDataRange().getValues();
  const cab = datos.shift() || [];
  const filas = datos.map((r, i) => {
    const o = { _fila: i + 2 };
    cab.forEach((c, j) => { if (c) o[String(c).trim()] = r[j]; });
    return o;
  }).filter(o => HOJAS[k].some(c => o[c] !== '' && o[c] !== undefined));
  return { cab: cab.map(c => String(c).trim()), filas: filas };
}

function actualizarFila_(k, fila, cambios) {
  const h = hoja_(k);
  const cab = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(c => String(c).trim());
  Object.keys(cambios).forEach(c => {
    const j = cab.indexOf(c);
    if (j >= 0) h.getRange(fila, j + 1).setValue(celda_(cambios[c]));
  });
}

function agregar_(k, filas) {
  if (!filas.length) return;
  const h = hoja_(k);
  // Las filas llegan en el orden de HOJAS[k]; se recolocan según el
  // encabezado real por si alguien movió columnas en la planilla.
  const cab = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(c => String(c).trim());
  const orden = HOJAS[k];
  const salida = filas.map(f => cab.map(c => {
    const j = orden.indexOf(c);
    return j >= 0 ? celda_(f[j]) : '';
  }));
  h.getRange(h.getLastRow() + 1, 1, salida.length, cab.length).setValues(salida);
}

/* Neutraliza la inyección de fórmulas: un texto que empieza por = + - @ lo
   interpretaría Sheets como fórmula (p. ej. =IMPORTXML(...) exfiltrando
   datos). El apóstrofo inicial lo fuerza a texto y no se ve en la celda. */
function celda_(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

function conBloqueo_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) falla_('El sistema está ocupado, intenta de nuevo');
  try {
    const r = fn();
    SpreadsheetApp.flush();
    return r;
  } finally {
    lock.releaseLock();
  }
}

function leerConfig_() {
  const o = {};
  leer_('config').filas.forEach(f => { o[String(f.clave)] = String(f.valor); });
  return o;
}

function registrar_(usuario, accion, detalle) {
  try { agregar_('registro', [[new Date(), String(usuario).slice(0, 32), accion, String(detalle).slice(0, 300)]]); }
  catch (e) { console.error(e); }
}

/* ============================================================
   UTILIDADES
   ============================================================ */

function limpiarProducto_(p) {
  return {
    id: p.id, sku: String(p.sku), codigo: String(p.codigo || ''), nombre: p.nombre,
    descripcion: p.descripcion, categoria: p.categoria, precio: Number(p.precio) || 0,
    costo: Number(p.costo) || 0, stock: Number(p.stock) || 0, stock_minimo: Number(p.stock_minimo) || 0,
    visible: si_(p.visible), imagen: p.imagen,
  };
}

function sinFila_(o) { const c = Object.assign({}, o); delete c._fila; return c; }

function agruparVentas_(filas) {
  const g = {};
  filas.forEach(v => {
    const x = g[v.venta_id] || (g[v.venta_id] = { ventaId: v.venta_id, fecha: v.fecha, usuario: v.usuario,
      medio: v.medio_pago, anulada: si_(v.anulada), total: 0, items: [] });
    x.total += Number(v.subtotal) || 0;
    x.items.push({ nombre: v.nombre, cantidad: Number(v.cantidad), subtotal: Number(v.subtotal) });
  });
  return Object.values(g).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
}

function siguienteSku_(filas) {
  let max = 0;
  filas.forEach(p => { const m = /^MK(\d+)$/.exec(String(p.sku)); if (m) max = Math.max(max, Number(m[1])); });
  return 'MK' + String(max + 1).padStart(4, '0');
}

function normCodigo_(c) { return String(c || '').trim().toUpperCase().replace(/\s+/g, ''); }

function texto_(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function entero_(v, porDefecto) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : porDefecto;
}

/* Solo se aceptan imágenes del propio sitio (ruta relativa img/…) o de
   Google (las que sube el panel). Una URL arbitraria permitiría meter en el
   catálogo público una imagen que rastree a los visitantes. */
function urlImagen_(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^img\/[A-Za-z0-9._-]+\.(webp|jpg|jpeg|png)$/.test(u)) return u;
  if (/^https:\/\/lh3\.googleusercontent\.com\/d\/[A-Za-z0-9_-]+(=w\d+)?$/.test(u)) return u;
  falla_('URL de imagen no permitida');
}

function esImagen_(bytes, tipo) {
  const b = i => (bytes[i] + 256) % 256;
  if (tipo === 'image/jpeg') return b(0) === 0xFF && b(1) === 0xD8;
  if (tipo === 'image/png') return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47;
  if (tipo === 'image/webp') return b(0) === 0x52 && b(1) === 0x49 && b(8) === 0x57 && b(9) === 0x45;
  return false;
}

function carpetaImagenes_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CARPETA_IMG');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* se recrea */ } }
  const c = DriveApp.createFolder('VentasMaker — imágenes');
  props.setProperty('CARPETA_IMG', c.getId());
  return c;
}

function zona_() { return Session.getScriptTimeZone() || 'America/Santiago'; }

/* La hoja la edita gente a mano: una casilla marcada llega como true, pero
   alguien puede escribir "si" o "TRUE". Todo eso cuenta como verdadero. */
function si_(v) {
  return v === true || /^(true|si|sí|1|verdadero|x)$/i.test(String(v).trim());
}
