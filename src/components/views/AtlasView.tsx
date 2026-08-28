/**
 * @file AtlasView.tsx
 * @description `/explore` — Atlas, the unified data explorer.
 *
 * One workbench for every epistemic-graph modality: pick a modality, filter it with
 * the same facet UI whatever it is, and render the answer as a table, a JSON tree, a
 * 2D graph or a 3D scene. The 3D path is not per-modality — any adapter that can
 * project its result into nodes and edges gets it for free (`ModalityAdapter.toGraph`).
 *
 * Design: `plans/atlas/DESIGN-atlas.md`. Adapter authoring: `src/lib/atlas/ADAPTER-GUIDE.md`.
 */
import { Compass } from 'lucide-react'

import { AtlasWorkbench } from '@/components/atlas/AtlasWorkbench'

export default function AtlasView() {
  return (
    <div className="space-y-4" data-testid="atlas-view">
      <div className="flex items-center gap-2">
        <Compass className="size-5" />
        <div>
          <h1 className="text-xl font-semibold">Atlas</h1>
          <p className="text-muted-foreground text-sm">
            Explore every modality of the graph — filter it one way, then draw it as a table, a tree, or in 3D.
          </p>
        </div>
      </div>
      <AtlasWorkbench />
    </div>
  )
}
