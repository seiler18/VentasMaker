const DIAS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']
const NOMBRES = { lun: 'Lunes', mar: 'Martes', mie: 'Miércoles', jue: 'Jueves', vie: 'Viernes', sab: 'Sábado', dom: 'Domingo' }

/* El horario viene de una celda editable a mano: todo lo que no sea un
   tramo "HH:MM-HH:MM" en texto se trata como cerrado, en vez de romper el
   catálogo público. */
export function leerHorario(txt) {
  let h
  try { h = JSON.parse(txt) } catch { return {} }
  if (!h || typeof h !== 'object') return {}
  const limpio = {}
  for (const [k, v] of Object.entries(h)) {
    if (typeof v === 'string' && /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(v)) limpio[k] = v
  }
  return limpio
}

/* Estado de la tienda ahora mismo, en la hora del teléfono del visitante
   (la tienda y sus clientes están en la misma zona horaria). */
export function estado(horario, ahora = new Date()) {
  const min = ahora.getHours() * 60 + ahora.getMinutes()
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(horario[DIAS[ahora.getDay()]] || '')
  if (m) {
    const a = +m[1] * 60 + +m[2], c = +m[3] * 60 + +m[4]
    if (min >= a && min < c) return { abierto: true, texto: `Abierto · cierra a las ${m[3]}:${m[4]}` }
    if (min < a) return { abierto: false, texto: `Cerrado · abre hoy a las ${m[1]}:${m[2]}` }
  }
  for (let i = 1; i <= 7; i++) {
    const d = DIAS[(ahora.getDay() + i) % 7]
    const t = /^(\d{2}:\d{2})-/.exec(horario[d] || '')
    if (t) return { abierto: false, texto: `Cerrado · abre ${i === 1 ? 'mañana' : NOMBRES[d].toLowerCase()} a las ${t[1]}` }
  }
  return { abierto: false, texto: 'Cerrado' }
}

export function tablaHorario(horario) {
  return ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'].map((d) => ({
    dia: NOMBRES[d], tramo: horario[d] ? horario[d].replace('-', ' – ') : 'Cerrado',
  }))
}
