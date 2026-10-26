// le HTML rendu par le serveur lit « false », quelle que soit sa casse, comme le navigateur après l'hydratation : `readonly="FALSE"` laisse
// la saisie du nombre modifiable, `required="FALSE"` (le nombre, la liste) ne pose pas `aria-required`, `disabled="FALSE"` laisse le nombre
// actif et son champ caché écrit — une page lue sans JavaScript, ou avant l'hydratation, dit la même chose que la page hydratée.
// Les mêmes attributs écrits vides restent vrais (témoins)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const OPT  = '<@@option value="">-</@@option><@@option value="a">A</@@option>'
const PAGE = `<form class="fs" method="get" action="/envoi">
  <@@number class="sn" name="sn" required="FALSE"></@@number>
  <@@number class="snf" name="snf" readonly="FALSE"></@@number>
  <@@number class="snm" name="snm" readonly="False" required="False"></@@number>
  <@@number class="snd" name="snd" value="4" disabled="FALSE"></@@number>
  <@@select class="ss" name="ss" required="FALSE">${OPT}</@@select>
  <@@number class="sok" name="sok" readonly required></@@number>
  <@@select class="sso" name="sso" required>${OPT}</@@select>
</form>
`

describe('rendu serveur : « false », toute casse, lu comme dans le navigateur', function () {
  this.timeout(120000)
  const parts: Record<string, string> = {}

  before(async () => {
    const root = mjsTmp('rendu-serveur-faux-casse')
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'hote-ssr.mjs'), PAGE)
    const renderer = await createSSRRenderer({ sourceDir: src, outputDir: join(root, 'out'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      const r = await renderer.renderToString('mjs-hote-ssr', { ssrMode: 'markers' } as any)
      // le HTML de chaque module, de sa balise à celle du module suivant
      for (const p of r.html.split(/(?=<mjs-core-(?:number|select)\b)/)) {
        const c = (p.match(/^<mjs-core-[a-z]+ [^>]*class="([^"]+)"/) || [])[1]
        if (c) parts[c] = p
      }
    }
    finally {
      await renderer.close()
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  const ariaRequis = (c: string) => (parts[c].match(/aria-required="true"/g) || []).length
  const saisieLue  = (c: string) => (parts[c].replace(/^<[^>]*>/, '').match(/<input[^>]*\breadonly\b[^>]*>/g) || []).length

  it('chaque module est rendu', () => {
    assert.deepEqual(Object.keys(parts).sort(), ['sn', 'snd', 'snf', 'snm', 'sok', 'ss', 'sso'])
  })

  it('readonly="FALSE" (toute casse) : la saisie du nombre reste modifiable ; readonly écrit vide la fige', () => {
    assert.deepEqual(['snf', 'snm', 'sok'].map(saisieLue), [0, 0, 1])
  })

  it('required="FALSE" (toute casse) : ni le nombre ni la liste ne disent aria-required ; required écrit vide le dit', () => {
    assert.deepEqual(['sn', 'snm', 'ss', 'sok', 'sso'].map(ariaRequis), [0, 0, 0, 1, 1])
  })

  it('disabled="FALSE" : le nombre reste actif et son champ caché part avec la page servie', () => {
    const corps = parts.snd.replace(/^<[^>]*>/, '')
    assert.equal(/<input[^>]*class="input"[^>]*\bdisabled\b/.test(corps), false, 'saisie active')
    assert.match(corps, /<input[^>]*type="hidden"[^>]*name="snd"|<input[^>]*name="snd"[^>]*type="hidden"/, 'champ caché écrit')
  })
})
