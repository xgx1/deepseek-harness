/**
 * Build repository artifacts, type-check the aggregate test and script programs, or both.
 *
 * `--scope artifacts` emits every artifact and binds the client outputs to their public environment;
 * `--scope check` type-checks only the Host and Client aggregate programs against the package
 * declarations already on disk; the default runs both step sets as one dependency graph, so the
 * aggregate checks overlap the remaining artifact steps. `--scope typecheck` (`pnpm run typecheck`)
 * generates Typert declarations before package compilation, then type-checks every package project
 * and both aggregate programs without bundling.
 */

import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gateInputHash, writeGateStamp } from './build-cache.ts'
import {
  CLIENT_BUILD_RECORD_PATH,
  CLIENT_BUILD_PROFILE_SELECTOR,
  clientBuildProcessEnvironment,
  repositoryClientBuildEnvironment,
  resolveClientBuildEnvironment,
  writeClientBuildRecord,
} from './client-build-environment.ts'
import { aggregateBuildArgs, aggregateCheckArgs, contractSteps, libraryBuildSteps } from './compile-referenced-projects.ts'
import type { LibraryStep } from './compile-referenced-projects.ts'
import { pnpmCommand } from './release/process.ts'
import { defaultParallelism, describeDefaultParallelism } from './parallelism.ts'
import { runAggregate } from './run-gates.ts'
import type { Gate } from './run-gates.ts'

/**
 * Steps one build invocation runs: every artifact and check, only artifacts, only aggregate checks,
 * or every type check with the generated Typert declarations it needs.
 */
export type BuildScope = 'complete' | 'artifacts' | 'check' | 'typecheck'

/** Parsed command-line selection of one build invocation. */
export interface BuildArguments {
  readonly scope: BuildScope
  /** Client build profile requested by `--profile`; `complete` and `artifacts` scopes only. */
  readonly profile: string | undefined
  /** Run build steps without overlap, including when a concurrency override is set. */
  readonly serial: boolean
  /** Rebuild every gate instead of trusting the input stamps of the previous run. */
  readonly noCache: boolean
  /** Omit the Desktop bundle, which the Web development loop does not serve. */
  readonly noDesktop: boolean
}

/**
 * Parse the build command line.
 * @param args - Arguments after the script path.
 * @returns The selected scope and requested client build profile.
 * @throws If an option is unknown, the scope is not `artifacts`, `check`, or `typecheck`,
 *   or `--profile` accompanies `--scope check` or `--scope typecheck`.
 */
