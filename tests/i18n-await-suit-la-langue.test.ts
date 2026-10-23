// Un texte traduit (`µt`) posé dans une branche d'un `{await}` (attente, `{success}`, `{error}`) suit la langue
// comme partout ailleurs dans le gabarit : une bascule `µlang = 'en'` après l'arrivée de la promesse le change,
// sans relancer la promesse ni reconstruire la branche (un champ de saisie y garde son nœud, sa valeur et son
// focus), et la valeur de succès reste lisible. Cause d'origine : le texte d'une branche était calculé une seule fois, à la
// construction (`${expr}`), et le rendu complet qu'une bascule de langue provoque ne le rejouait pas.
// Harnais : vrai Bundler, fichiers de langue et fragments servis depuis la sortie réelle du build (même patron
// que tests/i18n-e2e.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm, fileToId, ssrScopeFile, topoSortFiles } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

function dictionnaires(srcDir: string): void {
  const dir = join(srcDir, 'i18n')
  mkdirSync(join(dir, 'fr'), { recursive: true })
  mkdirSync(join(dir, 'en'), { recursive: true })
  writeFileSync(join(dir, 'fr.yml'), 'titre: Bienvenue\n')
  writeFileSync(join(dir, 'en.json'), JSON.stringify({ titre: 'Welcome' }))
  writeFileSync(join(dir, 'fr/panier.yml'), ['resume: Résumé du panier', 'items:', '  one: "%{n} article"', '  other: "%{n} articles"'].join('\n'))
  writeFileSync(join(dir, 'en/panier.json'), JSON.stringify({ resume: 'Cart summary', items: { one: '%{n} item', other: '%{n} items' } }))
}

const PROMESSE = ['<script>', '$p = window.__p', '</script>']

// `{await}` complet : un témoin hors du bloc, les trois branches, un champ de saisie dans `{success}`
const COMPLET = [
  "@i18n 'panier'",
  ...PROMESSE,
  '<p class="hors">{µt(\'resume\')}</p>',
  '{await $p}',
  '<p class="att">{µt(\'resume\')}</p>',
  '{success n}',
  '<p class="ok">{µt(\'items\', {n: n})}</p>',
  '<input class="saisie" aria-label="saisie">',
  '{error err}',
  '<p class="ko">{µt(\'resume\')}/{err.message}</p>',
  '{end}',
].join('\n')

// le même bloc sous un `{if}` de racine
const SOUS_IF = [
  "@i18n 'panier'",
  '<script>',
  '$p = window.__p',
  '$montre = true',
  '</script>',
  '{if $montre}',
  '{await $p}',
  '<p class="att">{µt(\'resume\')}</p>',
  '{success n}',
  '<p class="ok">{µt(\'items\', {n: n})}</p>',
  '<input class="saisie" aria-label="saisie">',
  '{end}',
  '{end}',
].join('\n')

// une valeur du dehors ($q) lue dans la branche : elle suit sa variable, comme la langue
const AVEC_VAR = [
  "@i18n 'panier'",
  '<script>',
  '$p = window.__p',
  '$q = 1',
  '</script>',
  '{await $p}',
  '<p class="att">attente</p>',
  '{success n}',
  '<p class="ok">{µt(\'items\', {n: n})}</p>',
  '<p class="q">{$q}</p>',
  '{end}',
].join('\n')

// texte brut `{{…}}` et lignes d'un `{for}` de la branche
const BRUT_ET_LIGNES = [
  "@i18n 'panier'",
  ...PROMESSE,
  '{await $p}',
  '<i>att</i>',
  '{success n}',
  '<p class="h">{{µt(\'resume\')}}</p>',
  '<ul>{for x in n}<li>{µt(\'items\', {n: x})}</li>{end}</ul>',
  '{end}',
].join('\n')

