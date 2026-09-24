/* Resuelve la ruta de imagen de un producto a una URL segura.

   Solo se aceptan dos orígenes, los mismos que valida el backend y los mismos
   que permite la CSP: rutas propias (img/…) y Drive (lh3.googleusercontent).
   Cualquier otra cosa se descarta en vez de pintarse: si alguien escribe a
   mano en la hoja una URL de un tercero, no se convierte en un píxel de
   rastreo dentro del catálogo. */
const BASE = import.meta.env.BASE_URL

export function urlImagen(ruta) {
  const r = String(ruta || '').trim()
  if (/^img\/[A-Za-z0-9._-]+\.(webp|jpe?g|png)$/.test(r)) return BASE + r
  if (/^https:\/\/lh3\.googleusercontent\.com\/d\/[A-Za-z0-9_-]+(=w\d+)?$/.test(r)) return r
  return ''
}

/* Reduce una foto del teléfono (4000px, varios MB) a 800px antes de subirla:
   sube en segundos con datos móviles y cabe de sobra en el límite del
   backend. Pasar por canvas además descarta los metadatos EXIF, que en una
   foto de celular incluyen la ubicación GPS de donde se tomó. */
export async function prepararImagen(archivo, lado = 800) {
  if (archivo.type && !archivo.type.startsWith('image/')) throw new Error('El archivo no es una imagen')
  const bmp = await createImageBitmap(archivo)
  const k = Math.min(1, lado / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k)
  c.height = Math.round(bmp.height * k)
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
  const aBlob = (tipo, q) => new Promise((ok) => c.toBlob(ok, tipo, q))
  let blob = await aBlob('image/webp', 0.8)
  // Safari antiguo no codifica WebP y devuelve PNG: entonces JPEG.
  if (!blob || blob.type !== 'image/webp') blob = await aBlob('image/jpeg', 0.82)
  const base64 = await new Promise((ok, mal) => {
    const fr = new FileReader()
    fr.onload = () => ok(String(fr.result).split(',')[1])
    fr.onerror = mal
    fr.readAsDataURL(blob)
  })
  return { base64, tipo: blob.type, previa: URL.createObjectURL(blob) }
}
