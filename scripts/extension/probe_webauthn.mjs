import { spawn } from 'node:child_process'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROBE_MESSAGE = 'MYPWDMG_PROBE_PASSKEY_PROXY'
const DETACH_MESSAGE = 'MYPWDMG_DETACH_PASSKEY_PROXY'
const TEMP_PREFIX = 'mypwdmg-passkey-proxy-'
const START_TIMEOUT_MS = 15000
const COMMAND_TIMEOUT_MS = 10000

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..')
const extensionRoot = join(repositoryRoot, 'browser-extension')
const browserPath = resolve(String(process.argv[2] || ''))

if (!process.argv[2]) {
  console.error('Usage: node scripts/probe_web_authentication_proxy.mjs <browser-executable>')
  process.exit(2)
}

let browserProcess = null
let cdp = null
let temporaryRoot = null
let stderr = ''

async function main() {
  try {
    temporaryRoot = await mkdtemp(join(tmpdir(), TEMP_PREFIX))
    assertDisposablePath(temporaryRoot)

    const temporaryExtension = join(temporaryRoot, 'extension')
    const profileDirectory = join(temporaryRoot, 'profile')
    await mkdir(profileDirectory)
    await cp(extensionRoot, temporaryExtension, {
      recursive: true,
      filter(sourcePath) {
        const sourceRelativePath = relative(extensionRoot, sourcePath)
        return !sourceRelativePath.split(sep).includes('tests')
      }
    })
    const extensionId = await prepareTemporaryManifest(join(temporaryExtension, 'manifest.json'))

    const debugPort = await findAvailablePort()
    browserProcess = spawn(browserPath, [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-gpu',
      '--disable-sync',
      `--user-data-dir=${profileDirectory}`,
      `--disable-extensions-except=${temporaryExtension}`,
      `--load-extension=${temporaryExtension}`,
      `--remote-debugging-port=${debugPort}`,
      'about:blank'
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true
    })
    browserProcess.stderr.setEncoding('utf8')
    browserProcess.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-12000)
    })

    const version = await waitForDevTools(debugPort)
    cdp = await CdpClient.connect(version.webSocketDebuggerUrl)
    const pageTarget = await waitForExtensionPage(cdp, extensionId)
    const attached = await cdp.send('Target.attachToTarget', {
      targetId: pageTarget.targetId,
      flatten: true
    })

    await cdp.send('Runtime.enable', {}, attached.sessionId)
    await waitForExtensionRuntime(cdp, attached.sessionId, extensionId)

    const probe = await sendExtensionMessage(cdp, attached.sessionId, PROBE_MESSAGE)
    const cleanup = await sendExtensionMessage(cdp, attached.sessionId, DETACH_MESSAGE)
    const productionFlowPassed = Boolean(
      probe?.response?.ok
      && probe.response.data?.attached
      && probe.response.data?.detached
      && cleanup?.response?.ok
      && cleanup.response.data?.detached
    )
    const temporaryRequiredPermissionPassed = Boolean(
      probe?.response?.code === 'PASSKEY_PROXY_PERMISSION_REMOVE_FAILED'
      && probe.response.data?.probeCode === 'SUPPORTED'
      && probe.response.data?.detached
      && cleanup?.response?.code === 'PASSKEY_PROXY_PERMISSION_REMOVE_FAILED'
      && cleanup.response.data?.probeCode === 'DETACHED'
      && cleanup.response.data?.detached
    )
    const passed = productionFlowPassed || temporaryRequiredPermissionPassed
    const crashRecovery = passed
      ? await probeServiceWorkerRestartRecovery(cdp, attached.sessionId, extensionId)
      : { passed: false, skipped: true }
    const releaseGatePassed = passed && crashRecovery.passed

    console.log(JSON.stringify({
      passed: releaseGatePassed,
      browser: version.Browser || '',
      extensionId,
      permissionMode: 'temporary-required',
      probe,
      cleanup,
      crashRecovery
    }, null, 2))
    if (!releaseGatePassed) process.exitCode = 1
  } catch (error) {
    console.error(JSON.stringify({
      passed: false,
      error: String(error?.message || error),
      browserStderr: stderr.trim()
    }, null, 2))
    process.exitCode = 1
  } finally {
    cdp?.close()
    await stopBrowser(browserProcess)
    if (temporaryRoot) {
      assertDisposablePath(temporaryRoot)
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  }
}

