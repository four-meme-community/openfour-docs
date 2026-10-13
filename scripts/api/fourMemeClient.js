import { assertBackendCreateData } from '../create/createResponse.js'

export const DEFAULT_FOUR_MEME_API_BASE = 'https://four.meme/meme-api/v1'

/**
 * Four.meme / OpenFour **request** network types.
 * These are NOT EVM chain IDs (`56`, `4663`, …).
 *
 * | Network   | Request value |
 * |-----------|---------------|
 * | BSC       | `0`           |
 * | Robinhood | `8`           |
 */
export const FOUR_MEME_NETWORK_CODE = Object.freeze({
  BSC: 0,
  ROBINHOOD: 8,
})

/** Default request network: BSC (`0`). */
export const DEFAULT_FOUR_MEME_NETWORK_CODE = FOUR_MEME_NETWORK_CODE.BSC

/** HTTP header for ranking / search / most private routes. */
export const MEME_NETWORK_HEADER = 'meme-network-code'

export const FOUR_MEME_TEMPLATE_CREATE_TOKEN_PATH =
  '/private/token_template/token/create'
export const FOUR_MEME_TEMPLATE_SEARCH_PATH = '/public/token_template/search'
export const FOUR_MEME_TEMPLATE_CONFIG_PATH = '/public/token_template/config'
export const FOUR_MEME_TOKEN_UPLOAD_PATH = '/private/token/upload'

/**
 * Normalize a request `networkCode` to integer `0` or `8`.
 * Accepts numbers, numeric strings, and legacy names `BSC` / `ROBINHOOD`
 * (server dual-read still accepts names; new callers should send `0` / `8`).
 *
 * @param {string | number | null | undefined} value
 * @returns {number}
 */
export function normalizeFourMemeNetworkCode(
  value = DEFAULT_FOUR_MEME_NETWORK_CODE,
) {
  if (value == null || value === '') {
    return DEFAULT_FOUR_MEME_NETWORK_CODE
  }
  if (
    typeof value === 'number' ||
    (typeof value === 'string' && /^\d+$/.test(String(value).trim()))
  ) {
    const n = Number(value)
    if (n === FOUR_MEME_NETWORK_CODE.BSC || n === FOUR_MEME_NETWORK_CODE.ROBINHOOD) {
      return n
    }
    throw new Error(
      `Unknown Four.meme networkCode type: ${n} (use 0=BSC, 8=ROBINHOOD; not EVM chainId)`,
    )
  }
  const name = String(value).trim().toUpperCase()
  if (name === 'BSC') return FOUR_MEME_NETWORK_CODE.BSC
  if (name === 'ROBINHOOD') return FOUR_MEME_NETWORK_CODE.ROBINHOOD
  throw new Error(
    `Unknown Four.meme networkCode: ${value} (use 0/8 or BSC/ROBINHOOD)`,
  )
}

function getFetch(fetchFn) {
  const resolved = fetchFn ?? globalThis.fetch
  if (typeof resolved !== 'function') {
    throw new Error('fourMemeClient: fetch is required')
  }
  return resolved
}

function joinApiUrl(apiBase, path) {
  const base = String(apiBase ?? DEFAULT_FOUR_MEME_API_BASE).replace(/\/+$/, '')
  const suffix = String(path ?? '').replace(/^\/+/, '')
  return `${base}/${suffix}`
}

function isSuccessCode(code) {
  return code === 0 || code === '0'
}

function assertFourMemeResponse(response, label = 'Four.meme API') {
  if (!response || typeof response !== 'object') {
    throw new Error(`${label}: invalid response`)
  }
  if (!isSuccessCode(response.code)) {
    const msg = response.msg || response.message || JSON.stringify(response)
    throw new Error(`${label} failed: ${msg}`)
  }
  return response
}

function withNetworkHeaders(headers, networkCode) {
  const code = normalizeFourMemeNetworkCode(networkCode)
  return {
    ...headers,
    [MEME_NETWORK_HEADER]: String(code),
  }
}

