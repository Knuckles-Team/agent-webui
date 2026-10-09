/**
 * @file renderers.ts
 * @description Registers the shipped chart renderer. Import this module
 * wherever a chart is resolved; registration is keyed by id, so repeated
 * imports are harmless.
 */
import { registerChartRenderer } from './chart-model'
import { OhlcChart } from './OhlcChart'

registerChartRenderer({ id: 'svg', label: 'SVG', component: OhlcChart })

export { resolveChartRenderer } from './chart-model'
