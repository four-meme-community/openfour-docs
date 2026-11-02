export const DOCS_REPO = 'https://github.com/four-meme-community/openfour-docs'
export const DOCS_CLONE = 'git clone https://github.com/four-meme-community/openfour-docs.git'
export const OFFICIAL_SITE = 'https://four.meme'

export async function fetchWorkspace() {
  const res = await fetch('/api/workspace')
  if (!res.ok) throw new Error('Could not read local workspace JSON')
  const data = await res.json()
  return {
    fork: data.fork && Object.keys(data.fork).length ? data.fork : null,
    tokens: Array.isArray(data.tokens?.tokens) ? data.tokens.tokens : [],
  }
}

export async function saveForkJson(fork) {
  const res = await fetch('/api/workspace/fork', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fork),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to write fork.json')
  return data.fork
}

export async function saveTokensJson(tokens) {
  const res = await fetch('/api/workspace/tokens', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokens }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to write tokens.json')
  return data.tokens ?? tokens
}

export async function importForkFromDeploy() {
  const res = await fetch('/api/workspace/import-fork', { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to import fork-deployment.json')
  return data.fork
}

export async function addCreatedToken(record) {
  const { tokens } = await fetchWorkspace()
  const next = [
    record,
    ...tokens.filter((row) => row.tokenAddress?.toLowerCase() !== record.tokenAddress.toLowerCase()),
  ]
  await saveTokensJson(next)
  return next
}