export function parseBuildArguments(args: readonly string[]): BuildArguments {
  const { values } = parseArgs({
    args: [...args],
    options: {
      'no-cache': { type: 'boolean', default: false },
      'no-desktop': { type: 'boolean', default: false },
      profile: { type: 'string' },
      scope: { type: 'string' },
      serial: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  })
  if (values.scope !== undefined && values.scope !== 'artifacts' && values.scope !== 'check' && values.scope !== 'typecheck') {
    throw new Error(`build: --scope must be artifacts, check, or typecheck, got ${JSON.stringify(values.scope)}; omit it for the complete build`)
  }
  const scope: BuildScope = values.scope ?? 'complete'
  if ((scope === 'check' || scope === 'typecheck') && values.profile !== undefined) {
    throw new Error(`build: --profile selects artifact values and does not apply to --scope ${scope}`)
  }
  return {
    scope,
    profile: values.profile,
    serial: values.serial,
    noCache: values['no-cache'],
    noDesktop: values['no-desktop'],
  }
}

/**
 * Construct the build steps of one scope as a gate dependency graph.
 * Artifact steps generate Typert from source before Host compilation, then bundle Host,
 * Desktop, and Client artifacts before Web. Native output also precedes Host compilation.
 * The typecheck scope generates Typert before compiling Host and Client packages; it writes no
 * bundle. In complete and typecheck scopes each aggregate check waits only for its own face's
 * package compilation; alone, the
 * checks have no predecessors and read whatever declarations already exist. The typecheck scope
 * checks aggregates in build mode, which skips a program whose tsbuildinfo is current; the other
 * scopes use project mode, which compiles no reference.
 * @param root - Repository root containing the compiler and bundle configurations.
 * @param scope - Steps to include.
 * @param environment - Environment overlay applied to every step; the parent value of a key mapped to `undefined` is removed.
 * @param serial - Whether each step must wait for the preceding step in report order.
 * @returns The gate graph in report order.
 * @throws If an aggregate configuration is invalid.
 */
export function buildGates(
  root: string,
  scope: BuildScope,
  environment: Readonly<Record<string, string | undefined>> = {},
  serial = false,
): Gate[] {
  const env = { ...environment }
  const gates: Gate[] = []
  if (scope === 'complete' || scope === 'artifacts') {
    gates.push(pnpmGate('native', 'native addon', ['run', 'build:native-system'], [], env))
    for (const step of libraryBuildSteps(root, 'all')) {
      gates.push(libraryGate(step, step.id === 'host-src' ? ['native', ...step.needs] : step.needs, env))
    }
    gates.push(pnpmGate('web', 'Web build', ['run', 'build:web'], ['client-bundle'], env))
  }
  if (scope === 'typecheck') {
    for (const step of contractSteps(root, 'all')) gates.push(libraryGate(step, step.needs, env))
  }
  if (scope !== 'artifacts') {
    for (const face of ['host', 'client'] as const) {
      gates.push({
        id: `${face}-check`,
        label: `${face} aggregate check`,
        displayCommand: `tsc ${scope === 'typecheck' ? '-b' : '-p'} tsconfig.${face}.json`,
        command: process.execPath,
        args: scope === 'typecheck' ? aggregateBuildArgs(face) : aggregateCheckArgs(face),
        needs: scope === 'check' ? [] : [`${face}-src`],
        env,
      })
    }
  }
  if (serial) {
    return gates.map((gate, index) => {
      const previous = gates[index - 1]
      return previous === undefined ? gate : { ...gate, needs: [...new Set([...(gate.needs ?? []), previous.id])] }
    })
  }
  return gates
}

function libraryGate(step: LibraryStep, needs: readonly string[], env: Record<string, string | undefined>): Gate {
  return {
    id: step.id,
    label: step.label,
    displayCommand: step.displayCommand,
    command: step.command,
    args: [...step.args],
    needs: [...needs],
    env,
  }
}

function pnpmGate(
  id: string,
  label: string,
  args: readonly string[],
  needs: readonly string[],
  env: Record<string, string | undefined>,
): Gate {
  const [command, ...prefix] = pnpmCommand()
  return { id, label, displayCommand: `pnpm ${args.join(' ')}`, command, args: [...prefix, ...args], needs: [...needs], env }
}

/**
 * Express a complete child environment as an overlay on the parent environment.
 * @param parent - Environment the gate executor merges the overlay into.
 * @param child - Complete environment every step must observe.
 * @returns `child` plus an `undefined` entry for each parent key it omits.
 */
function environmentOverlay(parent: NodeJS.ProcessEnv, child: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return { ...Object.fromEntries(Object.keys(parent).map(name => [name, undefined])), ...child }
}

async function main(): Promise<number> {
  // tsdown.config.ts loads only through Node type stripping (`--config-loader native`); this names the cause before tsdown fails.
  if (!process.features.typescript) {
    throw new Error('build: Node.js TypeScript type stripping is unavailable in this Node.js process; remove --no-experimental-strip-types from NODE_OPTIONS or use a Node.js build with TypeScript support')
  }
  const { scope, profile, serial, noCache, noDesktop } = parseBuildArguments(process.argv.slice(2))
  const root = resolve(import.meta.dirname, '..')
  const name = scope === 'complete' ? 'build' : scope === 'typecheck' ? 'typecheck' : `build:${scope}`
  const budget = defaultParallelism()
  const workers = (gates: readonly Gate[]) => ({
    workers: serial ? 1 : Math.min(gates.length, budget),
    source: serial ? '--serial' : describeDefaultParallelism(),
  })
  if (scope === 'check' || scope === 'typecheck') {
    const gates = buildGates(root, scope, {}, serial)
    return runAggregate(name, gates, workers(gates))
  }

  const repositoryEnvironment = repositoryClientBuildEnvironment(root, process.env)
  const clientEnvironment = resolveClientBuildEnvironment(repositoryEnvironment, profile ?? process.env[CLIENT_BUILD_PROFILE_SELECTOR])
  const environment = environmentOverlay(process.env, clientBuildProcessEnvironment(process.env, clientEnvironment))
  rmSync(resolve(root, CLIENT_BUILD_RECORD_PATH), { force: true })
  const gates = buildGates(root, scope, environment, serial)
  if (noDesktop) dropGate(gates, 'desktop-bundle')
  const inputs = gateInputTrees(root)
  wrapCachedGates(root, gates, inputs, noCache)
  const exitCode = await runAggregate(name, gates, workers(gates))
  if (exitCode !== 0) return exitCode
  // Stamped after the whole run: a gate's inputs may be rewritten by a later gate's dependencies
  // (the Client compiler re-emits shared lib/types after the Host bundle consumed them).
  for (const gate of gates) {
    const trees = inputs.get(gate.id)
    if (trees !== undefined) writeGateStamp(root, gate.id, gateInputHash(root, trees))
  }
  const record = writeClientBuildRecord(root, clientEnvironment)
  console.log(
    `build: recorded ${String(record.artifacts.fileCount)} client artifact(s) with ${String(Object.keys(record.environment).length)} public value(s)`,
  )
  return 0
}

/** Workspace package directories, `packages/<group>/<name>`. */
function workspacePackageDirs(root: string): string[] {
  const dirs: string[] = []
  const groups = readdirSync(join(root, 'packages'), { withFileTypes: true })
  for (const group of groups) {
    if (!group.isDirectory()) continue
    for (const entry of readdirSync(join(root, 'packages', group.name), { withFileTypes: true })) {
      if (entry.isDirectory()) dirs.push(`packages/${group.name}/${entry.name}`)
    }
  }
  return dirs
}

/** Package directories the Client compiler face owns, read from its reference list. */
function clientPackageDirs(root: string): Set<string> {
  const text = readFileSync(join(root, 'tsconfig.client.json'), 'utf8')
  const dirs = new Set<string>()
  for (const match of text.matchAll(/"path":\s*"\.\/(packages\/[^"]+)"/g)) {
    // A split package is referenced through its leaf config; the package directory is the owner.
    const dir = match[1]?.replace(/\/tsconfig(\.[a-z]+)?\.json$/, '')
    if (dir !== undefined) dirs.add(dir)
  }
  if (dirs.size === 0) throw new Error('build: tsconfig.client.json lists no package references')
  return dirs
}

