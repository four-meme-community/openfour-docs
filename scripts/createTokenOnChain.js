import { Contract } from 'ethers'
import OpenFourCoreAbi from './abi/OpenFourCore.json' with { type: 'json' }
import {
  computeCreateTokenTxValue,
  isPresaleNative,
  normalizeCreateArg,
} from './createArgCodec.js'

/**
 * Prepare on-chain createToken call from backend response.
 *
 * @param {object} options
 * @param {string} options.rawCreateArg - backend-encoded createArgs bytes
 * @param {string} options.signature
 * @param {string} [options.wrappedNative] - chain wrapped native (WBNB/WETH); required for accurate txValue
 * @param {string} [options.quoteAsset] - override quote from decoded initParams
 * @param {boolean} [options.quoteIsNative] - deprecated; use wrappedNative + decoded quoteAsset
 */
export function prepareCreateTokenOnChain({
  rawCreateArg,
  signature,
  wrappedNative,
  quoteAsset,
  quoteIsNative,
}) {
  if (!signature || signature === '0x') {
    throw new Error('prepareCreateTokenOnChain: signature is required')
  }

  const { createArg, decoded } = normalizeCreateArg(rawCreateArg)
  const resolvedQuote = quoteAsset ?? decoded?.initParams?.quoteAsset
  const txValue = computeCreateTokenTxValue(decoded, {
    quoteAsset: resolvedQuote,
    wrappedNative,
    quoteIsNative,
  })
  const presaleNative = isPresaleNative({
    presaleQuote: decoded?.presaleQuote,
    quoteAsset: resolvedQuote,
    wrappedNative,
  })

  return {
    createArg,
    signature,
    txValue,
    decoded,
    quoteAsset: resolvedQuote,
    presaleNative,
  }
}

/**
 * Submit createToken to OpenFourCore (ethers Signer).
 */
export async function submitCreateTokenOnChain({
  signer,
  coreAddress,
  createArg,
  signature,
  txValue = 0n,
  simulate = true,
}) {
  if (!signer) throw new Error('submitCreateTokenOnChain: signer is required')
  if (!coreAddress) throw new Error('submitCreateTokenOnChain: coreAddress is required')
  if (!createArg || createArg === '0x') {
    throw new Error('submitCreateTokenOnChain: createArg is required')
  }
  if (!signature || signature === '0x') {
    throw new Error('submitCreateTokenOnChain: signature is required')
  }

  const core = new Contract(coreAddress, OpenFourCoreAbi, signer)

  if (simulate) {
    try {
      await core.createToken.staticCall(createArg, signature, { value: txValue })
    } catch (err) {
      const reason = err?.shortMessage ?? err?.reason ?? err?.message ?? String(err)
      throw new Error(`createToken simulation failed: ${reason}`)
    }
  }

  const tx = await core.createToken(createArg, signature, { value: txValue })
  const receipt = await tx.wait()

  if (receipt && receipt.status !== 1) {
    throw new Error(`createToken transaction reverted (status=${receipt.status})`)
  }

  return {
    hash: tx.hash,
    receipt,
    status: receipt?.status,
  }
}
