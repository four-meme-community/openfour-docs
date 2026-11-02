import { Contract, Interface } from 'ethers'
import { OPEN_FOUR_CORE_EVENTS } from './coreEvents'
import { resolveCoreAndToolsAddresses } from './addressResolver'
import { getReadProvider, getSignerProvider } from './provider'

export const SELL_OPTION_RECEIVE_WBNB = 1n

const fourCoreAbi = new Interface([
  'function createToken(bytes createArgs, bytes signature) payable returns (address)',
  'error CoreErrRequestExpired()',
  'error CoreErrRequestAlreadyUsed()',
  'error CoreErrPresetInactive()',
  'error CoreErrPresetCreateDisabled()',
  'error CoreErrInsufficientNative()',
  'error CoreErrBadConfig()',
  'error CoreErrBadToken()',
  'error CoreErrDuplicateToken()',
  'error CoreErrBudgetNotExecutable()',
  'error CoreErrUnauthorizedProxy()',
  'function buy(address token, uint256 amount, uint256 maxQuotePayAmount, uint256 options, bytes proof) payable',
  'function buyByBudget(address token, uint256 maxQuotePayAmount, uint256 minAmountOut, uint256 options, bytes proof) payable',
  'function sell(address token, uint256 amount, uint256 minQuoteRecvAmount, uint256 options, bytes proof)',
  'function migrate(address token)',
  'function tokens(address) view returns (uint32 version,address creator,uint256 presetId,address token,string name,string symbol,uint256 maxSupply,uint256 saleAmount,uint256 raiseAmount,address quoteAsset,address vault,address curveModule,address tradeModule,address migrateModule,address tokenModule,address customData,uint256 createBlock,bool exists,bool paused,bool antiSniperEnabled)',
  'function registry() view returns (address)',
  'function wrappedNative() view returns (address)',
  'function signer() view returns (address)',
  'function feeRouter() view returns (address)',
  ...OPEN_FOUR_CORE_EVENTS,
])

export async function getFourCoreWithSigner(config) {
  const { signer } = await getSignerProvider(config)
  const { core } = await resolveCoreAndToolsAddresses(config)
  return new Contract(core, fourCoreAbi, signer)
}

export async function getFourCoreReadOnly(config) {
  const provider = getReadProvider(config)
  const { core } = await resolveCoreAndToolsAddresses(config)
  return new Contract(core, fourCoreAbi, provider)
}

export function formatRevert(err, iface) {
  const data = err?.data ?? err?.info?.error?.data
  if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
    try {
      const parsed = iface.parseError(data)
      if (parsed) {
        const args = parsed.args?.length ? ` ${parsed.args.join(', ')}` : ''
        return `${parsed.name}${args}`
      }
    } catch {
      /* custom error not in ABI */
    }
  }
  const reason = err?.reason ?? err?.shortMessage
  if (reason && !String(reason).includes('could not coalesce')) return reason
  return err?.message ?? 'unknown revert'
}
