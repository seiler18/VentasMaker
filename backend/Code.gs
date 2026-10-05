/* ============================================================
   VentasMaker — backend en Google Apps Script

   La hoja de cálculo ES la base de datos. Este script se publica como
   aplicación web y el front (GitHub Pages) le habla por fetch:

     GET  ?accion=catalogo        → catálogo público (sin costo ni datos internos)
     POST {accion, token, ...}    → todo lo demás; exige sesión salvo `login`
                                    y `crearPedido` (el cliente que reserva
                                    un pedido para retirar en tienda)

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
              'precio_unit', 'descuento', 'subtotal', 'medio_pago', 'canal', 'nota', 'anulada',
              'cliente', 'contacto', 'comprobante', 'pedido_id'],
  movimientos: ['fecha', 'usuario', 'producto_id', 'nombre', 'tipo', 'delta', 'stock_final', 'nota'],
  usuarios:  ['usuario', 'nombre', 'rol', 'sal', 'hash', 'activo', 'creado', 'ultimo_login', 'debe_cambiar'],
  config:    ['clave', 'valor'],
  registro:  ['fecha', 'usuario', 'accion', 'detalle'],
  pedidos:   ['pedido_id', 'fecha', 'estado', 'entrega', 'cliente', 'celular', 'direccion', 'nota',
              'items', 'total', 'venta_id', 'atendido_por', 'actualizado'],
};
const NOMBRE_HOJA = {
  productos: 'Productos', ventas: 'Ventas', movimientos: 'Movimientos',
  usuarios: 'Usuarios', config: 'Config', registro: 'Registro', pedidos: 'Pedidos',
};
/* Hojas que el script crea solo la primera vez que las necesita: así una
   tienda instalada antes de que existieran no tiene que volver a correr
   instalar(). A las demás, las columnas nuevas se les agregan al escribir
   (ver columnas_). */
const CREA_SOLA = ['pedidos'];

const ROLES = ['admin', 'vendedor'];
const SESION_SEG = 6 * 60 * 60;        // máximo que admite CacheService
const MAX_FALLOS = 5;                  // intentos de login antes del bloqueo
const BLOQUEO_SEG = 15 * 60;
const ITERACIONES = 2000;              // HMAC encadenado: frena la fuerza bruta
const MAX_IMG_BYTES = 1.5 * 1024 * 1024;
const MEDIOS_PAGO = ['efectivo', 'debito', 'credito', 'transferencia', 'otro'];
const LOGINS_POR_MINUTO = 20;          // freno global: ver login_
const MAX_REGISTRO = 5000;             // filas de Registro que se conservan
const CATALOGO_SEG = 6 * 60 * 60;      // caché del catálogo: toda escritura la invalida
const IDEM_SEG = 10 * 60;              // cuánto se recuerda la respuesta de una escritura
const EN_CURSO_SEG = 6 * 60;           // lo que dura como máximo una ejecución
const PEDIDOS_POR_MINUTO = 10;         // freno global de pedidos públicos
const PEDIDOS_POR_CELULAR = 5;         // por número, cada PEDIDOS_CELULAR_SEG
const PEDIDOS_CELULAR_SEG = 60 * 60;
const MAX_PENDIENTES = 300;            // tope de pedidos sin atender
const MAX_LINEAS_PEDIDO = 50;

/* Versión del contrato con el front. Viaja en cada respuesta (`srv`) para
   que el front sepa qué puede pedir: con la 2, reintentar escrituras con
   `idem` y mandar ajustes de stock en lote; con la 3, pedidos para retiro
   (`crearPedido`, `pedidos`, `cancelarPedido`) y datos del cliente en la
   venta. Un front nuevo contra un backend viejo sigue funcionando, solo que
   sin eso. */
const VERSION_API = 3;

/* Escrituras que aceptan clave de idempotencia (`idem`). Apps Script a veces
   ejecuta la acción y aun así el navegador recibe un 404 o se queda sin
   respuesta: sin esto, reintentar un cobro lo registraría dos veces.
   cambiarClave no está: su respuesta trae un token y no debe quedar en caché. */
