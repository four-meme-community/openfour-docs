import { BrowserProvider, JsonRpcProvider } from 'ethers'

export function getReadProvider(config) {
  return new JsonRpcProvider(config.rpcUrl)
}

export async function getSignerProvider(config) {
  if (!window.ethereum) throw new Error('Install MetaMask or a compatible wallet first')
  const browser = new BrowserProvider(window.ethereum)
  await browser.send('eth_requestAccounts', [])
  const net = await browser.getNetwork()
  if (Number(net.chainId) !== Number(config.chainId)) {
    throw new Error(`Wallet network does not match config: wallet=${net.chainId.toString()} config=${config.chainId}`)
  }
  const signer = await browser.getSigner()
  return { provider: browser, signer }
}
