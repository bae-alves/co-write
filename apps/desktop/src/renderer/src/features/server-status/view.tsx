import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { serverStatusIntents } from './intent'
import { useServerStatus } from './model'

export function ServerStatusView() {
  const status = useServerStatus((s) => s.state)

  useEffect(() => {
    void serverStatusIntents.checkServer()
  }, [])

  return (
    <div className="flex items-center gap-3 text-sm">
      <span
        aria-hidden
        className={
          status.tag === 'online'
            ? 'size-2 rounded-full bg-success'
            : status.tag === 'offline'
              ? 'size-2 rounded-full bg-destructive'
              : 'size-2 rounded-full bg-muted-foreground'
        }
      />
      <span role="status" className="text-muted-foreground">
        {status.tag === 'idle' && 'Server not checked'}
        {status.tag === 'checking' && 'Checking server…'}
        {status.tag === 'online' && `Server online (v${status.version})`}
        {status.tag === 'offline' && `Server offline: ${status.reason}`}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={status.tag === 'checking'}
        onClick={() => void serverStatusIntents.checkServer()}
      >
        Check server
      </Button>
    </div>
  )
}
