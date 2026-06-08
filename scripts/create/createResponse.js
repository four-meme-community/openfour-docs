export function assertBackendCreateData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('create API: missing data in response')
  }
  const { createArg: rawCreateArg, signature } = data
  if (!rawCreateArg || rawCreateArg === '0x') {
    throw new Error('create API: missing or empty createArg in data')
  }
  if (!signature || signature === '0x') {
    throw new Error('create API: missing or empty signature in data')
  }
  return data
}

export function normalizeBackendCreateData(data) {
  return assertBackendCreateData(data)
}
