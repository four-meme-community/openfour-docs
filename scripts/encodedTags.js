import { getBytes, hexlify } from 'ethers'

export const CREATION_TAGS_SCHEMA_V1 = 1
export const CREATION_TAGS_LENGTH = 57
export const ZERO_TAG_ID = '0x0000000000000000'

export const CREATION_TAG_SLOT_NAMES = Object.freeze([
  'token',
  'tokenModule',
  'vault',
  'curve',
  'trade',
  'migrate',
  'customData',
])

function normalizeBytes(encodedTags) {
  try {
    return getBytes(encodedTags)
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err)
    throw new Error(`decodeCreationEncodedTags: invalid encodedTags (${hint})`)
  }
}

/**
 * Decode OpenFour `TokenCreated.encodedTags`.
 *
 * Layout: byte0 schema, then 7 packed bytes8 tagId slots:
 * token, tokenModule, vault, curve, trade, migrate, customData.
 */
export function decodeCreationEncodedTags(encodedTags) {
  const bytes = normalizeBytes(encodedTags)

  if (bytes.length !== CREATION_TAGS_LENGTH) {
    throw new Error(
      `decodeCreationEncodedTags: expected ${CREATION_TAGS_LENGTH} bytes, got ${bytes.length}`
    )
  }

  const schema = bytes[0]
  if (schema !== CREATION_TAGS_SCHEMA_V1) {
    throw new Error(`decodeCreationEncodedTags: unsupported schema ${schema}`)
  }

  const slots = CREATION_TAG_SLOT_NAMES.map((name, index) => {
    const start = 1 + index * 8
    const tagId = hexlify(bytes.slice(start, start + 8))
    return {
      name,
      tagId,
      isZero: tagId === ZERO_TAG_ID,
    }
  })

  return {
    schema,
    slots,
    tagIds: Object.fromEntries(slots.map(({ name, tagId }) => [name, tagId])),
  }
}

export const parseCreationEncodedTags = decodeCreationEncodedTags
