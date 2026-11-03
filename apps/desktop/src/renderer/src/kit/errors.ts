/** A message fit for the screen: Electron prefixes errors thrown by IPC handlers; that is noise. */
export function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return (
    text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Something went wrong'
  )
}
