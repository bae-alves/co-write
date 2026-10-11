import { Compartment, EditorState } from '@codemirror/state'
import { EditorView as CodeMirror } from '@codemirror/view'
import { yCollab } from 'y-codemirror.next'
import { useEffect, useRef, type ReactNode } from 'react'
import { previewIntents } from '@/features/preview/intent'
import { markdownEditorExtensions } from '@/kit/codemirror'
import { documentIntents } from './intent'
import { isOpen, isRemoteOpen, useDocument } from './model'

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

/** The source column: CodeMirror bound to the open document's Y.Text. */
export function SourceView() {
  const state = useDocument((s) => s.state)
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<CodeMirror | null>(null)
  const editable = useRef(new Compartment())

  const session = isOpen(state) ? state.session : null
  const readOnly = isRemoteOpen(state) && state.role === 'viewer'

  useEffect(() => {
    const binding = session === null ? null : documentIntents.binding()
    if (!host.current || !binding) return
    const editor = new CodeMirror({
      parent: host.current,
      state: EditorState.create({
        doc: binding.ytext.toString(),
        extensions: [
          markdownEditorExtensions(),
          yCollab(binding.ytext, binding.awareness, { undoManager: binding.undoManager }),
          editable.current.of(EditorState.readOnly.of(false)),
          followScroll(),
        ],
      }),
    })
    view.current = editor
    editor.focus()
    return () => {
      view.current = null
      editor.destroy()
    }
  }, [session])

  useEffect(() => {
    view.current?.dispatch({
      effects: editable.current.reconfigure(EditorState.readOnly.of(readOnly)),
    })
  }, [readOnly, session])

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
  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" aria-label="Source" />
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