async function monter(sources: Record<string, string>) {
  const root   = mjsTmp('i18n-await-suit-la-langue')
  const srcDir = join(root, 'app')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  dictionnaires(srcDir)
  for (const [nom, source] of Object.entries(sources)) writeFileSync(join(srcDir, `${nom}.mjs`), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), i18n: { default: 'fr' } } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()

  const window: any = new Window({ url: 'http://localhost/' })
  window.fetch = async (url: string) => {
    const m = url.match(/\/i18n\/([^/]+)\/([^/]+\.json)$/)
    const chemin = m ? join(outDir, 'i18n', m[1], m[2]) : ''
    if (!m || !existsSync(chemin)) return { ok: false, status: 404 }
    const json = JSON.parse(readFileSync(chemin, 'utf-8'))
    return { ok: true, status: 200, json: async () => json }
  }
  ;(window as any).__mjsI18nImport = async (url: string) => {
    const src = readFileSync(join(outDir, String(url).split('/').pop()!), 'utf-8')
    return { default: JSON.parse(src.replace(/^export default /, '').replace(/;\s*$/, '')) }
  }

  const files     = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coreFile  = files.find((f) => /^mjs_core-/.test(f))!
  const brut      = readFileSync(join(root, 'bundle.js'), 'utf-8')
  const debut     = brut.indexOf('const µReady = ')
  const corps     = brut.match(/const µReady = import\(µCore\)\.then\(async \(\{ µ \}\) => \{\n([\s\S]*)\n\}\);\nif \(typeof window/)
  assert.ok(corps, 'corps du manifeste introuvable')
  const manifeste = [stripEsm(brut.slice(0, debut)), corps![1]].join('\n').replace(/window\.µ\s*=\s*µ;?/, '')
  const autres    = files.filter((f) => f !== coreFile)
  const ids       = new Map(autres.map((f) => [f, fileToId(f)]))
  const resoudre  = (url: string): string | null => ids.get(url.split('/').pop() || '') ?? null
  const portees   = autres.map((f) => ({ f, id: ids.get(f)!, ...ssrScopeFile(readFileSync(join(outDir, f), 'utf-8'), ids.get(f)!, resoudre) }))
  const ordre     = topoSortFiles(portees.map((p) => p.id), new Map(portees.map((p) => [p.id, p.deps])), new Map(portees.map((p) => [p.id, p.f])))
  const code      = ordre.map((id) => portees.find((p) => p.id === id)!.code).join('\n')
  const coeur     = stripEsm(readFileSync(join(outDir, coreFile), 'utf-8'))

  window.eval(`${coeur}\nµ._i18nImport = globalThis.__mjsI18nImport;\n${manifeste}\nglobalThis.µ = µ;\n${code}`)
  const inserer = (nom: string): any => {
    window.document.body.insertAdjacentHTML('beforeend', `<mjs-${nom}></mjs-${nom}>`)
    return window.document.body.querySelector(`mjs-${nom}`)
  }
  return { window, inserer }
}

// promesse pilotée par le test, posée sur `window` avant le montage
function pilotee(window: any) {
  let resoudre: (v: any) => void = () => {}
  let rejeter: (e: any) => void = () => {}
  window.__p = new Promise((res, rej) => { resoudre = res; rejeter = rej })
  return { resoudre, rejeter }
}

const texte = (el: any, sel: string): string => (el._shadow.querySelector(sel)?.textContent ?? '').trim()

