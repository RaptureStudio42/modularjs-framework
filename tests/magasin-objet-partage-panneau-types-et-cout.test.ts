// Un même objet rangé sous deux clés du magasin (`$$cfg = $$autre`) : les deux dernières voies qui le modifiaient
// en profondeur sans prévenir l'autre clé la préviennent aussi — l'écriture faite dans le panneau de développement
// (vue des stores, champ d'un objet déplié) et la conversion d'une valeur déjà présente quand la règle de son type
// arrive (`<vars>` d'un composant chargé plus tard). Avant, seule la clé écrite était prévenue : ce qui affichait
// l'autre restait sur l'ancienne valeur.
// Coût : prévenir les clés qui rangent le même objet ne parcourt plus tout le magasin à chaque écriture profonde
// (un magasin de 2 000 clés écrivait 100 fois plus lentement qu'un magasin de 10) ; un objet posé sans prévenir
// (`µwrite`) sous deux clés reste suivi.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'mpp-ecrivain': [
    '<script>',
    "$$autre = { quantite: Number('500'), nom: 'autre' }",
    'partager = -> $$cfg = $$autre',
    '</script>',
    '<button class="p" @click={partager()}>p</button>',
  ].join('\n'),
  'mpp-autre': '<p class="a">{$$autre ? $$autre.quantite : \'-\'}</p>',
  'mpp-cfg': '<p class="c">{$$cfg ? $$cfg.quantite : \'-\'}</p>',
  'mpp-type': [
    '<vars>',
    '$$autre { quantite: int 1..99 }',
    '</vars>',
    '<p>t</p>',
  ].join('\n'),
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('magasin — objet partagé par deux clés : panneau, types, coût', function () {
  this.timeout(60000)
  const modules: Record<string, string> = {}
  let core = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('magasin-partage-pt')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), source + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    core = lire(files.find((f) => /^mjs_core-/.test(f))!)
    for (const nom of Object.keys(COMPOSANTS)) modules[nom] = lire(files.find((f) => new RegExp(`^${nom}-[0-9a-z]{5}\\.js$`).test(f))!)
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  // fenêtre neuve (un seul magasin), cœur et modules chargés dans l'ordre donné
  function fenetre(noms: string[]) {
    const w: any = new Window({ url: 'http://localhost/' })
    fenetres.push(w)
    w.eval(`${core}\nglobalThis.µ = µ;`)
    for (const nom of noms) w.eval(modules[nom])
    return w
  }

  async function monter(w: any, nom: string) {
    w.document.body.insertAdjacentHTML('beforeend', `<mjs-${nom}></mjs-${nom}>`)
    const el = w.document.body.querySelector(`mjs-${nom}`)
    await attendre(() => !!el._shadow)
    return el
  }

  const texte = (el: any, sel: string) => el._shadow.querySelector(sel)?.textContent

  it('panneau de développement : un champ modifié dans l\'objet d\'une clé redessine les lecteurs de l\'autre', async () => {
    const w = fenetre(['mpp-ecrivain', 'mpp-autre', 'mpp-cfg'])
    const ecrivain = await monter(w, 'mpp-ecrivain')
    const autre = await monter(w, 'mpp-autre')
    const cfg = await monter(w, 'mpp-cfg')
    ecrivain._shadow.querySelector('.p').click()
    await attendre(() => texte(cfg, '.c') === '500')
    assert.equal(texte(autre, '.a'), '500')
    w.µ.console(true)
    const racine = w.document.querySelector('[data-mjs-devpanel]').shadowRoot
    const clic = (el: any) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    clic(Array.from(racine.querySelectorAll('.ligne') as ArrayLike<any>).find((b: any) => /stores/.test(b.textContent)))
    const chevron = Array.from(racine.querySelectorAll('.di-ligne') as ArrayLike<any>).find((l: any) => /^\W*cfg/.test(l.textContent))?.querySelector('.di-chevron')
    assert.ok(chevron, 'la clé cfg doit se déplier')
    clic(chevron)
    const champ = racine.querySelector('input.di-valeur[data-di-key="quantite"]')
    assert.ok(champ, 'la quantité de cfg doit être modifiable')
    champ.value = '7'
    champ.dispatchEvent(new w.Event('change', { bubbles: true }))
    assert.equal(w.µ.store.autre.quantite, 7, 'un seul objet sous les deux clés')
    await attendre(() => texte(autre, '.a') === '7')
    assert.equal(texte(cfg, '.c'), '7')
    assert.equal(texte(autre, '.a'), '7', 'le lecteur de $$autre suit l\'écriture faite par cfg')
    w.µ.console(false)
  })

  it('types : la valeur déjà présente, ramenée quand la règle arrive, redessine aussi les lecteurs de l\'autre clé', async () => {
    const w = fenetre(['mpp-ecrivain', 'mpp-autre', 'mpp-cfg'])
    const ecrivain = await monter(w, 'mpp-ecrivain')
    const cfg = await monter(w, 'mpp-cfg')
    ecrivain._shadow.querySelector('.p').click()
    await attendre(() => texte(cfg, '.c') === '500')
    assert.equal(texte(cfg, '.c'), '500')
    // la règle de $$autre arrive avec un composant chargé plus tard
    w.eval(modules['mpp-type'])
    await monter(w, 'mpp-type')
    assert.equal(w.µ.store.autre.quantite, 99, 'ramenée sur place par la règle')
    await attendre(() => texte(cfg, '.c') === '99')
    assert.equal(texte(cfg, '.c'), '99', 'le lecteur de $$cfg (même objet) suit')
  })

  it('un objet posé sans prévenir (`µwrite`) sous deux clés : écrit par l\'une, les lecteurs de l\'autre sont prévenus', async () => {
    const w = fenetre(['mpp-autre'])
    const autre = await monter(w, 'mpp-autre')
    const o = { quantite: 1 }
    w.µ._mjs_storeRaw.autre = o
    w.µ._mjs_storeRaw.cfg = o
    w.µ._mjs_storeDeepSet('cfg', ['quantite'], 3)
    await attendre(() => texte(autre, '.a') === '3')
    assert.equal(texte(autre, '.a'), '3')
  })

  it('coût : une écriture profonde ne dépend pas du nombre de clés du magasin', async () => {
    const mesurer = (n: number) => {
      const w = fenetre([])
      for (let i = 0; i < n; i++) w.µ._storeSet('k' + i, { n: 0 })
      let mieux = Infinity
      for (let essai = 0; essai < 3; essai++) {
        const t = process.hrtime.bigint()
        for (let i = 0; i < 10000; i++) w.µ._mjs_storeDeepSet('k0', ['n'], essai * 10000 + i + 1)
        mieux = Math.min(mieux, Number(process.hrtime.bigint() - t) / 1e6)
      }
      return mieux
    }
    const petit = mesurer(10)
    const grand = mesurer(2000)
    assert.ok(grand < petit * 8 + 5, `10 000 écritures : ${petit.toFixed(1)} ms avec 10 clés, ${grand.toFixed(1)} ms avec 2 000 clés`)
  })
})
