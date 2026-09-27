// G7: new GraphOS HTTP calls must go through src/lib/graphos-api.  Legacy
// /api/enhanced callers are reported separately until their operation families
// exist in the GraphOS registry and can be migrated without losing behavior.
function apiPath(node) {
  if (node?.type === 'ChainExpression') return apiPath(node.expression)
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node?.type === 'TemplateLiteral') return node.quasis[0]?.value.cooked ?? ''
  if (node?.type === 'BinaryExpression' && node.operator === '+') return apiPath(node.left)
  if (
    node?.type === 'NewExpression' &&
    node.callee?.type === 'Identifier' &&
    ['URL', 'Request'].includes(node.callee.name)
  )
    return apiPath(node.arguments[0])
  if (node?.type === 'ObjectExpression') {
    const url = node.properties.find(
      (property) =>
        property.type === 'Property' &&
        !property.computed &&
        (property.key?.name === 'url' || property.key?.value === 'url'),
    )
    return apiPath(url?.value)
  }
  return ''
}

function isTransport(callee) {
  if (callee?.type === 'ChainExpression') return isTransport(callee.expression)
  if (callee?.type === 'Identifier') return ['fetch', 'axios', 'fetchValidated'].includes(callee.name)
  if (
    callee?.type === 'MemberExpression' &&
    (callee.property?.name === 'fetch' || callee.property?.value === 'fetch') &&
    callee.object?.type === 'Identifier' &&
    ['window', 'globalThis', 'self'].includes(callee.object.name)
  )
    return true
  return (
    callee?.type === 'MemberExpression' &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'axios' &&
    ['get', 'post', 'put', 'patch', 'delete', 'request'].includes(callee.property?.name ?? callee.property?.value)
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

export const noDirectGraphosApiCall = rule((path) => /^\/api\/v1(?:[/?#]|$)/.test(path))
export const noDirectLegacyApiCall = rule((path) => /^\/api\/(?!v1(?:[/?#]|$))/.test(path))
