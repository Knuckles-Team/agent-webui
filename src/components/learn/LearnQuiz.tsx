/**
 * @file LearnQuiz.tsx
 * @description Simple multiple-choice quiz component for an Ontology School
 * lesson (Ontology-Playground coverage row #16). Click a choice to lock in an
 * answer and reveal correct/incorrect; a running score shows once every
 * question has been answered. No new UI primitive — plain buttons styled by
 * selection state (this repo's `src/components/ui/` has no RadioGroup).
 */

import { useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LearnQuizQuestion } from '@/lib/learn'

export interface LearnQuizProps {
  questions: LearnQuizQuestion[]
}

export function LearnQuiz({ questions }: LearnQuizProps) {
  const [answers, setAnswers] = useState<Partial<Record<number, number>>>({})

  const select = (qIndex: number, choiceIndex: number) => {
    if (qIndex in answers) return // locked once answered
    setAnswers((prev) => ({ ...prev, [qIndex]: choiceIndex }))
  }

  if (questions.length === 0) return null

  const answeredCount = Object.keys(answers).length
  const correctCount = questions.reduce((acc, q, i) => acc + (answers[i] === q.answerIndex ? 1 : 0), 0)

  return (
    <Card className="border-border/40 bg-card/60" data-testid="learn-quiz">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-bold flex items-center justify-between">
          <span>Quiz</span>
          {answeredCount === questions.length && (
            <span className="text-xs font-normal text-muted-foreground" data-testid="quiz-score">
              {correctCount}/{questions.length} correct
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {questions.map((q, qIndex) => {
          const selected = answers[qIndex]
          const answered = selected !== undefined
          return (
            <div key={`q-${String(qIndex)}`} className="space-y-1.5">
              <p className="text-sm font-medium">{q.question}</p>
              <div className="space-y-1">
                {q.choices.map((choice, choiceIndex) => {
                  const isSelected = selected === choiceIndex
                  const isCorrect = choiceIndex === q.answerIndex
                  let className = 'w-full text-left text-xs rounded px-2 py-1.5 border transition-colors '
                  if (!answered) {
                    className += 'border-border/40 hover:bg-muted/50'
                  } else if (isCorrect) {
                    className += 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  } else if (isSelected) {
                    className += 'border-destructive/50 bg-destructive/10 text-destructive'
                  } else {
                    className += 'border-border/20 text-muted-foreground'
                  }
                  return (
                    <button
                      key={`choice-${String(choiceIndex)}`}
                      type="button"
                      className={className}
                      disabled={answered}
                      onClick={() => {
                        select(qIndex, choiceIndex)
                      }}
                    >
                      <span className="flex items-center gap-1.5">
                        {answered && isCorrect && <CheckCircle2 className="size-3.5 shrink-0" />}
                        {answered && isSelected && !isCorrect && <XCircle className="size-3.5 shrink-0" />}
                        {choice}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
