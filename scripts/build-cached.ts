/**
 * Run one build gate unless its input trees are unchanged since the last successful run.
 *
 * The build script spawns this file as the gate command and passes the real command through
 * `DSH_BUILD_CACHE_GATE`, so the decision happens after the gate's dependencies ran: a compiler
 * that rewrote its output earlier in the same build is visible to the bundle that reads it.
 *
 * Usage: `node scripts/build-cached.ts` with `DSH_BUILD_CACHE_GATE` set to JSON
 * `{ root, id, inputs, command, args }`; `DSH_BUILD_CACHE_DISABLE=1` runs the gate regardless.
 * The build stamps every cacheable gate after the run finishes, so a stamp always describes the
 * settled tree rather than a mid-build state.
 */

import { spawn } from 'node:child_process'
import { gateInputHash, readGateStamp } from './build-cache.ts'

interface CachedGate {
  readonly root: string
  readonly id: string
  readonly inputs: readonly string[]
  readonly command: string
  readonly args: readonly string[]
}

const spec = JSON.parse(process.env.DSH_BUILD_CACHE_GATE ?? 'null') as CachedGate | null
if (spec === null) throw new Error('build-cached: DSH_BUILD_CACHE_GATE is unset')

const root = spec.root
const bypass = process.env.DSH_BUILD_CACHE_DISABLE === '1'
const before = gateInputHash(root, spec.inputs)
if (!bypass && readGateStamp(root, spec.id) === before) {
  console.log(`build: ${spec.id} unchanged`)
  process.exit(0)
}

const child = spawn(spec.command, [...spec.args], { cwd: root, stdio: 'inherit' })
process.on('SIGTERM', () => { child.kill('SIGTERM') })
process.on('SIGINT', () => { child.kill('SIGINT') })
const code = await new Promise<number>((resolve, reject) => {
  child.on('error', reject)
  child.on('exit', (exitCode) => { resolve(exitCode ?? 1) })
})
process.exit(code)