async function prepareTemporaryManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const publicKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  }).publicKey
  manifest.permissions = [...new Set([...(manifest.permissions || []), 'webAuthenticationProxy'])]
  manifest.key = publicKey.toString('base64')
  const optionalPermissions = (manifest.optional_permissions || [])
    .filter((permission) => permission !== 'webAuthenticationProxy')
  if (optionalPermissions.length) manifest.optional_permissions = optionalPermissions
  else delete manifest.optional_permissions
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return extensionIdFromPublicKey(publicKey)
}

function extensionIdFromPublicKey(publicKey) {
  return createHash('sha256')
    .update(publicKey)
    .digest()
    .subarray(0, 16)
    .toString('hex')
    .replace(/[0-9a-f]/g, (nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16)))
}

function assertDisposablePath(path) {
  const resolvedPath = resolve(path)
  const resolvedTemp = `${resolve(tmpdir())}${sep}`
  if (!resolvedPath.startsWith(resolvedTemp) || !basename(resolvedPath).startsWith(TEMP_PREFIX)) {
    throw new Error(`Refusing to clean an unexpected path: ${resolvedPath}`)
  }
}

function findAvailablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

async function waitForDevTools(port) {
  return waitFor(async () => {
    if (browserProcess?.exitCode !== null) {
      throw new Error(`Browser exited before DevTools started (${browserProcess.exitCode}).`)
    }
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    return response.ok ? response.json() : null
  }, START_TIMEOUT_MS, 'Timed out waiting for the browser DevTools endpoint.')
}

async function waitForExtensionPage(client, extensionId) {
  const url = `chrome-extension://${extensionId}/popup.html`
  return waitFor(async () => {
    try {
      return await client.send('Target.createTarget', { url })
    } catch {
      return null
    }
  }, START_TIMEOUT_MS, 'The browser did not load the temporary extension.')
}

async function waitForExtensionRuntime(client, sessionId, extensionId) {
  const expectedUrl = `chrome-extension://${extensionId}/popup.html`
  return waitFor(async () => {
    const result = await client.send('Runtime.evaluate', {
      expression: "({ href: location.href, runtimeReady: typeof chrome?.runtime?.sendMessage === 'function' })",
      returnByValue: true
    }, sessionId)
    const value = result.result?.value || {}
    if (value.href && value.href !== expectedUrl) {
      throw new Error(
        `The temporary extension URL resolved to ${value.href}. `
        + 'Google Chrome 137+ branded builds ignore --load-extension; use Chrome for Testing, Chromium, or a manual unpacked-extension run.'
      )
    }
    return value.runtimeReady === true
  }, START_TIMEOUT_MS, 'The extension page runtime did not become ready.')
}

