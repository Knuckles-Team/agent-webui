/**
 * @file AdminView.tsx
 * @description Admin console — a browser admin surface over the epistemic-graph
 * engine's admin APIs (roadmap: "Admin console UI").
 *
 * Four panels, each a thin renderer over the SAME gateway/backend REST surface
 * every other view uses (via `src/lib/admin-api.ts` → `src/lib/gateway.ts`):
 *   - Tenants  — graphs/tenants, per-tenant node/edge counts, shard placement (REAL, partial).
 *   - Shards   — shard topology / K-way writer layout + per-shard health (REAL).
 *   - RBAC     — roles / grants / agent identities (EG-092 / EG-303) (probe → placeholder).
 *   - Backup   — online backup + PITR status (EG-090) (probe → placeholder).
 *
 * Panels whose engine capability is not yet exposed over the REST surface probe
 * the closest existing route and degrade to a clearly-labeled read-only state —
 * they never fabricate backend data.
 */

import { ShieldCheck } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import TenantsPanel from './admin/TenantsPanel'
import ShardsPanel from './admin/ShardsPanel'
import RbacPanel from './admin/RbacPanel'
import BackupPanel from './admin/BackupPanel'

export default function AdminView() {
  return (
    <div className="space-y-6" data-testid="admin-view">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldCheck className="size-6" />
          Admin Console
        </h1>
        <p className="text-muted-foreground text-sm">
          Tenants, shard topology, RBAC and backup/PITR for the epistemic-graph engine.
        </p>
      </div>

      <Tabs defaultValue="tenants">
        <TabsList>
          <TabsTrigger value="tenants">Tenants</TabsTrigger>
          <TabsTrigger value="shards">Shards</TabsTrigger>
          <TabsTrigger value="rbac">RBAC</TabsTrigger>
          <TabsTrigger value="backup">Backup / PITR</TabsTrigger>
        </TabsList>
        <TabsContent value="tenants" className="mt-4">
          <TenantsPanel />
        </TabsContent>
        <TabsContent value="shards" className="mt-4">
          <ShardsPanel />
        </TabsContent>
        <TabsContent value="rbac" className="mt-4">
          <RbacPanel />
        </TabsContent>
        <TabsContent value="backup" className="mt-4">
          <BackupPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
