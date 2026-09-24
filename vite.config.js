import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/* Content-Security-Policy: solo en el build. En `npm run dev` Vite inyecta
   estilos y el cliente de recarga en línea, y una CSP estricta los bloquearía.
   GitHub Pages no deja poner cabeceras, así que va como <meta>: cubre todo
   salvo frame-ancestors (el anti-clickjacking), que se resuelve en JS en
   src/lib/marco.js.

   connect-src: el backend de Apps Script responde desde script.google.com y
   redirige a script.googleusercontent.com — hacen falta los dos.
   img-src: las imágenes subidas desde el panel viven en Drive (lh3). */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com",
  "connect-src 'self' https://script.google.com https://script.googleusercontent.com",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

function csp() {
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml(html) {
      // Justo después del charset, que debe quedar en los primeros bytes.
      return html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`)
    },
  }
}

/* base = "/NOMBRE-DEL-REPO/" porque se publica en seiler18.github.io/VentasMaker/.
   Con un dominio propio pasaría a ser '/'. */
export default defineConfig({
  base: '/VentasMaker/',
  plugins: [csp()],
  build: {
    rollupOptions: {
      input: {
        tienda: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
})