const IDEMPOTENTES = ['vender', 'anularVenta', 'guardarProducto', 'eliminarProducto', 'ajustarStock',
                      'subirImagen', 'guardarUsuario', 'guardarConfig', 'crearPedido', 'cancelarPedido'];

/* Qué puede hacer cada rol. Lo que no aparece aquí no existe. */
const PERMISOS = {
  sesion:          ['admin', 'vendedor'],
  logout:          ['admin', 'vendedor'],
  cambiarClave:    ['admin', 'vendedor'],
  productos:       ['admin', 'vendedor'],
  buscarCodigo:    ['admin', 'vendedor'],
  vender:          ['admin', 'vendedor'],
  ventasDelDia:    ['admin', 'vendedor'],
  pedidos:         ['admin', 'vendedor'],
  cancelarPedido:  ['admin', 'vendedor'],
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
  memo_ = {};
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
  memo_ = {};
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
    // Única escritura sin sesión: la hace el cliente desde el catálogo. No
    // toca el stock (se descuenta al cobrarlo en la tienda) y tiene sus
    // propios frenos (ver crearPedido_).
    if (accion === 'crearPedido') return json_(conIdem_(accion, body, { usuario: 'publico' }, crearPedido_));

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
    return json_(conIdem_(accion, body, ses));
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
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ srv: VERSION_API }, obj)))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Ejecuta la acción una sola vez por clave `idem`. La clave va ligada al
   usuario (otro no puede leer la respuesta ajena adivinándola). Mientras la
   primera ejecución sigue en marcha, un reintento recibe `enCurso` en vez de
   ejecutarla otra vez; cuando termina, recibe la misma respuesta. Si la
   acción falla, la marca se borra: reintentar entonces es seguro. */
