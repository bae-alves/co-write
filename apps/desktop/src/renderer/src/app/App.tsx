import { useEffect } from 'react'
import { accountIntents } from '@/features/account/intent'
import { commandIntents } from '@/features/commands/intent'
import { SourceView } from '@/features/document/view'
import { PreviewView } from '@/features/preview/view'
import { FilesView } from '@/features/project/view'
import { SharedDocsView } from '@/features/shared-docs/view'
import { Workbench } from '@/features/workbench/view'
import { Dialogs } from './dialogs'
import { StatusBar } from './StatusBar'
import { Toolbar } from './Toolbar'

/** Composition root of the renderer: toolbar, the three columns, status bar. */
export function App() {
  useEffect(() => {
    void accountIntents.restore()
    return commandIntents.listen()
  }, [])

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <Workbench
        files={
          <>
            <FilesView />
            <SharedDocsView />
          </>
        }
        source={<SourceView />}
        preview={<PreviewView />}
      />
      <StatusBar />
      <Dialogs />
    </div>
  )
}
