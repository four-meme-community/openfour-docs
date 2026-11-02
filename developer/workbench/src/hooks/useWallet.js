import { useCallback, useEffect, useState } from 'react'
import { BrowserProvider } from 'ethers'

export function useWallet() {
  const [address, setAddress] = useState(null)
  const [chainId, setChainId] = useState(null)
  const [loading, setLoading] = useState(false)

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert('Install MetaMask or a compatible wallet')
      return
    }
    setLoading(true)
    try {
      const provider = new BrowserProvider(window.ethereum)
      await provider.send('eth_requestAccounts', [])
      const signer = await provider.getSigner()
      const addr = await signer.getAddress()
      const net = await provider.getNetwork()
      setAddress(addr)
      setChainId(Number(net.chainId))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!window.ethereum) return
    const onAccounts = (accounts) => setAddress(accounts?.[0] ?? null)
    const onChain = (chainIdHex) => setChainId(chainIdHex ? parseInt(chainIdHex, 16) : null)
    window.ethereum.on?.('accountsChanged', onAccounts)
    window.ethereum.on?.('chainChanged', onChain)
    window.ethereum.request?.({ method: 'eth_accounts' }).then((accounts) => {
      if (accounts?.[0]) setAddress(accounts[0])
    })
    window.ethereum.request?.({ method: 'eth_chainId' }).then((hex) => {
      if (hex) setChainId(parseInt(hex, 16))
    })
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', onAccounts)
      window.ethereum?.removeListener?.('chainChanged', onChain)
    }
  }, [])

  return { address, chainId, connect, loading }
}
