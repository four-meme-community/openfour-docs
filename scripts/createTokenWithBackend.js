import {
  prepareCreateTokenOnChain,
  submitCreateTokenOnChain,
} from './createTokenOnChain.js'

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

/**
 * Backend create API + on-chain createToken (preset-agnostic).
 *
 * @param {object} options
 * @param {object|Function} options.buildPayload - POST body object, or async () => body
 * @param {Function} options.postCreate - async (payload) => ({ code, data, msg })
 * @param {import('ethers').Signer} options.signer
 * @param {string} options.coreAddress - OpenFourCore address
 * @param {string} [options.wrappedNative] - WBNB/WETH for txValue calculation
 * @param {boolean} [options.quoteIsNative] - deprecated; use wrappedNative
 * @param {boolean} [options.simulate=true]
 */
export async function createTokenWithBackendAndChain({
  buildPayload,
  postCreate,
  signer,
  coreAddress,
  wrappedNative,
  quoteIsNative,
  simulate = true,
}) {
  if (buildPayload == null) {
    throw new Error('createTokenWithBackendAndChain: buildPayload is required')
  }
  if (typeof postCreate !== 'function') {
    throw new Error('createTokenWithBackendAndChain: postCreate function is required')
  }
  if (!signer) {
    throw new Error('createTokenWithBackendAndChain: signer is required')
  }
  if (!coreAddress) {
    throw new Error('createTokenWithBackendAndChain: coreAddress is required')
  }

  const payload =
    typeof buildPayload === 'function' ? await buildPayload() : buildPayload

  const apiRes = await postCreate(payload)
  if (apiRes?.code !== 0) {
    throw new Error(apiRes?.msg || `create API failed (code=${apiRes?.code})`)
  }

  const data = assertBackendCreateData(apiRes.data)
  const { createArg: rawCreateArg, signature, tokenId } = data

  const prepared = prepareCreateTokenOnChain({
    rawCreateArg,
    signature,
    wrappedNative,
    quoteIsNative,
  })

  const onChain = await submitCreateTokenOnChain({
    signer,
    coreAddress,
    ...prepared,
    simulate,
  })

  return { payload, tokenId, ...prepared, ...onChain }
}
