// Web Worker: encode an image (data URL) to WebP off the main thread via
// OffscreenCanvas, so exporting a media-heavy project doesn't freeze the editor.
// The main thread falls back to a canvas encode if Workers/OffscreenCanvas are
// unavailable or a request fails (see encodeWebp in export.ts).

interface Req {
  id: number
  src: string
  quality: number
}

const ctx = self as unknown as { postMessage(m: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null }

ctx.onmessage = async (e: MessageEvent): Promise<void> => {
  const { id, src, quality } = e.data as Req
  try {
    const blob = await (await fetch(src)).blob()
    const bmp = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(bmp.width, bmp.height)
    const c2d = canvas.getContext('2d')
    if (!c2d) throw new Error('no 2d context')
    c2d.drawImage(bmp, 0, 0)
    bmp.close()
    const out = await canvas.convertToBlob({ type: 'image/webp', quality })
    const buf = await out.arrayBuffer()
    ctx.postMessage({ id, ok: true, buf }, [buf])
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: String(err) })
  }
}
