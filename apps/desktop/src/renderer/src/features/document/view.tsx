import { Compartment, EditorState } from '@codemirror/state'
import { EditorView as CodeMirror, keymap } from '@codemirror/view'
import { FileText, Users, X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { previewIntents } from '@/features/preview/intent'
import { baseEditorExtensions, languageFor, markdownExtension } from '@/kit/codemirror'
import { cn } from '@/lib/utils'
import { documentIntents } from './intent'
import { isOpen, isRemoteOpen, useDocument, useTabs, type Tab } from './model'

/** Reports the first visible source line so the preview can follow, at most once per frame. */
function followScroll() {
  let frame = 0
  return CodeMirror.domEventHandlers({
    scroll(_event, view) {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop)
        previewIntents.followSource(view.state.doc.lineAt(block.from).number)
      })
    },
  })
}

/**
 * One tab's editor: CodeMirror bound to that document's Y.Text. Every open tab keeps its editor,
 * so cursor, scroll position and undo history are still there when you come back; inactive ones
 * stay laid out but invisible.
 */
function EditorHost({ tab, active }: { tab: Tab; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<CodeMirror | null>(null)
  const editable = useRef(new Compartment())
  const language = useRef(new Compartment())
  const { key, session, title, fileKind, readOnly } = tab

  useEffect(() => {
    const binding = documentIntents.binding(key)
    if (!host.current || !binding) return
    const isMarkdown = fileKind.preview === 'markdown'
    const editor = new CodeMirror({
      parent: host.current,
      state: EditorState.create({
        doc: binding.ytext.toString(),
        extensions: [
          baseEditorExtensions(),
          language.current.of(isMarkdown ? markdownExtension() : []),
          yCollab(binding.ytext, binding.awareness, { undoManager: binding.undoManager }),
          // yCollab only handles native historyUndo/Redo input events, which Chromium never fires for CodeMirror.
          keymap.of(yUndoManagerKeymap),
          editable.current.of(EditorState.readOnly.of(false)),
          followScroll(),
        ],
      }),
    })
    view.current = editor
    let stale = false
    if (!isMarkdown) {
      // Other grammars (YAML, TOML, XML, …) load on demand and apply when they arrive.
      void languageFor(title, fileKind.preview).then((extension) => {
        if (!stale && extension)
          editor.dispatch({ effects: language.current.reconfigure(extension) })
      })
    }
    return () => {
      stale = true
      view.current = null
      editor.destroy()
    }
  }, [key, session, title, fileKind])

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(EditorState.readOnly.of(readOnly)),
    })
  }, [readOnly, session])

  useEffect(() => {
    if (active) view.current?.focus()
  }, [active, session])

  return (
    <div
      ref={host}
      className={cn(
        'min-h-0 overflow-hidden',
        active ? 'flex-1' : 'pointer-events-none invisible absolute inset-0',
      )}
      aria-hidden={!active}
      inert={!active}
      aria-label={active ? 'Source' : undefined}
    />
  )
}

/** The source column: the active tab's editor, or why there is none. */
export function SourceView() {
  const state = useDocument((s) => s.state)
  const tabs = useTabs((s) => s.state)
  const editors = tabs.tag === 'open' ? tabs.tabs.filter((tab) => tab.session !== null) : []
  const showing = isOpen(state)

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {editors.map((tab) => (
        <EditorHost
          key={`${tab.key}:${tab.session}`}
          tab={tab}
          active={showing && tabs.tag === 'open' && tabs.active === tab.key}
        />
      ))}
      {!showing && <SourcePlaceholder />}
    </div>
  )
}

function SourcePlaceholder() {
  const state = useDocument((s) => s.state)
  if (state.tag === 'empty') {
    return <Placeholder>Open a file on the left, or create one.</Placeholder>
  }
  if (state.tag === 'loading') return <Placeholder>Opening {state.title}…</Placeholder>
  if (state.tag === 'failed' || state.tag === 'closed') {
    return (
      <Placeholder>
        <span className="text-destructive">{state.reason}</span>
      </Placeholder>
    )
  }
  return null
}

