# Cómo dejar funcionando el backend en Google Sheets

**Para:** la dueña de la tienda (quien tiene la cuenta de Google de Ale ventas Alerce).
**Tiempo:** unos 20 minutos, una sola vez.
**Necesitas:** un computador (no el celular) con Chrome o Edge, e iniciar sesión en
**tu** cuenta de Google.

> **¿Por qué lo haces tú y no el programador?** La hoja de cálculo va a guardar el
> inventario, las ventas y las claves del panel. Tiene que quedar a nombre de la
> tienda, en tu cuenta. Nadie más necesita tu clave de Google: al final solo le
> envías al programador **un enlace** (paso 9).

En esta carpeta hay dos archivos que vas a copiar y pegar:

| Archivo | Qué es | Cómo abrirlo para copiar |
|---|---|---|
| `Code.gs` | El programa (el "backend") | Clic derecho → *Abrir con* → **Bloc de notas** |
| `appsscript.json` | La configuración del programa | Clic derecho → *Abrir con* → **Bloc de notas** |

Si no tienes la carpeta, están en internet (abre el enlace y copia todo el texto):
- Code.gs → <https://raw.githubusercontent.com/seiler18/VentasMaker/main/backend/Code.gs>
- appsscript.json → <https://raw.githubusercontent.com/seiler18/VentasMaker/main/backend/appsscript.json>

Para **copiar todo el texto** de un archivo o de una página: haz clic dentro del
texto, pulsa **Ctrl + A** (selecciona todo) y después **Ctrl + C** (copia).
Para **pegar**: **Ctrl + V**.

---

## Paso 1 — Crear la hoja de cálculo

1. Entra a <https://drive.google.com> con tu cuenta.
2. Arriba a la izquierda: **+ Nuevo** → **Hojas de cálculo de Google** → **Hoja de cálculo en blanco**.
3. Arriba a la izquierda, donde dice *Hoja de cálculo sin título*, haz clic y escribe:
   **VentasMaker – Ale ventas Alerce**. Pulsa Enter.

No escribas nada en la hoja: el programa va a crear todo solo.

## Paso 2 — Abrir el editor de programas (Apps Script)

1. En el menú de la hoja: **Extensiones** → **Apps Script**.
2. Se abre una pestaña nueva con un editor. A la izquierda verás un archivo llamado
   **Código.gs** (o *Code.gs*), con algo como `function myFunction() { }`.
3. Arriba a la izquierda, donde dice *Proyecto sin título*, haz clic y escribe
   **VentasMaker backend**. Pulsa **Cambiar nombre**.

## Paso 3 — Mostrar el archivo de configuración

1. En la barra de la izquierda (los iconos), haz clic en el **engranaje ⚙️
   (Configuración del proyecto)**.
2. Marca la casilla **"Mostrar el archivo de manifiesto «appsscript.json» en el editor"**.
3. Vuelve al editor con el icono **`< >` (Editor)**, en la misma barra.
   Ahora a la izquierda aparecen dos archivos: `appsscript.json` y `Código.gs`.

## Paso 4 — Pegar la configuración

1. Clic en **appsscript.json** (a la izquierda).
2. Clic dentro del texto → **Ctrl + A** → **Suprimir**: el archivo queda vacío.
3. Abre el archivo `appsscript.json` de esta carpeta, copia todo (**Ctrl + A**, **Ctrl + C**)
   y pégalo en el editor (**Ctrl + V**).
4. Guarda con **Ctrl + S** (o el icono del disquete 💾).

## Paso 5 — Pegar el programa

1. Clic en **Código.gs** (a la izquierda).
2. Clic dentro del texto → **Ctrl + A** → **Suprimir**.
3. Abre `Code.gs` de esta carpeta, copia todo y pégalo en el editor.
   Es largo (unas 960 líneas): comprueba que la **última línea** pegada sea `}`.
4. Guarda con **Ctrl + S**. Si aparece un error en rojo al guardar, casi siempre
   es porque faltó copiar un trozo: repite los pasos 2 y 3.

## Paso 6 — Instalar (crea las pestañas y el usuario administrador)

1. Arriba, al lado de los botones **▷ Ejecutar** y **Depurar**, hay una lista
   desplegable con el nombre de una función. Ábrela y elige **`instalar`**.
2. Pulsa **▷ Ejecutar**.
3. La primera vez Google pide permiso. Esto es normal: el programa es tuyo y
   Google avisa porque no lo publicó una empresa.
   - **Revisar permisos** → elige **tu cuenta**.
   - Si aparece **"Google no ha verificado esta aplicación"**: clic en
     **Configuración avanzada** (abajo a la izquierda) → **Ir a VentasMaker backend (no seguro)**.
   - Revisa la lista de permisos y pulsa **Permitir**. Pide:
     - ver y editar **solo esta hoja**;
     - guardar en tu Drive **solo las fotos que suba el panel**;
     - enviarte **el correo del resumen diario**;
     - programar el **reporte de cada noche**;
     - leer el catálogo publicado (para cargar los productos).
4. Abajo se abre el **Registro de ejecución**. Espera a que diga *Ejecución completada*.
   Verás una línea así:

   ```
   Usuario: admin   Clave inicial: Ab12Cd34Ef56Gh   ← el panel pedirá cambiarla al entrar
   ```

   **Copia esa clave inicial** y guárdala en un lugar seguro (por ejemplo, anótala
   en papel). **No se vuelve a mostrar.** Si la pierdes, mira «Problemas frecuentes».

Si vuelves a la pestaña de la hoja verás pestañas nuevas abajo: *Productos,
Ventas, Movimientos, Config, Registro* (la de *Usuarios* queda oculta a propósito).

