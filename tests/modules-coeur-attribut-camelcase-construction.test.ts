// modules du cœur : un attribut écrit en dur sur leur balise (`<@@x …>` ou `<mjs-core-x …>`) qui est l'écriture camelCase d'une prop du
// module arrête la construction en donnant l'écriture à tirets, la seule des attributs des modules du cœur. Le HTML met les noms d'attributs
// en minuscules : `emptyLabel="Rien"` arrive en `emptylabel`, que le module recevrait pourtant sous son nom (comme toute prop déclarée d'un
// composant) ; le refus garde une seule écriture. Les formes liées (`emptyLabel={$x}` comme `empty-label={$x}`)
// passent la valeur par le code et marchent : permises. Dans le doute, rien : une variable que le module calcule lui-même (`labelText`), un
// attribut natif (`tabIndex`), un attribut `data-*` ou `aria-*`, un composant de l'appli. Les props se lisent dans les sources du module.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'

const MODULES = new URL('../src/core-modules/', import.meta.url)

async function construire(etiquette: string, fichiers: Record<string, string>): Promise<{ fichier: string, texte: string }> {
  const root   = mjsTmp(etiquette)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), stylesheetsDir: join(root, 'styles') })
  const stats   = await bundler.compile()
  await bundler.close()
  return { fichier: join(srcDir, 'gc-page.mjs'), texte: stats.errors.map((e: any) => String(e?.message ?? e)).join('\n') }
}

const DONNEES = `<script>\n  $lignes = [{ x: 'a', v: 1 }]\n  $series = [{ key: 'v' }]\n  $t = 'lié'\n</script>\n`

const FAUTES = DONNEES + [
  '<@@chart rows={$lignes} series={$series} emptyLabel="Rien" axisUnit="kg"></@@chart>',
  '<mjs-core-chart rows={$lignes} series={$series} emptyLabel="Rien"></mjs-core-chart>',
  '<@@field name="n" okLabel="Bravo"><input name="n"></@@field>',
  '<@@select otherLabel="Autre" searchPlaceholder></@@select>',
  '<@@number lessLabel="Moins"></@@number>',
  '<@@carousel prevLabel="Avant"></@@carousel>',
  '<@@code copiedLabel="Copié">x</@@code>',
  '<@@gauge warnColor="red"></@@gauge>',
].join('\n') + '\n'

const faute = (tag: string, attribut: string, kebab: string) => `<${tag} ${attribut}=…> — écrivez ${kebab} : sur un module du cœur, un attribut écrit en dur s'écrit à tirets, comme dans sa documentation. Écrit ainsi, ${attribut} arriverait en minuscules (${attribut.toLowerCase()}) et le module le recevrait pourtant sous son nom : la construction n'en garde qu'une écriture.`

const ATTENDUS = [
  faute('@@chart', 'emptyLabel', 'empty-label'),
  faute('@@chart', 'axisUnit', 'axis-unit'),
  faute('mjs-core-chart', 'emptyLabel', 'empty-label'),
  faute('@@field', 'okLabel', 'ok-label'),
  faute('@@select', 'otherLabel', 'other-label'),
  faute('@@select', 'searchPlaceholder', 'search-placeholder'),
  faute('@@number', 'lessLabel', 'less-label'),
  faute('@@carousel', 'prevLabel', 'prev-label'),
  faute('@@code', 'copiedLabel', 'copied-label'),
  faute('@@gauge', 'warnColor', 'warn-color'),
]

