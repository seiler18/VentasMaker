# Seguridad — VentasMaker

Auditoría hecha antes de publicar (septiembre 2026): revisión adversarial
independiente del backend y del front, más un banco de **pruebas
automáticas** del backend (`Code.gs` ejecutado en Node con simulaciones de
Apps Script; `npm test`, 71 a la fecha) y un recorrido en navegador real con la
CSP activa. Segunda revisión, del repositorio entero e historial incluido, el
2026-09-26: hallazgos L6, L7 e I2 de la tabla.

## Qué se protege y de quién

| Activo | Amenaza principal |
|---|---|
| Stock y ventas (la hoja) | Alguien de internet que llama a la API directamente |
| Cuentas del panel | Fuerza bruta, token robado, empleado al que se le quitó el acceso |
| Datos de clientes (nombre, celular, dirección) | No se guardan en el servidor: van por WhatsApp. En el navegador del cliente solo queda lo suyo |
| Costos y márgenes | Un vendedor curioso |
| Disponibilidad de la caja | Saturar el Apps Script (cuota de ejecuciones del dueño) |

## Controles

**Backend (`backend/Code.gs`)**
- Toda acción excepto `login` y el catálogo exige sesión; cada acción declara sus
  roles en `PERMISOS` (lista blanca: lo que no está no existe).
- Claves: HMAC-SHA256 × 2000 con sal por usuario y un «pimiento» en las
  Propiedades del script (no en la hoja). Comparación en tiempo constante. Mínimo
  10 caracteres con letras y números.
- **Clave provisoria obligatoria de cambiar**: la inicial y las que pone un admin.
  Hasta cambiarla, el servidor rechaza cualquier otra acción.
- Sesión: token aleatorio en el cuerpo del POST (nunca en la URL); el servidor
  guarda solo su hash, 6 h. Lleva la **versión de la cuenta**: cambiar clave, rol
  o desactivar sube la versión y mata al instante todas las sesiones de esa cuenta.
- Login: bloqueo de 15 min tras 5 fallos por usuario + **freno global** de 20
  intentos/minuto antes de cualquier trabajo caro. «Cambiar clave» comparte el
  contador de fallos del login: un token robado no sirve para adivinar la clave. Los usuarios inexistentes
  cuestan lo mismo (no se puede enumerar) y no dejan rastro en caché ni en la hoja.
- Precio de venta lo pone el servidor; stock verificado dentro de `LockService`;
  cantidades enteras 1–1000; celdas con texto en stock/precio bloquean la venta.
- Anti-inyección de fórmulas en toda escritura a la hoja (`celda_`) y en el CSV.
- Errores internos no se devuelven al cliente (solo «Error interno»).
- Catálogo público: solo productos visibles y solo campos de vitrina; nunca
  costo, código de barras ni el correo de reportes.
- Imágenes: solo admin, JPEG/PNG/WebP comprobado por firma de bytes, ≤ 1,5 MB, y
  solo URLs propias o de Drive en el catálogo.

**Front**
- Plantilla `html\`\`` que escapa todo valor interpolado; la auditoría no
  encontró ningún camino de XSS.
- CSP estricta en `<meta>` (sin `unsafe-inline`, sin `eval`, `connect-src` solo a
  Google Apps Script). El verificador rechaza `style=""` en el marcado.
- Anti-clickjacking por JS (Pages no permite cabeceras); comprobado con un iframe.
- Panel con `noindex` y `referrer: no-referrer`; `window.open` con `noopener`.
- Fotos subidas: se re-codifican en canvas, lo que elimina el EXIF (GPS).

**CI**: el trabajo que compila no puede escribir; el que publica solo escribe en
Pages. `npm ci --ignore-scripts`, `npm audit`, acciones fijadas por SHA.