async function probeServiceWorkerRestartRecovery(client, pageSessionId, extensionId) {
  const worker = await waitForExtensionWorker(client, extensionId)
  const attached = await client.send('Target.attachToTarget', {
    targetId: worker.targetId,
    flatten: true
  })
  await client.send('Runtime.enable', {}, attached.sessionId)
  const directAttach = await evaluatePromise(client, attached.sessionId, `
    chrome.webAuthenticationProxy.attach().then(
      () => ({ ok: true }),
      (error) => ({ ok: false, message: String(error?.message || error) })
    )
  `)
  if (!directAttach?.ok) {
    return { passed: false, stage: 'attach-before-restart', directAttach }
  }

  const stopped = await client.send('Target.closeTarget', { targetId: worker.targetId })
  if (!stopped.success) {
    return { passed: false, stage: 'stop-worker', directAttach, stopped }
  }
  await waitFor(async () => {
    const targets = await client.send('Target.getTargets')
    return !targets.targetInfos.some((target) => target.targetId === worker.targetId)
  }, START_TIMEOUT_MS, 'The extension service worker did not stop.')

  const recovery = await sendExtensionMessage(client, pageSessionId, DETACH_MESSAGE)
  const reprobe = await sendExtensionMessage(client, pageSessionId, PROBE_MESSAGE)
  const recovered = isTemporaryRequiredDetach(recovery, 'DETACHED')
  const reprobed = isTemporaryRequiredDetach(reprobe, 'SUPPORTED')
  return {
    passed: recovered && reprobed,
    stage: recovered && reprobed ? 'complete' : 'restart-recovery',
    directAttach,
    stopped,
    recovery,
    reprobe
  }
}

async function waitForExtensionWorker(client, extensionId) {
  const expectedUrl = `chrome-extension://${extensionId}/background.js`
  return waitFor(async () => {
    const result = await client.send('Target.getTargets')
    return result.targetInfos.find((target) => (
      target.type === 'service_worker' && target.url === expectedUrl
    )) || null
  }, START_TIMEOUT_MS, 'The extension service worker did not start.')
}

async function evaluatePromise(client, sessionId, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId)
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Extension runtime evaluation failed.')
  }
  return result.result?.value || null
}

function isTemporaryRequiredDetach(message, probeCode) {
  return Boolean(
    message?.response?.code === 'PASSKEY_PROXY_PERMISSION_REMOVE_FAILED'
    && message.response.data?.probeCode === probeCode
    && message.response.data?.detached
  )
}

async function sendExtensionMessage(client, sessionId, type) {
  const expression = `new Promise((resolve) => chrome.runtime.sendMessage({ type: ${JSON.stringify(type)} }, (response) => resolve({ response, lastError: chrome.runtime.lastError?.message || '' })))`
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  }, sessionId)
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || `Extension message ${type} failed.`)
  }
  return result.result?.value || null
}

async function waitFor(operation, timeoutMs, timeoutMessage) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const value = await operation()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(lastError?.message ? `${timeoutMessage} ${lastError.message}` : timeoutMessage)
}

function delay(durationMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs))
}

async function stopBrowser(process) {
  if (!process || process.exitCode !== null) return
  const exited = new Promise((resolveExit) => process.once('exit', resolveExit))
  process.kill()
  await Promise.race([exited, delay(3000)])
  if (process.exitCode === null) process.kill('SIGKILL')
}

class CdpClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.addEventListener('message', (event) => this.handleMessage(event.data))
    socket.addEventListener('close', () => this.rejectPending(new Error('DevTools connection closed.')))
    socket.addEventListener('error', () => this.rejectPending(new Error('DevTools connection failed.')))
  }

  static connect(url) {
    return new Promise((resolveClient, reject) => {
      const socket = new WebSocket(url)
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('Timed out connecting to DevTools.'))
      }, COMMAND_TIMEOUT_MS)
      socket.addEventListener('open', () => {
        clearTimeout(timer)
        resolveClient(new CdpClient(socket))
      }, { once: true })
      socket.addEventListener('error', () => {
        clearTimeout(timer)
        reject(new Error('Could not connect to DevTools.'))
      }, { once: true })
    })
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`DevTools command timed out: ${method}`))
      }, COMMAND_TIMEOUT_MS)
      this.pending.set(id, { method, resolve: resolveCommand, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  handleMessage(data) {
    const message = JSON.parse(String(data))
    if (!message.id) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(`${pending.method}: ${message.error.message}`))
      return
    }
    pending.resolve(message.result || {})
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  close() {
    this.socket.close()
  }
}

await main()
