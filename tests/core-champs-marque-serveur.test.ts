// Les modules de saisie du cœur (<@@checkbox>, <@@switch>, <@@radio>, <@@number>, <@@gauge>, <@@knob>, <@@select>, <@@editor>) écrivent leur valeur dans un champ caché
// qu'ils créent eux-mêmes. La marque `mjs-f` de ce champ ne sert qu'à une chose : une page RENDUE PAR LE SERVEUR contient déjà ce champ, et le module qui la reprend dans le
// navigateur le retrouve par cette marque au lieu d'en ajouter un second (le formulaire enverrait `n=3&n=3`), sans jamais toucher un champ caché de la page qui porte le même
// nom (celui que Rails écrit pour `f.check_box`). Donc :
// - seul le rendu par le serveur écrit la marque (drapeau `µserver`) : dans le navigateur, un champ créé par le module ne la porte plus, et le module garde sa référence ;
// - la recherche par la marque n'existe que dans les applis qui reprennent des pages du serveur : même repère `reprise` que l'état de départ écrit par le serveur. Ailleurs,
//   le module garde ses champs (plusieurs pour une liste à choix multiple, et pour l'éditeur en mode « répondre » : un champ par case cochée).
//
// Trois étages : le texte des fichiers (les lignes de la marque sont sous le repère), les builds de production avec un vrai Bundler (la marque n'est dans aucun module d'une
// appli sans reprise), puis le comportement dans happy-dom (aucun `mjs-f` dans le DOM au premier rendu ni après des changements de valeur, les bons champs suivent la valeur,
// le champ de la page reste en place). Les vrais navigateurs jouent la page reprise dans core-champs-marque-serveur-browser.test.ts.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { selectCoreSections, RESUME_LABEL } from '../src/bundler/core-sections.js'
import { mjsTmp } from './helpers/tmp.js'
import { monter } from './helpers/editeur-riche.js'

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const MODULES = ['checkbox', 'switch', 'radio', 'number', 'gauge', 'knob', 'select', 'editor'] as const
const CATALOG = fileURLToPath(new URL('../src/core-modules/', import.meta.url))

