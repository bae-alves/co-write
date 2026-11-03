import type { MemberRequest } from '@co-write/shared'
import { Button } from '@/components/ui/button'
import { Dialog, Field } from '@/components/ui/dialog'
import { accountIntents } from '@/features/account/intent'
import { useAccount } from '@/features/account/model'
import { AccountDialog } from '@/features/security/view'
import { serverStatusIntents } from '@/features/server-status/intent'
import { useServerStatus } from '@/features/server-status/model'
import { isRemoteOpen, useDocument } from '@/features/document/model'
import { projectIntents } from '@/features/project/intent'
import { sharedDocsIntents } from '@/features/shared-docs/intent'
import { workbenchIntents } from '@/features/workbench/intent'
import { useWorkbench } from '@/features/workbench/model'

const text = (form: FormData, name: string) => String(form.get(name) ?? '')
const close = () => workbenchIntents.closeDialog()

/** Whichever dialog the workbench model says is open. Each one only wires a form to an intent. */
export function Dialogs() {
  const workbench = useWorkbench((s) => s.state)
  const account = useAccount((s) => s.state)
  const document = useDocument((s) => s.state)
  const status = useServerStatus((s) => s.state)
  const dialog = workbench.tag === 'ready' ? workbench.dialog : null
  if (!dialog) return null
  const common = {
    error: dialog.error,
    notice: dialog.notice ?? null,
    busy: dialog.busy,
    onClose: close,
  }

  switch (dialog.kind) {
    case 'new-file':
      return (
        <Dialog
          {...common}
          title="New file"
          description="Created in the open folder. Sub-folders are fine, and so is any text type: notes.md, config.yaml, data.json. Without an extension it becomes Markdown."
          onSubmit={(form) =>
            void workbenchIntents.submitDialog(() => projectIntents.createFile(text(form, 'name')))
          }
          actions={
            <Button size="sm" type="submit">
              Create
            </Button>
          }
        >
          <Field
            label="File name"
            name="name"
            placeholder="notes/idea.md or config.yaml"
            autoFocus
            required
          />
        </Dialog>
      )

    case 'new-shared':
      return (
        <Dialog
          {...common}
          title="New shared document"
          description="Lives on the server; invite people to it once it is open."
          onSubmit={(form) =>
            void workbenchIntents.submitDialog(() => sharedDocsIntents.create(text(form, 'title')))
          }
          actions={
            <Button size="sm" type="submit">
              Create
            </Button>
          }
        >
          <Field label="Title" name="title" placeholder="Meeting notes" autoFocus required />
        </Dialog>
      )

    case 'sign-in': {
      const providers = status.tag === 'online' ? status.oauth : []
      return (
        <Dialog
          {...common}
          title="Sign in"
          description="Your co-write server account is a key that stays on this machine. New here? Pick a name and create one."
          onSubmit={(form, submitter) => {
            const username = text(form, 'username')
            void workbenchIntents.submitDialog(async () => {
              if (submitter === 'copy-key') {
                return (
                  (await accountIntents.copyPublicKey()) ?? {
                    notice: 'Public key copied to the clipboard.',
                  }
                )
              }
              if (submitter === 'import-key') {
                const { message, error } = await accountIntents.importKey()
                return error ?? (message ? { notice: message } : { notice: '' })
              }
              if (submitter?.startsWith('provider:')) {
                return accountIntents.signInWithProvider(submitter.slice('provider:'.length))
              }
              return submitter === 'register'
                ? accountIntents.register(username)
                : accountIntents.signIn(username)
            })
          }}
          actions={
            <>
              <Button size="sm" variant="ghost" type="submit" value="register">
                Create account
              </Button>
              <Button size="sm" type="submit" value="login">
                Sign in
              </Button>
            </>
          }
        >
          <Field
            label="Username"
            name="username"
            autoComplete="username"
            defaultValue={account.tag === 'signedOut' ? '' : undefined}
            autoFocus
          />
          {providers.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-subtle-foreground">Or sign in with a provider:</p>
              <div className="flex flex-wrap gap-2">
                {providers.map((provider) => (
                  <Button
                    key={provider.id}
                    size="sm"
                    variant="outline"
                    type="submit"
                    value={`provider:${provider.id}`}
                  >
                    {provider.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-subtle-foreground">
            <span>Signing in from another computer?</span>
            <button type="submit" value="import-key" className="underline hover:text-foreground">
              Import this account’s key
            </button>
            <button type="submit" value="copy-key" className="underline hover:text-foreground">
              Copy this machine’s public key
            </button>
          </div>
        </Dialog>
      )
    }

    case 'server':
      return (
        <Dialog
          {...common}
          title="Server"
          description="co-write works fully offline. To write together, connect to your own server: its address, such as https://write.example.com."
          onSubmit={(form, submitter) =>
            void workbenchIntents.submitDialog(() =>
              submitter === 'disconnect'
                ? serverStatusIntents.disconnect()
                : serverStatusIntents.connect(text(form, 'url')),
            )
          }
          actions={
            <>
              {status.tag !== 'unset' && (
                <Button size="sm" variant="ghost" type="submit" value="disconnect">
                  Disconnect
                </Button>
              )}
              <Button size="sm" type="submit" value="connect">
                Connect
              </Button>
            </>
          }
        >
          <Field
            label="Server address"
            name="url"
            type="url"
            placeholder="https://write.example.com"
            autoFocus
          />
        </Dialog>
      )

    case 'display-name':
      return (
        <Dialog
          {...common}
          title="Your name"
          description="This server has no accounts. The name is shown on your cursor to the people you write with."
          onSubmit={(form) =>
            void workbenchIntents.submitDialog(async () =>
              accountIntents.setDisplayName(text(form, 'name')),
            )
          }
          actions={
            <Button size="sm" type="submit">
              Save
            </Button>
          }
        >
          <Field
            label="Display name"
            name="name"
            maxLength={32}
            defaultValue={account.tag === 'anonymous' ? (account.name ?? '') : ''}
            autoFocus
            required
          />
        </Dialog>
      )

    case 'account':
      return <AccountDialog onClose={close} />

    case 'share':
      if (document.tag === 'local') {
        return (
          <Dialog
            {...common}
            title={`Share ${document.title}`}
            description="Uploads a copy to the server as a new shared document and opens it. The file on disk is left as it is."
            onSubmit={() => void workbenchIntents.submitDialog(() => sharedDocsIntents.publish())}
            actions={
              <Button size="sm" type="submit">
                Share
              </Button>
            }
          />
        )
      }
      if (isRemoteOpen(document)) {
        return (
          <Dialog
            {...common}
            title={`Invite to ${document.title}`}
            description="Editors can change the document; viewers can only read it. Changing someone’s role, or removing them, takes effect at once."
            onSubmit={(form, submitter) =>
              void workbenchIntents.submitDialog(async () => {
                const username = text(form, 'username')
                if (submitter === 'remove') {
                  return (
                    (await sharedDocsIntents.removeMember(username)) ?? {
                      notice: `${username.trim()} no longer has access. Their open sessions were closed.`,
                    }
                  )
                }
                return sharedDocsIntents.invite(
                  username,
                  text(form, 'role') as MemberRequest['role'],
                )
              })
            }
            actions={
              <>
                <Button size="sm" variant="ghost" type="submit" value="remove">
                  Remove
                </Button>
                <Button size="sm" type="submit" value="invite">
                  Invite
                </Button>
              </>
            }
          >
            <Field label="Username" name="username" autoFocus required />
            <label className="flex flex-col gap-1 text-xs text-subtle-foreground">
              Role
              <select
                name="role"
                defaultValue="editor"
                className="h-8 rounded-md bg-input px-2 text-sm text-foreground focus:ring-1 focus:ring-ring focus:outline-none"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
          </Dialog>
        )
      }
      return null
  }
}
