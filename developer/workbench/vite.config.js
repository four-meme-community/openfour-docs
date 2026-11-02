import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(here, 'data')
const forkFile = path.join(dataDir, 'fork.json')
const tokensFile = path.join(dataDir, 'tokens.json')
const forkDeployOut = path.resolve(here, '../fork-deploy/out/fork-deployment.json')

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true })
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  ensureDataDir()
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function workspaceApi() {
  return {
    name: 'openfour-workspace-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0]
        try {
          if (req.method === 'GET' && url === '/api/workspace') {
            sendJson(res, 200, {
              fork: readJson(forkFile, null),
              tokens: readJson(tokensFile, { tokens: [] }),
            })
            return
          }
          if (req.method === 'PUT' && url === '/api/workspace/fork') {
            const body = await readBody(req)
            writeJson(forkFile, body)
            sendJson(res, 200, { ok: true, fork: body })
            return
          }
          if (req.method === 'PUT' && url === '/api/workspace/tokens') {
            const body = await readBody(req)
            const payload = Array.isArray(body) ? { tokens: body } : { tokens: body.tokens ?? [] }
            writeJson(tokensFile, payload)
            sendJson(res, 200, { ok: true, ...payload })
            return
          }
          if (req.method === 'POST' && url === '/api/workspace/import-fork') {
            if (!fs.existsSync(forkDeployOut)) {
              sendJson(res, 404, {
                error: 'developer/fork-deploy/out/fork-deployment.json not found. Run npm run fork first.',
              })
              return
            }
            const fork = JSON.parse(fs.readFileSync(forkDeployOut, 'utf8'))
            writeJson(forkFile, fork)
            sendJson(res, 200, { ok: true, fork })
            return
          }
        } catch (err) {
          sendJson(res, 500, { error: err.message || String(err) })
          return
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), workspaceApi()],
})
