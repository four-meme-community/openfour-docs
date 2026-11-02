import { Interface } from 'ethers'

export const OPEN_FOUR_CORE_EVENTS = [
  'event TokenCreated(uint256 requestId, uint256 indexed presetId, address indexed creator, address indexed token, string name, string symbol, uint256 maxSupply, uint256 saleAmount, uint256 raiseAmount, uint256 initialPrice, address quoteAsset, address vault, address curveModule, address tradeModule, address migrateModule, address customData, address tokenModule, string tokenMetaUri, uint256 flags, bytes encodedTags)',
  'event TradeExecuted(address indexed token, address indexed trader, uint256 indexed presetId, bool isBuy, address quoteAsset, address vault, uint256 requestedTokenAmount, uint256 tokenAmount, uint256 curveQuoteAmount, uint256 traderQuoteAmount, uint256 lastPrice, uint256 slippageLimit, uint256 protocolFee, uint256 taxFee, uint256 devFee, uint256 antiSniperFee, uint256 totalRaised, uint256 remainingForSale)',
  'event MigrateExecuted(uint256 indexed presetId, address indexed caller, address indexed token, address vault, address migrateModule, bytes8 migrateTagId, uint256 totalRaised, uint256 remainingForSale, bytes32 hookDataHash, uint8 migratedDataVersion, bytes encodedMigratedData)',
  'event PhaseTransition(address indexed token, uint8 from, uint8 to, address operator)',
]

const ifaceTokenCreatedOnly = new Interface([OPEN_FOUR_CORE_EVENTS[0]])
export const TOPIC_TOKEN_CREATED = ifaceTokenCreatedOnly.getEvent('TokenCreated').topicHash
export const ifaceTokenCreated = ifaceTokenCreatedOnly
