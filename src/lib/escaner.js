/* Lectura de códigos de barras con la cámara.

   Dos motores:
   - BarcodeDetector nativo (Chrome/Edge en Android, Chrome de escritorio):
     rápido y sin descargar nada.
   - ZXing como respaldo (Safari de iPhone, Firefox): se carga con import()
     dinámico, así que solo lo descarga quien abre la cámara en un navegador
     que no trae detector propio. El catálogo público nunca lo carga.

   Un lector USB/Bluetooth no necesita nada de esto: se comporta como un
   teclado que escribe el código y pulsa Enter en el campo enfocado. */

const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code']

export async function iniciarEscaner(video, alLeer) {
  let parado = false
  let ultimo = '', ultimoT = 0

  // Una misma etiqueta queda frente a la cámara varios fotogramas: sin esto
  // un solo escaneo descontaría 5 unidades.
  const emitir = (codigo) => {
    const ahora = Date.now()
    if (codigo === ultimo && ahora - ultimoT < 2000) return
    ultimo = codigo; ultimoT = ahora
    pitido()
    navigator.vibrate?.(60)
    alLeer(codigo)
  }

  if ('BarcodeDetector' in window) {
    const soportados = await window.BarcodeDetector.getSupportedFormats().catch(() => [])
    const formatos = FORMATOS.filter((f) => soportados.includes(f))
    if (formatos.length) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false,
      })
      video.srcObject = stream
      await video.play()
      const det = new window.BarcodeDetector({ formats: formatos })
      const bucle = async () => {
        if (parado) return
        try {
          const r = await det.detect(video)
          if (r[0]?.rawValue) emitir(r[0].rawValue)
        } catch { /* fotograma no listo */ }
        setTimeout(bucle, 150)
      }
      bucle()
      return () => { parado = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null }
    }
  }

  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  const lector = new BrowserMultiFormatReader()
  const control = await lector.decodeFromConstraints(
    { video: { facingMode: { ideal: 'environment' } }, audio: false }, video,
    (res) => { if (res && !parado) emitir(res.getText()) })
  return () => { parado = true; control.stop() }
}

let ctx
function pitido() {
  try {
    ctx ||= new AudioContext()
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.frequency.value = 1400
    g.gain.setValueAtTime(0.15, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12)
    o.connect(g).connect(ctx.destination)
    o.start(); o.stop(ctx.currentTime + 0.12)
  } catch { /* sin audio */ }
}
