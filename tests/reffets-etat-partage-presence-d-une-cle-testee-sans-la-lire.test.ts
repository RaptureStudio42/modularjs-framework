// un reffet qui teste la présence d'une clé d'un état partagé sans la lire (`Object.hasOwn(etat, k)`, `etat.hasOwnProperty(k)`, `k in etat`
// dans une fonction importée) a lu cet état : quand la clé est posée ou retirée, il passe, comme le reffet qui la lit. Le composant est
// abonné par son gabarit ; le reffet témoin, qui ne lit qu'une variable `$`, ne passe pas.
import { describe, it, after } from 'mocha'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const ETATS = `export session = µ.state({ a: 0 })
export panier = new µStore({ a: 0 })
export aCle = (k) -> k in session
export aCleMagasin = (k) -> k in panier.data
`

const LECTEUR = `<script>
  @import { session panier aCle aCleMagasin } 'rp-etats.civet.mjs'
  vu = (k) -> window.__n[k] = (window.__n[k] or 0) + 1
  $x = 0
  @poser = -> session.neuve = 1
  @retirer = -> delete session.neuve
  @poserMagasin = -> panier.data.neuve = 1
  µeffect ->
    vu('propre')
    window.__v.propre = [$x, Object.hasOwn(session, 'neuve')].join()
  µeffect ->
    vu('methode')
    window.__v.methode = [$x, session.hasOwnProperty('neuve')].join()
  µeffect ->
    vu('importee')
    window.__v.importee = [$x, aCle('neuve')].join()
  µeffect ->
    vu('magasin')
    window.__v.magasin = [$x, aCleMagasin('neuve')].join()
  µeffect ->
    vu('temoin')
    window.__v.temoin = $x
</script>
<p>{session.neuve} {panier.data.neuve}</p>
`

async function jouer(nom: string, opts: Record<string, unknown>): Promise<{ pas: Record<string, { passages: Record<string, number>, valeurs: Record<string, unknown> }> }> {
  const root   = mjsTmp('reffets-presence-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'rp-etats.civet.mjs'), ETATS)
  writeFileSync(join(srcDir, 'rp-lecteur.mjs'), LECTEUR)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'bundle', minify: false, ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const code   = readFileSync(join(outDir, 'bundle.js'), 'utf-8')
  const window: any = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any)
  try {
    window.__n = {}
    window.__v = {}
    window.eval(code.replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''))
    window.document.body.innerHTML = '<mjs-rp-lecteur></mjs-rp-lecteur>'
    const fin = Date.now() + 5000
    while (Object.keys(window.__n).length < 5 && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
    await new Promise((r) => setTimeout(r, 60))
    const pas: Record<string, { passages: Record<string, number>, valeurs: Record<string, unknown> }> = {}
    for (const geste of ['poser', 'retirer', 'poserMagasin']) {
      const avant = { ...window.__n }
      window.document.querySelector('mjs-rp-lecteur')[geste]()
      await new Promise((r) => setTimeout(r, 60))
      const passages: Record<string, number> = {}
      for (const k of Object.keys(window.__n)) if (window.__n[k] !== avant[k]) passages[k] = window.__n[k] - avant[k]
      pas[geste] = { passages, valeurs: { ...window.__v } }
    }
    return JSON.parse(JSON.stringify({ pas }))
  }
  finally {
    await window.happyDOM.close()
  }
}

describe('reffets devant un état partagé : la présence d\'une clé testée sans la lire', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, opts] of [['production', { env: 'prod' }], ['développement', { env: 'dev' }]] as [string, Record<string, unknown>][]) {
    it(`${nom} : la clé posée puis retirée fait passer les reffets qui ont testé sa présence, pas le témoin`, async () => {
      const jeu = await jouer(nom === 'production' ? 'prod' : 'dev', opts)
      assert.equal(jeu.pas.poser.valeurs.propre, '0,true')
      assert.equal(jeu.pas.poser.valeurs.methode, '0,true')
      assert.equal(jeu.pas.poser.valeurs.importee, '0,true')
      assert.equal(jeu.pas.poser.passages.temoin, undefined)
      assert.equal(jeu.pas.retirer.valeurs.propre, '0,false')
      assert.equal(jeu.pas.retirer.valeurs.methode, '0,false')
      assert.equal(jeu.pas.retirer.valeurs.importee, '0,false')
      assert.equal(jeu.pas.retirer.passages.temoin, undefined)
      assert.equal(jeu.pas.poserMagasin.valeurs.magasin, '0,true')
      assert.equal(jeu.pas.poserMagasin.passages.temoin, undefined)
    })
  }
})