## Paso 7 — Cargar los 440 productos del catálogo actual

1. En la lista de funciones elige **`importarSemilla`** → **▷ Ejecutar**.
2. Espera a que el registro diga **"Importados 440 productos."**
3. En la hoja, la pestaña **Productos** ya tiene todo: nombres, precios, stock y fotos.

## Paso 8 — Activar el reporte automático de cada noche

1. Elige **`instalarDisparadores`** → **▷ Ejecutar**.
2. El registro dirá **"Disparador diario instalado."** Desde hoy, a las 23:00 se
   actualizan solas las pestañas *Resumen diario / semanal / mensual / anual*.

## Paso 9 — Publicar el backend y obtener el enlace

1. Arriba a la derecha, botón azul **Implementar** → **Nueva implementación**.
2. Al lado de *Seleccionar tipo* hay un **engranaje ⚙️** → elige **Aplicación web**.
3. Completa así (**es importante que quede exactamente así**):

   | Campo | Qué poner |
   |---|---|
   | Descripción | `v1` |
   | Ejecutar como | **Yo** (tu correo) |
   | Quién tiene acceso | **Cualquier usuario** |

   *¿«Cualquier usuario» es peligroso?* No: así el catálogo puede leer los productos
   sin que los clientes inicien sesión. Todo lo demás (vender, ver reportes, cambiar
   stock) exige usuario y clave del panel.
4. Pulsa **Implementar**. Si vuelve a pedir permisos, acéptalos igual que en el paso 6.
5. Aparece **URL de la aplicación web**, que termina en **`/exec`**. Pulsa **Copiar**.
6. **Envíale ese enlace al programador** (por WhatsApp o correo). Él lo conecta al
   sitio; tarda unos minutos.

**Prueba rápida (opcional):** pega el enlace en una pestaña nueva y añade al final
`?accion=catalogo`. Debe aparecer mucho texto que empieza con `{"ok":true`. Si
ves eso, el backend funciona.

## Paso 10 — Primer ingreso al panel

Cuando el programador te confirme que conectó el enlace:

1. Entra a <https://seiler18.github.io/VentasMaker/admin.html>.
2. Usuario **`admin`** y la **clave inicial** del paso 6.
3. El panel te pedirá **cambiar la clave**: elige una de al menos 10 caracteres,
   con letras y números, que no uses en ningún otro sitio.
4. En **Usuarios → Nuevo usuario** crea una cuenta **Vendedor** para cada persona
   que atienda. El vendedor solo puede vender: no ve costos, no cambia stock ni
   anula ventas. Su primera clave también se cambia al entrar.
5. En **Ajustes** revisa los datos de la tienda y, si quieres, escribe tu correo
   para recibir el **resumen de ventas cada noche**.

---

## Reglas para mantenerlo seguro

- **No compartas la hoja como "Editor"** con nadie que no deba ser administrador:
  quien puede editar la hoja puede cambiar el programa. Los vendedores usan el
  **panel**, no la hoja. Si alguien solo debe mirar, compártela como **Lector**.
- **No cambies el nombre de las pestañas** (*Productos, Ventas…*) ni de los
  encabezados de la fila 1. Sí puedes mover columnas y editar datos.
- El **stock** conviene cambiarlo desde el panel (Inventario → Ajustar stock), no
  a mano en la hoja: así queda registrado quién lo cambió y por qué.
- Activa la **verificación en dos pasos** en tu cuenta de Google
  (<https://myaccount.google.com/security>). Quien entre a tu cuenta entra a la tienda.
- La clave del panel **no es** la de Google, y no deben ser iguales.

## Cuando el programador envíe una versión nueva del programa

1. Reemplaza el contenido de **Código.gs** como en el paso 5 y guarda.
2. **Implementar** → **Gestionar implementaciones** → selecciona la que existe →
   **lápiz ✏️ (Editar)** → en *Versión* elige **Nueva versión** → **Implementar**.

   **No uses «Nueva implementación»**: esa crea un enlace distinto y el sitio
   dejaría de conectarse.

## Problemas frecuentes

| Qué pasa | Qué hacer |
|---|---|
| Perdí la clave del admin | En Apps Script elige **`restablecerAdmin`** → Ejecutar. El registro muestra una clave nueva (el panel pedirá cambiarla). Las sesiones abiertas del admin se cierran. |
| `importarSemilla` dice *"Productos ya tiene datos"* | Ya estaba cargado; no hace falta repetirlo. Es a propósito, para no borrar datos reales. |
| Error *"Falta la hoja …"* o *"Falta ejecutar instalar()"* | Ejecuta **`instalar`** otra vez: no borra nada, solo completa lo que falte. |
| El catálogo no muestra un cambio hecho a mano en la hoja | Recarga la página: los cambios en *Productos* o *Config* se ven al instante. Si editaste de otra forma (pegando desde otra planilla con un programa), haz cualquier cambio desde el panel o espera unas horas. |
| El sitio o el panel tardan mucho, o dicen «Google está tardando» | Es Google: a veces Apps Script tarda en responder. El catálogo se sigue viendo y el panel reintenta solo. Si pasa todo el día, mira en Apps Script **Ejecuciones** (ícono ☰ a la izquierda) cuánto duran y si hay errores, y avisa al programador. |
| El panel dice *"Sesión caducada"* | Las sesiones duran 6 horas. Vuelve a entrar. |
| *"Demasiados intentos"* al entrar | Espera 15 minutos (protección contra quien intente adivinar claves). |
| Al ejecutar sale *"Se requiere autorización"* | Repite la parte de permisos del paso 6. |
