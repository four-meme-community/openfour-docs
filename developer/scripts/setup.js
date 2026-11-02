const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");

function ensureEnv(example, dest) {
  if (fs.existsSync(dest) || !fs.existsSync(example)) return;
  fs.copyFileSync(example, dest);
  console.log(`wrote ${path.relative(root, dest)}`);
}

ensureEnv(path.join(root, ".env.example"), path.join(root, ".env"));
ensureEnv(path.join(root, "startup/.env.example"), path.join(root, "startup/.env"));
ensureEnv(path.join(root, "fork-deploy/.env.example"), path.join(root, "fork-deploy/.env"));

const install = spawnSync("npm", ["install"], { cwd: root, stdio: "inherit" });
if (install.status !== 0) process.exit(install.status || 1);
console.log("setup done. Fill developer/.env (or startup/.env and fork-deploy/.env), then npm run fork -w openfour-fork-deploy");
