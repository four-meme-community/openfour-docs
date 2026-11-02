import { Contract, Interface } from 'ethers'
import { getReadProvider } from './provider'

const vaultAbi = new Interface([
  'function quoteAsset() view returns (address)',
  'function phase() view returns (uint8)',
  'function totalRaised() view returns (uint256)',
  'function initialSaleAmount() view returns (uint256)',
  'function remainingForSale() view returns (uint256)',
])

export function getVaultReadOnlyAt(config, vaultAddress) {
  return new Contract(vaultAddress, vaultAbi, getReadProvider(config))
}
