/**
 * Promote out/fork-deployment.json into the default developer source list.
 *
 *   npm run promote-source
 *   npm run promote-source -- ./out/fork-deployment.json
 *
 * Writes source/bsctestnet.json (slim addresses + moduleIds + preset).
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

  const out = {
    role: "developer-source",
    network: full.network || "bsctestnet",
    chainId: full.chainId || 97,
    note:
      "Shared developer hub. Default SOURCE_DEPLOYMENT for fork-deploy. Fork your own proxy set before registering modules unless you own this Registry.",
    deployedAt: full.deployedAt || new Date().toISOString(),
    deployer: full.deployer,
    addresses: {
      registry: A.registry,
      feeRouter: A.feeRouter,
      core: A.core,
      createDeployer: A.createDeployer,
      tools: A.tools,
    },
    moduleIds: full.moduleIds,
    presets: { bondingV1: String(full.presets.bondingV1) },
  };

  const outPath = path.join(__dirname, "source/bsctestnet.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(`promoted ${inPath}`);
  console.log(`developer source -> ${outPath}`);
  console.log(`registry ${out.addresses.registry}`);
}

main();
