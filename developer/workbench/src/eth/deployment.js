import { createContext, useContext } from 'react'

export const DeploymentContext = createContext(null)

export function useDeployment() {
  const ctx = useContext(DeploymentContext)
  if (!ctx) throw new Error('useDeployment must be used inside DeploymentProvider')
  return ctx
}
