/**
 * @file types.ts
 * @description Raw (on-disk-shaped) Ontology School content types
 * (Ontology-Playground coverage row #16). Mirrors the field names in
 * agent-utilities' `docs/learn/manifest.yaml` exactly (including the
 * `answer_index` / `schema_version` snake_case) so the two repos' copies stay
 * trivially diffable. `src/lib/learn.ts` normalizes these into the
 * camelCase view-facing shape.
 */

export interface RawQuizQuestion {
  question: string
  choices: string[]
  answer_index: number
}

export interface RawLesson {
  id: string
  title: string
  /** Markdown lesson body (bundled as a TS string constant, not a fetched file). */
  body: string
  quiz?: RawQuizQuestion[]
}

export interface RawCourse {
  id: string
  title: string
  description: string
  lessons: RawLesson[]
}

export interface RawLearnManifest {
  schema_version: number
  courses: RawCourse[]
}
