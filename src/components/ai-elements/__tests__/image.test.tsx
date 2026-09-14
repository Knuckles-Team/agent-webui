import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AccessibleImage, ExperimentalGeneratedImage, Image } from '@/components/ai-elements/image'
import { Avatar, AvatarImage } from '@/components/ui/avatar'

describe('image accessibility contract', () => {
  it('renders informative images with the caller-provided description', () => {
    render(<AccessibleImage alt="A graph of service dependencies" src="/graph.png" />)

    expect(screen.getByRole('img')).toHaveAttribute('alt', 'A graph of service dependencies')
  })

  it('rejects an empty dynamic alt value unless the caller opts into decoration', () => {
    const dynamicAlt = ''.slice(0)

    expect(() => render(<AccessibleImage alt={dynamicAlt} src="/pixel.png" />)).toThrow(/non-empty alt text/i)
  })

  it('allows an explicitly decorative image', () => {
    const { container } = render(<AccessibleImage alt="" decorative src="/ornament.png" />)

    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('applies the same contract to generated and base64 image wrappers', () => {
    const { rerender } = render(
      <ExperimentalGeneratedImage image={{ url: '/generated.png', alt: 'Generated architecture diagram' }} />,
    )
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Generated architecture diagram')

    rerender(<Image alt="Uploaded architecture diagram" base64="cG5n" mediaType="image/png" />)
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Uploaded architecture diagram')
  })

  it('allows explicit decoration through generated and base64 wrappers', () => {
    const { container, rerender } = render(
      <ExperimentalGeneratedImage image={{ url: '/ornament.png', alt: '', decorative: true }} />,
    )
    expect(container.querySelector('img')).toHaveAttribute('alt', '')

    rerender(<Image alt="" decorative base64="cG5n" mediaType="image/png" />)
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('requires avatar callers to mark empty alt text as decorative', () => {
    const { container } = render(
      <Avatar>
        <AvatarImage alt="" decorative src="/avatar.png" />
      </Avatar>,
    )

    // Radix intentionally waits for the image load event before mounting its
    // image element. The key contract here is that the explicitly decorative
    // call is accepted without the runtime guard throwing.
    expect(container.querySelector('[data-slot="avatar"]')).toBeInTheDocument()
  })
})