function conIdem_(accion, body, ses, fn) {
  fn = fn || ACCIONES[accion];
  const idem = IDEMPOTENTES.indexOf(accion) >= 0 && typeof body.idem === 'string' &&
               /^[A-Za-z0-9_-]{16,64}$/.test(body.idem) ? 'idem_' + sha256_(ses.usuario + ':' + body.idem) : '';
  if (!idem) return { ok: true, ...fn(body, ses) };
  const cache = CacheService.getScriptCache();
  const previo = cache.get(idem);
  if (previo === 'en_curso') return { ok: false, error: 'La operación anterior aún se está procesando', enCurso: true };
  if (previo) return Object.assign(JSON.parse(previo), { repetida: true });
  cache.put(idem, 'en_curso', EN_CURSO_SEG);
  let res;
  try {
    res = { ok: true, ...fn(body, ses) };
  } catch (err) {
    cache.remove(idem);
    throw err;
  }
  try { cache.put(idem, JSON.stringify(res), IDEM_SEG); } catch (e) { cache.remove(idem); }
  return res;
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
    // Mismo contador de fallos que el login: sin él, quien robe un token
    // podría probar claves sin límite contra "clave actual" y, al acertar,
    // cambiarla y quedarse con la cuenta más allá de las 6 h de la sesión.
    const cache = CacheService.getScriptCache();
    const kFallos = 'fallo_' + sha256_(ses.usuario);
    const fallos = Number(cache.get(kFallos) || 0);
    if (fallos >= MAX_FALLOS) falla_('Demasiados intentos. Espera 15 minutos.');
    const tabla = leer_('usuarios');
    const fila = tabla.filas.find(u => u.usuario === ses.usuario);
    if (!fila || !claveCorrecta_(actual, fila)) {
      cache.put(kFallos, String(fallos + 1), BLOQUEO_SEG);
      registrar_(ses.usuario, 'cambiarClaveFallido', '');
      falla_('La clave actual no es correcta');
    }
    cache.remove(kFallos);
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
    // Pedido reservado desde el catálogo: la venta lo completa en la misma
    // operación (o no se completa ninguno de los dos).
    const pedidoId = b.pedidoId ? normPedido_(b.pedidoId) : '';
    const canal = pedidoId ? 'web' : b.canal === 'whatsapp' ? 'whatsapp' : 'local';
    let cliente = texto_(b.cliente, 60), contacto = texto_(b.contacto, 60);
    const comprobante = texto_(b.comprobante, 40);
    const descuentoTotal = entero_(b.descuento, 0);
    if (descuentoTotal < 0) falla_('Descuento no válido');
    if (descuentoTotal > 0 && ses.rol !== 'admin') falla_('Solo un admin puede aplicar descuentos');

    return conBloqueo_(() => {
      // Se lee DENTRO del bloqueo: si se leyera antes, dos ventas simultáneas
      // verían el mismo stock y ambas lo darían por disponible.
      const tabla = leer_('productos');
      // Sin prototipo: con un {} normal, un id "__proto__" o "constructor"
      // mandado por el cliente pasaría el "producto existe" (heredaría de
      // Object.prototype) y la venta seguiría con datos que no son de la hoja.
      const porId = Object.create(null);
      tabla.filas.forEach(p => porId[p.id] = p);

      let pedido = null;
      if (pedidoId) {
        pedido = existe_('pedidos') && leer_('pedidos').filas.find(x => String(x.pedido_id) === pedidoId);
        if (!pedido) falla_('No existe el pedido ' + pedidoId);
        if (pedido.estado !== 'pendiente') falla_('El pedido ' + pedidoId + ' ya está ' + pedido.estado);
        cliente = cliente || texto_(pedido.cliente, 60);
        contacto = contacto || texto_(pedido.celular, 60);
      }

      // Agrupa por producto: el mismo código escaneado dos veces es una línea.
      const cant = Object.create(null);
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
                         d, bruto - d, medio, canal, texto_(b.nota, 200), false,
                         cliente, contacto, comprobante, pedidoId]);
        filasMov.push([ahora, ses.usuario, id, p.nombre, 'venta', -cant[id], stockFinal, ventaId]);
      });
      agregar_('ventas', filasVenta);
      agregar_('movimientos', filasMov);
      if (pedido) {
        actualizarFila_('pedidos', pedido._fila, { estado: 'completado', venta_id: ventaId,
                                                   atendido_por: ses.usuario, actualizado: ahora });
      }
      invalidarCatalogo_();
      return {
        ventaId: ventaId,
        pedidoId: pedidoId,
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
      // Si la venta cobraba un pedido, el pedido vuelve a quedar por cobrar:
      // lo normal es que se anule por un error al cobrarlo.
      const pedidoId = String(ventas[0].pedido_id || '');
      if (pedidoId && existe_('pedidos')) {
        const ped = leer_('pedidos').filas.find(x => String(x.pedido_id) === pedidoId && x.venta_id === ventaId);
        if (ped) actualizarFila_('pedidos', ped._fila, { estado: 'pendiente', venta_id: '', actualizado: ahora });
      }
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

  /* Un producto ({id, delta | nuevo}) o un lote ({items: [{id, delta}]}): el
     ingreso de mercadería escanea decenas de prendas, y una llamada por cada
     una son decenas de viajes a Apps Script. El lote es todo o nada: si una
     línea no vale, no se escribe ninguna. */
  ajustarStock: (b, ses) => {
    const tipo = ['ingreso', 'ajuste', 'merma'].indexOf(b.tipo) >= 0 ? b.tipo : 'ajuste';
    const nota = texto_(b.nota, 200);
    const lote = Array.isArray(b.items);
    const items = lote ? b.items : [b];
    if (!items.length || items.length > 200) falla_('El ajuste no tiene productos');
    return conBloqueo_(() => {
      const porId = Object.create(null);
      leer_('productos').filas.forEach(p => porId[p.id] = p);
      const cambios = [], vistos = Object.create(null);
      items.forEach(it => {
        const id = String(it.id || '');
        const p = porId[id];
        if (!p) falla_('Producto no encontrado');
        if (vistos[id]) falla_('Producto repetido en el ajuste');
        vistos[id] = true;
        const actual = Number(p.stock) || 0;
        let final;
        if (!lote && it.nuevo !== undefined && it.nuevo !== null && it.nuevo !== '') final = entero_(it.nuevo, -1);
        else final = actual + entero_(it.delta, 0);
        if (final < 0 || final > 1000000) falla_('Stock no válido');
        cambios.push({ p: p, actual: actual, final: final });
      });
      const ahora = new Date(), mov = [];
      cambios.forEach(c => {
        if (c.final === c.actual) return;
        actualizarFila_('productos', c.p._fila, { stock: c.final, actualizado: ahora });
        mov.push([ahora, ses.usuario, c.p.id, c.p.nombre, tipo, c.final - c.actual, c.final, nota]);
      });
      if (mov.length) {
        agregar_('movimientos', mov);
        invalidarCatalogo_();
      }
      return lote ? { stock: cambios.map(c => ({ id: c.p.id, stock: c.final })) } : { stock: cambios[0].final };
    });
  },

  subirImagen: (b, ses) => {
    const tipo = String(b.tipo || '');
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(tipo) === -1) falla_('Formato de imagen no permitido');
    const bytes = Utilities.base64Decode(String(b.base64 || ''));
    if (!bytes.length || bytes.length > MAX_IMG_BYTES) falla_('Imagen vacía o demasiado grande');
    // Comprobación por "número mágico": que el tipo declarado sea verdad.
    if (!esImagen_(bytes, tipo)) falla_('El archivo no es una imagen válida');
    // Servicio avanzado de Drive, no DriveApp: DriveApp exige permiso sobre
    // todo el Drive de la dueña y el manifiesto solo concede drive.file (los
    // archivos que crea este script). Con DriveApp la subida fallaba con
    // "Error interno".
    const nombre = 'p_' + Date.now() + '.' + tipo.split('/')[1];
    const archivo = Drive.Files.create({ name: nombre, mimeType: tipo, parents: [carpetaImagenes_()] },
                                       Utilities.newBlob(bytes, tipo, nombre));
    Drive.Permissions.create({ role: 'reader', type: 'anyone' }, archivo.id);
    registrar_(ses.usuario, 'subirImagen', archivo.id);
    return { url: 'https://lh3.googleusercontent.com/d/' + archivo.id + '=w800' };
  },

  /* Con `id`, un pedido (el número que trae el cliente: "P1042", "p 1042" o
     "1042"). Sin él, los pendientes y los últimos atendidos. */
  pedidos: (b) => {
    const filas = existe_('pedidos') ? leer_('pedidos').filas.map(limpiarPedido_) : [];
    if (b.id !== undefined) {
      const id = normPedido_(b.id);
      return { pedido: filas.find(p => p.pedidoId === id) || null };
    }
    const pendientes = filas.filter(p => p.estado === 'pendiente');
    const otros = filas.filter(p => p.estado !== 'pendiente').slice(-50);
    return { pedidos: pendientes.concat(otros).sort((x, y) => new Date(y.fecha) - new Date(x.fecha)) };
  },

  cancelarPedido: (b, ses) => {
    const id = normPedido_(b.id);
    return conBloqueo_(() => {
      const p = existe_('pedidos') && leer_('pedidos').filas.find(x => String(x.pedido_id) === id);
      if (!p) falla_('No existe el pedido ' + id);
      if (p.estado !== 'pendiente') falla_('El pedido ' + id + ' ya está ' + p.estado);
      actualizarFila_('pedidos', p._fila, { estado: 'cancelado', atendido_por: ses.usuario, actualizado: new Date() });
      registrar_(ses.usuario, 'cancelarPedido', id);
      return {};
    });
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
  try { cache.putAll(obj, CATALOGO_SEG); } catch (e) { /* sin caché: se sirve igual */ }
  return res;
}

