import assert from 'node:assert/strict'
import test from 'node:test'

import { noDirectGraphosApiCall, noDirectLegacyApiCall } from './no-direct-api-call.mjs'

function reports(rule, callee, argument) {
  const found = []
  rule.create({ report: (finding) => found.push(finding) }).CallExpression({
    type: 'CallExpression',
    callee,
    arguments: [argument],
  })
  return found
}

test('G7 catches direct GraphOS fetch and axios calls', () => {
  const path = { type: 'Literal', value: '/api/v1/ops/search.query' }
  assert.equal(reports(noDirectGraphosApiCall, { type: 'Identifier', name: 'fetch' }, path).length, 1)
  assert.equal(
    reports(
      noDirectGraphosApiCall,
      {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'axios' },
        property: { type: 'Identifier', name: 'post' },
      },
      path,
    ).length,
    1,
  )
  assert.equal(
    reports(
      noDirectGraphosApiCall,
      { type: 'Identifier', name: 'fetch' },
      {
        type: 'TemplateLiteral',
        quasis: [{ value: { cooked: '/api/v1/ops/' } }],
      },
    ).length,
    1,
  )
})

test('legacy debt is visible without blocking the new GraphOS gate', () => {
  const fetch = { type: 'Identifier', name: 'fetch' }
  const legacy = { type: 'Literal', value: '/api/enhanced/sdd/specs' }
  assert.equal(reports(noDirectGraphosApiCall, fetch, legacy).length, 0)
  assert.equal(reports(noDirectLegacyApiCall, fetch, legacy).length, 1)
  assert.equal(reports(noDirectLegacyApiCall, fetch, { type: 'Literal', value: '/api/v1/ops/search' }).length, 0)
  assert.equal(reports(noDirectGraphosApiCall, fetch, { type: 'Literal', value: 'https://example.test' }).length, 0)
})
