import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const script = resolve(root, 'scripts/build-exe-for-python-sdk.ts')
const pnpmEntry = join(dirname(createRequire(import.meta.url).resolve('pnpm')), 'bin', 'pnpm.mjs')

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx/esm', script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
}

describe('Python runtime executable builder CLI', () => {
  it.each([
    { flags: [], command: 'run build' },
    { flags: ['--build-artifacts'], command: 'run build:artifacts' },
  ])('validates the closure before $command and deploys only after building', ({ flags, command }) => {
    const result = run(['--dry-run', '--targets=node24-macos-arm64', ...flags])

    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status, result.stderr).toBe(0)
    const commands = result.stdout.split('\n').filter(line => line.includes(`${process.execPath} ${pnpmEntry} `))
    expect(commands[0]).toContain(`${process.execPath} ${pnpmEntry} run verify-runtime-closure`)
    expect(commands[1]?.endsWith(' ' + command)).toBe(true)
    expect(commands[2]).toContain(' --filter dsh-python-runtime-closure deploy ')
  })

  it('rejects simultaneous build modes before invoking the package manager', () => {
    const result = run(['--skip-build', '--build-artifacts', '--targets=node24-macos-arm64'])

    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('--skip-build and --build-artifacts cannot be combined')
    expect(result.stdout).toBe('')
  })

  it('keeps the single-file dispatcher on the Python packaging surface', () => {
    const bootstrapPath = resolve(root, 'python/sdk-runtime/runtime-bootstrap.mjs')
    const bootstrap = readFileSync(bootstrapPath, 'utf8')
    const cliConfig = readFileSync(resolve(root, 'apps/cli/tsdown.config.ts'), 'utf8')
    const cliTsconfig = readFileSync(resolve(root, 'apps/cli/tsconfig.json'), 'utf8')
    const cliManifest = JSON.parse(readFileSync(resolve(root, 'apps/cli/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const runtimeManifest = JSON.parse(readFileSync(resolve(root, 'python/sdk-runtime/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }

    expect(existsSync(resolve(root, 'apps/cli/src/runtime-bootstrap.ts'))).toBe(false)
    expect(cliConfig).not.toContain('runtime-bootstrap')
    expect(cliConfig).toContain("clean: ['lib/*.js']")
    expect(cliTsconfig).not.toContain('packages/subprocess/subprocess-local')
    expect(cliManifest.dependencies).not.toHaveProperty('@deepseek-ai/dsh-subprocess-local')
    expect(cliManifest.devDependencies).toHaveProperty('@deepseek-ai/dsh-subprocess-local')
    expect(runtimeManifest.dependencies).toHaveProperty('@deepseek-ai/dsh-subprocess-local')
    expect(bootstrap).toContain("import('@deepseek-ai/dsh/lib/bin.js')")
    expect(bootstrap).toContain('await runCli({ packageManager })')
    expect(bootstrap).toContain("import('@deepseek-ai/dsh-subprocess-local/runner')")
    expect(bootstrap).toContain('await runSelectedSubprocessRunner(selection)')
  })

  it('runs the pinned pnpm entrypoint without a command shell', () => {
    const result = run(['--skip-build', '--dry-run', '--targets=node24-macos-arm64'])

    expect(existsSync(pnpmEntry)).toBe(true)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`${process.execPath} ${pnpmEntry} run verify-runtime-closure`)
    expect(result.stdout).not.toMatch(/\[dry-run\] .* run build(?::src)?$/m)
    expect(result.stdout).toContain(`${process.execPath} ${pnpmEntry} --filter dsh-python-runtime-closure deploy`)
    const deploy = result.stdout.split('\n').find(line => line.includes(' --filter dsh-python-runtime-closure deploy'))
    expect(deploy).toContain('--prod --config.allow-unused-patches=true')
    expect(deploy).toContain('--config.hoist-workspace-packages=false')
    expect(deploy).toContain(`--config.pnpmfile=${join(root, 'scripts/python-runtime-deploy.pnpmfile.mjs')}`)
    expect(deploy).not.toContain('--legacy')
    expect(deploy).not.toContain('--config.auto-install-peers=false')
    expect(result.stdout.split('--config.allow-unused-patches=true')).toHaveLength(2)
    expect(result.stdout).not.toContain(resolve(root, 'python/sdk-runtime/runtime-bootstrap.mjs'))
    expect(result.stdout).toContain('"bin":"runtime-bootstrap.mjs"')
    expect(result.stdout).toContain(`${process.execPath} ${pnpmEntry} exec pkg`)
    expect(result.stdout).not.toMatch(/pnpm\.(cmd|exe)/i)
  })

  it('ignores the launcher nub exports and Windows command shims', () => {
    const result = run(['--skip-build', '--dry-run', '--targets=node24-macos-arm64'],
      { npm_execpath: 'C:\\tools\\pnpm.cmd', PNPM_HOME: 'C:\\tools' })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`${process.execPath} ${pnpmEntry} run verify-runtime-closure`)
    expect(result.stdout).not.toMatch(/pnpm\.cmd/i)
  })

  it('accepts the macOS x64 pkg target', () => {
    const result = run(['--skip-build', '--dry-run', '--targets=node24-macos-x64'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('exec pkg')
    expect(result.stdout).toContain('--sea --compress Brotli --targets node24-macos-x64')
    expect(result.stdout).toContain('keep only node-pty prebuilds darwin-x64')
    expect(result.stdout).toContain(`lock optional resource downloads in ${join(root, 'dist-exe', 'macos-x64')}`)
    expect(result.stdout).not.toContain('office-skills')
    expect(result.stdout).toContain(join(root, 'dist-exe', 'macos-x64'))
  })

  it('rejects a Windows arm64 product before any build step', () => {
    const result = run(['--skip-build', '--dry-run', '--targets=node24-win-arm64'])

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Windows supports x64 only')
    expect(result.stdout).toBe('')
  })
})
