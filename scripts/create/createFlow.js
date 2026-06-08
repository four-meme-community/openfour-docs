import {
  prepareCreateTokenOnChain,
  submitCreateTokenOnChain,
} from './createOnChain.js'
import { normalizeBackendCreateData } from './createResponse.js'

/**
 * Backend create API + on-chain createToken (preset-agnostic).
 *
 * `postCreate` should return a normalized response:
 *   { code: 0, data: { createArg, signature, tokenId?, tokenAddress? }, msg?: string }
 *
 * Business-specific API adapters (for example Four.meme) should normalize their
 * own response shapes before passing data into this generic flow.
 *
 * @param {object} options
 * @param {object|Function} options.buildPayload - POST body object, or async () => body
 * @param {Function} options.postCreate - async (payload) => normalized create API response
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

  const data = normalizeBackendCreateData(apiRes.data)
  const { createArg: rawCreateArg, signature, tokenId, tokenAddress } = data

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

  return { payload, tokenId, tokenAddress, ...prepared, ...onChain }
}