describe('i18n — un texte traduit suit la langue dans les branches d\'un {await}', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('{success} : le texte suit fr -> en -> fr ; le champ garde son nœud, sa valeur et son focus ; la valeur reste lue', async () => {
    const { window, inserer } = await monter({ 'tst-complet': COMPLET })
    const { resoudre } = pilotee(window)
    const el = inserer('tst-complet')
    await pause(150)
    assert.equal(texte(el, '.hors'), 'Résumé du panier', 'témoin hors du bloc')
    assert.equal(texte(el, '.att'), 'Résumé du panier', 'attente en français')
    resoudre(3)
    await pause(100)
    assert.equal(texte(el, '.ok'), '3 articles', 'arrivée en français')
    const champ = el._shadow.querySelector('input.saisie')
    champ.value = 'saisi'
    champ.focus()
    const etat = el._mjs_awaitStates.get('await2') ?? [...el._mjs_awaitStates.values()][0]

    window.µ.store.__mjsLang = 'en'
    await pause(150)
    assert.equal(texte(el, '.hors'), 'Cart summary', 'témoin hors du bloc en anglais')
    assert.equal(texte(el, '.ok'), '3 items', 'branche {success} en anglais, valeur de succès lue')
    assert.ok(el._shadow.querySelector('input.saisie') === champ, 'même nœud : branche non reconstruite')
    assert.equal(champ.value, 'saisi', 'valeur de saisie gardée')
    assert.ok(el._shadow.activeElement === champ, 'focus gardé')
    assert.equal([...el._mjs_awaitStates.values()][0], etat, 'même état d\'attente : promesse non relancée')

    window.µ.store.__mjsLang = 'fr'
    await pause(150)
    assert.equal(texte(el, '.ok'), '3 articles', 'retour au français')
    assert.equal(texte(el, '.hors'), 'Résumé du panier')
    assert.ok(el._shadow.querySelector('input.saisie') === champ, 'toujours le même nœud')
    assert.equal(champ.value, 'saisi')
  })

  it('attente : le texte de la branche d\'attente suit la langue avant l\'arrivée de la promesse', async () => {
    const { window, inserer } = await monter({ 'tst-attente': COMPLET })
    pilotee(window)
    const el = inserer('tst-attente')
    await pause(150)
    assert.equal(texte(el, '.att'), 'Résumé du panier')
    window.µ.store.__mjsLang = 'en'
    await pause(150)
    assert.equal(texte(el, '.att'), 'Cart summary', 'attente en anglais')
    assert.equal(texte(el, '.hors'), 'Cart summary')
  })

  it('{error} : le texte suit la langue, le message de l\'erreur reste lu', async () => {
    const { window, inserer } = await monter({ 'tst-erreur': COMPLET })
    const { rejeter } = pilotee(window)
    const el = inserer('tst-erreur')
    await pause(150)
    rejeter(new Error('panne'))
    await pause(100)
    assert.equal(texte(el, '.ko'), 'Résumé du panier/panne')
    window.µ.store.__mjsLang = 'en'
    await pause(150)
    assert.equal(texte(el, '.ko'), 'Cart summary/panne', 'branche {error} en anglais')
    window.µ.store.__mjsLang = 'fr'
    await pause(150)
    assert.equal(texte(el, '.ko'), 'Résumé du panier/panne', 'retour au français')
  })

  it('{await} sous un {if} : le texte suit la langue, le champ reste', async () => {
    const { window, inserer } = await monter({ 'tst-sous-if': SOUS_IF })
    const { resoudre } = pilotee(window)
    const el = inserer('tst-sous-if')
    await pause(150)
    assert.equal(texte(el, '.att'), 'Résumé du panier')
    resoudre(1)
    await pause(100)
    assert.equal(texte(el, '.ok'), '1 article')
    const champ = el._shadow.querySelector('input.saisie')
    champ.value = 'x'
    window.µ.store.__mjsLang = 'en'
    await pause(150)
    assert.equal(texte(el, '.ok'), '1 item')
    assert.ok(el._shadow.querySelector('input.saisie') === champ, 'même nœud')
    assert.equal(champ.value, 'x')
  })

  it('une variable du dehors lue dans la branche suit sa variable, la langue suit aussi', async () => {
    const { window, inserer } = await monter({ 'tst-avec-var': AVEC_VAR })
    const { resoudre } = pilotee(window)
    const el = inserer('tst-avec-var')
    await pause(150)
    resoudre(2)
    await pause(100)
    assert.equal(texte(el, '.q'), '1')
    el._set('q', 7)
    window.µ.store.__mjsLang = 'en'
    await pause(150)
    assert.equal(texte(el, '.ok'), '2 items', 'la langue suit')
    assert.equal(texte(el, '.q'), '7', 'la variable du dehors suit, comme à la racine')
  })

  it('texte brut {{…}} et lignes d\'un {for} de la branche : ils suivent la langue', async () => {
    const { window, inserer } = await monter({ 'tst-brut-lignes': BRUT_ET_LIGNES })
    const { resoudre } = pilotee(window)
    const el = inserer('tst-brut-lignes')
    await pause(150)
    resoudre([1, 2])
    await pause(100)
    const lignes = () => [...el._shadow.querySelectorAll('li')].map((l: any) => l.textContent)
    assert.equal(texte(el, '.h'), 'Résumé du panier')
    assert.deepEqual(lignes(), ['1 article', '2 articles'])
    window.µ.store.__mjsLang = 'en'
    await pause(150)
    assert.equal(texte(el, '.h'), 'Cart summary', 'texte brut en anglais')
    assert.deepEqual(lignes(), ['1 item', '2 items'], 'lignes en anglais')
  })
})
