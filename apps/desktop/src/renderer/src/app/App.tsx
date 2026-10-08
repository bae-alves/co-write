import { ServerStatusView } from '@/features/server-status/view'

export function App() {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-sm font-semibold">co-write</h1>
        <ServerStatusView />
      </header>
      <main className="flex flex-1 items-center justify-center text-muted-foreground">
        Editor goes here.
      </main>
    </div>
  )
}
