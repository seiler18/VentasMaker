/* Exporta a CSV para abrir en Excel.

   Dos detalles que no son decorativos:
   - BOM UTF-8 al inicio: sin él, Excel en Windows abre "Pantalón" como
     "PantalÃ³n".
   - Punto y coma como separador: Excel con configuración regional chilena
     usa la coma para decimales y espera ";" entre columnas.
   - Una celda que empieza por = + - @ se prefija con apóstrofo: si no, Excel
     la ejecutaría como fórmula al abrir el archivo (inyección CSV). */
export function descargarCSV(nombre, filas, columnas) {
  const celda = (v) => {
    let s = String(v ?? '')
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const txt = [columnas.join(';'), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(';'))].join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
