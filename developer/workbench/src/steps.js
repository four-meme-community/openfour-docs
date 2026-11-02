export const STEPS = [
  {
    id: 1,
    to: '/docs',
    title: 'Get official docs',
    body: 'Clone openfour-docs and read the Developer Guide, interfaces, and the FairLaunch starter.',
    meta: 'Docs',
  },
  {
    id: 2,
    to: '/fork',
    title: 'Prepare a testnet',
    body: 'Create a personal development testnet for later module registration and token testing.',
    meta: 'Prepare',
  },
  {
    id: 3,
    to: '/modules',
    title: 'Build preset modules',
    body: 'Compile with Hardhat and solc 0.8.24, starting from the FairLaunch project in developer/startup. Implement Token / Vault / Curve / Trade / Migrate interfaces and reuse public token source from openfour-docs.',
    meta: 'Build',
  },
  {
    id: 4,
    to: '/register',
    title: 'Deploy and register',
    body: 'Deploy implementations, register modules on your Fork Registry, and compose a Preset. Official networks are registered only after audit.',
    meta: 'Registry',
  },
  {
    id: 5,
    to: '/create',
    title: 'Create a token',
    body: 'Sign locally as Core.signer with the current wallet, create a token from schema, and write tokens.json.',
    meta: 'Create',
  },
  {
    id: 6,
    to: '/tokens',
    title: 'Trade and migrate',
    body: 'Open a token from the local list and verify buy, sell, and migrate. The list reads local JSON, not chain logs.',
    meta: 'Trade',
  },
  {
    id: 7,
    to: '/submit',
    title: 'Submit official audit',
    body: 'Prepare source, schema, tests, risk notes, and the Fork Registry address for official review. Officials register approved work on the formal Registry.',
    meta: 'Audit',
  },
]

export function isStepPath(pathname, to) {
  if (pathname === to) return true
  return to === '/tokens' && pathname.startsWith('/token/')
}