async function requestFourMemeJson({
  apiBase = DEFAULT_FOUR_MEME_API_BASE,
  path,
  method = 'GET',
  headers = {},
  accessToken,
  body,
  networkCode = DEFAULT_FOUR_MEME_NETWORK_CODE,
  fetchFn,
}) {
  const fetchImpl = getFetch(fetchFn)
  const finalHeaders = withNetworkHeaders(
    {
      ...headers,
      ...(accessToken ? { 'meme-web-access': accessToken } : {}),
    },
    networkCode,
  )

  let finalBody = body
  if (
    body != null &&
    typeof body !== 'string' &&
    !(body instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(body)
  ) {
    finalHeaders['Content-Type'] ??= 'application/json'
    finalBody = JSON.stringify(body)
  }

  const res = await fetchImpl(joinApiUrl(apiBase, path), {
    method,
    headers: finalHeaders,
    body: finalBody,
  })
  if (!res.ok) {
    throw new Error(
      `Four.meme HTTP ${res.status}: ${res.statusText || 'request failed'}`,
    )
  }
  return res.json()
}

async function requestFourMemeLoginNonce({
  apiBase = DEFAULT_FOUR_MEME_API_BASE,
  accountAddress,
  networkCode = DEFAULT_FOUR_MEME_NETWORK_CODE,
  verifyType = 'LOGIN',
  fetchFn,
} = {}) {
  if (!accountAddress) {
    throw new Error('requestFourMemeLoginNonce: accountAddress is required')
  }

  const code = normalizeFourMemeNetworkCode(networkCode)
  const response = await requestFourMemeJson({
    apiBase,
    path: '/private/user/nonce/generate',
    method: 'POST',
    networkCode: code,
    body: {
      accountAddress,
      verifyType,
      networkCode: code,
    },
    fetchFn,
  })

  return assertFourMemeResponse(response, 'Four.meme nonce').data
}

async function loginFourMemeWithSignature({
  apiBase = DEFAULT_FOUR_MEME_API_BASE,
  address,
  signature,
  networkCode = DEFAULT_FOUR_MEME_NETWORK_CODE,
  verifyType = 'LOGIN',
  region = 'WEB',
  langType = 'EN',
  loginIp = '',
  inviteCode = '',
  walletName = 'MetaMask',
  fetchFn,
} = {}) {
  if (!address) throw new Error('loginFourMemeWithSignature: address is required')
  if (!signature) {
    throw new Error('loginFourMemeWithSignature: signature is required')
  }

  const code = normalizeFourMemeNetworkCode(networkCode)
  const response = await requestFourMemeJson({
    apiBase,
    path: '/private/user/login/dex',
    method: 'POST',
    networkCode: code,
    body: {
      region,
      langType,
      loginIp,
      inviteCode,
      verifyInfo: {
        address,
        networkCode: code,
        signature,
        verifyType,
      },
      walletName,
    },
    fetchFn,
  })

  return assertFourMemeResponse(response, 'Four.meme login').data
}

async function loginFourMemeWithSigner({
  signer,
  accountAddress,
  apiBase = DEFAULT_FOUR_MEME_API_BASE,
  networkCode = DEFAULT_FOUR_MEME_NETWORK_CODE,
  verifyType = 'LOGIN',
  fetchFn,
  ...loginOptions
} = {}) {
  if (!signer) throw new Error('loginFourMemeWithSigner: signer is required')

  const code = normalizeFourMemeNetworkCode(networkCode)
  const address = accountAddress ?? (await signer.getAddress())
  const nonce = await requestFourMemeLoginNonce({
    apiBase,
    accountAddress: address,
    networkCode: code,
    verifyType,
    fetchFn,
  })
  const message = `You are sign in Meme ${nonce}`
  const signature = await signer.signMessage(message)
  const accessToken = await loginFourMemeWithSignature({
    apiBase,
    address,
    signature,
    networkCode: code,
    verifyType,
    fetchFn,
    ...loginOptions,
  })

  return { accessToken, address, nonce, message, signature, networkCode: code }
}

function toUploadBlob(file, contentType) {
  if (typeof Blob !== 'undefined' && file instanceof Blob) return file
  if (file instanceof ArrayBuffer || ArrayBuffer.isView(file)) {
    return new Blob([file], contentType ? { type: contentType } : undefined)
  }
  throw new Error(
    'uploadFourMemeTokenImage: file must be a Blob, ArrayBuffer, Buffer, or typed array',
  )
}

function extractFourMemeImageUrl(data) {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    return data.url ?? data.imgUrl ?? data.imageUrl ?? data.path
  }
  return ''
}

async function uploadFourMemeTokenImage({
  apiBase = DEFAULT_FOUR_MEME_API_BASE,
  accessToken,
  file,
  filename,
  contentType,
  fieldName = 'file',
  networkCode = DEFAULT_FOUR_MEME_NETWORK_CODE,
  fetchFn,
} = {}) {
  if (!accessToken) {
    throw new Error('uploadFourMemeTokenImage: accessToken is required')
  }
  if (!file) throw new Error('uploadFourMemeTokenImage: file is required')

  const fetchImpl = getFetch(fetchFn)
  const uploadBlob = toUploadBlob(file, contentType)
  const resolvedFilename = filename ?? file.name ?? 'token-image.png'
  const form = new FormData()
  form.append(fieldName, uploadBlob, resolvedFilename)

  const res = await fetchImpl(joinApiUrl(apiBase, FOUR_MEME_TOKEN_UPLOAD_PATH), {
    method: 'POST',
    headers: withNetworkHeaders(
      { 'meme-web-access': accessToken },
      networkCode,
    ),
    body: form,
  })
  if (!res.ok) {
    throw new Error(
      `Four.meme upload HTTP ${res.status}: ${res.statusText || 'request failed'}`,
    )
  }

  const response = assertFourMemeResponse(
    await res.json(),
    'Four.meme image upload',
  )
  const imgUrl = extractFourMemeImageUrl(response.data)
  if (!imgUrl) {
    throw new Error('Four.meme image upload: response did not include imgUrl')
  }
  return imgUrl
}

