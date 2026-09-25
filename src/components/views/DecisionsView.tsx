import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import DecisionCalibrationTab from '@/components/decisions/DecisionCalibrationTab'
import DecisionExplorerTab from '@/components/decisions/DecisionExplorerTab'

/**
 * @file DecisionsView.tsx
 * @description EH-046/047: the Decide layer's two UI surfaces
 * (`plans/refactor/architecture/DECIDE-LAYER-DESIGN.md` §10 "UIs") — the
 * decision explorer (list/detail over the committed `DecisionLog`, with
 * premises, derivations, the solve certificate or typed abstention, and
 * why-not) and the outcome dashboard (the per-option outcome aggregate,
 * with unavailable calibration/coverage states). Both tabs are read-only:
 * this view never commits or resolves a decision; it renders what
 * `agent/graph_os_webui/api_extensions.py`'s Decisions section serves.
 */

type TabId = 'explorer' | 'calibration'

function isTabId(value: string): value is TabId {
  return value === 'explorer' || value === 'calibration'
}

export default function DecisionsView() {
  const [tab, setTab] = useState<TabId>('explorer')

  return (
    <div className="space-y-6">
      <Card className="border-border/40 bg-card/60 backdrop-blur-md">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(isTabId(value) ? value : tab)
          }}
          className="w-full"
        >
          <CardHeader>
            <CardTitle className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-400 via-emerald-400 to-green-500">
              Decisions
            </CardTitle>
            <CardDescription>
              Every typed decision the engine has committed — which mechanism resolved it, the weakest evidence class
              its conclusion rests on, and observed outcomes for executed options. Calibrated coverage needs separate
              independent-label evidence.
            </CardDescription>
            <TabsList
              aria-label="Decisions sections"
              className="flex flex-wrap justify-start h-auto gap-2 mt-4 rounded-none border-b border-border/40 bg-transparent p-0 pb-2"
            >
              <TabsTrigger
                value="explorer"
                className="rounded-md border border-transparent px-3 py-1.5 text-xs font-semibold data-[state=active]:border-emerald-500/30 data-[state=active]:bg-emerald-500/10 data-[state=active]:font-bold data-[state=active]:text-emerald-400"
              >
                Explorer
              </TabsTrigger>
              <TabsTrigger
                value="calibration"
                className="rounded-md border border-transparent px-3 py-1.5 text-xs font-semibold data-[state=active]:border-emerald-500/30 data-[state=active]:bg-emerald-500/10 data-[state=active]:font-bold data-[state=active]:text-emerald-400"
              >
                Outcomes and calibration
              </TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent>
            <TabsContent value="explorer">
              <DecisionExplorerTab />
            </TabsContent>
            <TabsContent value="calibration">
              <DecisionCalibrationTab />
            </TabsContent>
          </CardContent>
        </Tabs>
      </Card>
    </div>
  )
}