## Hallazgos de la auditoría y estado

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| M1 | Media | `buscarCodigo` devolvía el costo al vendedor | **Corregido** |
| M2 | Media | Cambiar rol/clave no cerraba todas las sesiones | **Corregido** (versión de cuenta) |
| M3 | Media | DoS por login con usuarios inventados; Registro sin límite | **Corregido** (freno global, sin registro de inexistentes, Registro recortado a 5000 filas cada noche) |
| M4 | Media | Quien pueda **editar** la hoja controla el backend | **Riesgo aceptado, documentado** — ver abajo |
| M5 | Media | Origen compartido `seiler18.github.io` | **Pendiente** — ver abajo |
| L1 | Baja | Un tercero puede bloquear el login 15 min con 5 fallos | Aceptado: las sesiones abiertas siguen; el freno global lo acota |
| L2 | Baja | Texto en la celda de stock saltaba la validación | **Corregido** |
| L3 | Baja | «Nuevo usuario» con nombre existente pisaba la cuenta | **Corregido** |
| L4 | Baja | Clave inicial en el registro de ejecución, sin cambio forzado | **Corregido** (cambio obligatorio) |
| L5 | Baja | CI con permiso de escritura y scripts de instalación | **Corregido** |
| — | Info | Horario malformado rompía el catálogo | **Corregido** |
| L6 | Baja | `cambiarClave` no limitaba los intentos de «clave actual»: con un token robado se podía adivinar la clave por fuerza bruta y quedarse con la cuenta pasadas las 6 h de la sesión | **Corregido** en el código (2026-09-26); vale en producción cuando se redespliegue |
| L7 | Baja | El freno global (20 logins/minuto) lo puede agotar cualquiera sin cuenta: mientras dure el ataque, nadie inicia sesión | Aceptado: Apps Script no entrega la IP del cliente, así que no hay freno por origen; sin el global, el mismo ataque agota la cuota del dueño y tumba también catálogo y caja. Las sesiones abiertas siguen |
| I2 | Info | `vender` buscaba los productos en un objeto con prototipo: un id `__proto__` pasaba como «existe» (sin efecto real: la venta salía vacía o fallaba) | **Corregido** (2026-09-26), mismo redespliegue que L6 |

## Lo que queda en manos de la dueña (importante)

1. **Compartir la planilla solo con quien sea admin.** El script vive dentro de la
   hoja: un editor de la planilla puede leer el pimiento, ejecutar
   `restablecerAdmin` o cambiarse el rol a mano. Editar la hoja = ser admin. Para
   quien solo deba mirar: permiso de **lector**. Los vendedores usan el panel, no
   la hoja.
2. **Origen propio (M5).** `seiler18.github.io` es el mismo origen de todos los
   demás proyectos Pages de esa cuenta; un fallo en cualquiera de ellos podría
   leer la sesión del panel. Solución: un dominio propio (p. ej.
   `aleventas.cl`, ~$10.000/año) o una organización de GitHub gratuita solo para
   la tienda (`aleventas.github.io`). Hasta entonces, no publicar en esa cuenta
   código de terceros sin revisar.
3. Activar la **verificación en dos pasos** en la cuenta de Google dueña de la
   hoja y en la cuenta de GitHub: quien entra a cualquiera de las dos controla el
   sistema completo.
4. Redesplegar Apps Script como «versión nueva» de la misma implementación tras
   cada cambio de `Code.gs`. **Pendiente al 2026-09-26**: pegar el `Code.gs`
   actual (L6 e I2) y publicar una versión nueva; hasta entonces producción
   sigue con el código anterior.

## Sobre el sitio anterior (catalogo.treinta.co)

Se observó solo de forma pasiva, lo que cualquier visitante ve (no se hicieron
pruebas intrusivas: es una plataforma de terceros). El catálogo público entrega,
por una acción de servidor sin autenticación, el listado completo con **stock
exacto** de cada producto, paginado hasta 100 por petición; así se hizo la
migración. No es una falla grave (el stock se muestra en la vitrina), pero
significa que cualquiera puede seguir el inventario de la tienda en el tiempo. El
catálogo nuevo mantiene el mismo comportamiento a propósito (el cliente ve
cuántas quedan); si se prefiere ocultarlo, basta con quitar `stock` del
`catalogoPublico_()` y mostrar solo «disponible / agotado».

## Credenciales compartidas durante el desarrollo

En la conversación de desarrollo se compartió en texto plano una contraseña de
una cuenta personal. **No se usó** (no se inició sesión en esa cuenta) y no quedó
en ningún archivo del proyecto. Aun así, al haber circulado por un chat, **hay que
cambiarla**.

## Reportar un problema

Escribir al administrador del proyecto; no abrir un issue público con detalles
de explotación.
