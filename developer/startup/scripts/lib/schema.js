const { ethers } = require("hardhat");

const coder = ethers.AbiCoder.defaultAbiCoder();

const PARAM_TUPLE =
  "tuple(string name,string abiType,uint8 decimals,bool optional,string title,string defaultValue,string hint,string minValue,string maxValue)";
const MODULE_SCHEMA = `tuple(string kind,uint8 version,${PARAM_TUPLE}[] params)`;

const TOOLS_SCHEMA_ABI = [
  `function getTokenBaseSchema() pure returns (${PARAM_TUPLE}[])`,
  `function getPresetEncodeSchemas(uint256 presetId) view returns (${MODULE_SCHEMA},${MODULE_SCHEMA},${MODULE_SCHEMA},${MODULE_SCHEMA},${MODULE_SCHEMA},${MODULE_SCHEMA})`,
];

const TOKEN_BASE_FALLBACK = [
  { name: "name", abiType: "string", decimals: 0, optional: false },
  { name: "symbol", abiType: "string", decimals: 0, optional: false },
  { name: "tokenUri", abiType: "string", decimals: 0, optional: true },
  { name: "maxSupply", abiType: "uint256", decimals: 18, optional: false },
  { name: "saleAmount", abiType: "uint256", decimals: 18, optional: false },
  { name: "raiseAmount", abiType: "uint256", decimals: 18, optional: false },
];

const FAIRLAUNCH_OFFLINE_SCHEMAS = {
  token: { kind: "token", params: [] },
  vault: { kind: "vault", params: [] },
  customData: { kind: "customData", params: [] },
  curve: {
    kind: "curve",
    params: [
      { name: "fixedPrice", abiType: "uint256", decimals: 18, optional: false },
      { name: "sellPenaltyBps", abiType: "uint16", decimals: 0, optional: true },
      { name: "enableSell", abiType: "bool", decimals: 0, optional: false },
      { name: "minPurchase", abiType: "uint256", decimals: 0, optional: false },
      { name: "maxPurchase", abiType: "uint256", decimals: 0, optional: false },
    ],
  },
  trade: {
    kind: "trade",
    params: [
      { name: "maxBuyAmount", abiType: "uint256", decimals: 0, optional: false },
      { name: "maxPerAddress", abiType: "uint256", decimals: 0, optional: true },
      { name: "maxSellAmount", abiType: "uint256", decimals: 0, optional: true },
      { name: "buyFeeBps", abiType: "uint16", decimals: 0, optional: true },
      { name: "sellFeeBps", abiType: "uint16", decimals: 0, optional: true },
      { name: "feeRecipient", abiType: "address", decimals: 0, optional: true },
    ],
  },
  migrate: {
    kind: "migrate",
    params: [
      { name: "softCap", abiType: "uint256", decimals: 18, optional: true },
      { name: "duration", abiType: "uint256", decimals: 0, optional: true },
      { name: "tokenLiquidityAmount", abiType: "uint256", decimals: 0, optional: true },
      { name: "maxQuoteToUse", abiType: "uint256", decimals: 18, optional: true },
    ],
  },
};

function parseArrayValue(raw) {
  if (Array.isArray(raw)) return raw;
  const str = String(raw ?? "").trim();
  if (!str) return [];
  if (str.startsWith("[")) {
    const parsed = JSON.parse(str);
    if (!Array.isArray(parsed)) throw new Error("array param must be a JSON array");
    return parsed;
  }
  return str.split(/[\n,]+/).map((v) => v.trim()).filter(Boolean);
}

function zeroValue(abiType) {
  if (abiType.endsWith("[]")) return [];
  if (abiType === "address") return ethers.ZeroAddress;
  if (abiType === "bool") return false;
  if (abiType === "bytes32") return ethers.ZeroHash;
  if (abiType === "bytes") return "0x";
  if (abiType === "string") return "";
  return 0n;
}

function resolveParam(desc, form) {
  let raw = form[desc.name];
  if (raw == null || String(raw).trim() === "") {
    if (desc.defaultValue != null && String(desc.defaultValue).trim() !== "") {
      raw = desc.defaultValue;
    } else if (desc.optional) {
      return zeroValue(desc.abiType);
    } else {
      throw new Error(`required param "${desc.name}" is missing`);
    }
  }
  const str = String(raw).trim();

  switch (desc.abiType) {
    case "address[]":
      return parseArrayValue(raw).map((v) => String(v).trim());
    case "uint16[]":
      return parseArrayValue(raw).map((v) => BigInt(String(v).trim()));
    case "uint256[]":
      return parseArrayValue(raw).map((v) => {
        const s = String(v).trim();
        return Number(desc.decimals) > 0 ? ethers.parseUnits(s, desc.decimals) : BigInt(s);
      });
    case "bool":
      if (typeof raw === "boolean") return raw;
      return str === "true" || str === "1";
    case "address":
      return str || ethers.ZeroAddress;
    case "string":
      return str;
    case "bytes32":
      return str || ethers.ZeroHash;
    case "bytes":
      return str || "0x";
    default:
      return Number(desc.decimals) > 0 ? ethers.parseUnits(str, desc.decimals) : BigInt(str);
  }
}

