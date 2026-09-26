// G7: new GraphOS HTTP calls must go through src/lib/graphos-api.  Legacy
// /api/enhanced callers are reported separately until their operation families
// exist in the GraphOS registry and can be migrated without losing behavior.
function apiPath(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral') return node.quasis[0]?.value.cooked ?? ''
  return ''
}

function isTransport(callee) {
  if (callee?.type === 'Identifier') return callee.name === 'fetch' || callee.name === 'axios'
  return (
    callee?.type === 'MemberExpression' &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'axios' &&
    callee.property?.type === 'Identifier' &&
    ['get', 'post', 'put', 'patch', 'delete', 'request'].includes(callee.property.name)
  )
}

function rule(match) {
  return {
    meta: {
      type: 'problem',
      docs: { description: 'Use the GraphOS API client for domain HTTP calls' },
      messages: { direct: 'Route API calls through src/lib/graphos-api instead of calling {{path}} directly.' },
      schema: [],
    },
    create(context) {
      return {
        CallExpression(node) {
          if (!isTransport(node.callee)) return
          const path = apiPath(node.arguments[0])
          if (match(path)) context.report({ node, messageId: 'direct', data: { path } })
        },
      }
    },
  }
}

export const noDirectGraphosApiCall = rule((path) => /^\/api\/v1(?:\/|$)/.test(path))
export const noDirectLegacyApiCall = rule((path) => /^\/api\/(?!v1(?:\/|$))/.test(path))
