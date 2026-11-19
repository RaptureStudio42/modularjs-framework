// le registre des détenteurs, part des familles : la référence faible propre à l'objet de famille d'un `µ.state` ou d'un `µ.Store`
// (`_mjsClaimRef`, `µ._mjs_claims`, au cœur) n'est appelée que par mjs_state.ts et mjs_store.ts ; elle n'entre au cœur de production que si
// l'un d'eux est dans la construction. Avec un état ou un magasin, elle y est, et l'écriture faite par le composant qui tient un objet de
// l'état ou du magasin se lit aussi par l'état ou le magasin, comme l'inverse. Vrai Bundler, production, monté dans happy-dom

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const tic     = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const js      = (script: string[], gabarit: string) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', gabarit].join('\n')
const ombre   = (el: any) => el._shadow || el.shadowRoot || el
const GESTES  = ['$o = st.o;', '@ecrire = function() { $o.n++; };', '@poser = function(v) { st.o.n = v; };']
const GABARIT = '<b>{$o.n}</b><i>{st.o.n}</i>'
const SANS: Record<string, string>    = { 'ze-carte.mjs': js(['$o = { n: 0 };', '@ecrire = function() { $o.n++; };'], '<b>{$o.n}</b>') }
const ETAT: Record<string, string>    = { 'ze-etat.mjs': js(['const st = µ.state({ o: { n: 0 } });', ...GESTES], GABARIT) }
const MAGASIN: Record<string, string> = { 'ze-magasin.mjs': js(['const st = new µ.Store({ o: { n: 0 } }).data;', ...GESTES], GABARIT) }

// la définition de la référence faible des familles, et son entrée au cœur
const REF    = /function _mjsClaimRef\d*\(/
const ENTREE = /_mjs_claims = /

async function coeur(nom: string, sources: Record<string, string>): Promise<string> {
  const root   = mjsTmp('detenteurs-familles-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(sources)) writeFileSync(join(srcDir, f), s + '\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'prod', minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  return readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
}

describe('registre des détenteurs — la référence des familles part sans µ.state ni µ.Store', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('production, ni état ni magasin : la référence des familles n\'est pas au cœur', async () => {
    const code = await coeur('sans', SANS)
    assert.doesNotMatch(code, REF, 'la référence des familles est au cœur d\'une appli sans µ.state ni µ.Store')
    assert.doesNotMatch(code, ENTREE)
  })

  for (const [balise, sources] of [['ze-etat', ETAT], ['ze-magasin', MAGASIN]] as const) it(`production, ${balise} : la référence des familles est au cœur ; l'écriture du composant se lit par l'objet partagé, et l'inverse`, async () => {
    const code = await coeur(balise, sources)
    assert.match(code, REF, 'la référence des familles manque au cœur d\'une appli qui emploie ' + (balise === 'ze-etat' ? 'µ.state' : 'µ.Store'))
    assert.match(code, ENTREE)
    const win: any = new Window({ url: 'http://localhost/' })
    try {
      win.eval(`${code}\nglobalThis.µ = µ;`)
      win.document.body.innerHTML = `<mjs-${balise}></mjs-${balise}>`
      await tic()
      const el  = win.document.querySelector('mjs-' + balise)
      const vue = () => ['b', 'i'].map((t) => ombre(el).querySelector(t).textContent).join(',')
      assert.equal(vue(), '0,0')
      el.ecrire()
      await tic()
      assert.equal(vue(), '1,1', 'l\'écriture faite par la variable du composant se lit par l\'objet partagé')
      el.poser(5)
      await tic()
      assert.equal(vue(), '5,5', 'l\'écriture faite par l\'objet partagé se lit par la variable du composant')
    }
    finally {
      win.close()
    }
  })
})
