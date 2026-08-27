/**
 * @file WorkspaceIDEView.tsx
 * @description Embeds the openvscode-server workbench (the `code-server`
 * deployment) inside the Workspace section, per R4 in
 * `plans/au-eg-program/PROGRAM.md` ("embed, do not fork"). This replaces
 * the standalone code-server origin (`VITE_IDE_ORIGIN`) as the
 * operator-facing entry point for the IDE.
 *
 * Two things make this more than "an iframe someone bolted on":
 *  - **Shared theme.** The workbench ships the "Agent WebUI Dark" color theme
 *    (generated from this app's own `.dark` CSS tokens) via the first-party
 *    `agent-webui-bridge` extension baked into the code-server image.
 *  - **Editor context.** The same extension publishes the active file,
 *    selection, cursor, dirty state, and diagnostics to
 *    `/api/enhanced/editor-context`. This view polls that endpoint and feeds
 *    it into the shared page-context store (`usePageContextPublisher`), so
 *    the chat agent always knows what the operator has open -- the R4 "core
 *    ask".
 */

import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api, type EditorContext } from '@/lib/api'
import { usePageContextPublisher, type PageContextContribution } from '@/lib/page-context'

// The existing openvscode-server deployment (`services/code-server`,
// configured via `VITE_IDE_ORIGIN`) -- mounted on the same NFS workspace
// volume this app's own Workspace Files view reads from. `?folder=` opens
// it directly instead of making the operator navigate there by hand.
const IDE_ORIGIN = import.meta.env.VITE_IDE_ORIGIN ?? 'http://code.example'
const IDE_URL = `${IDE_ORIGIN}/?folder=/home/app`

const EDITOR_CONTEXT_POLL_MS = 2000

export default function WorkspaceIDEView() {
  const [editorContext, setEditorContext] = useState<EditorContext | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const ctx = await api.getEditorContext()
        if (!cancelled) setEditorContext(ctx)
      } catch {
        // The bridge extension may not have published yet, or the request
        // raced a redeploy -- neither is worth surfacing as a toast on a
        // 2s poll; the panel below just keeps showing the last-known state.
      }
    }
    void poll()
    const timer = setInterval(() => {
      void poll()
    }, EDITOR_CONTEXT_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const pageContext = useMemo<PageContextContribution>(() => {
    const filePath = editorContext?.filePath ?? null
    return {
      selection: filePath ? [{ kind: 'editor-file', id: filePath, label: filePath }] : [],
      filters: {
        workspaceRoot: editorContext?.workspaceRoot ?? null,
        languageId: editorContext?.languageId ?? null,
        dirty: editorContext?.dirty ?? false,
        cursorLine: editorContext?.cursor?.line ?? null,
        selectionText: editorContext?.selection?.isEmpty === false ? editorContext.selection.text : null,
        diagnosticsCount: editorContext?.diagnostics?.length ?? 0,
      },
      allowedActions: [
        { id: 'read-open-file', label: 'Read the file currently open in the IDE', kind: 'read' },
        { id: 'read-selection', label: 'Read the current editor selection', kind: 'read' },
      ],
    }
  }, [editorContext])
  usePageContextPublisher(pageContext)

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] gap-3">
      <Card>
        <CardHeader className="py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">IDE</CardTitle>
              <CardDescription>
                Full VS Code on your workspace.{' '}
                {editorContext?.filePath ? (
                  <>
                    Currently open: <span className="font-mono">{editorContext.filePath}</span>
                    {editorContext.dirty ? ' (unsaved changes)' : ''}
                  </>
                ) : (
                  'The agent will see the open file and selection once you pick one.'
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {editorContext?.diagnostics && editorContext.diagnostics.length > 0 && (
                <Badge variant="outline">{editorContext.diagnostics.length} diagnostics</Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setReloadKey((k) => k + 1)
                }}
                title="Reload the IDE frame"
              >
                <RefreshCw className="size-4" />
              </Button>
              <Button variant="outline" size="sm" asChild>
                <a href={IDE_URL} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4 mr-1" />
                  Open in new tab
                </a>
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card className="flex-1 overflow-hidden p-0">
        <CardContent className="p-0 h-full">
          <iframe
            key={reloadKey}
            src={IDE_URL}
            title="Workspace IDE"
            className="w-full h-full border-0"
            // openvscode-server's own CSP has no frame-ancestors/X-Frame-Options
            // restriction, so this needs no `allow` beyond the workbench's own
            // needs (clipboard for copy/paste across the frame boundary).
            allow="clipboard-read; clipboard-write"
          />
        </CardContent>
      </Card>
    </div>
  )
}