function invalidarCatalogo_() {
  CacheService.getScriptCache().remove('cat_n');
}

/* Disparador simple: quien corrige un precio o un stock A MANO en la
   planilla lo ve en el catálogo al instante, sin esperar a que caduque la
   caché (que dura horas porque las escrituras del panel ya la invalidan).
   CacheService no pide autorización, así que funciona desde onEdit. */
function onEdit(e) {
  try {
    const n = e && e.range && e.range.getSheet().getName();
    if (n === NOMBRE_HOJA.productos || n === NOMBRE_HOJA.config) invalidarCatalogo_();
  } catch (err) { /* nunca debe molestar al editar */ }
}

/* ============================================================
   PEDIDOS DEL CATÁLOGO (retiro en tienda)
   ============================================================ */

/* El cliente arma su carrito en el catálogo y reserva: recibe un número
   ("P1042") con el que llega a la tienda, y ahí la venta se cobra con
   `vender` + `pedidoId`. Hasta entonces el pedido NO descuenta stock: así
   nadie puede dejar la tienda sin inventario llenándola de pedidos falsos.

   Es la única escritura pública, así que:
   - freno global por minuto y por celular, antes de leer la hoja;
   - tope de pedidos pendientes;
   - precios y nombres los pone el servidor; el cliente solo manda id y
     cantidad, y solo de productos visibles con stock;
   - todo texto pasa por texto_() y celda_() como cualquier otra escritura. */
