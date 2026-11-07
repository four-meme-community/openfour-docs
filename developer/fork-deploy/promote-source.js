/**
 * INTERNAL ONLY — not part of the public developer workflow.
 * Do not document or expose this command in community docs.
 *
 * Writes source/bsctestnet.json from a fork-deployment.json.
 * Not registered in package.json scripts.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function main() {
  const inPath = path.resolve(
    process.argv[2] || path.join(__dirname, "out/fork-deployment.json")
  );
  if (!fs.existsSync(inPath)) {
    throw new Error(`fork deployment not found: ${inPath}`);
  }
  const full = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const A = full.addresses || {};
  for (const key of ["registry", "feeRouter", "core", "createDeployer", "tools"]) {
    if (!A[key]) throw new Error(`missing addresses.${key} in ${inPath}`);
  }
  if (!full.moduleIds?.TOKEN_STANDARD) throw new Error(`missing moduleIds in ${inPath}`);
  if (!full.presets?.bondingV1) throw new Error(`missing presets.bondingV1 in ${inPath}`);

  const addresses = {
    registry: A.registry,
    feeRouter: A.feeRouter,
    core: A.core,
    createDeployer: A.createDeployer,
    tools: A.tools,
  };
  if (A.taxVaultRegistry) addresses.taxVaultRegistry = A.taxVaultRegistry;
  if (A.forwardVaultImpl) addresses.forwardVaultImpl = A.forwardVaultImpl;

  const presets = {};
  for (const [key, id] of Object.entries(full.presets)) {
    presets[key] = String(id);
  }

  const out = {
    role: "developer-source",
    network: full.network || "bsctestnet",
    chainId: full.chainId || 97,
    note:
      "Default fork-deploy source. Includes Bonding V1 and Bonding Tax V1 (Royalty / ForwardVault). Fork your own proxy set; register only on the Registry in your fork.json.",
    deployedAt: full.deployedAt || new Date().toISOString(),
    addresses,
    moduleIds: full.moduleIds,
    presets,
  };
  if (full.forwardVaultTypeId) out.forwardVaultTypeId = full.forwardVaultTypeId;

  const outPath = path.join(__dirname, "source/bsctestnet.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`promoted ${inPath}`);
  console.log(`developer source -> ${outPath}`);
  console.log(`registry ${out.addresses.registry}`);
}

main();