/** le code seul : les lignes de commentaire (la légende des repères, les explications ; `#` dans le fichier du module, `//` dans le JavaScript non minifié) ne comptent pas */
const code = (texte: string): string => texte.split('\n').filter((l) => !/^\s*(?:#|\/\/)/.test(l)).join('\n')

/** la marque du champ, telle qu'elle s'écrit dans le code : le sélecteur `[mjs-f]` ou le nom d'attribut entre guillemets (`--mjs-fg`, une variable de style, n'en est pas une) */
const MARQUE = /\[mjs-f\]|["'`]mjs-f["'`]/g
const marques = (texte: string): number => (texte.match(MARQUE) ?? []).length

/** le module lu avec le morceau `reprise` (les autres morceaux restent) ou sans lui */
const garde = (kind: string) => kind === 'piece'
const sans  = (kind: string, attr: string) => attr === RESUME_LABEL ? false : kind === 'piece'

describe('la marque `mjs-f` des huit modules de saisie — le texte des fichiers', () => {
  for (const m of MODULES) {
    const file = join(CATALOG, `${m}.mjs`)
    const src  = readFileSync(file, 'utf-8')

    it(`${m} : avec le morceau, il cherche les champs du serveur par leur marque et ne l'écrit que pendant le rendu par le serveur`, () => {
      const plein = code(selectCoreSections(file, src, garde))
      assert.match(plein, /:scope > \[mjs-f\]/, 'la recherche par la marque')
      const ecrit = plein.split('\n').filter((l) => l.includes('setAttribute(\'mjs-f\''))
      assert.ok(ecrit.length > 0, 'l\'écriture de la marque')
      for (const l of ecrit) assert.match(l, /\bif µserver\b/, `la marque n'est écrite que sous le drapeau du serveur : ${l.trim()}`)
    })

    it(`${m} : sans le morceau, plus aucune trace de la marque dans le code`, () => {
      const maigre = code(selectCoreSections(file, src, sans))
      assert.equal(marques(maigre), 0, `${m} : la marque est partie`)
      assert.ok(maigre.length > 1500, `${m} : le module est bien là`)
    })
  }
})

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

type Options = Record<string, unknown>

const HOTE = [
  '<script>',
  '  $texte  = \'<p>un</p>\'',
  '  $modele = \'<ul data-checklist><li>x</li><li>y</li></ul>\'',
  '  $coches = [0]',
  '  $multi  = [\'a\']',
  '</script>',
  '<form @noUJS>',
  '  <@@checkbox name="c">c</@@checkbox>',
  '  <@@switch name="w">w</@@switch>',
  '  <@@radio name="r" value="x">r</@@radio>',
  '  <@@number name="n" value={3}></@@number>',
  '  <@@gauge name="g" value={3}></@@gauge>',
  '  <@@knob name="k" value={30}></@@knob>',
  '  <@@select name="p" value="a"><@@option value="a">A</@@option></@@select>',
  '  <@@select name="m" multiple value={$multi}><@@option value="a">A</@@option></@@select>',
  '  <@@editor name="e" toolbar="none" value={$texte}></@@editor>',
  '  <@@editor name="a[]" toolbar="none" answer value={$modele} checked={$coches}></@@editor>',
  '</form>',
].join('\n')

/** tout ce que le dossier de sortie porte d'un module cœur (le code et son style) */
function coreOf(outDir: string, prefix: string): string {
  return readdirSync(outDir).filter((f) => f.startsWith(prefix)).sort().map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
}

async function build(prefix: string, opts: Options): Promise<Record<string, string>> {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
  return Object.fromEntries(MODULES.map((m) => [m, coreOf(outDir, `core-${m}-`)]))
}

const gzip = (texte: string): number => gzipSync(Buffer.from(texte)).length

// des réglages où aucune page n'est reprise : pas de rendu serveur, ou un rendu que le navigateur jette puis refait
const SANS: Array<[string, Options]> = [
  ['aucun bloc render', {}],
  ['render.default: ssr (rendre puis remplacer)', { render: { default: 'ssr' } }],
  ['une liste de modules d\'exécution qui ne cite pas hydrate', { runtime: ['router'] }],
]

// des réglages où le navigateur reprend une page du serveur
const AVEC: Array<[string, Options]> = [
  ['render.default: ssr:markers', { render: { default: 'ssr:markers' } }],
  ['runtime: [\'hydrate\']', { runtime: ['hydrate'] }],
]

describe('construction — la marque `mjs-f` suit les pages reprises du serveur', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('production, aucune page reprise : la marque n\'est dans aucun des huit modules', () => {
    for (const [nom, opts] of SANS) {
      it(nom, async () => {
        const chunks = await build('marque-sans', { env: 'prod', ...opts })
        for (const m of MODULES) {
          assert.ok(chunks[m].length > 1500, `${m} : le module est bien là (${chunks[m].length} octets)`)
          assert.equal(marques(chunks[m]), 0, `${m} : ni recherche ni écriture de la marque`)
        }
      })
    }

    it('non minifiée aussi', async () => {
      const chunks = await build('marque-sans-txt', { env: 'prod', minify: false })
      for (const m of MODULES) assert.equal(marques(code(chunks[m])), 0, `${m} : ni recherche ni écriture de la marque`)
    })
  })

  describe('production, l\'appli reprend une page du serveur : la recherche et l\'écriture restent', () => {
    for (const [nom, opts] of AVEC) {
      it(nom, async () => {
        const chunks = await build('marque-avec', { env: 'prod', ...opts })
        for (const m of MODULES) assert.ok(marques(chunks[m]) >= 2, `${m} : la recherche et l'écriture de la marque sont là (${marques(chunks[m])})`)
      })
    }

    it('chaque module pèse plus qu\'une appli sans reprise, en brut comme en gzip', async () => {
      const maigre = await build('marque-poids-sans', { env: 'prod' })
      const plein  = await build('marque-poids-avec', { env: 'prod', render: { default: 'ssr:markers' } })
      for (const m of MODULES) {
        assert.ok(maigre[m].length < plein[m].length, `${m} : ${maigre[m].length} octets sans reprise, ${plein[m].length} avec`)
        assert.ok(gzip(maigre[m]) < gzip(plein[m]), `${m} : ${gzip(maigre[m])} gzip sans reprise, ${gzip(plein[m])} avec`)
      }
    })
  })

  describe('développement : tout reste toujours', () => {
    it('chaque module garde la recherche et l\'écriture de la marque', async () => {
      const chunks = await build('marque-dev', { env: 'dev' })
      for (const m of MODULES) assert.ok(marques(chunks[m]) >= 2, `${m} : la recherche et l'écriture de la marque sont là (${marques(chunks[m])})`)
    })
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------

// un champ caché de la page, de même nom, dans la balise de chaque module (la forme d'un formulaire Rails)
const PAGE = [
  '<script>',
  '  $texte  = \'<p>un</p>\'',
  '  $modele = \'<ul data-checklist><li>x</li><li>y</li><li>z</li></ul>\'',
  '  $coches = [0]',
  '  $multi  = [\'a\', \'c\']',
  '</script>',
  '<form class="f" @noUJS>',
  '  <@@checkbox class="cb" name="cb"><input type="hidden" name="cb" value="a-cb">case</@@checkbox>',
  '  <@@switch class="sw" name="sw"><input type="hidden" name="sw" value="a-sw">interrupteur</@@switch>',
  '  <@@radio class="rd" name="g" value="x"><input type="hidden" name="g" value="a-g">x</@@radio>',
  '  <@@number class="nb" name="n" value={3}><input type="hidden" name="n" value="a-n"></@@number>',
  '  <@@gauge class="ga" name="ga" value={4}><input type="hidden" name="ga" value="a-ga"></@@gauge>',
  '  <@@knob class="kn" name="kn" value={30}><input type="hidden" name="kn" value="a-kn"></@@knob>',
  '  <@@select class="s1" name="s" value="b"><input type="hidden" name="s" value="a-s"><@@option value="a">A</@@option><@@option value="b">B</@@option></@@select>',
  '  <@@select class="sm" name="m" multiple value={$multi}><input type="hidden" name="m" value="a-m"><@@option value="a">A</@@option><@@option value="b">B</@@option><@@option value="c">C</@@option></@@select>',
  '  <@@editor class="ed" name="e" toolbar="none" value={$texte}><input type="hidden" name="e" value="a-e"></@@editor>',
  '  <@@editor class="rp" name="a[]" toolbar="none" answer value={$modele} checked={$coches}><input type="hidden" name="a[]" value="a-a"></@@editor>',
  '</form>',
].join('\n')

// pour chaque module : la suite de changements de valeur et les champs attendus ensuite, celui de la page toujours en tête, puis ceux du module
type Etape = [string, unknown, string[]]
const SUITES: Record<string, { depart: string[]; etapes: Etape[] }> = {
  cb: { depart: ['cb=a-cb'], etapes: [['checked', true, ['cb=a-cb', 'cb=on']], ['checked', false, ['cb=a-cb']], ['checked', true, ['cb=a-cb', 'cb=on']], ['disabled', true, ['cb=a-cb']], ['disabled', false, ['cb=a-cb', 'cb=on']]] },
  sw: { depart: ['sw=a-sw'], etapes: [['checked', true, ['sw=a-sw', 'sw=on']], ['checked', false, ['sw=a-sw']], ['checked', true, ['sw=a-sw', 'sw=on']], ['disabled', true, ['sw=a-sw']]] },
  rd: { depart: ['g=a-g'], etapes: [['checked', true, ['g=a-g', 'g=x']], ['checked', false, ['g=a-g']], ['checked', true, ['g=a-g', 'g=x']]] },
  nb: { depart: ['n=a-n', 'n=3'], etapes: [['value', 5, ['n=a-n', 'n=5']], ['value', 8, ['n=a-n', 'n=8']], ['name', '', ['n=a-n']], ['name', 'n', ['n=a-n', 'n=8']], ['value', 2, ['n=a-n', 'n=2']]] },
  ga: { depart: ['ga=a-ga', 'ga=4'], etapes: [['value', 7, ['ga=a-ga', 'ga=7']], ['name', '', ['ga=a-ga']], ['name', 'ga', ['ga=a-ga', 'ga=7']], ['value', 9, ['ga=a-ga', 'ga=9']]] },
  kn: { depart: ['kn=a-kn', 'kn=30'], etapes: [['value', 60, ['kn=a-kn', 'kn=60']], ['disabled', true, ['kn=a-kn']], ['disabled', false, ['kn=a-kn', 'kn=60']], ['value', 10, ['kn=a-kn', 'kn=10']]] },
  s1: { depart: ['s=a-s', 's=b'], etapes: [['value', 'a', ['s=a-s', 's=a']], ['value', 'b', ['s=a-s', 's=b']], ['name', '', ['s=a-s']], ['name', 's', ['s=a-s', 's=b']]] },
  sm: { depart: ['m=a-m', 'm=a', 'm=c'], etapes: [['value', ['b'], ['m=a-m', 'm=b']], ['value', ['a', 'b', 'c'], ['m=a-m', 'm=a', 'm=b', 'm=c']], ['value', [], ['m=a-m']], ['value', ['c', 'a'], ['m=a-m', 'm=c', 'm=a']], ['value', ['a'], ['m=a-m', 'm=a']]] },
  ed: { depart: ['e=a-e', 'e=<p>un</p>'], etapes: [['value', '<p>deux</p>', ['e=a-e', 'e=<p>deux</p>']], ['disabled', true, ['e=a-e']], ['disabled', false, ['e=a-e', 'e=<p>deux</p>']], ['value', '<p>trois</p>', ['e=a-e', 'e=<p>trois</p>']]] },
  rp: { depart: ['a[]=a-a', 'a[]=0'], etapes: [['checked', [0, 2], ['a[]=a-a', 'a[]=0', 'a[]=2']], ['checked', [], ['a[]=a-a']], ['checked', [1], ['a[]=a-a', 'a[]=1']], ['checked', [0, 1, 2], ['a[]=a-a', 'a[]=0', 'a[]=1', 'a[]=2']], ['checked', [2], ['a[]=a-a', 'a[]=2']]] },
}

describe('dans le navigateur (happy-dom) — aucun champ du module ne porte la marque, les bons champs suivent la valeur', function () {
  this.timeout(240000)
  let hote: any
  let window: any

  const racine  = () => hote._shadow
  const marked  = (): number => racine().querySelectorAll('[mjs-f]').length
  const module_ = (cls: string): any => racine().querySelector('.' + cls)
  const champs  = (el: any): string[] => Array.from(el.children).filter((c: any) => c.localName === 'input' && c.type === 'hidden').map((c: any) => c.name + '=' + c.value)

  before(async () => {
    ;({ window, hote } = await monter(PAGE, 'marque-navigateur'))
    await pause(400)
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const [cls, suite] of Object.entries(SUITES)) {
    it(`${cls} : au premier rendu puis après chaque changement de valeur, le champ de la page reste et le module n'écrit aucune marque`, async () => {
      const el = module_(cls)
      assert.ok(el, `le module .${cls} est monté`)
      assert.deepEqual(champs(el).slice(0, suite.depart.length), suite.depart, 'au premier rendu')
      assert.equal(marked(), 0, 'aucune marque dans le DOM au premier rendu')
      for (const [prop, valeur, attendu] of suite.etapes) {
        el._set(prop, valeur)
        await pause(90)
        assert.deepEqual(champs(el), attendu, `après ${prop} = ${JSON.stringify(valeur)}`)
        assert.equal(marked(), 0, `aucune marque dans le DOM après ${prop} = ${JSON.stringify(valeur)}`)
      }
    })
  }

  it('au total : aucune marque nulle part dans la page, et le formulaire envoie un champ par valeur', () => {
    assert.equal(marked(), 0)
    const envoi = Array.from(new window.FormData(racine().querySelector('.f')) as any).map((p: any) => p[0] + '=' + p[1])
    for (const [nom, nombre] of [['n', 2], ['ga', 2], ['kn', 2], ['s', 2], ['m', 2], ['e', 2], ['a[]', 2]] as Array<[string, number]>) {
      assert.equal(envoi.filter((x) => x.startsWith(nom + '=')).length, nombre, `${nom} : le champ de la page et celui du module, jamais davantage (${envoi.join('&')})`)
    }
  })
})
