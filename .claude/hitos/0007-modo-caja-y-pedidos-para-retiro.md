# 0007 — Modo caja en el catálogo y pedidos para retiro con número

- **Fecha:** 2026-09-28
- **Estado:** completado en el repo; **falta redesplegar `Code.gs` (v3)** y publicar el front
- **Commits:** pendiente de commit

## Contexto

Se pidió que el sitio sirviera para dos cosas:

1. **La tienda vende desde el catálogo** (`/VentasMaker/`): elegir o escanear
   con la pistola, ver la venta en «Tu pedido», finalizarla con los datos del
   cliente (trazabilidad) y que el stock se descuente en la hoja y en la app,
   con un «Gracias por la compra».
2. **El cliente compra desde el catálogo** (lo que ve por defecto): con
   despacho, se coordina por WhatsApp y el envío no se da por gratis; con
   retiro en tienda, recibe un número de pedido, llega con él, y la tienda lo
   cobra (efectivo o tarjeta, con su comprobante) y descuenta el stock.

Antes, el catálogo solo armaba un mensaje de WhatsApp y el stock se
descontaba vendiendo en el panel (*Vender*), sin datos del cliente.

Al empezar, producción ya respondía `srv: 2`: el `Code.gs` del hito 0006 sí
se había redesplegado.

## Qué se hizo

**Backend (`backend/Code.gs`, `VERSION_API` 3)**
- Hoja nueva *Pedidos* (`pedido_id, fecha, estado, entrega, cliente, celular,
  direccion, nota, items, total, venta_id, atendido_por, actualizado`). Se crea
  sola al primer pedido (`CREA_SOLA`, `existe_`): no hace falta volver a correr
  `instalar()`.
- Columnas nuevas en *Ventas*: `cliente, contacto, comprobante, pedido_id`. A
  una planilla vieja se le agregan solas la primera vez que se escribe
  (`columnas_`, dentro del bloqueo).
- `crearPedido` — **pública**, fuera de `PERMISOS`, tratada en `doPost` como
  `login`. No mueve stock. Frenos: 10/min global, 5 por celular por hora, tope
  de 300 pendientes; solo productos visibles con stock; precio y total del
  servidor; idempotente con el usuario `publico`. Número correlativo `P1001…`.
- `pedidos` (lista, o uno por número normalizado: «p 1042», «#1042», «1042»)
  y `cancelarPedido`, para admin y vendedor.
- `vender` acepta `cliente`, `contacto`, `comprobante` y `pedidoId`: con
  pedido, comprueba que esté pendiente y lo marca `completado` **en el mismo
  bloqueo** (canal `web`). `anularVenta` devuelve el pedido a `pendiente`.
- 119 pruebas (`npm test`); la simulación de Sheets ahora devuelve el texto de
  una celda neutralizada como lo hace Sheets (antes, un objeto).

**Front**
- `src/tienda/main.js`: el checkout según la entrega. Retiro → «Reservar para
  retiro» → `crearPedido` → diálogo con el número grande, pasos y «Avisar por
  WhatsApp»; el carrito se vacía y el aviso «Tienes el pedido P…» queda arriba
  del catálogo 7 días (localStorage). Despacho → WhatsApp con «el envío no está
  incluido» y la pregunta por su costo. `aplicar()` ordena por separado los
  datos de la tienda y los productos (fuente `caja` > `vivo`).
- `src/tienda/caja.js` + `src/styles/caja.css` (se descargan solo con sesión):
  barra «Modo caja», lectura de pistola sin foco (ráfaga de ≥4 teclas a
  <60 ms + Enter; si cayó en un campo, se quita de ahí), cámara, cobro con
  cliente, medio de pago, N° de comprobante, descuento (admin), y «Cobrar
  pedido» (buscar por número o elegir de los pendientes). Carrito aparte
  (`vm_carrito_caja`).
- `src/admin/pedidos.js`: pestaña **Pedidos** (por cobrar / todos, buscar,
  WhatsApp del cliente, Cancelar, Cobrar → `./#pedido=P…`). Barra del panel:
  «Vender en el catálogo» (`./#caja`). *Vender* del panel también pide cliente,
  contacto y comprobante (opcionales) y lista cliente y pedido en «Ventas de hoy».
- `src/lib/api.js`: `llamar(…, { idem })` con clave fija (el cliente que vuelve
  a tocar «Reservar» tras un corte recibe el mismo número), `backend.pedidos`,
  y `pistaVersion` (la versión viaja en `data/vivo.json` y en la copia local).
- `src/admin/demo.js` imita todo lo anterior.

Verificado con un recorrido de Playwright sobre un build demo con la CSP
activa (iPhone 13 y escritorio): reservar, ver el pedido en el panel, cobrarlo
con débito y voucher, stock descontado, escaneo con y sin foco, código
desconocido, venta con cliente y descuento, salir y volver al modo caja,
consola sin errores.

## Decisiones y alternativas descartadas

- **El pedido no reserva stock.** Reservar habría hecho que una ráfaga de
  pedidos falsos (es una escritura pública) dejara la tienda «sin stock». El
  costo: si alguien compra lo último en el mesón, el pedido llega con faltantes;
  la caja lo avisa al cargarlo y cobra lo que hay.
- **Despacho sin número de pedido.** WhatsApp debe abrirse en el mismo clic
  (tras esperar al servidor el navegador bloquea la ventana), y el total no se
  conoce sin el envío. Se cobra después en modo caja.
- **Modo caja en el catálogo, no una copia de *Vender*.** Se reutiliza la
  sesión del panel (sessionStorage, misma pestaña) y el mismo `vender`; el
  servidor sigue comprobando sesión y rol. Se descartó iniciar sesión desde el
  catálogo: duplicaba el login y su freno.
- **Precio al cobrar, no al reservar.** El servidor siempre pone el precio de la
  hoja; si cambió, el cobro lo muestra («al reservar sumaba…»).
- **Número correlativo (P1042)**, fácil de decir en voz alta. Adivinar uno no
  da nada: leer pedidos exige sesión y cobrarlo exige pagar.
- **Anular la venta de un pedido lo deja pendiente**, porque lo normal es
  haberse equivocado al cobrar; si el cliente devolvió, se cancela en Pedidos.

## Consecuencias

- La hoja guarda ahora nombre y celular de clientes (SECURITY.md actualizado:
  activos, controles y hallazgo L8).
- Un front nuevo con backend v2 sigue funcionando: el retiro cae a WhatsApp
  («Acción no válida» o `srv < 3`) y la pestaña Pedidos explica que falta
  desplegar el backend.
- `crearPedido` es la segunda puerta sin sesión: cualquier cambio en ella se
  revisa como `login`.

## Pendiente

- **Redesplegar `Code.gs` como versión nueva** de la misma implementación
  (skill `desplegar-backend`); comprobar `curl "<API_URL>?accion=nada"` →
  `"srv":3`. Hasta entonces el retiro sigue por WhatsApp.
- Publicar el front (skill `desplegar`).
- Sin notificación a la tienda cuando entra un pedido: se ve en *Pedidos* (o
  el cliente avisa por WhatsApp). Un correo por pedido gastaría cuota de
  MailApp con cada pedido falso.
- Pedidos viejos no caducan solos: se cancelan a mano.
