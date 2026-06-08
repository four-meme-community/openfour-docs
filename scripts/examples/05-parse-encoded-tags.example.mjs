/**
 * Example: parse TokenCreated.encodedTags and detect UniToken.
 *
 * Contract formula:
 *   bytes8 tagId = bytes8(keccak256(bytes(tag)));
 *
 * For UniToken:
 *   tag = "token.uni"
 *   tagId = bytes8(keccak256(bytes("token.uni")))
 *
 * Usage:
 *   ENCODED_TAGS=0x... node scripts/examples/05-parse-encoded-tags.example.mjs
 */
import { id } from 'ethers'
import { parseCreationEncodedTags } from '../tags/encodedTags.js'

const ENCODED_TAGS =
  process.env.ENCODED_TAGS || '0x01' + '0000000000000000'.repeat(7)

function tagIdOf(tag) {
  // ethers id(tag) == keccak256(toUtf8Bytes(tag)); slice bytes8 (0x + 16 hex).
  return id(tag).slice(0, 18)
}

function main() {
  const decoded = parseCreationEncodedTags(ENCODED_TAGS)

  const uniTokenTagId = tagIdOf('token.uni')
  const isUniToken = decoded.tagIds.token === uniTokenTagId

  console.log('schema:', decoded.schema)
  console.log('token tagId:', decoded.tagIds.token)
  console.log('UniToken tagId:', uniTokenTagId)
  console.log('is UniToken:', isUniToken)
  console.table(decoded.slots)
}

main()
