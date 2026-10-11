export interface ColumnPrefs {
  readonly files: boolean
  readonly source: boolean
  readonly preview: boolean
}

export interface WorkbenchRepository {
  loadColumns(): Partial<ColumnPrefs> | null
  storeColumns(columns: ColumnPrefs): void
}

const KEY = 'co-write.columns'

/** Column visibility is a per-machine preference; it lives in the renderer's localStorage. */
export function createWorkbenchRepository(storage: Storage | undefined): WorkbenchRepository {
  return {
    loadColumns() {
      try {
        const raw = storage?.getItem(KEY)
        if (!raw) return null
        const value: unknown = JSON.parse(raw)
        if (typeof value !== 'object' || value === null) return null
        const pick = (key: keyof ColumnPrefs) => {
          const flag = (value as Record<string, unknown>)[key]
          return typeof flag === 'boolean' ? { [key]: flag } : {}
        }
        return { ...pick('files'), ...pick('source'), ...pick('preview') }
      } catch {
        return null
      }
    },
    storeColumns(columns) {
      try {
        storage?.setItem(KEY, JSON.stringify(columns))
      } catch {
        // Preferences are a convenience; losing them is fine.
      }
    },
  }
}

export const workbenchRepository = createWorkbenchRepository(
  typeof localStorage === 'undefined' ? undefined : localStorage,
)
