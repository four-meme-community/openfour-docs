export function computeCreateTokenTxValue({ createFee = 0n, presaleQuote = 0n, quoteAsset, wrappedNative }) {
  const fee = typeof createFee === 'bigint' ? createFee : BigInt(createFee ?? 0)
  const presale = typeof presaleQuote === 'bigint' ? presaleQuote : BigInt(presaleQuote ?? 0)
  const q = String(quoteAsset ?? '').toLowerCase()
  const w = String(wrappedNative ?? '').toLowerCase()
  if (presale > 0n && q && w && q === w) return fee + presale
  return fee
}
