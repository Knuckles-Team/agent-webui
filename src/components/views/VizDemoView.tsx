/**
 * @file VizDemoView.tsx
 * @description Native visualization demo (D-VZ-1, lane w6-viz-xy) — renders a
 * `ViewSpec` through the eg-viz LOD ColumnStore/export pipeline running inside
 * the epistemic-graph engine (`Method::Viz`) and displays the resulting PNG.
 *
 * This is the first real "views over engine data" surface in agent-webui: the
 * image is drawn server-side (Rust), at a bounded primitive/byte budget, and the
 * response tells you exactly what tier was chosen (`Direct` = every point,
 * `Density` = a screen-bounded reduction) so a caller can see the LOD ladder
 * actually engage, not just trust it did. Presets range from a small exact
 * scatter/graph up to a "high density" 5,000,000-row scatter and a 100,000-node
 * graph, both generated ENGINE-SIDE (`SyntheticScatterClusters`/`SyntheticGraph`)
 * so the request payload stays tiny regardless of how many primitives are drawn.
 */

import { useState } from 'react'
import { AlertTriangle, Gauge, Loader2, Play, Sparkles, Zap } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { api, ApiError, type VizRenderRequest, type VizRenderResponse } from '@/lib/api'

interface Preset {
  id: string
  label: string
  description: string
  request: VizRenderRequest
}

const SCATTER_SPEC = (dataRef: string) => ({
  version: 1,
  title: 'eg-viz scatter demo',
  marks: [
    {
      kind: 'scatter',
      data_ref: dataRef,
      encodings: { x: { field: 'x' }, y: { field: 'y' } },
    },
  ],
})

const GRAPH_SPEC = (dataRef: string) => ({
  version: 1,
  title: 'eg-viz graph demo',
  marks: [{ kind: 'graph', data_ref: dataRef }],
})

const PRESETS: Preset[] = [
  {
    id: 'scatter-small',
    label: 'Small scatter — 500 pts (exact)',
    description: 'select_tier stays Direct: every point drawn, one-to-one.',
    request: {
      spec: SCATTER_SPEC('scatter-small'),
      dataset: { SyntheticScatterClusters: { row_count: 500, clusters: 4, seed: 1 } },
      width_px: 900,
      height_px: 560,
      dataset_ref: 'scatter-small',
    },
  },
  {
    id: 'scatter-dense',
    label: 'High-density scatter — 5,000,000 pts',
    description: 'select_tier drops to Density: a bounded screen grid, never 5M draw calls.',
    request: {
      spec: SCATTER_SPEC('scatter-dense'),
      dataset: { SyntheticScatterClusters: { row_count: 5_000_000, clusters: 6, seed: 7 } },
      width_px: 900,
      height_px: 560,
      dataset_ref: 'scatter-dense',
    },
  },
  {
    id: 'graph-small',
    label: 'Small graph — 300 nodes (force-directed)',
    description: 'A real bounded-iteration Fruchterman-Reingold layout, drawn exactly.',
    request: {
      spec: GRAPH_SPEC('graph-small'),
      dataset: { SyntheticGraph: { node_count: 300, edge_count: 600, seed: 3 } },
      width_px: 900,
      height_px: 560,
      dataset_ref: 'graph-small',
    },
  },
  {
    id: 'graph-large',
    label: 'Large graph — 100,000 nodes',
    description: 'Layout work itself is LOD-bounded above the node cap, then density-binned.',
    request: {
      spec: GRAPH_SPEC('graph-large'),
      dataset: { SyntheticGraph: { node_count: 100_000, edge_count: 300_000, seed: 11 } },
      width_px: 900,
      height_px: 560,
      dataset_ref: 'graph-large',
    },
  },
]

export default function VizDemoView() {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<VizRenderResponse | null>(null)

  const run = async (preset: Preset) => {
    setActiveId(preset.id)
    setLoading(true)
    setError(null)
    try {
      const res = await api.renderViz(preset.request)
      setResult(res)
    } catch (err) {
      setResult(null)
      setError(err instanceof ApiError ? `${err.status}: ${err.message}` : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6" data-testid="viz-demo-view">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Zap className="size-6" />
          Visualizations
        </h1>
        <p className="text-muted-foreground text-sm">
          Charts and graph renders generated server-side through the eg-viz ColumnStore + LOD pipeline (D-VZ-1) — no
          per-view chart code, no matplotlib round trip.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PRESETS.map((preset) => (
          <Card key={preset.id} className={activeId === preset.id ? 'border-primary' : ''}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="size-4" />
                {preset.label}
              </CardTitle>
              <CardDescription>{preset.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                disabled={loading}
                onClick={() => {
                  void run(preset)
                }}
                data-testid={`viz-run-${preset.id}`}
              >
                {loading && activeId === preset.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                Render
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 pt-6 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {error}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card data-testid="viz-render-result">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="size-4" />
              Render result
            </CardTitle>
            <CardDescription>
              <div className="flex flex-wrap gap-2 mt-1">
                <Badge variant={result.view_result.exact ? 'default' : 'secondary'}>
                  {result.view_result.exact ? 'exact' : 'approximated'}
                </Badge>
                <Badge variant="outline">tier: {result.view_result.lod_tier}</Badge>
                <Badge variant="outline">rows: {result.view_result.row_count.toLocaleString()}</Badge>
                <Badge variant="outline">{result.view_result.wall_time_ms} ms</Badge>
                <Badge variant="outline">{(result.byte_len / 1024).toFixed(1)} KB</Badge>
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result.format === 'png' ? (
              <img
                src={result.data_url}
                alt="eg-viz render"
                className="max-w-full rounded-md border"
                data-testid="viz-render-image"
              />
            ) : (
              <a href={result.data_url} download={`eg-viz.${result.format}`} className="text-sm underline">
                Download {result.format.toUpperCase()} render
              </a>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
