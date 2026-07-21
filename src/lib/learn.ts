/**
 * @file learn.ts
 * @description Ontology School manifest loader + presentation-mode slide
 * splitter (Ontology-Playground coverage row #16).
 *
 * The manifest and lesson bodies are bundled TypeScript content modules
 * (`src/content/learn/`) mirroring agent-utilities' `docs/learn/manifest.yaml`
 * — `LearnView` renders entirely client-side with no backend round-trip. This
 * is documentation content, not a KG capability: agent-utilities' `docs/` is
 * excluded from its installed Python package (see that repo's
 * `pyproject.toml`), so there would be nothing for a deployed backend to
 * serve here even if we wired a fetch. `loadLearnManifest()` normalizes the
 * raw bundled content into the typed shape `LearnView` renders, dropping any
 * course/lesson that's missing required content instead of crashing.
 */

import { RAW_LEARN_MANIFEST } from '@/content/learn/manifest'
import type { RawLearnManifest } from '@/content/learn/types'

export interface LearnQuizQuestion {
  question: string
  choices: string[]
  answerIndex: number
}

export interface LearnLesson {
  id: string
  title: string
  body: string
  quiz: LearnQuizQuestion[]
}

export interface LearnCourse {
  id: string
  title: string
  description: string
  lessons: LearnLesson[]
}

export interface LearnManifest {
  courses: LearnCourse[]
}

/**
 * Normalize the bundled Ontology School manifest into the view-facing shape.
 * A course with no valid lessons, or a lesson with an empty body, is dropped
 * rather than surfaced — a partial/malformed manifest degrades to a smaller
 * curriculum instead of breaking the view.
 */
export function loadLearnManifest(raw: RawLearnManifest = RAW_LEARN_MANIFEST): LearnManifest {
  const courses: LearnCourse[] = []
  for (const course of raw.courses) {
    const lessons: LearnLesson[] = []
    for (const lesson of course.lessons) {
      if (!lesson.body.trim()) continue
      lessons.push({
        id: lesson.id,
        title: lesson.title,
        body: lesson.body,
        quiz: (lesson.quiz ?? []).map((q) => ({
          question: q.question,
          choices: q.choices,
          answerIndex: q.answer_index,
        })),
      })
    }
    if (lessons.length === 0) continue
    courses.push({ id: course.id, title: course.title, description: course.description, lessons })
  }
  return { courses }
}

/** Find a course + lesson by id pair (undefined if either doesn't exist). */
export function findLesson(
  manifest: LearnManifest,
  courseId: string,
  lessonId: string,
): { course: LearnCourse; lesson: LearnLesson } | undefined {
  const course = manifest.courses.find((c) => c.id === courseId)
  const lesson = course?.lessons.find((l) => l.id === lessonId)
  return course && lesson ? { course, lesson } : undefined
}

/**
 * Split a lesson body into presentation-mode slides at each `##` heading.
 * Content before the first `##` (the H1 title + intro) becomes slide 1; every
 * `##`-headed section after that becomes its own slide. Empty slides (e.g. a
 * body with no content at all) are dropped.
 */
export function splitIntoSlides(body: string): string[] {
  const lines = body.split('\n')
  const slides: string[] = []
  let current: string[] = []
  for (const line of lines) {
    if (line.startsWith('## ') && current.length > 0) {
      slides.push(current.join('\n').trim())
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length > 0) slides.push(current.join('\n').trim())
  return slides.filter((s) => s.length > 0)
}