/** The tabs of every open file and shared document, above the source and preview columns. */
export function TabBarView() {
  const tabs = useTabs((s) => s.state)
  const active = useRef<HTMLDivElement>(null)
  const activeKey = tabs.tag === 'open' ? tabs.active : null

  useEffect(() => {
    active.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeKey])

  if (tabs.tag === 'none') return null
  return (
    <div
      role="tablist"
      aria-label="Open files"
      className="flex h-9 shrink-0 items-end overflow-x-auto bg-surface"
    >
      {tabs.tabs.map((tab) => {
        const selected = tab.key === tabs.active
        return (
          <div
            key={tab.key}
            ref={selected ? active : undefined}
            className={cn(
              'group relative flex h-full max-w-56 min-w-24 shrink-0 items-center border-r border-separator text-xs',
              selected
                ? 'bg-background text-foreground'
                : 'text-subtle-foreground hover:bg-raised/60',
            )}
            // Middle-click closes, like every tabbed editor.
            onAuxClick={(event) => {
              if (event.button === 1) void documentIntents.closeTab(tab.key)
            }}
          >
            {selected && <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-primary" />}
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              title={tab.ref.kind === 'local' ? tab.ref.path : `Shared / ${tab.title}`}
              onClick={() => documentIntents.activate(tab.key)}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 pl-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {tab.ref.kind === 'remote' ? (
                <Users className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{tab.title}</span>
              {tab.readOnly && <span className="sr-only">(read-only)</span>}
            </button>
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              title={tab.dirty ? 'Close (unsaved changes are kept as a draft)' : 'Close (Ctrl+W)'}
              onClick={() => void documentIntents.closeTab(tab.key)}
              className="mr-1.5 grid size-5 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-raised hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            >
              {tab.dirty ? (
                <span
                  aria-label="Unsaved changes"
                  className="size-2 rounded-full bg-primary group-hover:hidden"
                />
              ) : null}
              <X className={cn('size-3.5', tab.dirty && 'hidden group-hover:block')} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

const dot = 'inline-block size-1.5 shrink-0 rounded-full'

/** Status-bar summary of the open document: saved state for files, sync state for shared docs. */
export function DocumentStatusView() {
  const state = useDocument((s) => s.state)
  let tone = 'bg-muted-foreground'
  let text: string
  let detail: string | null = null

  switch (state.tag) {
    case 'local':
      text = state.saving ? 'Saving…' : state.dirty ? 'Unsaved changes' : 'Saved'
      tone = state.dirty ? 'bg-warning' : 'bg-success'
      if (state.saveError) detail = `Save failed: ${state.saveError}`
      else if (state.diskChanged) detail = 'Changed on disk — saving will overwrite it'
      break
    case 'viewing':
      text = 'Read-only view'
      break
    case 'connecting':
      text = 'Connecting…'
      break
    case 'synced':
      text = state.role === 'viewer' ? 'Synced · read-only' : 'Synced'
      tone = 'bg-success'
      break
    case 'offline':
      text = 'Offline'
      detail = 'Edits are kept on this machine and sync when the server is back'
      tone = 'bg-warning'
      break
    case 'closed':
      text = 'Disconnected'
      tone = 'bg-destructive'
      break
    default:
      return null
  }

  return (
    <span role="status" className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className={`${dot} ${tone}`} />
      <span className="truncate">{text}</span>
      {detail && <span className="truncate text-muted-foreground">· {detail}</span>}
    </span>
  )
}

/** Everyone else in the shared document, as coloured initials. */
export function PeersView() {
  const state = useDocument((s) => s.state)
  if (!isRemoteOpen(state) || state.peers.length === 0) return null
  return (
    <ul className="flex items-center -space-x-1" aria-label="Collaborators">
      {state.peers.map((peer) => (
        <li
          key={peer.clientId}
          title={peer.name}
          className="grid size-5 place-items-center rounded-full text-[10px] font-semibold text-background uppercase ring-2 ring-surface"
          style={{ backgroundColor: peer.color }}
        >
          {peer.name.slice(0, 1)}
        </li>
      ))}
    </ul>
  )
}
