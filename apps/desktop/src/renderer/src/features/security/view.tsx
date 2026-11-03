import { KeyRound, Link2, Trash2 } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, Field } from '@/components/ui/dialog'
import { useAccount } from '@/features/account/model'
import { useServerStatus } from '@/features/server-status/model'
import { useSharedDocs } from '@/features/shared-docs/model'
import { securityIntents } from './intent'
import { useSecurity } from './model'

const text = (form: FormData, name: string) => String(form.get(name) ?? '')

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-separator pt-3 first:border-t-0 first:pt-0">
      <h3 className="text-[11px] font-semibold tracking-wider text-subtle-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  )
}

const small = 'h-7 px-2 text-xs'

/**
 * The signed-in account: this machine's key, the keys the account accepts, linked sign-in
 * providers, and deleting the account. Each button is a submit with a value saying what it does.
 */
export function AccountDialog({ onClose }: { onClose: () => void }) {
  const state = useSecurity((s) => s.state)
  const account = useAccount((s) => s.state)
  const status = useServerStatus((s) => s.state)
  const shared = useSharedDocs((s) => s.state)

  useEffect(() => {
    void securityIntents.open()
    return () => securityIntents.close()
  }, [])

  if (account.tag !== 'signedIn') return null
  const ready = state.tag === 'ready' ? state : null
  const providers = status.tag === 'online' ? status.oauth : []
  const owned = shared.tag === 'hidden' ? [] : shared.docs.filter((doc) => doc.role === 'owner')

  const act = (form: FormData, action: string | null) => {
    const [verb, argument = ''] = (action ?? '').split(':')
    switch (verb) {
      case 'add-key':
        return void securityIntents.addKey(text(form, 'publicKey'), text(form, 'label'))
      case 'remove-key':
        return void securityIntents.removeKey(Number(argument))
      case 'create-key':
        return void securityIntents.createLocalKey()
      case 'import-key':
        return void securityIntents.importLocalKey()
      case 'export-key':
        return void securityIntents.exportLocalKey()
      case 'copy-key':
        return void securityIntents.copyLocalPublicKey()
      case 'link':
        return void securityIntents.linkProvider(argument)
      case 'unlink':
        return void securityIntents.unlinkProvider(argument)
      case 'transfer':
        return void securityIntents.transferOwnership(argument, text(form, `transfer-${argument}`))
      case 'delete-account':
        return void securityIntents.deleteAccount(text(form, 'confirm'))
    }
  }

  return (
    <Dialog
      wide
      title={`Account · ${account.username}`}
      description="Sign in with a key that stays on your machine, or with a provider. Nothing here is a password."
      busy={!ready || ready.busy}
      error={ready?.error ?? null}
      notice={ready?.notice ?? null}
      onClose={onClose}
      onSubmit={act}
      actions={
        <Button size="sm" type="button" variant="ghost" onClick={onClose}>
          Done
        </Button>
      }
    >
      {/* Enter in a text field submits with the first submit button; make that one do nothing. */}
      <button type="submit" value="noop" hidden tabIndex={-1} aria-hidden />
      {!ready ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : (
        <>
          <Section title="This machine’s key">
            {ready.local ? (
              <>
                <p className="font-mono text-xs break-all text-foreground">
                  {ready.local.fingerprint}
                </p>
                {!ready.local.protected && (
                  <p className="text-xs text-warning">
                    No OS keychain here: the key is a file only you can read, not encrypted.
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    type="submit"
                    value="copy-key"
                    className={small}
                  >
                    Copy public key
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    type="submit"
                    value="export-key"
                    className={small}
                  >
                    Export…
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    type="submit"
                    value="import-key"
                    className={small}
                  >
                    Import…
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">This machine has no key.</p>
                <Button
                  size="sm"
                  variant="outline"
                  type="submit"
                  value="create-key"
                  className={small}
                >
                  Create key
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="submit"
                  value="import-key"
                  className={small}
                >
                  Import…
                </Button>
              </div>
            )}
          </Section>

          <Section title="Keys on this account">
            <ul className="flex flex-col gap-1">
              {ready.keys.map((key) => (
                <li key={key.id} className="flex items-center gap-2 text-xs">
                  <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-foreground">
                      {key.label || 'Unnamed key'}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {key.fingerprint}
                      {ready.local?.fingerprint === key.fingerprint && ' · this machine'}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    type="submit"
                    value={`remove-key:${key.id}`}
                    className={small}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <label className="flex flex-col gap-1 text-xs text-subtle-foreground">
              Add another device’s public key
              <textarea
                name="publicKey"
                rows={3}
                spellCheck={false}
                placeholder="-----BEGIN PUBLIC KEY-----"
                className="rounded-md bg-input px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-none"
              />
            </label>
            <div className="flex items-end gap-2">
              <Field label="Label" name="label" placeholder="desktop" className="w-40" />
              <Button size="sm" variant="outline" type="submit" value="add-key">
                Add key
              </Button>
            </div>
          </Section>

          {providers.length > 0 && (
            <Section title="Sign in with">
              <ul className="flex flex-col gap-1">
                {providers.map((provider) => {
                  const linked = ready.identities.find((item) => item.provider === provider.id)
                  return (
                    <li key={provider.id} className="flex items-center gap-2 text-xs">
                      <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {provider.label}
                        {linked && <span className="text-muted-foreground"> · {linked.login}</span>}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="submit"
                        value={`${linked ? 'unlink' : 'link'}:${provider.id}`}
                        className={small}
                      >
                        {linked ? 'Unlink' : 'Link'}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </Section>
          )}

          <Section title="Delete account">
            <p className="text-xs text-subtle-foreground">
              Removes your keys, linked providers, sessions and memberships
              {owned.length > 0
                ? ', and these documents you own — hand them to someone first to keep them:'
                : '.'}
            </p>
            {owned.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {owned.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-foreground">{doc.title}</span>
                    <input
                      name={`transfer-${doc.id}`}
                      placeholder="username"
                      aria-label={`New owner of ${doc.title}`}
                      className="h-7 w-28 rounded-md bg-input px-2 text-xs text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-none"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      type="submit"
                      value={`transfer:${doc.id}`}
                      className={small}
                    >
                      Hand over
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-end gap-2">
              <Field
                label={`Type ${account.username} to confirm`}
                name="confirm"
                autoComplete="off"
              />
              <Button size="sm" variant="outline" type="submit" value="delete-account">
                <Trash2 className="size-3.5" /> Delete
              </Button>
            </div>
          </Section>
        </>
      )}
    </Dialog>
  )
}
