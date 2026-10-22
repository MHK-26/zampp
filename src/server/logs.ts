import { open, stat } from 'node:fs/promises'
import type { WebSocket } from 'ws'

/** Streams the tail of a file over a WebSocket, following appends until the socket closes. */
export async function tailFile(ws: WebSocket, file: string, initialLines = 200): Promise<void> {
  let position = 0
  try {
    const size = (await stat(file)).size
    const handle = await open(file, 'r')
    const start = Math.max(0, size - 64 * 1024)
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(size - start), 0, size - start, start)
    await handle.close()
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    const lines = text.split('\n')
    ws.send(JSON.stringify({ type: 'init', lines: lines.slice(-initialLines) }))
    position = size
  } catch {
    ws.send(JSON.stringify({ type: 'init', lines: [] }))
  }

  let closed = false
  ws.once('close', () => {
    closed = true
  })
  // fs.watch is unreliable for single files on some platforms; poll as well.
  while (!closed && ws.readyState === ws.OPEN) {
    let size: number
    try {
      size = (await stat(file)).size
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
      continue
    }
    if (size < position) position = 0
    if (size > position) {
      const handle = await open(file, 'r')
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(size - position), 0, size - position, position)
      await handle.close()
      position = size
      ws.send(JSON.stringify({ type: 'append', text: buffer.subarray(0, bytesRead).toString('utf8') }))
    }
    await new Promise((r) => setTimeout(r, 500))
  }
}
