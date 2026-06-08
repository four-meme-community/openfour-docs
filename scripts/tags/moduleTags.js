/** On-chain `descriptor().tag` from token module implementations. */

export const UNI_TOKEN_MODULE_TAG = 'module.token.uni'
export const TAX_TOKEN_MODULE_TAG = 'module.token.tax'

export function isUniTokenModuleTag(tag) {
  return tag === UNI_TOKEN_MODULE_TAG
}

export function isTaxTokenModuleTag(tag) {
  return tag === TAX_TOKEN_MODULE_TAG
}
