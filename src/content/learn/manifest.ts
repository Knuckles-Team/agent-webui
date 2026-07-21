/**
 * @file manifest.ts
 * @description Bundled Ontology School course manifest (Ontology-Playground
 * coverage row #16). Mirrors agent-utilities' `docs/learn/manifest.yaml` +
 * `docs/learn/lessons/` field-for-field (see that repo's `docs/learn/index.md`
 * for the shared schema and the honest scope note — this ships the framework
 * plus two real starter lessons, not a full curriculum). Kept as a bundled TS
 * module rather than a fetched file: `LearnView` renders fully client-side
 * with no backend round-trip, which also means it works before the KG backend
 * is configured at all.
 */

import type { RawLearnManifest } from './types'
import { ONTOLOGY_MODEL_101_LESSON_01 } from './lessons/ontologyModel101Lesson01'
import { QUERYING_WITH_UQL_LESSON_01 } from './lessons/queryingWithUqlLesson01'

export const RAW_LEARN_MANIFEST: RawLearnManifest = {
  schema_version: 1,
  courses: [
    {
      id: 'ontology-model-101',
      title: 'Intro to the Ontology Model',
      description:
        "What an interface, an object type, and a link type are in this platform's ontology, and how they compose into a governed schema.",
      lessons: [
        {
          id: 'interfaces-object-types-and-links',
          title: 'Interfaces, Object Types, and Links',
          body: ONTOLOGY_MODEL_101_LESSON_01,
          quiz: [
            {
              question: 'What is an Interface in this ontology model?',
              choices: [
                'A concrete, instantiable object type like "Customer" or "Order"',
                'An abstract shape contract (properties + link constraints) that object types implement',
                'A database table',
                'A REST endpoint',
              ],
              answer_index: 1,
            },
            {
              question:
                'A link with cardinality MANY_TO_MANY that needs its own properties (e.g. "role", "allocation") is modeled as a...',
              choices: [
                'plain LinkType',
                'JunctionLinkType (a reified intermediary object type)',
                'InterfaceProperty',
                'value type',
              ],
              answer_index: 1,
            },
            {
              question: 'How does an existing object type "implement" an Interface?',
              choices: [
                'By subclassing it in Python',
                'By being renamed to match the interface',
                'Via InterfaceRegistry.implement(), which validates it satisfies every required property and link constraint',
                'It cannot — interfaces are documentation only',
              ],
              answer_index: 2,
            },
          ],
        },
      ],
    },
    {
      id: 'querying-with-uql',
      title: 'Querying with UQL',
      description:
        "UQL is the engine's native cross-modal query language: one pipelined text query composing graph, vector, lexical, temporal, and epistemic reads over a single snapshot.",
      lessons: [
        {
          id: 'your-first-uql-pipeline',
          title: 'Your First UQL Pipeline',
          body: QUERYING_WITH_UQL_LESSON_01,
          quiz: [
            {
              question: 'What must every UQL query start with?',
              choices: ['RANK BY ~[...]', 'MATCH (:Label) [WHERE ...]', 'REASON <Class>', 'RETURN'],
              answer_index: 1,
            },
            {
              question: 'What does |> do in a UQL query?',
              choices: [
                'Comments out the rest of the line',
                'Pipes the current RowSet into the next stage',
                'Starts a brand-new, independent query',
                'Escapes a string literal',
              ],
              answer_index: 1,
            },
            {
              question: 'RANK BY ~[0.1, 0.9, 0.0] ranks the current RowSet by...',
              choices: [
                'Alphabetical order of node id',
                'Cosine similarity to a literal embedding-space query vector',
                'Recency (how recently the node changed)',
                'Node degree (number of edges)',
              ],
              answer_index: 1,
            },
          ],
        },
      ],
    },
  ],
}
