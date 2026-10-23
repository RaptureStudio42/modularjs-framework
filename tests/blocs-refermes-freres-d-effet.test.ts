// un bloc refermé retire TOUT son contenu, même quand un effet pose un frère à côté de sa balise
// (le reflet de *reflect, la boîte de -moz-element) : le nettoyage de l'effet retire ce frère
// pendant que le bloc détruit ses nœuds, et la marche de destruction ne doit pas s'arrêter sur lui
// en laissant derrière elle les balises qui suivent. Les trois lieux : {if} à la racine, {if} dans
// un {for}, {key} à la racine.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// `blur` : le reflet n'est jamais natif, il pose toujours une boîte frère juste après sa balise
const CORPS = '<div class="r" *reflect(blur: 2)>reflet</div><div class="m" *magnet>aimant</div><div class="z">fin</div>'

const COMPOSANTS: Record<string, string> = {
  'fx-bloc-si':    `<script>\n$on = true\n</script>\n{if $on}${CORPS}{end}\n<button class="t" @click={$on = !$on}>t</button>`,
  'fx-bloc-sinon': `<script>\n$on = true\n</script>\n{if $on}${CORPS}{else}<i class="e">autre</i>{end}\n<button class="t" @click={$on = !$on}>t</button>`,
  'fx-bloc-pour':  `<script>\n$on = true\n$l = [1, 2]\n</script>\n{for i in $l}<p class="row">{if $on}${CORPS}{end}</p>{end}\n<button class="t" @click={$on = !$on}>t</button>`,
  'fx-bloc-cle':   `<script>\n$on = true\n</script>\n{key $on}${CORPS}{end}\n<button class="t" @click={$on = !$on}>t</button>`,
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// les balises d'un parent, en texte : la boîte de l'effet (copie ou -moz-element) se lit « calque »
const balises = (parent: any) => Array.from(parent.children).map((c: any) => c.getAttribute('mjs-fx-layer') ? 'calque' : c.localName + '.' + (c.getAttribute('class') ?? '')).join(' ')

const COMPLET = 'div.r calque div.m div.z'

describe('blocs — un bloc refermé après un effet qui pose un frère', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('blocs-refermes-freres')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  // monte le composant, note quelle méthode de bloc travaille quand on clique
  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.z'))
    await pause()
    const appels: string[] = []
    for (const nom of ['_mjs_updIf', '_mjs_updItemIf', '_mjs_updKey']) {
      const origine = comp[nom]
      comp[nom] = function (...a: any[]) { appels.push(nom); return origine.apply(this, a) }
    }
    return { comp, appels }
  }

  const cliquer = async (comp: any) => {
    comp._shadow.querySelector('.t').click()
    await pause(80)
  }

  it('{if} à la racine : refermé, il ne reste que le bouton ; rouvert, le contenu revient une seule fois', async () => {
    const { comp, appels } = await monter('mjs-fx-bloc-si')
    assert.equal(balises(comp._shadow), COMPLET + ' button.t', 'au départ : la balise, sa boîte, ses deux frères')
    await cliquer(comp)
    assert.deepEqual(appels, ['_mjs_updIf'], 'le bloc racine est refait par _mjs_updIf')
    assert.equal(balises(comp._shadow), 'button.t', 'refermé : plus aucune balise du bloc')
    assert.equal(comp._shadow.querySelectorAll('[mjs-fx]').length, 0, 'plus aucun effet actif')
    await cliquer(comp)
    assert.equal(balises(comp._shadow), COMPLET + ' button.t', 'rouvert : une seule fois')
  })

  it('{if}{else} : la branche sinon arrive seule, sans reste de la branche alors', async () => {
    const { comp } = await monter('mjs-fx-bloc-sinon')
    await cliquer(comp)
    assert.equal(balises(comp._shadow), 'i.e button.t', 'la branche sinon, rien de la branche alors')
    await cliquer(comp)
    assert.equal(balises(comp._shadow), COMPLET + ' button.t', 'la branche alors revient, sans reste de la branche sinon')
  })

  it('{if} dans un {for} : chaque ligne se vide, rouvert chaque ligne se remplit une fois', async () => {
    const { comp, appels } = await monter('mjs-fx-bloc-pour')
    const lignes = () => Array.from(comp._shadow.querySelectorAll('.row')).map((p: any) => '[' + balises(p) + ']').join(' ')
    assert.equal(lignes(), '[' + COMPLET + '] [' + COMPLET + ']', 'au départ : deux lignes pleines')
    await cliquer(comp)
    assert.ok(appels.includes('_mjs_updItemIf'), 'le bloc d\'une ligne est refait par _mjs_updItemIf')
    assert.equal(lignes(), '[] []', 'refermé : deux lignes vides')
    assert.equal(comp._shadow.querySelectorAll('[mjs-fx]').length, 0, 'plus aucun effet actif')
    await cliquer(comp)
    assert.equal(lignes(), '[' + COMPLET + '] [' + COMPLET + ']', 'rouvert : deux lignes pleines, une fois')
  })

  it('{key} à la racine : la clé change, l\'ancien contenu part en entier et le neuf arrive seul', async () => {
    const { comp, appels } = await monter('mjs-fx-bloc-cle')
    await cliquer(comp)
    assert.deepEqual(appels, ['_mjs_updKey'], 'le bloc racine est refait par _mjs_updKey')
    assert.equal(balises(comp._shadow), COMPLET + ' button.t', 'le contenu neuf seul, aucun reste de l\'ancien')
    assert.equal(comp._shadow.querySelectorAll('[mjs-fx]').length, 2, 'les deux effets du contenu neuf, pas ceux de l\'ancien')
  })
})
