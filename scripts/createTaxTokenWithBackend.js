import { buildCreateTaxTokenRequest } from './createTaxTokenRequest.js'
import { createTokenWithBackendAndChain } from './createTokenWithBackend.js'

/**
 * Convenience wrapper: buildCreateTaxTokenRequest + backend API + on-chain createToken.
 *
 * @param {object} options
 * @param {object} options.buildRequest - input for buildCreateTaxTokenRequest
 * @param {Function} options.postCreate - async (payload) => ({ code, data, msg })
 * @param {import('ethers').Signer} options.signer
 * @param {string} options.coreAddress
 * @param {string} [options.wrappedNative]
 * @param {boolean} [options.simulate=true]
 */
export async function createTaxTokenWithBackendAndChain({
  buildRequest,
  postCreate,
  signer,
  coreAddress,
  wrappedNative,
  quoteIsNative,
  simulate = true,
}) {
  if (!buildRequest) {
    throw new Error('createTaxTokenWithBackendAndChain: buildRequest is required')
  }

  return createTokenWithBackendAndChain({
    buildPayload: () => {
      const { payload } = buildCreateTaxTokenRequest(buildRequest)
      return payload
    },
    postCreate,
    signer,
    coreAddress,
    wrappedNative,
    quoteIsNative,
    simulate,
  })
}
