const fmtCLP = new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 })
export const clp = (n) => fmtCLP.format(Math.round(Number(n) || 0))

const fmtNum = new Intl.NumberFormat('es-CL')
export const num = (n) => fmtNum.format(Number(n) || 0)

export function fechaHora(f) {
  const d = new Date(f)
  if (isNaN(d)) return ''
  return d.toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })
}

/* Solo la hora ("10:49"). No sirve cortar fechaHora por espacios: en es-CL
   termina en "a. m." y quedaba "m.". */
export function hora(f) {
  const d = new Date(f)
  if (isNaN(d)) return ''
  return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
}

export function hoyISO(desplazarDias = 0) {
  const d = new Date(Date.now() + desplazarDias * 86400000)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/* Para buscar sin que importen tildes ni mayúsculas: "pantalon" encuentra
   "Pantalón". */
export const normalizar = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
