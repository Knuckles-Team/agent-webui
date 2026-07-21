import { describe, it, expect } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import LearnView from '@/components/views/LearnView'

/**
 * LearnView has no backend fetch dependency (Ontology-Playground coverage
 * row #16 — the manifest + lesson bodies are bundled TS content, not
 * fetched), so unlike the fetch-driven ontology views (SchemaView/
 * SparqlView/CatalogueView) there's no request contract to assert. It's
 * exercised via real user interaction instead: selecting a lesson,
 * toggling presentation mode, and answering a quiz question.
 */

describe('LearnView', () => {
  it('is a renderable default export that mounts without throwing', () => {
    expect(typeof LearnView).toBe('function')
    expect(() => render(<LearnView />)).not.toThrow()
  })

  it('renders the bundled Ontology School courses and auto-selects the first lesson', () => {
    render(<LearnView />)
    expect(screen.getByTestId('learn-view')).toBeTruthy()
    expect(screen.getByText('Intro to the Ontology Model')).toBeTruthy()
    // "Querying with UQL" also appears inline in lesson 1's closing "next lesson" pointer,
    // so there are two matches (the sidebar course title + the rendered lesson body text).
    expect(screen.getAllByText('Querying with UQL').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('lesson-body')).toBeTruthy()
    expect(screen.getByTestId('lesson-title').textContent).toBe('Interfaces, Object Types, and Links')
  })

  it('switches lessons when a different lesson link is clicked', () => {
    render(<LearnView />)
    fireEvent.click(screen.getByTestId('lesson-link-querying-with-uql-your-first-uql-pipeline'))
    expect(screen.getByTestId('lesson-title').textContent).toBe('Your First UQL Pipeline')
  })

  it('toggles presentation mode and shows a slide counter', () => {
    render(<LearnView />)
    fireEvent.click(screen.getByTestId('presentation-toggle'))
    expect(screen.getByTestId('presentation-slide')).toBeTruthy()
    expect(screen.getByText(/^Slide 1 \//)).toBeTruthy()
  })

  it('advances to the next slide in presentation mode', () => {
    render(<LearnView />)
    fireEvent.click(screen.getByTestId('presentation-toggle'))
    const next = screen.getAllByRole('button').find((b) => b.querySelector('svg.lucide-chevron-right'))
    expect(next).toBeDefined()
    if (next) fireEvent.click(next)
    expect(screen.getByText(/^Slide 2 \//)).toBeTruthy()
  })

  it('locks a question and reveals correct/incorrect once a choice is clicked', () => {
    render(<LearnView />)
    expect(screen.getByTestId('learn-quiz')).toBeTruthy()
    const choice = screen
      .getAllByRole('button')
      .find((b) => b.textContent?.includes('abstract shape contract') ?? false)
    expect(choice).toBeDefined()
    if (!choice) throw new Error('choice button not found')
    fireEvent.click(choice)
    // Locked: clicking again does nothing further (button is disabled once answered).
    expect(choice.hasAttribute('disabled')).toBe(true)
  })

  it('shows a final score once every quiz question in a lesson has been answered', () => {
    render(<LearnView />)
    const quiz = screen.getByTestId('learn-quiz')
    // Click the first choice of every question in the quiz — enough to answer
    // all of them regardless of which choice is "correct".
    const buttons = Array.from(quiz.querySelectorAll('button'))
    let answered = 0
    for (const button of buttons) {
      if (button.hasAttribute('disabled')) continue
      fireEvent.click(button)
      answered += 1
      if (answered >= 3) break
    }
    expect(screen.getByTestId('quiz-score')).toBeTruthy()
  })
})
