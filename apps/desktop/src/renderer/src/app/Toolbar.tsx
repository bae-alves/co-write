import { LogOut, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/section'
import { accountIntents } from '@/features/account/intent'
import { useAccount } from '@/features/account/model'
import { isOpen, isRemoteOpen, useDocument } from '@/features/document/model'
import { useProject } from '@/features/project/model'
import { useServerStatus } from '@/features/server-status/model'
import { ColumnToggles } from '@/features/workbench/view'
import { workbenchIntents } from '@/features/workbench/intent'

/** Column toggles on the left (VS Code style), what is open in the middle, account on the right. */
export function Toolbar() {
  const account = useAccount((s) => s.state)
  const document = useDocument((s) => s.state)
  const project = useProject((s) => s.state)
  const online = useServerStatus((s) => s.state.tag === 'online')

  const canShare =
    online &&
    account.tag === 'signedIn' &&
    (document.tag === 'local' || (isRemoteOpen(document) && document.role === 'owner'))
  const location =
    'ref' in document
      ? document.ref.kind === 'local'
        ? `${project.tag === 'open' ? `${project.name} / ` : ''}${document.ref.path}`
        : `Shared / ${document.title}`
      : null

  return (
    <header className="flex h-10 shrink-0 items-center gap-3 bg-surface pr-2 pl-2">
      <ColumnToggles />
      <div className="flex min-w-0 flex-1 items-center gap-2 text-xs text-subtle-foreground">
        {location && <span className="truncate">{location}</span>}
        {document.tag === 'local' && document.dirty && (
          <span
            aria-label="Unsaved changes"
            title="Unsaved changes"
            className="size-1.5 shrink-0 rounded-full bg-primary"
          />
        )}
        {isOpen(document) && isRemoteOpen(document) && document.role === 'viewer' && (
          <span className="rounded-sm bg-raised px-1.5 py-px text-[10px] tracking-wide uppercase">
            read-only
          </span>
        )}
      </div>
      {canShare && (
        <Button size="sm" variant="outline" onClick={() => workbenchIntents.openDialog('share')}>
          <Share2 className="size-3.5" />
          {document.tag === 'local' ? 'Share' : 'Invite'}
        </Button>
      )}
      {account.tag === 'signedIn' ? (
        <div className="flex items-center gap-1 text-xs text-subtle-foreground">
          <span className="max-w-32 truncate">{account.username}</span>
          <IconButton label="Sign out" onClick={() => void accountIntents.signOut()}>
            <LogOut />
          </IconButton>
        </div>
      ) : (
        online && (
          <Button
            size="sm"
            variant="ghost"
            disabled={account.tag !== 'signedOut'}
            onClick={() => workbenchIntents.openDialog('sign-in')}
          >
            Sign in
          </Button>
        )
      )}
    </header>
  )
}
