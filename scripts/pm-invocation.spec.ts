import { describe, expect, it } from 'vitest'
import { pmInvocation } from './pm-invocation.ts'

describe('package-manager invocation', () => {
  it.each([
    '/tools/nub.js',
    '/tools/nub.cjs',
    '/tools/nub.mjs',
    '/tools/NUB.CJS',
    '/tools/with spaces/工具/$pnpm;.mjs',
  ])('runs the JavaScript entrypoint %j through Node', (entrypoint) => {
    expect(pmInvocation(['run', 'build'], { npm_execpath: entrypoint })).toEqual({
      command: process.execPath,
      args: [entrypoint, 'run', 'build'],
    })
  })

  it.each([
    '/tools/nub',
    '/tools/with spaces/$pnpm;',
    String.raw`C:\Program Files\工具\$nub;\nub.exe`,
  ])('runs the executable entrypoint %j directly', (entrypoint) => {
    expect(pmInvocation(['run', 'build'], { npm_execpath: entrypoint })).toEqual({
      command: entrypoint,
      args: ['run', 'build'],
    })
  })

  it.each([undefined, ''])('falls back to nub when the lifecycle entrypoint is unavailable', (entrypoint) => {
    expect(pmInvocation(['run', 'build'], { npm_execpath: entrypoint })).toEqual({ command: 'nub', args: ['run', 'build'] })
    expect(pmInvocation(['run', 'build'], { npm_execpath: entrypoint, NUB_BIN: '/opt/nub' }))
      .toEqual({ command: '/opt/nub', args: ['run', 'build'] })
  })
})
