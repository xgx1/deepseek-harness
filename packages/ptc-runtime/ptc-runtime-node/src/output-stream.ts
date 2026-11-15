/** Bounded drainage for raw process output after managed execution ends. */
import type { Readable } from 'node:stream'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'

/**
 * Wait for queued bytes without letting an inherited descriptor retain a run forever.
 * @param stream - Caller-owned raw process output, when provided.
 * @param graceMs - Maximum wait after managed process termination.
 * @returns Whether the complete stream ended without a transport error.
 */
export function drainOutput(stream: Readable | undefined, graceMs: number): Promise<boolean> {
  if (stream === undefined || stream.readableEnded) return Promise.resolve(true)
  if (stream.destroyed) return Promise.resolve(false)
  return new Promise((resolve) => {
    const finish = (complete: boolean): void => {
      clearTimeout(timer)
      stream.off('end', onEnd)
      stream.off('close', onClose)
      stream.off('error', onError)
      resolve(complete)
    }
    const onEnd = (): void => { finish(true) }
    const onClose = (): void => { finish(false) }
    const onError = (): void => { finish(false) }
    const timer = setTimeout(() => { finish(false) }, graceMs)
    stream.once('end', onEnd)
    stream.once('close', onClose)
    stream.once('error', onError)
  })
}

/**
 * Terminate a managed process and drain its pipes, including failures before output listeners attach.
 * @param handle - Process and streams owned by the runtime.
 * @param graceMs - Maximum managed-range exit wait and, separately, pipe-drain wait.
 * @returns Whether the managed range emptied and both output streams ended cleanly.
 */
export async function terminateProcess(handle: SubprocessHandle, graceMs: number): Promise<boolean> {
  try {
    handle.terminate()
    handle.stdout?.resume()
    handle.stderr?.resume()
    // The range can outlive the spawned command: a program that leaves a detached
    // descendant keeps `waitForExit` pending forever unless the wait itself is bound.
    const bound = AbortSignal.timeout(graceMs)
    const observation = handle.waitForExit(bound)
    // The bound is enforced here rather than trusted to the provider: a handle whose
    // signal support is missing would otherwise retain the run forever.
    void observation.catch(() => {})
    const emptied = await Promise.race([
      observation,
      new Promise<boolean>((resolve) => { bound.addEventListener('abort', () => { resolve(false) }, { once: true }) }),
    ]).catch((error: unknown) => {
      // An unobservable range stays a provider failure; only our own bound ends the wait.
      if (!bound.aborted) throw error
      return false
    })
    if (!emptied) return false
    await handle.done.catch(() => {})
    const drained = await Promise.all([drainOutput(handle.stdout, graceMs), drainOutput(handle.stderr, graceMs)])
    return !drained.includes(false)
  } finally {
    handle.stdout?.destroy()
    handle.stderr?.destroy()
  }
}
