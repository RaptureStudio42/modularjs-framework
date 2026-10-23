// une liste `{for}` retire TOUTES ses lignes quand elle devient nulle, vide ou perd une ligne, même quand
// un effet pose un frère à côté de la balise de la ligne (la copie de *reflect(blur: 2)) : le nettoyage
// de l'effet retire ce frère pendant que la liste détruit ses nœuds, et la marche de destruction ne doit
// pas s'arrêter sur lui en laissant les lignes suivantes affichées, effets actifs. Les marches de
// `_mjs_reconcileList` : collection nulle (le défaut), retrait d'une ligne, vidage `[]`, réordonnancement,
// liste imbriquée (sous-liste nulle, ligne extérieure retirée).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// `blur` : le reflet n'est jamais natif, il pose toujours une copie frère juste après sa balise
const EFFET   = '*reflect(blur: 2)'
const BOUTON  = '<button class="t" @click={$l = null}>t</button>'
const ID3     = '[{id: 1}, {id: 2}, {id: 3}]'
const GROUPES = '[{id: 1, kids: [1, 2]}, {id: 2, kids: [3, 4]}]'

const COMPOSANTS: Record<string, string> = {
  'fx-liste-nulle':     `<script>\n$l = [1, 2, 3]\n</script>\n{for r in $l}<p class="row" ${EFFET}>{r}</p>{end}\n${BOUTON}`,
  'fx-liste-cle':       `<script>\n$l = ${ID3}\n</script>\n{for r in $l by id}<p class="row" ${EFFET}>{r.id}</p>{end}\n${BOUTON}`,
  'fx-liste-imbriquee': `<script>\n$l = ${GROUPES}\n</script>\n{for g in $l by id}<section class="g">{for k in g.kids}<p class="row" ${EFFET}>{k}</p>{end}</section>{end}\n${BOUTON}`,
  'fx-liste-multi':     `<script>\n$l = ${ID3}\n</script>\n{for r in $l by id}<p class="row" ${EFFET}>{r.id}</p><i class="suite">fin</i>{end}\n${BOUTON}`,
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

// les balises d'un parent, en texte : la copie de l'effet se lit « calque »
const balises = (parent: any) => Array.from(parent.children).map((c: any) => c.getAttribute('mjs-fx-layer') ? 'calque' : c.localName + '.' + (c.getAttribute('class') ?? '')).join(' ')

const LIGNE  = 'p.row calque'
const PLEIN2 = [LIGNE, LIGNE].join(' ')
const PLEIN3 = [LIGNE, LIGNE, LIGNE].join(' ')
const MULTI  = 'p.row calque i.suite'

describe('{for} — une liste qui perd ses lignes après un effet qui pose un frère', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('for-liste-nulle-freres')
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

  // monte le composant, note si la liste travaille sur une collection pleine ou nulle
  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector('.t'))
    await pause(60)
    const appels: string[] = []
    const origine          = comp._mjs_reconcileList
    comp._mjs_reconcileList = function (...a: any[]) { appels.push(a[4] ? 'pleine' : 'nulle'); return origine.apply(this, a) }
    return { comp, appels }
  }

  const cliquer = async (comp: any) => {
    comp._shadow.querySelector('.t').click()
    await pause(100)
  }

  const poser = async (comp: any, valeur: any) => {
    comp._set('l', valeur)
    await pause(100)
  }

  const actifs = (comp: any) => comp._shadow.querySelectorAll('[mjs-fx]').length
  const textes = (comp: any) => Array.from(comp._shadow.querySelectorAll('.row')).map((p: any) => p.textContent).join(',')

  it('collection nulle, sans clé : les trois lignes et leurs copies partent ; rouverte, chacune revient une fois', async () => {
    const { comp, appels } = await monter('mjs-fx-liste-nulle')
    assert.equal(balises(comp._shadow), PLEIN3 + ' button.t', 'au départ : trois lignes, chacune suivie de sa copie')
    await cliquer(comp)
    assert.ok(appels.includes('nulle'), 'la liste est refaite par la branche collection nulle')
    assert.equal(balises(comp._shadow), 'button.t', 'liste nulle : plus aucune ligne, plus aucune copie')
    assert.equal(actifs(comp), 0, 'plus aucun effet actif')
    await poser(comp, [1, 2, 3])
    assert.equal(balises(comp._shadow), PLEIN3 + ' button.t', 'rouverte : trois lignes, une seule copie chacune')
    assert.equal(textes(comp), '1,2,3', 'les trois valeurs, dans l\'ordre')
  })

  it('collection nulle, avec clé : les trois lignes et leurs copies partent ; rouverte, chacune revient une fois', async () => {
    const { comp, appels } = await monter('mjs-fx-liste-cle')
    assert.equal(balises(comp._shadow), PLEIN3 + ' button.t', 'au départ : trois lignes, chacune suivie de sa copie')
    await cliquer(comp)
    assert.ok(appels.includes('nulle'), 'la liste est refaite par la branche collection nulle')
    assert.equal(balises(comp._shadow), 'button.t', 'liste nulle : plus aucune ligne, plus aucune copie')
    assert.equal(actifs(comp), 0, 'plus aucun effet actif')
    await poser(comp, [{ id: 1 }, { id: 2 }, { id: 3 }])
    assert.equal(balises(comp._shadow), PLEIN3 + ' button.t', 'rouverte : trois lignes, une seule copie chacune')
    assert.equal(textes(comp), '1,2,3', 'les trois valeurs, dans l\'ordre')
  })

  it('{for} imbriqué : la sous-liste devient nulle, chaque section perd ses lignes et leurs copies ; rouverte, une fois', async () => {
    const { comp, appels } = await monter('mjs-fx-liste-imbriquee')
    const sections = () => Array.from(comp._shadow.querySelectorAll('.g')).map((s: any) => '[' + balises(s) + ']').join(' ')
    assert.equal(sections(), '[' + PLEIN2 + '] [' + PLEIN2 + ']', 'au départ : deux sections de deux lignes')
    await poser(comp, [{ id: 1, kids: null }, { id: 2, kids: null }])
    assert.ok(appels.includes('nulle'), 'une sous-liste est refaite par la branche collection nulle')
    assert.equal(sections(), '[] []', 'sous-listes nulles : les deux sections sont vides')
    assert.equal(actifs(comp), 0, 'plus aucun effet actif')
    await poser(comp, [{ id: 1, kids: [1, 2] }, { id: 2, kids: [3, 4] }])
    assert.equal(sections(), '[' + PLEIN2 + '] [' + PLEIN2 + ']', 'rouvertes : deux lignes par section, une seule copie chacune')
    assert.equal(textes(comp), '1,2,3,4', 'les quatre valeurs, dans l\'ordre')
  })

  it('retrait d\'une ligne : la ligne du milieu part avec sa copie, les deux autres restent entières', async () => {
    const { comp } = await monter('mjs-fx-liste-cle')
    await poser(comp, [{ id: 1 }, { id: 3 }])
    assert.equal(balises(comp._shadow), PLEIN2 + ' button.t', 'deux lignes, chacune suivie de sa copie')
    assert.equal(textes(comp), '1,3', 'les lignes 1 et 3')
    assert.equal(actifs(comp), 2, 'un effet par ligne restante')
  })

  it('retrait de la première ligne puis de la dernière : aucune copie orpheline', async () => {
    const { comp } = await monter('mjs-fx-liste-cle')
    await poser(comp, [{ id: 2 }, { id: 3 }])
    assert.equal(balises(comp._shadow), PLEIN2 + ' button.t', 'la première ligne est partie avec sa copie')
    await poser(comp, [{ id: 2 }])
    assert.equal(balises(comp._shadow), LIGNE + ' button.t', 'la dernière ligne est partie avec sa copie')
    assert.equal(textes(comp), '2', 'la ligne 2 seule')
  })

  it('vidage par un tableau vide : toutes les lignes et leurs copies partent ; rempli, chacune revient une fois', async () => {
    const { comp, appels } = await monter('mjs-fx-liste-nulle')
    await poser(comp, [])
    assert.ok(appels.includes('pleine'), 'un tableau vide est une collection pleine pour la liste : c\'est la marche des clés disparues')
    assert.equal(balises(comp._shadow), 'button.t', 'tableau vide : plus aucune ligne, plus aucune copie')
    assert.equal(actifs(comp), 0, 'plus aucun effet actif')
    await poser(comp, [1, 2, 3])
    assert.equal(balises(comp._shadow), PLEIN3 + ' button.t', 'rempli : trois lignes, une seule copie chacune')
  })

  it('réordonnancement : aucune ligne ni copie perdue ou en double, un effet par ligne', async () => {
    const { comp } = await monter('mjs-fx-liste-cle')
    await poser(comp, [{ id: 3 }, { id: 2 }, { id: 1 }])
    assert.equal(textes(comp), '3,2,1', 'lignes inversées')
    assert.equal(comp._shadow.querySelectorAll('[mjs-fx-layer]').length, 3, 'trois copies, ni perdue ni en double')
    assert.equal(actifs(comp), 3, 'un effet par ligne')
  })

  it('lignes à deux balises de tête : une ligne retirée emporte ses deux balises et sa copie ; liste nulle, tout part', async () => {
    const { comp, appels } = await monter('mjs-fx-liste-multi')
    assert.equal(balises(comp._shadow), [MULTI, MULTI, MULTI].join(' ') + ' button.t', 'au départ : trois lignes de deux balises, la copie entre les deux')
    await poser(comp, [{ id: 1 }, { id: 3 }])
    assert.equal(balises(comp._shadow), [MULTI, MULTI].join(' ') + ' button.t', 'la ligne du milieu est partie en entier')
    assert.equal(textes(comp), '1,3', 'les lignes 1 et 3')
    await cliquer(comp)
    assert.ok(appels.includes('nulle'), 'la liste est refaite par la branche collection nulle')
    assert.equal(balises(comp._shadow), 'button.t', 'liste nulle : plus aucune balise de ligne')
    assert.equal(actifs(comp), 0, 'plus aucun effet actif')
  })

  it('{for} imbriqué : la ligne extérieure retirée emporte ses lignes et leurs copies', async () => {
    const { comp } = await monter('mjs-fx-liste-imbriquee')
    await poser(comp, [{ id: 2, kids: [3, 4] }])
    const sections = Array.from(comp._shadow.querySelectorAll('.g')).map((s: any) => '[' + balises(s) + ']').join(' ')
    assert.equal(sections, '[' + PLEIN2 + ']', 'une seule section, ses deux lignes et leurs copies')
    assert.equal(balises(comp._shadow), 'section.g button.t', 'aucune balise restée hors de la section')
    assert.equal(actifs(comp), 2, 'les deux effets de la section restante')
  })
})
