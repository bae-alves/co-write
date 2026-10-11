import { RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { IconButton } from '@/components/ui/section'
import { cn } from '@/lib/utils'
import { serverStatusIntents } from './intent'
import { useServerStatus } from './model'

export function ServerStatusView() {
  const status = useServerStatus((s) => s.state)

  useEffect(() => {
    void serverStatusIntents.checkServer()
  }, [])

  return (
    <div className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          status.tag === 'online'
            ? 'bg-success'
            : status.tag === 'offline'
              ? 'bg-destructive'
              : 'bg-muted-foreground',
        )}
      />
      <span
        role="status"
        className="max-w-64 truncate"
        title={status.tag === 'offline' ? status.reason : undefined}
      >
        {status.tag === 'idle' && 'Server not checked'}
        {status.tag === 'checking' && 'Checking server…'}
        {status.tag === 'online' && `Server online (v${status.version})`}
        {status.tag === 'offline' && `Server offline: ${status.reason}`}
      </span>
      <IconButton
        label="Check server"
        className="size-5"
        disabled={status.tag === 'checking'}
        onClick={() => void serverStatusIntents.checkServer()}
      >
        <RefreshCw className={cn(status.tag === 'checking' && 'animate-spin')} />
      </IconButton>
    </div>
  )
}
