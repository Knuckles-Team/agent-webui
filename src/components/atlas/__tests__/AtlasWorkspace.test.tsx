import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AtlasWorkspace } from '../AtlasWorkspace'

const mockUseIdentity = vi.hoisted(() => vi.fn())

vi.mock('../AtlasWorkbench', () => ({
  AtlasWorkbench: () => <div data-testid="atlas-workbench" />,
}))

vi.mock('@/lib/auth', () => ({
  useIdentity: mockUseIdentity,
}))

describe('AtlasWorkspace', () => {
  beforeEach(() => {
    mockUseIdentity.mockReturnValue({
      identity: { role: 'reader', userKey: 'test', ssoConfigured: false, needsSignIn: false, raw: null },
      loading: false,
    })
  })

  it('provides guided starting points and one unified workbench', () => {
    render(<AtlasWorkspace />)

    expect(screen.getByTestId('atlas-workspace')).toHaveTextContent('Atlas')
    expect(screen.getByRole('heading', { name: 'Start with a question' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Knowledge Graph:/ })).toHaveAttribute('href', '/graph')
    expect(screen.getByRole('link', { name: /Open the unified Atlas workbench/ })).toHaveAttribute(
      'href',
      '#atlas-workbench',
    )
    expect(screen.getByTestId('atlas-workbench')).toBeInTheDocument()
  })

  it('keeps expert destinations in a collapsed, role-filtered index', () => {
    render(<AtlasWorkspace />)

    const expert = screen.getByTestId('atlas-expert-tools')
    expect(expert).not.toHaveAttribute('open')
    expect(within(expert).queryByRole('link', { name: /Cypher Console:/ })).toBeNull()
    expect(within(expert).getByRole('link', { name: /Knowledge Graph 3D:/ })).toHaveAttribute('href', '/graph-3d')
  })

  it('fails closed while the signed-in role is still loading', () => {
    mockUseIdentity.mockReturnValue({
      identity: { role: 'admin', userKey: 'unresolved', ssoConfigured: true, needsSignIn: false, raw: null },
      loading: true,
    })

    render(<AtlasWorkspace />)

    expect(screen.queryByRole('link', { name: /Cypher Console:/ })).toBeNull()
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getAllByRole('status')[0]).toHaveTextContent('Loading available Atlas tools')
  })
})
