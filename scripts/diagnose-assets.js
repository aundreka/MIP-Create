// Paste into the DevTools console on the affected editor (localhost or the site).
// Read-only: it checks indexedDB.databases() first and only opens `pa-assets` if
// it already exists (a bare indexedDB.open CREATES the database), and it opens at
// the existing version so it can never trigger an upgrade.
(async () => {
  let exists = null
  try {
    exists = (await indexedDB.databases()).some((d) => d.name === 'pa-assets')
  } catch {
    /* older browser: databases() unsupported, fall through to opening */
  }
  if (exists === false) {
    console.log('IndexedDB "pa-assets" does not exist yet (no assets have been saved on this origin).')
  }

  const open = () =>
    new Promise((res) => {
      let r
      try {
        r = indexedDB.open('pa-assets')
      } catch {
        return res(null)
      }
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(null)
      r.onblocked = () => res(null)
      setTimeout(() => res(null), 3000)
    })

  const db = exists === false ? null : await open()
  if (db) console.log('IndexedDB "pa-assets" opens: true (version ' + db.version + ')')
  const hasStore = !!db && db.objectStoreNames.contains('assets')
  if (db && !hasStore) console.error('BROKEN: the database exists but has NO "assets" object store — every read/write silently fails.')

  const keys = hasStore
    ? await new Promise((res) => {
        const q = db.transaction('assets', 'readonly').objectStore('assets').getAllKeys()
        q.onsuccess = () => res(q.result.map(String))
        q.onerror = () => res([])
      })
    : []
  console.log('asset blobs stored in IndexedDB:', keys.length)
  try {
    console.log('storage estimate:', JSON.stringify(await navigator.storage.estimate()))
  } catch {}

  const index = JSON.parse(localStorage.getItem('pa:projects') || '[]')
  let lsBytes = 0
  for (const k in localStorage) if (Object.hasOwn(localStorage, k)) lsBytes += (localStorage[k] || '').length
  console.log('localStorage used: ~' + (lsBytes / 1048576).toFixed(2) + ' MB, projects:', index.length)

  const keySet = new Set(keys)
  console.table(
    index.map((r) => {
      const d = JSON.parse(localStorage.getItem('pa:proj:' + r.id) || 'null')
      const assets = d ? Object.entries(d.assets || {}) : []
      return {
        name: r.name,
        id: r.id,
        assets: assets.length,
        inline: assets.filter(([, a]) => a.src).length,
        inIdb: assets.filter(([aid]) => keySet.has(r.id + '/' + aid)).length,
        LOST: assets.filter(([aid, a]) => !a.src && !keySet.has(r.id + '/' + aid)).length,
      }
    }),
  )
})()
