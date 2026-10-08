/** Content-Security-Policy for the renderer. Dev needs inline scripts/HMR sockets; prod does not. */
export function buildCsp(options: { dev: boolean; serverOrigin: string }): string {
  const { dev, serverOrigin } = options
  const wsOrigin = serverOrigin.replace(/^http/, 'ws')
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': dev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'connect-src': ["'self'", serverOrigin, wsOrigin, ...(dev ? ['ws://localhost:*'] : [])],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  }
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ')
}
