// Effets — contrat commun à TOUS les effets du catalogue : chacun a son fichier runtime (une
// transition : son animation, runtime/animations/<nom>.ts, et le pont commun mjs_fx_transition),
// ses variables CSS correspondent à ses réglages, son CSS reste dans son espace de noms et sait
// « réduire les animations », et, posé puis retiré dans un vrai composant, il ne laisse rien
// derrière lui (ni marque, ni variable, ni calque). Un effet ajouté au catalogue passe ici d'office.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { EFFECTS } from '../src/effects/catalog.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { fxToolsCalled } from '../src/bundler/fx-tools.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { assertAbsent } from './helpers/dom-assert.js'

const ICI     = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(ICI, '../src/runtime')
const NOMS    = Object.keys(EFFECTS)
// les effets qui se posent sur une balise (une transition réservée au cycle de vie n'a pas de définition à poser)
const POSES   = NOMS.filter((n) => !EFFECTS[n].life)
const transition = (nom: string) => !!EFFECTS[nom].transition
const fichier = (nom: string) => transition(nom) ? join(RUNTIME, 'mjs_fx_transition.ts') : join(RUNTIME, `mjs_fx_${nom.replace(/-/g, '_')}.ts`)

// µ minimal : le moteur des effets et la définition d'un effet, sans le reste du cœur ; l'outil du texte en plus pour un effet qui en nomme les aides
// (*stagger et *bounce bâtissent leur CSS au chargement, par µ._mjs_fxOrderCss)
const MOTEUR      = readFileSync(join(RUNTIME, 'mjs_fx.ts'), 'utf-8')
const OUTIL_TEXTE = readFileSync(join(RUNTIME, 'mjs_fx_tooltext.ts'), 'utf-8')
function definition(nom: string): any {
  const µ: any = {}
  const effet = readFileSync(fichier(nom), 'utf-8')
  new Function('µ', MOTEUR + '\n' + (fxToolsCalled(effet).has('fx_tooltext') ? OUTIL_TEXTE + '\n' : '') + effet)(µ)
  return µ._mjs_fxDefs[nom]
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('effets — contrat de chaque effet du catalogue', () => {
  it(`${NOMS.length} effets, chacun avec son fichier runtime qui le définit`, () => {
    assert.ok(NOMS.length >= 35)
    for (const nom of NOMS) {
      assert.ok(existsSync(fichier(nom)), `fichier manquant pour *${nom}`)
      // une transition réservée au cycle de vie (*crossfade) ne se pose jamais directement
      if (!EFFECTS[nom].life) assert.ok(definition(nom), `µ._mjs_fxDefs['${nom}'] absent de son fichier`)
      if (transition(nom) && nom !== 'crossfade') assert.ok(existsSync(join(RUNTIME, 'animations', nom + '.ts')), `*${nom} : animation manquante (runtime/animations/${nom}.ts)`)
    }
  })

  it('le réglage principal existe, une famille est donnée', () => {
    for (const nom of NOMS) {
      assert.ok(EFFECTS[nom].main in EFFECTS[nom].settings, `*${nom} : réglage principal « ${EFFECTS[nom].main} » inconnu`)
      assert.ok(EFFECTS[nom].family, `*${nom} : famille`)
    }
  })

  it('chaque variable CSS de l\'effet est un réglage, et l\'effet la lit (--mjs-<effet>-<réglage>, dans son CSS ou son JavaScript)', () => {
    for (const nom of POSES) {
      const def = definition(nom)
      for (const k of Object.keys(def.vars ?? {})) {
        assert.ok(k in EFFECTS[nom].settings, `*${nom} : variable « ${k} » sans réglage au catalogue`)
        assert.ok(readFileSync(fichier(nom), 'utf-8').includes(`--mjs-${nom}-${k}`), `*${nom} : --mjs-${nom}-${k} jamais lue`)
      }
    }
  })

  it('la valeur par défaut du catalogue est celle que le CSS de l\'effet prend (repli de sa variable)', () => {
    // durées en ms, sans espaces, zéro initial omis : `.5s` = `500ms`, `rgba(1, 2, 3, .5)` = `rgba(1,2,3,.5)`
    const net = (v: string) => v.replace(/\s+/g, '').replace(/(^|[,(])0\./g, '$1.').replace(/^(\d*\.?\d+)(ms|s)$/, (_m, n, u) => String(Number(n) * (u === 's' ? 1000 : 1)) + 'ms')
    let vus = 0
    for (const nom of POSES) {
      const def = definition(nom)
      for (const [k, unite] of Object.entries(def.vars ?? {}) as Array<[string, string]>) {
        const dflt = EFFECTS[nom].settings[k].dflt
        if (dflt === undefined) continue
        const replis = [...(def.css ?? '').matchAll(new RegExp(`var\\(--mjs-${nom}-${k},([^()]*(?:\\([^()]*\\))?[^()]*)\\)`, 'g'))].map(m => net(m[1]))
        if (replis.length === 0) continue
        for (const r of replis) assert.equal(r, net(String(dflt) + unite), `*${nom} : ${k} — catalogue ${dflt}, CSS ${r}`)
        vus++
      }
    }
    assert.ok(vus > 40, `trop peu de replis comparés : ${vus}`)
  })

  it('le CSS reste dans son espace de noms, et un effet qui bouge sait « réduire les animations »', () => {
    for (const nom of POSES) {
      const css = definition(nom).css ?? ''
      for (const m of css.matchAll(/@keyframes\s+([\w-]+)/g)) assert.ok(m[1].startsWith('mjs-fx-'), `*${nom} : @keyframes ${m[1]} hors de l'espace mjs-fx-`)
      if (/animation:|transition:/.test(css)) assert.match(css, /prefers-reduced-motion:reduce/, `*${nom} : rien pour « réduire les animations »`)
    }
  })
})

describe('effets — chacun posé puis retiré dans un composant : rien ne reste', function () {
  this.timeout(90000)
  let window: any
  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('pose : la marque mjs-fx ; retrait ({if} refermé) : ni marque, ni variable, ni calque', async () => {
    const root   = mjsTmp('effets-catalogue')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    // un effet de champ (*guard) se pose sur un champ ; un réglage à écrire (la clé de *shared) reçoit une valeur
    const pose   = (nom: string) => `*${nom}${EFFECTS[nom].need ? '(k1)' : ''}`
    const lignes = NOMS.filter((nom) => !EFFECTS[nom].life).map((nom) => EFFECTS[nom].field ? `<input class="e-${nom}" aria-label="${nom}" ${pose(nom)}>` : `<div class="e-${nom}" ${pose(nom)}>${nom === 'count' ? '1234' : 'Texte ' + nom}</div>`)
    // les effets en direct prennent leur connexion dans @sock : vide ici, ils l'attendent sans rien poser de plus
    writeFileSync(join(srcDir, 'fx-tous.mjs'), `<script>\n$on = true\n@sock = null\n</script>\n{if $on}\n${lignes.join('\n')}\n{end}\n<button class="t" @click={$on = !$on}>t</button>`)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis les animations, puis les composants
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.document.body.innerHTML = '<mjs-fx-tous></mjs-fx-tous>'
    const comp = window.document.querySelector('mjs-fx-tous')
    await attendre(() => !!comp._shadow?.querySelector('.e-float'))
    await new Promise((r) => setTimeout(r, 30))
    const poses: Record<string, any> = {}
    for (const nom of NOMS.filter((n) => !EFFECTS[n].life)) {
      const el = comp._shadow.querySelector(`.e-${nom}`)
      assert.ok(el, nom)
      assert.ok((el.getAttribute('mjs-fx') ?? '').split(' ').includes(nom), `*${nom} : marque mjs-fx absente`)
      poses[nom] = el
    }
    comp._shadow.querySelector('.t').click()
    await attendre(() => !comp._shadow.querySelector('.e-float'))
    await new Promise((r) => setTimeout(r, 50))
    for (const nom of Object.keys(poses)) {
      const el = poses[nom]
      const restes = el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx'))
      assert.deepEqual(restes, [], `*${nom} : attributs restés ${restes.join(', ')}`)
      assertAbsent(el.querySelector('[mjs-fx-layer]'), `*${nom} : calque resté`)
      const style = el.getAttribute('style') ?? ''
      assert.ok(!/--mjs-/.test(style), `*${nom} : variable restée (${style})`)
      assert.equal(el._mjs_fxOff ?? null, null, `*${nom} : retrait non inscrit`)
    }
  })
})
