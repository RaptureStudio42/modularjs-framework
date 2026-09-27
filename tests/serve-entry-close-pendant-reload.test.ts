// `createServeEntry` (chargeur `.server.mjs` de `mjs serve`/`mjs dev`) : `close()` ne faisait que
// fermer le watcher fs et le debounceTimer — un rechargement (`load()`) DÉJÀ EN VOL (import lent)
// continuait en tâche de fond et réassignait `props`/`actions`/`active` APRÈS que l'appelant ait
// considéré l'entry fermée (ex. `render-server.ts`'s `close()`, appelé pendant l'arrêt du
// serveur HTTP). MÊME famille de correctif que cli/ws.ts/cli/server.ts : un drapeau
// `closed` empêche toute reprise ET toute écriture d'état après `close()`.

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createServeEntry } from '../src/server/serve-entry.js'

const tick = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function fakeReq(): any { return { headers: {} } }

describe('server/serve-entry — close() pendant un rechargement EN VOL', function () {
  this.timeout(15000)

  it("close() pendant l'import (lent) d'une v2 : les props restent celles de la v1, la v2 n'écrase JAMAIS l'état après coup", async () => {
    const configDir = mjsTmp('serve-entry-close')
    const entryPath = join(configDir, 'serve.server.mjs')
    writeFileSync(entryPath, `export default {\n  props: {\n    '/': (params, req) -> { version: 'v1' }\n  }\n}\n`)

    const entry = await createServeEntry({} as any, configDir)
    assert.deepEqual(await entry.propsFor('/', fakeReq()), { version: 'v1' })

    // v2 : import délibérément LENT — laisse une fenêtre où load() est encore en vol (import pas
    // fini) au moment où l'on ferme.
    writeFileSync(entryPath, `await new Promise((r) -> setTimeout(r, 300))\n\nexport default {\n  props: {\n    '/': (params, req) -> { version: 'v2' }\n  }\n}\n`)
    await tick(220)   // 150ms debounce (RELOAD_DEBOUNCE_MS) + marge : le rechargement doit être en vol

    entry.close()
    // Laisse le temps à un rechargement en vol (SANS le fix) de finir malgré close() : import
    // restant (~80ms) + le reste de load() — marge large.
    await tick(500)

    // BUG confirmé si version vaut 'v2' : le rechargement en vol a écrasé l'état APRÈS close().
    const props = await entry.propsFor('/', fakeReq())
    assert.deepEqual(props, { version: 'v1' }, `BUG confirmé si un rechargement en vol a écrasé l'état après close() — obtenu : ${JSON.stringify(props)}`)
  })

  it("non-régression : SANS rechargement en vol, close() reste synchrone et suffisant (comportement historique)", async () => {
    const configDir = mjsTmp('serve-entry-close-simple')
    writeFileSync(join(configDir, 'serve.server.mjs'), `export default {\n  props: {\n    '/': (params, req) -> { ok: true }\n  }\n}\n`)
    const entry = await createServeEntry({} as any, configDir)
    assert.deepEqual(await entry.propsFor('/', fakeReq()), { ok: true })
    assert.doesNotThrow(() => entry.close())
  })
})
