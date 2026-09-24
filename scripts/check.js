/* Verificador previo al build (va dentro de `npm run build`, así que un
   fallo rompe el deploy en vez de llegar a producción).

   Comprueba lo que Vite no ve:
   1. Colores literales fuera de tokens.css (regla heredada de WebMaker).
   2. Duraciones literales en transiciones/animaciones.
   3. Imágenes del catálogo semilla que no existen en public/img
      (GitHub Pages distingue mayúsculas; Windows no).
   4. Atributos style="" en el HTML generado: la CSP los bloquearía.
   5. Secretos que no deben llegar al repo público. */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const fallos = []
const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function archivos(dir, ext) {
  const out = []
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) out.push(...archivos(p, ext))
    else if (ext.includes(extname(n))) out.push(p)
  }
  return out
}

// 1 y 2
for (const f of archivos(join(raiz, 'src/styles'), ['.css'])) {
  if (f.endsWith('tokens.css')) continue
  readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    const sinComentario = l.replace(/\/\*.*?\*\//g, '')
    if (/#[0-9a-fA-F]{3,8}\b/.test(sinComentario)) fallos.push(`${f}:${i + 1} color literal: ${l.trim()}`)
    if (/rgba?\((?!0, 0, 0,)/.test(sinComentario)) fallos.push(`${f}:${i + 1} color literal: ${l.trim()}`)
    if (/(transition|animation)[^;]*\b\d+m?s\b/.test(sinComentario)) fallos.push(`${f}:${i + 1} duración literal: ${l.trim()}`)
  })
}

// 3
const semilla = JSON.parse(readFileSync(join(raiz, 'public/data/catalogo.json'), 'utf8'))
const imgs = new Set(readdirSync(join(raiz, 'public/img')))
for (const p of semilla) {
  if (p.imagen && !imgs.has(p.imagen.replace(/^img\//, ''))) fallos.push(`catalogo.json: falta ${p.imagen} (${p.nombre})`)
}
const skus = new Set()
for (const p of semilla) {
  if (skus.has(p.sku)) fallos.push(`catalogo.json: SKU duplicado ${p.sku}`)
  skus.add(p.sku)
}

// 4
for (const f of archivos(join(raiz, 'src'), ['.js'])) {
  readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    if (/<[a-z][^>]*\sstyle="/.test(l)) fallos.push(`${f}:${i + 1} atributo style="" (lo bloquea la CSP)`)
  })
}

// 5
const PATRONES = [/gh[opsu]_[A-Za-z0-9]{30,}/, /AIza[0-9A-Za-z_-]{35}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/]
for (const f of [...archivos(join(raiz, 'src'), ['.js', '.css']), ...archivos(join(raiz, 'backend'), ['.gs', '.json']),
                 join(raiz, 'index.html'), join(raiz, 'admin.html')].filter(existsSync)) {
  const t = readFileSync(f, 'utf8')
  if (PATRONES.some((r) => r.test(t))) fallos.push(`${f}: posible secreto en el código`)
}

if (fallos.length) {
  console.error(`✗ ${fallos.length} problema(s):\n  ` + fallos.join('\n  '))
  process.exit(1)
}
console.log(`✓ check: estilos, ${semilla.length} productos semilla, CSP y secretos en orden`)
