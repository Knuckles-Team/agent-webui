/**
 * @file LearnView.tsx
 * @description Ontology School — course list, lesson reader, presentation
 * mode, and quiz (Ontology-Playground coverage row #16). Renders the bundled
 * manifest (`src/content/learn/`, loaded via `loadLearnManifest()`) entirely
 * client-side: course list on the left, the selected lesson on the right,
 * reusing the existing Markdown renderer (`Response`, the same one Chat/
 * KnowledgeView/SessionsView already use) rather than a new one. Presentation
 * mode slide-splits the lesson body at each `##` heading (`splitIntoSlides`);
 * a lesson with a quiz gets a `LearnQuiz` below its content.
 */

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, GraduationCap, LayoutList, Presentation } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Response } from '@/components/ai-elements/response'
import { LearnQuiz } from '@/components/learn/LearnQuiz'
import { loadLearnManifest, splitIntoSlides, type LearnCourse, type LearnManifest } from '@/lib/learn'

function firstLessonRef(manifest: LearnManifest): { courseId: string; lessonId: string } {
  const course = manifest.courses[0] as LearnCourse | undefined
  const lesson = course?.lessons[0]
  return { courseId: course?.id ?? '', lessonId: lesson?.id ?? '' }
}

type Lesson = LearnCourse['lessons'][number]

function CourseList({
  manifest,
  courseId,
  lessonId,
  onSelectLesson,
}: {
  manifest: LearnManifest
  courseId: string
  lessonId: string
  onSelectLesson: (courseId: string, lessonId: string) => void
}) {
  if (manifest.courses.length === 0) {
    return <p className="text-xs text-muted-foreground py-4 px-1">No courses available.</p>
  }
  return (
    <div className="space-y-3">
      {manifest.courses.map((c) => (
        <div key={c.id}>
          <p className="text-xs font-semibold px-1 mb-1">{c.title}</p>
          <ul className="space-y-0.5">
            {c.lessons.map((l) => {
              const isSelected = c.id === courseId && l.id === lessonId
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    data-testid={`lesson-link-${c.id}-${l.id}`}
                    onClick={() => {
                      onSelectLesson(c.id, l.id)
                    }}
                    className={`w-full text-left text-xs rounded px-2 py-1.5 hover:bg-muted/50 ${
                      isSelected ? 'bg-muted/50 font-medium' : 'text-muted-foreground'
                    }`}
                  >
                    {l.title}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function EmptyLesson() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
      <GraduationCap className="size-12 text-muted-foreground/30 mb-3" />
      <p className="text-sm">Pick a course from the left to start learning.</p>
    </div>
  )
}

function PresentationSlide({
  slides,
  slideIndex,
  setSlideIndex,
}: {
  slides: string[]
  slideIndex: number
  setSlideIndex: (updater: (i: number) => number) => void
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ScrollArea className="flex-1 px-6 py-4">
        <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="presentation-slide">
          <Response>{slides[slideIndex] ?? ''}</Response>
        </div>
      </ScrollArea>
      <div className="flex items-center justify-between px-6 py-3 border-t border-border/30 shrink-0">
        <Button
          variant="outline"
          size="sm"
          disabled={slideIndex === 0}
          onClick={() => {
            setSlideIndex((i) => Math.max(0, i - 1))
          }}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Badge variant="outline" className="text-xs">
          Slide {slides.length === 0 ? 0 : slideIndex + 1} / {slides.length}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          disabled={slideIndex >= slides.length - 1}
          onClick={() => {
            setSlideIndex((i) => Math.min(slides.length - 1, i + 1))
          }}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function ReadingModeContent({ lesson }: { lesson: Lesson }) {
  return (
    <ScrollArea className="h-full">
      <div className="px-6 py-4 space-y-6">
        <div className="prose prose-sm dark:prose-invert max-w-none" data-testid="lesson-body">
          <Response>{lesson.body}</Response>
        </div>
        {lesson.quiz.length > 0 && <LearnQuiz questions={lesson.quiz} />}
      </div>
    </ScrollArea>
  )
}

function LessonBody({
  lesson,
  presentation,
  slides,
  slideIndex,
  setSlideIndex,
}: {
  lesson: Lesson | undefined
  presentation: boolean
  slides: string[]
  slideIndex: number
  setSlideIndex: (updater: (i: number) => number) => void
}) {
  if (!lesson) return <EmptyLesson />
  if (presentation) return <PresentationSlide slides={slides} slideIndex={slideIndex} setSlideIndex={setSlideIndex} />
  return <ReadingModeContent lesson={lesson} />
}

function LessonHeader({
  lesson,
  presentation,
  onTogglePresentation,
}: {
  lesson: Lesson | undefined
  presentation: boolean
  onTogglePresentation: () => void
}) {
  return (
    <CardHeader className="pb-2 flex flex-row items-center justify-between">
      <CardTitle className="text-sm font-bold truncate" data-testid="lesson-title">
        {lesson?.title ?? 'Select a lesson'}
      </CardTitle>
      {lesson && (
        <Button variant="outline" size="sm" data-testid="presentation-toggle" onClick={onTogglePresentation}>
          {presentation ? <LayoutList className="size-4 mr-1" /> : <Presentation className="size-4 mr-1" />}
          {presentation ? 'Reading mode' : 'Presentation mode'}
        </Button>
      )}
    </CardHeader>
  )
}

export default function LearnView() {
  const manifest = useMemo(() => loadLearnManifest(), [])
  const first = useMemo(() => firstLessonRef(manifest), [manifest])

  const [courseId, setCourseId] = useState(first.courseId)
  const [lessonId, setLessonId] = useState(first.lessonId)
  const [presentation, setPresentation] = useState(false)
  const [slideIndex, setSlideIndex] = useState(0)

  const course = manifest.courses.find((c) => c.id === courseId)
  const lesson = course?.lessons.find((l) => l.id === lessonId)
  const slides = useMemo(() => (lesson ? splitIntoSlides(lesson.body) : []), [lesson])

  const selectLesson = (nextCourseId: string, nextLessonId: string) => {
    setCourseId(nextCourseId)
    setLessonId(nextLessonId)
    setSlideIndex(0)
  }

  return (
    <div className="space-y-6 h-[calc(100vh-12rem)] flex flex-col" data-testid="learn-view">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GraduationCap className="size-6 text-emerald-400" />
          Ontology School
        </h1>
        <p className="text-sm text-muted-foreground">
          A short, structured curriculum for learning this platform's Knowledge Graph — its ontology model, and how to
          query it.
        </p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden">
        {/* Course / lesson list */}
        <Card className="border-border/40 bg-card/60 overflow-hidden flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold">Courses</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-full px-3 pb-3">
              <CourseList manifest={manifest} courseId={courseId} lessonId={lessonId} onSelectLesson={selectLesson} />
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Lesson content */}
        <Card className="lg:col-span-2 border-border/40 bg-card/60 overflow-hidden flex flex-col">
          <LessonHeader
            lesson={lesson}
            presentation={presentation}
            onTogglePresentation={() => {
              setPresentation((p) => !p)
              setSlideIndex(0)
            }}
          />
          <CardContent className="flex-1 overflow-hidden p-0 flex flex-col">
            <LessonBody
              lesson={lesson}
              presentation={presentation}
              slides={slides}
              slideIndex={slideIndex}
              setSlideIndex={setSlideIndex}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