function crearPedido_(b) {
  const cache = CacheService.getScriptCache();
  const kMin = 'pedidos_' + Math.floor(Date.now() / 60000);
  const enEsteMinuto = Number(cache.get(kMin) || 0);
  if (enEsteMinuto >= PEDIDOS_POR_MINUTO) falla_('Estamos recibiendo muchos pedidos. Intenta en un minuto o escríbenos por WhatsApp.');
  cache.put(kMin, String(enEsteMinuto + 1), 120);

  const nombre = texto_(b.nombre, 60);
  if (!nombre) falla_('Escribe tu nombre');
  const celular = String(b.celular || '').replace(/\D/g, '');
  if (celular.length < 8 || celular.length > 12) falla_('Revisa el número de celular');
  const kCel = 'pedcel_' + sha256_(celular);
  const delCelular = Number(cache.get(kCel) || 0);
  if (delCelular >= PEDIDOS_POR_CELULAR) falla_('Ya hiciste varios pedidos seguidos. Escríbenos por WhatsApp y te ayudamos.');
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length || items.length > MAX_LINEAS_PEDIDO) falla_('El pedido no tiene productos');
  if (leerConfig_().retiro === 'no') falla_('El retiro en tienda no está disponible');

  return conBloqueo_(() => {
    const porId = Object.create(null);
    leer_('productos').filas.forEach(p => porId[p.id] = p);
    const cant = Object.create(null);
    items.forEach(it => {
      const id = String(it && it.id || '');
      const c = entero_(it && it.cantidad, 0);
      if (!porId[id] || !si_(porId[id].visible)) falla_('Un producto del pedido ya no está en el catálogo. Actualiza la página.');
      if (c <= 0 || c > 1000) falla_('Cantidad no válida');
      cant[id] = (cant[id] || 0) + c;
    });
    const lineas = Object.keys(cant).map(id => {
      const p = porId[id];
      const stock = Number(p.stock);
      if (!(stock >= cant[id])) falla_(stock > 0 ? 'Solo quedan ' + stock + ' de ' + p.nombre : p.nombre + ' se agotó');
      const precio = Number(p.precio);
      if (!Number.isFinite(precio) || precio < 0) falla_('Precio no válido en la hoja: ' + p.nombre);
      return { id: id, sku: String(p.sku), nombre: String(p.nombre), cantidad: cant[id], precio: precio };
    });
    const total = lineas.reduce((s, l) => s + l.cantidad * l.precio, 0);

    const tabla = leer_('pedidos');
    if (tabla.filas.filter(p => p.estado === 'pendiente').length >= MAX_PENDIENTES) {
      falla_('Ahora no podemos recibir más pedidos por aquí. Escríbenos por WhatsApp.');
    }
    const pedidoId = siguientePedido_(tabla.filas);
    const ahora = new Date();
    agregar_('pedidos', [[pedidoId, ahora, 'pendiente', 'retiro', nombre, celular, '', texto_(b.nota, 300),
                          JSON.stringify(lineas), total, '', '', ahora]]);
    cache.put(kCel, String(delCelular + 1), PEDIDOS_CELULAR_SEG);
    registrar_('publico', 'crearPedido', pedidoId + ' …' + celular.slice(-4));
    return { pedidoId: pedidoId, total: total, items: lineas };
  });
}

