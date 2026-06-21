// Fetch a remote URL and return a base64 data URL, bypassing browser CORS:
//   1) Electron main process (window.editorAPI.fetchDataUrl) — no CORS at all
//   2) the dev/preview server proxy (/api/proxy) — fetched server-side
//   3) a direct fetch (works only if the host sends CORS headers)
// Used by the Figma importer and the exporter so remote assets get inlined.

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

interface NativeFetch {
  fetchDataUrl?: (url: string) => Promise<{ ok: boolean; dataUrl?: string }>
}

export async function remoteToDataUrl(url: string): Promise<string | null> {
  if (url.startsWith('data:')) return url

  const api = (window as unknown as { editorAPI?: NativeFetch }).editorAPI
  if (api?.fetchDataUrl) {
    try {
      const r = await api.fetchDataUrl(url)
      if (r?.ok && r.dataUrl) return r.dataUrl
    } catch {
      /* fall through */
    }
  }

  try {
    const res = await fetch('/api/proxy?url=' + encodeURIComponent(url))
    if (res.ok) return await blobToDataUrl(await res.blob())
  } catch {
    /* fall through */
  }

  try {
    const res = await fetch(url)
    if (res.ok) return await blobToDataUrl(await res.blob())
  } catch {
    /* give up */
  }
  return null
}
