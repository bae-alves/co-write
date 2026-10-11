import { DocumentStatusView, PeersView } from '@/features/document/view'
import { ServerStatusView } from '@/features/server-status/view'

export function StatusBar() {
  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 bg-surface px-3 text-[11px] text-subtle-foreground">
      <DocumentStatusView />
      <div className="ml-auto flex items-center gap-3">
        <PeersView />
        <ServerStatusView />
      </div>
    </footer>
  )
}
