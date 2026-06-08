import { getCreate2Address, keccak256, solidityPacked, toBeHex, zeroPadValue } from 'ethers'
import { isUniTokenModuleTag } from '../tags/moduleTags.js'

export const HOOK_ADDR_MASK = (1n << 14n) - 1n
// Must match PancakeInfinityHookBitmap.UNITOKEN_HOOK_BITMAP offsets (0, 2, 3, 7).
export const HOOK_ADDR_TARGET = (1n << 0n) | (1n << 2n) | (1n << 3n) | (1n << 7n)
const MAX_SALT = 500_000_000n
const LOG_PREFIX = '[uniHookSalt]'
const PROGRESS_EVERY = 100_000n

export function predictUniHookCloneAddress(implementation, salt, deployer) {
  const deploymentBytecode = solidityPacked(
    ['bytes', 'address', 'bytes'],
    ['0x3d602d80600a3d3981f3363d3d373d3d3d363d73', implementation, '0x5af43d82803e903d91602b57fd5bf3'],
  )
  return getCreate2Address(deployer, salt, keccak256(deploymentBytecode))
}

/** @param {import('ethers').Provider} provider */
export async function isHookCloneAddressAvailable(provider, hookAddress) {
  const code = await provider.getCode(hookAddress)
  return !code || code === '0x'
}

/**
 * Re-check mined salt right before submit; re-mine if CREATE2 slot was taken meanwhile.
 * @returns {Promise<{ salt: string, hookAddress: string, remined: boolean }>}
 */
export async function ensureHookSaltAvailable(
  provider,
  createDeployer,
  hookImplementation,
  hookSalt,
) {
  const hookAddress = predictUniHookCloneAddress(hookImplementation, hookSalt, createDeployer)
  if (await isHookCloneAddressAvailable(provider, hookAddress)) {
    return { salt: hookSalt, hookAddress, remined: false }
  }
  console.warn(
    `${LOG_PREFIX} slot occupied before submit (${hookAddress}), re-mining...`,
  )
  const mined = await mineUniHookCloneSalt(provider, createDeployer, hookImplementation)
  return { salt: mined.salt, hookAddress: mined.hookAddress, remined: true }
}

/**
 * Mine CREATE2 salt whose predicted clone address satisfies Infinity hook flags and is not deployed yet.
 * @param {import('ethers').Provider} provider read provider (eth_getCode)
 * @param {string} createDeployer OpenFourDeployer
 * @param {string} hookImplementation registry uniTokenV4HookImpl
 * @param {bigint} [maxSalt]
 * @returns {Promise<{ salt: string, hookAddress: string, attempts: bigint, skippedOccupied: bigint, elapsedMs: number }>}
 */
export async function mineUniHookCloneSalt(
  provider,
  createDeployer,
  hookImplementation,
  maxSalt = MAX_SALT,
) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  let skippedOccupied = 0n

  console.group(`${LOG_PREFIX} mine V4 hook CREATE2 salt`)
  console.log(`${LOG_PREFIX} createDeployer:`, createDeployer)
  console.log(`${LOG_PREFIX} hookImplementation:`, hookImplementation)
  console.log(`${LOG_PREFIX} maxSalt:`, maxSalt.toString())
  console.log(`${LOG_PREFIX} skip addresses with existing bytecode (CREATE2 slot taken)`)
  console.log(
    `${LOG_PREFIX} Pancake Infinity hook flag bits (addr & mask === target):`,
    `mask=0x${HOOK_ADDR_MASK.toString(16)}`,
    `target=0x${HOOK_ADDR_TARGET.toString(16)}`,
  )

  for (let salt = 0n; salt < maxSalt; salt++) {
    if (salt > 0n && salt % PROGRESS_EVERY === 0n) {
      console.log(
        `${LOG_PREFIX} searching... salt index=${salt.toString()}, skippedOccupied=${skippedOccupied.toString()}`,
      )
    }

    const saltBytes32 = zeroPadValue(toBeHex(salt), 32)
    const predicted = predictUniHookCloneAddress(hookImplementation, saltBytes32, createDeployer)
    if ((BigInt(predicted) & HOOK_ADDR_MASK) !== HOOK_ADDR_TARGET) {
      continue
    }

    if (!(await isHookCloneAddressAvailable(provider, predicted))) {
      skippedOccupied += 1n
      console.log(
        `${LOG_PREFIX} skip occupied slot: salt index=${salt.toString()}, address=${predicted}`,
      )
      continue
    }

    const elapsedMs = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
    )
    const attempts = salt + 1n
    console.log(`${LOG_PREFIX} found salt index:`, salt.toString())
    console.log(`${LOG_PREFIX} salt (bytes32):`, saltBytes32)
    console.log(`${LOG_PREFIX} predicted hook address:`, predicted)
    console.log(`${LOG_PREFIX} attempts:`, attempts.toString())
    console.log(`${LOG_PREFIX} skippedOccupied:`, skippedOccupied.toString())
    console.log(`${LOG_PREFIX} elapsedMs:`, elapsedMs)
    console.groupEnd()
    return { salt: saltBytes32, hookAddress: predicted, attempts, skippedOccupied, elapsedMs }
  }

  const elapsedMs = Math.round(
    (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  )
  console.warn(
    `${LOG_PREFIX} exhausted: no free matching salt in [0, ${maxSalt.toString()}), skippedOccupied=${skippedOccupied.toString()}`,
  )
  console.log(`${LOG_PREFIX} elapsedMs:`, elapsedMs)
  console.groupEnd()
  throw new Error('UniTokenV4Hook clone salt mine exhausted (no unused hook address found)')
}

/** @param {{ tokenModuleTag?: string } | null | undefined} presetView */
export function isUniTokenPreset(presetView) {
  return isUniTokenModuleTag(presetView?.tokenModuleTag)
}
