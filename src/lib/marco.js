/* Anti-clickjacking. GitHub Pages no permite la cabecera
   `Content-Security-Policy: frame-ancestors` ni `X-Frame-Options`, y la CSP
   en <meta> ignora frame-ancestors. Así que si la página se carga dentro de
   un iframe ajeno, se vacía: un botón "Cobrar" o "Anular venta" no puede
   quedar debajo de un clic engañoso de otro sitio. */
export function protegerMarco() {
  if (window.top !== window.self) {
    document.documentElement.innerHTML = ''
    try { window.top.location = window.self.location } catch { /* bloqueado: queda vacía */ }
    throw new Error('Cargado dentro de un marco')
  }
}
