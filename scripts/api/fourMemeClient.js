import { assertBackendCreateData } from '../create/createResponse.js'

export const DEFAULT_FOUR_MEME_API_BASE = 'https://four.meme/meme-api/v1'
export const DEFAULT_FOUR_MEME_NETWORK_CODE = 'BSC'
export const FOUR_MEME_TEMPLATE_CREATE_TOKEN_PATH =
  '/private/token_template/token/create'
export const FOUR_MEME_TEMPLATE_SEARCH_PATH = '/public/token_template/search'
export const FOUR_MEME_TEMPLATE_CONFIG_PATH = '/public/token_template/config'
export const FOUR_MEME_TOKEN_UPLOAD_PATH = '/private/token/upload'

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

async function requestFourMemeJson({
  apiBase = DEFAULT_FOUR_MEME_API_BASE,
  path,
  method = 'GET',
  headers = {},
  accessToken,
  body,
  fetchFn,
}) {
  const fetchImpl = getFetch(fetchFn)
  const finalHeaders = {
    ...headers,
    ...(accessToken ? { 'meme-web-access': accessToken } : {}),
  }

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

  const response = await requestFourMemeJson({
    apiBase,
    path: '/private/user/nonce/generate',
    method: 'POST',
    body: {
      accountAddress,
      verifyType,
      networkCode,
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

  const response = await requestFourMemeJson({
    apiBase,
    path: '/private/user/login/dex',
    method: 'POST',
    body: {
      region,
      langType,
      loginIp,
      inviteCode,
      verifyInfo: {
        address,
        networkCode,
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

  const address = accountAddress ?? (await signer.getAddress())
  const nonce = await requestFourMemeLoginNonce({
    apiBase,
    accountAddress: address,
    networkCode,
    verifyType,
    fetchFn,
  })
  const message = `You are sign in Meme ${nonce}`
  const signature = await signer.signMessage(message)
  const accessToken = await loginFourMemeWithSignature({
    apiBase,
    address,
    signature,
    networkCode,
    verifyType,
    fetchFn,
    ...loginOptions,
  })

  return { accessToken, address, nonce, message, signature }
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
    headers: { 'meme-web-access': accessToken },
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

export function createFourMemeApiClient({
  apiBase = DEFAULT_FOUR_MEME_API_BASE,
  accessToken = '',
  fetchFn,
} = {}) {
  let currentAccessToken = accessToken

  const client = {
    apiBase,
    setAccessToken(nextAccessToken) {
      currentAccessToken = nextAccessToken
      return client
    },
    async loginWithSigner(options = {}) {
      const login = await loginFourMemeWithSigner({
        apiBase,
        fetchFn,
        ...options,
      })
      currentAccessToken = login.accessToken
      return login
    },
    async uploadTokenImage(options = {}) {
      return uploadFourMemeTokenImage({
        apiBase,
        fetchFn,
        ...options,
        accessToken: options.accessToken ?? currentAccessToken,
      })
    },
    async searchTokenTemplates({ sort = 'LAST', ...body } = {}) {
      const response = await requestFourMemeJson({
        apiBase,
        fetchFn,
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