/**
 * File trees each cacheable gate's output depends on. Coarse by design: a tree that does not
 * exist contributes nothing, so a missing optional artifact costs a cache hit only.
 */
function gateInputTrees(root: string): Map<string, readonly string[]> {
  const packages = workspacePackageDirs(root)
  const client = clientPackageDirs(root)
  const host = packages.filter(dir => !client.has(dir))
  const trees = new Map<string, readonly string[]>()
  trees.set('host-typert', [...packages.map(dir => `${dir}/src`), 'scripts/generate-typert.ts', 'scripts/typert-faces.ts'])
  trees.set('host-bundle', [
    'tsdown.config.ts',
    // The Host bundle covers every workspace package, so client-face declarations and emitted
    // JavaScript are inputs here too.
    ...packages.flatMap(dir => [`${dir}/lib/types`, `${dir}/package.json`]),
  ])
  trees.set('desktop-bundle', [
    'apps/desktop/src', 'apps/desktop/package.json', 'apps/desktop/tsdown.config.ts',
    ...host.map(dir => `${dir}/lib`),
  ])
  trees.set('client-bundle', [
    'tsdown.config.ts', 'packages/client/tsdown.client.ts',
    ...[...client].flatMap(dir => [`${dir}/lib/types`, `${dir}/lib/client.js`, `${dir}/package.json`]),
  ])
  trees.set('web', [
    'apps/web/src', 'apps/web/index.html', 'apps/web/vite.config.ts',
    'apps/web/product-isolation.ts', 'apps/web/katex-fonts.ts', 'apps/web/package.json',
    ...[...client].flatMap(dir => [`${dir}/lib/client.js`, `${dir}/lib/index.js`]),
  ])
  return trees
}

/** Gate runner that compares input trees before executing, then stamps a successful run. */
const CACHED_GATE_RUNNER = fileURLToPath(new URL('./build-cached.ts', import.meta.url))

/**
 * Route cacheable gates through {@link CACHED_GATE_RUNNER}. The decision stays inside the gate
 * process so it observes what earlier gates wrote in the same build.
 * @param root - repository root the stamped paths are relative to.
 * @param gates - gates to wrap in place.
 * @param inputs - gate id to its input trees; unwrapped ids are not cacheable.
 * @param bypass - run and stamp every wrapped gate instead of trusting a previous stamp.
 */
function wrapCachedGates(
  root: string,
  gates: Gate[],
  inputs: ReadonlyMap<string, readonly string[]>,
  bypass: boolean,
): void {
  for (const gate of gates) {
    const trees = inputs.get(gate.id)
    if (trees === undefined) continue
    const spec = JSON.stringify({ root, id: gate.id, inputs: trees, command: gate.command, args: gate.args })
    gate.env = { ...gate.env, DSH_BUILD_CACHE_GATE: spec, ...bypass ? { DSH_BUILD_CACHE_DISABLE: '1' } : {} }
    gate.command = process.execPath
    gate.args = [CACHED_GATE_RUNNER]
  }
}

/** Remove one gate and the dependency edges that named it. */
function dropGate(gates: Gate[], id: string): void {
  const index = gates.findIndex(gate => gate.id === id)
  if (index === -1) return
  gates.splice(index, 1)
  for (const gate of gates) {
    if (gate.needs?.includes(id) === true) gate.needs = gate.needs.filter(need => need !== id)
  }
}
if (import.meta.main) process.exitCode = await main()
