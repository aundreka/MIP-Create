// Video sources for the media stack.
//
// An export inlines every asset as a `data:` URL, which is fine for <img> but is the
// one form iOS refuses to play: WebKit drives <video> through byte-range requests, and
// a data: URL cannot serve one. The clip never reaches a decodable frame, autoplay never
// happens, and the webview paints its own big play button over the element — the player
// has to tap the ad to start the end card. A blob: URL is backed by a real, seekable
// store, so the same bytes play inline and autoplay like any hosted file.
//
// Conversion is cached per source string: portrait and landscape are separate clips, but
// a rotation or a scene rebuild must reuse the blob it already made rather than decode
// several megabytes again (and leak the old one).
const blobs = new Map<string, string>()

const DATA_RE = /^data:([^;,]*)(;base64)?,([\s\S]*)$/

/** The URL to hand a <video>: unchanged, unless it's a data: URL we can turn into a blob. */
export function videoSrc(src: string): string {
  if (!src || !src.startsWith('data:')) return src
  const hit = blobs.get(src)
  if (hit) return hit
  try {
    const m = DATA_RE.exec(src)
    if (!m) return src
    const [, type, b64, body] = m
    const bin = b64 ? atob(body) : decodeURIComponent(body)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const url = URL.createObjectURL(new Blob([bytes], { type: type || 'video/mp4' }))
    blobs.set(src, url)
    return url
  } catch {
    return src // no Blob/atob (jsdom), or a source we can't parse — let the element try
  }
}