export function normalizeFourMemeCreateResponse(response) {
  const ok = assertFourMemeResponse(response, 'Four.meme create token')
  const data = assertBackendCreateData(Array.isArray(ok.data) ? ok.data[0] : ok.data)
  return {
    ...ok,
    code: 0,
    data,
  }
}

export function selectFourMemeTemplateConfig(configs, { symbol } = {}) {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error('Four.meme template config: empty config list')
  }
  if (!symbol) return configs[0]
  return (
    configs.find((item) => String(item?.symbol ?? '').toLowerCase() === String(symbol).toLowerCase()) ??
    configs[0]
  )
}

/**
 * Four.meme Web API client.
 *
 * Multi-chain: pass `networkCode` `0` (BSC) or `8` (Robinhood). The client
 * sends header `meme-network-code` on every request and the same integer in
 * login / nonce body fields. Call `setNetworkCode` (or pass overrides) to switch.
 *
 * @param {object} [options]
 * @param {string} [options.apiBase]
 * @param {string} [options.accessToken]
 * @param {string | number} [options.networkCode=0] - request network (`0`/`8`)
 * @param {typeof fetch} [options.fetchFn]
 */
export function createFourMemeApiClient({
  apiBase = DEFAULT_FOUR_MEME_API_BASE,
  accessToken = '',
  networkCode = DEFAULT_FOUR_MEME_NETWORK_CODE,
  fetchFn,
} = {}) {
  let currentAccessToken = accessToken
  let currentNetworkCode = normalizeFourMemeNetworkCode(networkCode)

  const client = {
    apiBase,
    getNetworkCode() {
      return currentNetworkCode
    },
    setNetworkCode(nextNetworkCode) {
      currentNetworkCode = normalizeFourMemeNetworkCode(nextNetworkCode)
      return client
    },
    setAccessToken(nextAccessToken) {
      currentAccessToken = nextAccessToken
      return client
    },
    async loginWithSigner(options = {}) {
      const login = await loginFourMemeWithSigner({
        apiBase,
        fetchFn,
        ...options,
        networkCode: options.networkCode ?? currentNetworkCode,
      })
      currentAccessToken = login.accessToken
      if (login.networkCode != null) {
        currentNetworkCode = login.networkCode
      }
      return login
    },
    async uploadTokenImage(options = {}) {
      return uploadFourMemeTokenImage({
        apiBase,
        fetchFn,
        ...options,
        networkCode: options.networkCode ?? currentNetworkCode,
        accessToken: options.accessToken ?? currentAccessToken,
      })
    },
    async searchTokenTemplates({ sort = 'LAST', ...body } = {}) {
      const response = await requestFourMemeJson({
        apiBase,
        fetchFn,
        networkCode: currentNetworkCode,
        path: FOUR_MEME_TEMPLATE_SEARCH_PATH,
        method: 'POST',
        body: { sort, ...body },
      })
      return assertFourMemeResponse(response, 'Four.meme template search').data
    },
    async getTokenTemplateConfig({ templateId, symbol } = {}) {
      if (!templateId && templateId !== 0) {
        throw new Error('getTokenTemplateConfig: templateId is required')
      }
      const response = await requestFourMemeJson({
        apiBase,
        fetchFn,
        networkCode: currentNetworkCode,
        path: `${FOUR_MEME_TEMPLATE_CONFIG_PATH}?templateId=${encodeURIComponent(templateId)}`,
        method: 'GET',
      })
      const configs = assertFourMemeResponse(response, 'Four.meme template config').data
      return selectFourMemeTemplateConfig(configs, { symbol })
    },
    async createToken(payload, options = {}) {
      const response = await requestFourMemeJson({
        apiBase,
        fetchFn,
        networkCode: options.networkCode ?? currentNetworkCode,
        path: FOUR_MEME_TEMPLATE_CREATE_TOKEN_PATH,
        method: 'POST',
        accessToken: options.accessToken ?? currentAccessToken,
        body: payload,
      })
      return normalizeFourMemeCreateResponse(response)
    },
    async postCreate(payload, options = {}) {
      return client.createToken(payload, options)
    },
  }

  return client
}
