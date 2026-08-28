/**
 * @file renderers/index.ts
 * @description Registers the five built-in renderers.
 *
 * Renderers, unlike adapters, are a CLOSED set owned by this lane — they are keyed on
 * result SHAPE, not on modality, so a new modality never needs a new renderer. A new
 * renderer (a chart for time series, a map for geo) is a deliberate addition here.
 */
import { rendererRegistry } from '@/lib/atlas/renderers'

import { graph2dRenderer } from './Graph2DRenderer'
import { graph3dRenderer } from './Graph3DRenderer'
import { jsonRenderer } from './JsonRenderer'
import { rawRenderer } from './RawRenderer'
import { tableRenderer } from './TableRenderer'

/** Idempotent: registration is keyed by id, so a re-import (HMR, a second suite) is harmless. */
export function registerBuiltinRenderers(): void {
  rendererRegistry.registerAll([graph2dRenderer, graph3dRenderer, tableRenderer, jsonRenderer, rawRenderer])
}

export { graph2dRenderer, graph3dRenderer, tableRenderer, jsonRenderer, rawRenderer }
