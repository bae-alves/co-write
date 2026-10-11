import { X } from 'lucide-react'
import { useEffect, type ComponentProps, type FormEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A small modal form. Fully controlled by its caller: it renders while mounted, reports
 * dismissal (Escape, backdrop, ×) through `onClose`, and hands the submitted form to `onSubmit`.
 */
export function Dialog({
  title,
  description,
  error,
  busy,
  onClose,
  onSubmit,
  children,
  actions,
}: {
  title: string
  description?: ReactNode
  error?: string | null
  busy?: boolean
  onClose: () => void
  onSubmit: (form: FormData, submitter: string | null) => void
  children?: ReactNode
  actions: ReactNode
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    onSubmit(new FormData(event.currentTarget), submitter?.value || null)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[14vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={submit}
        className="w-[min(420px,calc(100vw-32px))] rounded-lg bg-raised p-5 shadow-2xl shadow-black/40"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {description && <p className="mt-1 text-xs text-subtle-foreground">{description}</p>}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <fieldset disabled={busy} className="flex flex-col gap-3">
          {children}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="mt-1 flex justify-end gap-2">{actions}</div>
        </fieldset>
      </form>
    </div>
  )
}

export function Field({ label, className, ...props }: { label: string } & ComponentProps<'input'>) {
  return (
    <label className="flex flex-col gap-1 text-xs text-subtle-foreground">
      {label}
      <input
        className={cn(
          'h-8 rounded-md bg-input px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-none',
          className,
        )}
        {...props}
      />
    </label>
  )
}
