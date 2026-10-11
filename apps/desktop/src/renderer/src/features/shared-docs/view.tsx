import { Eye, Plus, RefreshCw, Users } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { IconButton, ListRow, SectionHeader } from '@/components/ui/section'
import { useAccount } from '@/features/account/model'
import { useDocument } from '@/features/document/model'
import { workbenchIntents } from '@/features/workbench/intent'
import { cn } from '@/lib/utils'
import { sharedDocsIntents } from './intent'
import { useSharedDocs } from './model'

/** The server half of the files column: documents shared with the signed-in user. */
export function SharedDocsView() {
  const docs = useSharedDocs((s) => s.state)
  const account = useAccount((s) => s.state)
  const document = useDocument((s) => s.state)
  const activeId = 'ref' in document && document.ref.kind === 'remote' ? document.ref.docId : null

  useEffect(() => {
    void sharedDocsIntents.refresh()
    return sharedDocsIntents.listen()
  }, [])

  return (
    <section
      aria-label="Shared documents"
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col pt-1"
    >
      <SectionHeader title="Shared">
        {account.tag === 'signedIn' && (
          <>
            <IconButton
              label="New shared document"
              onClick={() => workbenchIntents.openDialog('new-shared')}
            >
              <Plus />
            </IconButton>
            <IconButton
              label="Refresh"
              disabled={docs.tag === 'loading'}
              onClick={() => void sharedDocsIntents.refresh()}
            >
              <RefreshCw className={cn(docs.tag === 'loading' && 'animate-spin')} />
            </IconButton>
          </>
        )}
      </SectionHeader>
      <div className="min-h-0 overflow-y-auto pb-3">
        {account.tag !== 'signedIn' ? (
          <div className="flex flex-col items-start gap-2 px-3 py-1">
            <p className="text-xs text-muted-foreground">Sign in to write together.</p>
            <Button
              size="sm"
              variant="outline"
              disabled={account.tag === 'restoring'}
              onClick={() => workbenchIntents.openDialog('sign-in')}
            >
              Sign in
            </Button>
          </div>
        ) : docs.tag === 'hidden' ? null : (
          <>
            {docs.docs.map((doc) => (
              <ListRow
                key={doc.id}
                active={doc.id === activeId}
                onClick={() => void sharedDocsIntents.open(doc)}
                title={
                  doc.owner === account.username
                    ? doc.title
                    : `${doc.title} — shared by ${doc.owner}`
                }
              >
                {doc.role === 'viewer' ? (
                  <Eye className="text-muted-foreground" aria-label="read-only" />
                ) : (
                  <Users className="text-muted-foreground" />
                )}
                <span className="truncate">{doc.title}</span>
                {doc.owner !== account.username && (
                  <span className="ml-auto truncate pl-2 text-[11px] text-muted-foreground">
                    {doc.owner}
                  </span>
                )}
              </ListRow>
            ))}
            {docs.docs.length === 0 && docs.tag === 'ready' && (
              <p className="px-3 py-1 text-xs text-muted-foreground">No shared documents yet.</p>
            )}
            {docs.tag === 'failed' && (
              <p role="alert" className="px-3 py-1 text-xs text-destructive">
                {docs.reason}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
