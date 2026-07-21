import { describe, it, expect } from 'vitest'
import { loadLearnManifest, findLesson, splitIntoSlides, type LearnManifest } from '@/lib/learn'
import type { RawLearnManifest } from '@/content/learn/types'

describe('loadLearnManifest', () => {
  it('loads the real bundled manifest with both starter courses', () => {
    const manifest = loadLearnManifest()
    expect(manifest.courses).toHaveLength(2)
    expect(manifest.courses.map((c) => c.id)).toEqual(['ontology-model-101', 'querying-with-uql'])
  })

  it('normalizes quiz answer_index to answerIndex on every lesson', () => {
    const manifest = loadLearnManifest()
    for (const course of manifest.courses) {
      for (const lesson of course.lessons) {
        expect(lesson.quiz.length).toBeGreaterThan(0)
        for (const q of lesson.quiz) {
          expect(q.answerIndex).toBeGreaterThanOrEqual(0)
          expect(q.answerIndex).toBeLessThan(q.choices.length)
        }
      }
    }
  })

  it('every lesson body is non-empty real content', () => {
    const manifest = loadLearnManifest()
    for (const course of manifest.courses) {
      for (const lesson of course.lessons) {
        expect(lesson.body.length).toBeGreaterThan(200)
      }
    }
  })

  it('drops a lesson with an empty body instead of surfacing it', () => {
    const raw: RawLearnManifest = {
      schema_version: 1,
      courses: [
        {
          id: 'c1',
          title: 'Course 1',
          description: 'd',
          lessons: [
            { id: 'good', title: 'Good', body: 'real content' },
            { id: 'empty', title: 'Empty', body: '   ' },
          ],
        },
      ],
    }
    const manifest = loadLearnManifest(raw)
    expect(manifest.courses[0].lessons).toHaveLength(1)
    expect(manifest.courses[0].lessons[0].id).toBe('good')
  })

  it('drops a course whose every lesson was dropped', () => {
    const raw: RawLearnManifest = {
      schema_version: 1,
      courses: [
        { id: 'empty-course', title: 'Empty', description: 'd', lessons: [{ id: 'l', title: 'L', body: '' }] },
        { id: 'real-course', title: 'Real', description: 'd', lessons: [{ id: 'l', title: 'L', body: 'content' }] },
      ],
    }
    const manifest = loadLearnManifest(raw)
    expect(manifest.courses).toHaveLength(1)
    expect(manifest.courses[0].id).toBe('real-course')
  })

  it('defaults a lesson with no quiz to an empty quiz array, never undefined', () => {
    const raw: RawLearnManifest = {
      schema_version: 1,
      courses: [{ id: 'c', title: 'C', description: 'd', lessons: [{ id: 'l', title: 'L', body: 'content' }] }],
    }
    const manifest = loadLearnManifest(raw)
    expect(manifest.courses[0].lessons[0].quiz).toEqual([])
  })
})

describe('findLesson', () => {
  it('resolves a real course/lesson id pair from the bundled manifest', () => {
    const manifest = loadLearnManifest()
    const found = findLesson(manifest, 'ontology-model-101', 'interfaces-object-types-and-links')
    expect(found).toBeDefined()
    expect(found?.course.id).toBe('ontology-model-101')
    expect(found?.lesson.title).toBe('Interfaces, Object Types, and Links')
  })

  it('returns undefined for an unknown course or lesson id', () => {
    const manifest = loadLearnManifest()
    expect(findLesson(manifest, 'no-such-course', 'x')).toBeUndefined()
    expect(findLesson(manifest, 'ontology-model-101', 'no-such-lesson')).toBeUndefined()
  })
})

describe('splitIntoSlides', () => {
  it('splits a body into one slide per ## heading, keeping the intro as slide 1', () => {
    const body = '# Title\n\nIntro text.\n\n## First\n\nfirst body\n\n## Second\n\nsecond body\n'
    const slides = splitIntoSlides(body)
    expect(slides).toHaveLength(3)
    expect(slides[0]).toContain('# Title')
    expect(slides[0]).toContain('Intro text.')
    expect(slides[1]).toContain('## First')
    expect(slides[1]).not.toContain('## Second')
    expect(slides[2]).toContain('## Second')
  })

  it('returns the whole body as one slide when there are no ## headings', () => {
    const body = '# Title\n\nJust one section, no subheadings.'
    expect(splitIntoSlides(body)).toEqual([body])
  })

  it('splits both real bundled lessons into more than one slide', () => {
    const manifest: LearnManifest = loadLearnManifest()
    for (const course of manifest.courses) {
      for (const lesson of course.lessons) {
        const slides = splitIntoSlides(lesson.body)
        expect(slides.length).toBeGreaterThan(3)
      }
    }
  })

  it('never produces an empty slide', () => {
    const manifest = loadLearnManifest()
    for (const course of manifest.courses) {
      for (const lesson of course.lessons) {
        for (const slide of splitIntoSlides(lesson.body)) {
          expect(slide.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('bundled lesson content sanity (guards the manual template-literal escaping)', () => {
  it('the UQL lesson renders clean triple-backtick fences, not escaped backslash-backtick pairs', () => {
    const manifest = loadLearnManifest()
    const found = findLesson(manifest, 'querying-with-uql', 'your-first-uql-pipeline')
    expect(found).toBeDefined()
    const body = found!.lesson.body
    expect(body).toContain('```uql')
    expect(body).not.toContain('\\`')
  })
})
