import type { MemberRequest } from '@co-write/shared'
import { Button } from '@/components/ui/button'
import { Dialog, Field } from '@/components/ui/dialog'
import { accountIntents } from '@/features/account/intent'
import { useAccount } from '@/features/account/model'
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
  const dialog = workbench.tag === 'ready' ? workbench.dialog : null
  if (!dialog) return null
  const common = { error: dialog.error, busy: dialog.busy, onClose: close }

  switch (dialog.kind) {
    case 'new-file':
      return (
        <Dialog
          {...common}
          title="New file"
          description="Created in the open folder. Sub-folders are fine."
          onSubmit={(form) =>
            void workbenchIntents.submitDialog(() => projectIntents.createFile(text(form, 'name')))
          }
          actions={
            <Button size="sm" type="submit">
              Create
            </Button>
          }
        >
          <Field label="File name" name="name" placeholder="notes/idea.md" autoFocus required />
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

    case 'sign-in':
      return (
        <Dialog
          {...common}
          title="Sign in"
          description="Your co-write server account. New here? Pick a name and create one."
          onSubmit={(form, submitter) =>
            void workbenchIntents.submitDialog(() =>
              accountIntents.signIn(
                submitter === 'register' ? 'register' : 'login',
                text(form, 'username'),
                text(form, 'password'),
              ),
            )
          }
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
            required
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            required
          />
        </Dialog>
      )

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
            description="Editors can change the document; viewers can only read it."
            onSubmit={(form) =>
              void workbenchIntents.submitDialog(() =>
                sharedDocsIntents.invite(
                  text(form, 'username'),
                  text(form, 'role') as MemberRequest['role'],
                ),
              )
            }
            actions={
              <Button size="sm" type="submit">
                Invite
              </Button>
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
