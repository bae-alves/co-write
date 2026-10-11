import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A sidebar section header: small caps title on the left, icon actions on the right. */
export function SectionHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-8 shrink-0 items-center justify-between gap-2 pr-1.5 pl-3">
      <h2 className="truncate text-[11px] font-semibold tracking-wider text-subtle-foreground uppercase">
        {title}
      </h2>
      <div className="flex items-center">{children}</div>
    </div>
  )
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: { label: string } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'grid size-6 place-items-center rounded-md text-subtle-foreground transition-colors hover:bg-raised hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

/** A row in a sidebar list (file, folder, shared document). */
export function ListRow({
  active,
  depth = 0,
  className,
  children,
  ...props
}: { active?: boolean; depth?: number } & ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      style={{ paddingLeft: `${12 + depth * 12}px` }}
      className={cn(
        'flex h-6.5 w-full items-center gap-1.5 pr-2 text-left text-[13px] transition-colors focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset [&_svg]:size-3.5 [&_svg]:shrink-0',
        active
          ? 'bg-raised text-foreground'
          : 'text-subtle-foreground hover:bg-raised/50 hover:text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
