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
import { AtlasWorkspace } from '@/components/atlas/AtlasWorkspace'

export default function AtlasView() {
  return (
    <div data-testid="atlas-view">
      <AtlasWorkspace />
    </div>
  )
}
