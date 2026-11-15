import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { drainOutput, terminateProcess } from '../src/output-stream.ts'

afterEach(() => vi.useRealTimers())

it('waits for queued output and accepts an already ended or absent stream', async () => {
  const stream = new PassThrough()
  const chunks: string[] = []
  stream.on('data', chunk => chunks.push(String(chunk)))
  const pending = drainOutput(stream, 1000)
  stream.end('last output')
  expect(await pending).toBe(true)
  expect(chunks).toEqual(['last output'])
  expect(await drainOutput(stream, 1000)).toBe(true)
  expect(await drainOutput(undefined, 1000)).toBe(true)
})

it('bounds an output descriptor retained after the process exits', async () => {
  vi.useFakeTimers()
  const stream = new PassThrough()
  const pending = drainOutput(stream, 100)
  await vi.advanceTimersByTimeAsync(100)
  expect(await pending).toBe(false)
  stream.destroy()
  expect(await drainOutput(stream, 100)).toBe(false)
})

it.each(['close', 'error'])('reports incomplete output on %s', async (event) => {
  const stream = new PassThrough()
  const pending = drainOutput(stream, 1000)
  stream.emit(event, new Error('pipe failed'))
  expect(await pending).toBe(false)
  stream.destroy()
})

/** Minimal handle whose managed range outlives the spawned command. */
const rangeSurvivor = (waitForExit: SubprocessHandle['waitForExit']): SubprocessHandle => ({
  stdin: undefined, stdout: new PassThrough(), stderr: new PassThrough(), control: undefined,
  collected: {}, done: Promise.resolve({ exitCode: 0, signal: null }), terminate: vi.fn(), waitForExit,
})

it('bounds a managed range that keeps a detached descendant alive', async () => {
  // The program exited; a surviving group member keeps `waitForExit` pending forever.
  const signal = Promise.withResolvers<boolean>()
  const handle = rangeSurvivor(() => signal.promise)
  const started = Date.now()
  expect(await terminateProcess(handle, 50)).toBe(false)
  expect(Date.now() - started).toBeLessThan(2_000)
  expect(handle.terminate).toHaveBeenCalledOnce()
})

it('still reports an unobservable managed range as a provider failure', async () => {
  const handle = rangeSurvivor(async () => { throw new Error('range cannot be observed') })
  await expect(terminateProcess(handle, 50)).rejects.toThrow('range cannot be observed')
})
