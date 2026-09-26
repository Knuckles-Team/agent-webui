import { lazy } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { RouteDef } from '@/lib/nav-registry'

export const CONSOLE_ROUTES: readonly RouteDef[] = [
  {
    id: 'console.confirm',
    path: '/console/confirm/:plan_ref',
    label: 'Confirm operation',
    section: 'admin',
    navigation: 'deep-link',
    blurb: 'Review and confirm one GraphOS operation.',
    icon: ShieldCheck,
    minRole: 'user',
    mobile: 'adapted',
    element: lazy(() => import('@/pages/console/ConfirmPage')),
  },
]