function mapParam(p) {
  return {
    name: p.name,
    abiType: p.abiType,
    decimals: Number(p.decimals || 0),
    optional: Boolean(p.optional),
    title: p.title || "",
    defaultValue: p.defaultValue || "",
    hint: p.hint || "",
    minValue: p.minValue || "",
    maxValue: p.maxValue || "",
  };
}

function mapModuleSchema(raw) {
  return {
    kind: raw.kind,
    version: Number(raw.version || 1),
    params: Array.from(raw.params || []).map(mapParam),
  };
}

function encodeModuleParams(schema, form) {
  if (!schema?.params?.length) return "0x";
  const types = schema.params.map((p) => p.abiType);
  const values = schema.params.map((p) => resolveParam(p, form));
  return coder.encode([`(${types.join(",")})`], [values]);
}

function flattenCreateForm(create = {}, extra = {}) {
  const defined = Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined));
  return {
    ...create,
    ...(create.token || {}),
    ...(create.vault || {}),
    ...(create.curve || {}),
    ...(create.trade || {}),
    ...(create.migrate || {}),
    ...(create.customData || {}),
    ...defined,
  };
}

function readBaseField(form, name, decimals = 18, fallback = "0") {
  const raw = form[name];
  if (raw == null || String(raw).trim() === "") {
    return decimals > 0 ? ethers.parseUnits(fallback, decimals) : BigInt(fallback);
  }
  if (typeof raw === "bigint") return raw;
  const str = String(raw).trim();
  return decimals > 0 ? ethers.parseUnits(str, decimals) : BigInt(str);
}

async function fetchPresetSchemas(tools, presetId) {
  const connected = new ethers.Contract(await tools.getAddress(), TOOLS_SCHEMA_ABI, tools.runner);
  const [token, vault, curve, trade, migrate, customData] = await connected.getPresetEncodeSchemas(presetId);
  let base = TOKEN_BASE_FALLBACK;
  try {
    base = Array.from(await connected.getTokenBaseSchema()).map(mapParam);
  } catch {
    /* older tools */
  }
  return {
    base,
    token: mapModuleSchema(token),
    vault: mapModuleSchema(vault),
    curve: mapModuleSchema(curve),
    trade: mapModuleSchema(trade),
    migrate: mapModuleSchema(migrate),
    customData: mapModuleSchema(customData),
  };
}

function encodeCreateParams(form, schemas) {
  return {
    tokenParams: encodeModuleParams(schemas.token, form),
    vaultParams: encodeModuleParams(schemas.vault, form),
    curveParams: encodeModuleParams(schemas.curve, form),
    tradeParams: encodeModuleParams(schemas.trade, form),
    migrateParams: encodeModuleParams(schemas.migrate, form),
    customDataParams: encodeModuleParams(schemas.customData, form),
  };
}

function encodeCreateArgs({
  requestId,
  presetId,
  validTimestamp,
  createFee,
  presaleQuote,
  quoteAsset,
  form,
  schemas,
}) {
  const params = encodeCreateParams(form, schemas);
  const maxSupply = readBaseField(form, "maxSupply", 18);
  const saleAmount = readBaseField(form, "saleAmount", 18);
  const raiseAmount = readBaseField(form, "raiseAmount", 18);
  return coder.encode(
    [
      "tuple(uint256 requestId,uint256 presetId,uint256 validTimestamp,uint256 createFee,uint256 presaleQuote,bool antiSniperEnabled,address partner,tuple(string name,string symbol,string tokenUri,uint256 maxSupply,uint256 saleAmount,uint256 raiseAmount,address quoteAsset,bytes32 tokenSalt,bytes tokenParams,bytes vaultParams,bytes curveParams,bytes tradeParams,bytes migrateParams,bytes customDataParams) initParams)",
    ],
    [[
      requestId,
      presetId,
      validTimestamp,
      createFee,
      presaleQuote,
      false,
      ethers.ZeroAddress,
      [
        form.name || "",
        form.symbol || "",
        form.tokenUri || "",
        maxSupply,
        saleAmount,
        raiseAmount,
        quoteAsset,
        ethers.ZeroHash,
        params.tokenParams,
        params.vaultParams,
        params.curveParams,
        params.tradeParams,
        params.migrateParams,
        params.customDataParams,
      ],
    ]],
  );
}

module.exports = {
  FAIRLAUNCH_OFFLINE_SCHEMAS,
  TOKEN_BASE_FALLBACK,
  TOOLS_SCHEMA_ABI,
  encodeCreateArgs,
  encodeCreateParams,
  encodeModuleParams,
  fetchPresetSchemas,
  flattenCreateForm,
  readBaseField,
};