// tout passe : l'écriture en kebab-case (texte, texte interpolé, valeur liée), l'écriture camelCase liée, `data-*` et `aria-*`, un attribut
// natif écrit à la façon de JSX, une variable que le module calcule lui-même, un composant de l'appli qui porte une prop du même nom ; et le
// doute : un texte interpolé en camelCase (`emptyLabel="Rien pour {$t}"`, ignoré lui aussi), que la construction ne distingue pas d'une
// liaison à deux sens (`axisUnit=!{$t}`) — rien plutôt qu'une erreur fausse
const JUSTES = DONNEES + [
  '<@@chart rows={$lignes} series={$series} empty-label="Rien" axis-unit="kg"></@@chart>',
  '<@@chart rows={$lignes} series={$series} emptyLabel={$t} axisUnit=!{$t}></@@chart>',
  '<mjs-core-chart rows={$lignes} series={$series} emptyLabel="Rien pour {$t}"></mjs-core-chart>',
  '<@@field name="n" ok-label="Bravo {$t}" data-okLabel="x" aria-label="y"><input name="n"></@@field>',
  '<@@field name="m" okLabel={$t}><input name="m"></@@field>',
  '<@@select other-label="Autre" otherPlaceholder={$t} search-placeholder={$t}></@@select>',
  '<@@number less-label="Moins" tabIndex="0"></@@number>',
  '<@@gauge labelText="Nombre"></@@gauge>',
  '<@gc-carte okLabel="Bravo"></@gc-carte>',
].join('\n') + '\n'

const CARTE = '<script>\n  $okLabel = \'\'\n</script>\n\n<p>{$okLabel}</p>\n'

describe('modules du cœur — un attribut écrit en camelCase arrête la construction', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('chaque attribut camelCase écrit en dur sur un module du cœur arrête la construction, avec la bonne écriture', async () => {
    const { fichier, texte } = await construire('camel-fautes', { 'gc-page.mjs': FAUTES })
    for (const attendu of ATTENDUS) assert.ok(texte.includes(`[bundler] ${fichier} : ${attendu}`), `message absent : ${attendu}\n--- erreurs :\n${texte}`)
    const lignes = texte.split('\n').filter((l) => l.includes('écrivez'))
    assert.equal(lignes.length, ATTENDUS.length, `une ligne par faute, rien de plus :\n${lignes.join('\n')}`)
  })

  it('les formes liées, le kebab-case, data-* et aria-*, un attribut natif, une variable calculée, un composant de l\'appli : rien', async () => {
    const { texte } = await construire('camel-justes', { 'gc-page.mjs': JUSTES, 'gc-carte.mjs': CARTE })
    assert.equal(texte, '', texte)
  })

  it('en anglais aussi', async () => {
    setMessagesLang('en')
    try {
      const { fichier, texte } = await construire('camel-fautes-en', { 'gc-page.mjs': DONNEES + '<@@field name="n" okLabel="Well done"><input name="n"></@@field>\n' })
      const attendu = '<@@field okLabel=…> — write ok-label: on a core module, an attribute written as is takes the dashed form, as in its documentation. Written this way, okLabel would arrive lowercased (oklabel) and the module would still receive it under its name: the build keeps a single spelling.'
      assert.ok(texte.includes(`[bundler] ${fichier}: ${attendu}`), `message absent : ${attendu}\n--- erreurs :\n${texte}`)
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('les props camelCase d\'un module se lisent dans ses sources : posées par une valeur, ou lues sans être posées ; jamais une variable calculée', async () => {
    const { coreCamelProps } = await import('../src/bundler/core-attrs.js')
    const props = (nom: string) => coreCamelProps(readFileSync(new URL(nom + '.mjs', MODULES), 'utf-8'))
    assert.deepEqual(props('chart'), ['axisUnit', 'emptyLabel'])
    assert.ok(props('field').includes('okLabel'))
    for (const p of ['otherLabel', 'otherPlaceholder', 'searchPlaceholder', 'emptyLabel']) assert.ok(props('select').includes(p), p)
    for (const p of ['placeholderText', 'searchText', 'otherTexts']) assert.ok(!props('select').includes(p), p)
    assert.ok(props('gauge').includes('warnColor'))
    assert.ok(!props('gauge').includes('labelText'))
    assert.deepEqual(props('carousel'), ['nextLabel', 'prevLabel'])
  })

  it('les modules du cœur eux-mêmes n\'écrivent aucune de ces fautes', async () => {
    const noms = readdirSync(MODULES).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4))
    assert.ok(noms.length >= 20, noms.join(' '))
    const { texte } = await construire('camel-cœur', { 'gc-page.mjs': noms.map((n) => `<@@${n}></@@${n}>`).join('\n') + '\n' })
    assert.deepEqual(texte.split('\n').filter((l) => l.includes('écrivez')), [], texte)
  })
})