function siguientePedido_(filas) {
  let max = 1000;
  filas.forEach(p => { const m = /^P(\d+)$/.exec(String(p.pedido_id)); if (m) max = Math.max(max, Number(m[1])); });
  return 'P' + (max + 1);
}

/* "P1042", "p 1042", "#1042" o "1042" → "P1042". */
function normPedido_(v) {
  const s = String(v === undefined || v === null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
  return /^\d+$/.test(s) ? 'P' + s : s;
}

function limpiarPedido_(p) {
  let items = [];
  try { items = JSON.parse(String(p.items || '[]')); } catch (e) { /* celda editada a mano */ }
  if (!Array.isArray(items)) items = [];
  return {
    pedidoId: String(p.pedido_id), fecha: p.fecha, estado: String(p.estado || 'pendiente'),
    entrega: String(p.entrega || 'retiro'), cliente: String(p.cliente || ''), celular: String(p.celular || ''),
    direccion: String(p.direccion || ''), nota: String(p.nota || ''),
    items: items.filter(i => i && typeof i === 'object').map(i => ({
      id: String(i.id || ''), sku: String(i.sku || ''), nombre: String(i.nombre || ''),
      cantidad: Number(i.cantidad) || 0, precio: Number(i.precio) || 0 })),
    total: Number(p.total) || 0, ventaId: String(p.venta_id || ''), atendidoPor: String(p.atendido_por || ''),
    actualizado: p.actualizado,
  };
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
  memo_ = {};
  const ss = ss_();
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
  memo_ = {};
  const ss = ss_();
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
  const h = ss_().getSheetByName('Productos');
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

/* SpreadsheetApp.getActive() solo "ve" la hoja cuando el código corre con
   contexto de interfaz: desde el editor (▷ Ejecutar) o un disparador simple.
   Un doGet/doPost de la aplicación web, o un disparador instalable (el
   reporte de las 23:00), NO tienen ese contexto y getActive() devuelve null
   — el síntoma es "Error interno" apenas alguien entra al catálogo público.
   Por eso el identificador de la hoja se guarda una vez (la primera vez que
   se ejecuta algo desde el editor, donde getActive() sí funciona) y desde
   entonces se abre siempre por ese identificador, que no depende de nada. */
/* Lo abierto se recuerda durante UNA ejecución (doGet/doPost lo vacían al
   entrar): una venta de tres productos llamaba a openById y releía el
   encabezado de la hoja una decena de veces, y cada llamada a Sheets cuesta. */
let memo_ = {};

function ss_() {
  if (memo_.ss) return memo_.ss;
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  if (id) return (memo_.ss = SpreadsheetApp.openById(id));
  const activa = SpreadsheetApp.getActive();
  if (!activa) throw new Error('Ejecuta instalar() una vez desde el editor de Apps Script antes de usar la aplicación web.');
  props.setProperty('SHEET_ID', activa.getId());
  return (memo_.ss = activa);
}

function hoja_(k) {
  const hs = memo_.hojas || (memo_.hojas = {});
  if (hs[k]) return hs[k];
  let h = ss_().getSheetByName(NOMBRE_HOJA[k]);
  if (!h && CREA_SOLA.indexOf(k) >= 0) {
    h = ss_().insertSheet(NOMBRE_HOJA[k]);
    h.getRange(1, 1, 1, HOJAS[k].length).setValues([HOJAS[k]]).setFontWeight('bold');
    h.setFrozenRows(1);
  }
  if (!h) throw new Error('Falta la hoja ' + NOMBRE_HOJA[k] + '. Ejecuta instalar().');
  return (hs[k] = h);
}

/* Para leer una hoja de CREA_SOLA sin crearla fuera de un bloqueo. */
function existe_(k) {
  return Boolean((memo_.hojas && memo_.hojas[k]) || ss_().getSheetByName(NOMBRE_HOJA[k]));
}

/* El encabezado para ESCRIBIR: si a la hoja le faltan columnas de HOJAS (una
   planilla de antes de que existieran), se agregan al final. Solo lo usan
   agregar_ y actualizarFila_, que se llaman dentro de conBloqueo_ (salvo
   registrar_, cuya hoja no cambia): dos ejecuciones no las agregan a la vez. */
function columnas_(k) {
  const cab = cabecera_(k);
  const faltan = HOJAS[k].filter(c => cab.indexOf(c) === -1);
  if (!faltan.length) return cab;
  hoja_(k).getRange(1, cab.length + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold');
  return (memo_.cab[k] = cab.concat(faltan));
}

function cabecera_(k) {
  const cs = memo_.cab || (memo_.cab = {});
  if (cs[k]) return cs[k];
  const h = hoja_(k);
  return (cs[k] = h.getRange(1, 1, 1, h.getLastColumn()).getValues()[0].map(c => String(c).trim()));
}

/* Lee una hoja como objetos, localizando cada columna por su ENCABEZADO: así
   se pueden reordenar o añadir columnas en la planilla sin romper el script. */
function leer_(k) {
  const h = hoja_(k);
  const datos = h.getDataRange().getValues();
  const cab = datos.shift() || [];
  (memo_.cab || (memo_.cab = {}))[k] = cab.map(c => String(c).trim());
  const filas = datos.map((r, i) => {
    const o = { _fila: i + 2 };
    cab.forEach((c, j) => { if (c) o[String(c).trim()] = r[j]; });
    return o;
  }).filter(o => HOJAS[k].some(c => o[c] !== '' && o[c] !== undefined));
  return { cab: cab.map(c => String(c).trim()), filas: filas };
}

function actualizarFila_(k, fila, cambios) {
  const h = hoja_(k);
  const cab = columnas_(k);
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
  const cab = columnas_(k);
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
      medio: v.medio_pago, anulada: si_(v.anulada), total: 0, items: [],
      cliente: String(v.cliente || ''), comprobante: String(v.comprobante || ''), pedidoId: String(v.pedido_id || '') });
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

/* Id de la carpeta de fotos en el Drive de la dueña. La crea el script, así
   que drive.file basta para escribir en ella. Si la borran, se crea otra. */
function carpetaImagenes_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('CARPETA_IMG');
  if (id) {
    try { if (!Drive.Files.get(id, { fields: 'id,trashed' }).trashed) return id; } catch (e) { /* se recrea */ }
  }
  const c = Drive.Files.create({ name: 'VentasMaker — imágenes', mimeType: 'application/vnd.google-apps.folder' });
  props.setProperty('CARPETA_IMG', c.id);
  return c.id;
}

function zona_() { return Session.getScriptTimeZone() || 'America/Santiago'; }

/* La hoja la edita gente a mano: una casilla marcada llega como true, pero
   alguien puede escribir "si" o "TRUE". Todo eso cuenta como verdadero. */
function si_(v) {
  return v === true || /^(true|si|sí|1|verdadero|x)$/i.test(String(v).trim());
}
