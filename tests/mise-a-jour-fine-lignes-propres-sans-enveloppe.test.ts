// lignes propres avec le réglage `"proxy": false` : un objet tenu par deux variables `$` du composant et écrit par l'une (`$sel = $data[3]`
// puis `$sel.label = v`, affiché ou non ; `$favs = [$data[3]]` puis `$favs[0].label = v`, ou l'inverse) paraît dans la liste de l'autre à
// sa passe suivante — échange, retrait, ajout —, comme avant les lignes propres. L'écriture servie champ par champ par la variable de la
// liste elle-même la laisse propre : l'échange suivant ne relit aucune ligne. Avec l'enveloppe, mêmes écrans et mêmes comptes

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const tic = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)) }
const js = (script: string[], gabarit: string[]) => ['<script lang="js">', ...script.map((l) => '  ' + l), '</script>', ...gabarit].join('\n')
const LIGNES = "const a = []; for (let i = 0; i < 6; i++) a.push({ id: i + 1, label: 'r' + (i + 1) });"
const BASE = [
  '$data = [];',
  `@poser = function() { ${LIGNES} $data = a; };`,
  "@fine = function() { $data[2].label += ' F'; };",
  '@echanger = function() { const t = $data[1]; $data[1] = $data[4]; $data[4] = t; };',
  '@retirer = function() { $data.splice(0, 1); };',
  "@ajouter = function() { $data.push({ id: 50, label: 'n' }); };",
]
const SEL   = ['$sel = null;', '@choisir = function() { $sel = $data[3]; };', "@ecrire = function() { $sel.label += ' S'; };"]
const FAVS  = ['$favs = [];', '@choisir = function() { $favs = [$data[3]]; };', "@ecrire = function() { $favs[0].label += ' S'; };", "@viaData = function() { $data[3].label += ' D'; };", "@pousserFav = function() { $favs.push({ id: 99, label: 'n' }); };"]
const LISTE = '{for row in $data by id}<i>{row.label}</i>{end}'

const SOURCES: Record<string, string> = {
  'sel-vu.mjs':    js([...BASE, ...SEL], ["<p>{$sel ? $sel.label : '-'}</p>", LISTE]),
  'sel-cache.mjs': js([...BASE, ...SEL], [LISTE]),
  'favs.mjs':      js([...BASE, ...FAVS], [LISTE, '|{for f in $favs by id}<b>{f.label}</b>{end}']),
}

// après `propre` (pose, écriture fine, échange) : r1 r5 r3F r4 r2 r6 ; `$data[3]` est r4, écrit par l'autre variable (« S »)
const ECRANS: Record<string, string[]> = {
  echanger: ['r1', 'r2', 'r3 F', 'r4 S', 'r5', 'r6'],
  retirer:  ['r5', 'r3 F', 'r4 S', 'r2', 'r6'],
  ajouter:  ['r1', 'r5', 'r3 F', 'r4 S', 'r2', 'r6', 'n'],
}

async function construire(nom: string, opts: Record<string, unknown>): Promise<{ win: any, avis: string[] }> {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  const avis: string[] = []
  mkdirSync(srcDir, { recursive: true })
  for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const win   = new Window({ url: 'http://localhost/' })
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const coeur = files.find((f) => /^mjs_core-/.test(f))!
  const code  = files.filter((f) => f !== coeur).reduce((acc, f) => acc + '\n' + stripEsm(readFileSync(join(outDir, f), 'utf-8')), stripEsm(readFileSync(join(outDir, coeur), 'utf-8')))
  win.eval(`${code}\nglobalThis.µ = µ;`)
  win.µ.warn = (...a: any[]) => { avis.push(a.map(String).join(' ')) }
  win.document.body.innerHTML = '<mjs-sel-vu></mjs-sel-vu><mjs-sel-cache></mjs-sel-cache><mjs-favs></mjs-favs>'
  await tic()
  return { win, avis }
}

const ombre  = (el: any) => el._shadow || el.shadowRoot
const textes = (el: any, sel: string) => Array.from(ombre(el).querySelectorAll(sel)).map((x: any) => x.textContent)

// lignes de la liste de `$data` (des `<i>`) relues par sa passe (fermeture appelée sans masque) ; celle de `$favs` (des `<b>`) se relit
// en plus avec l'enveloppe, qui la prévient tout de suite
function espion(el: any): { n: number } {
  const c = { n: 0 }
  for (const cache of Object.values(el._mjs_list_cache) as any[]) {
    for (const en of cache.values()) {
      const f = en._mjs_updFn
      if (!f || en.nodes[0].localName !== 'i') continue
      en._mjs_updFn = function(it: any, ix: any, m?: number) { if (m === undefined) c.n++; return f(it, ix, m) }
    }
  }
  return c
}

// six lignes posées, une écriture servie champ par champ, un échange : la liste est propre
async function propre(el: any) {
  el.poser()
  await tic()
  el.fine()
  await tic()
  el.echanger()
  await tic()
}

for (const [reglage, opts] of [['"proxy": false', { proxy: false }], ['enveloppe', {}]] as Array<[string, Record<string, unknown>]>) {
  describe(`lignes propres, ${reglage} : objet tenu par deux variables $ et écrit par l'une (runtime)`, function () {
    this.timeout(60000)
    let win: any, avis: string[]

    before(async () => { ({ win, avis } = await construire('fine-propres-deux-variables', opts)) })
    after(async () => { win?.close?.(); await terminateSharedWorkerPool() })

    const hote = (nom: string): any => win.document.querySelector('mjs-' + nom)

    for (const nom of ['sel-vu', 'sel-cache', 'favs']) {
      for (const geste of Object.keys(ECRANS)) {
        it(`${nom} : l'autre variable écrit l'objet, puis ${geste} — la liste de $data le montre, relue une fois`, async () => {
          const el = hote(nom)
          await propre(el)
          el.choisir()
          await tic()
          const c = espion(el)
          el.ecrire()
          await tic()
          el[geste]()
          await tic()
          assert.deepEqual(textes(el, 'i'), ECRANS[geste])
          if (nom === 'sel-vu') assert.deepEqual(textes(el, 'p'), ['r4 S'])
          if (geste === 'echanger') {
            assert.equal(c.n, 6)
            const c2 = espion(el)
            el.echanger()
            await tic()
            assert.equal(c2.n, 0)
            assert.deepEqual(textes(el, 'i'), ['r1', 'r5', 'r3 F', 'r4 S', 'r2', 'r6'])
          }
        })
      }
    }

    it('favs : $data écrit l\'objet que tient $favs — la liste de $favs le montre à sa passe suivante', async () => {
      const el = hote('favs')
      await propre(el)
      el.choisir()
      await tic()
      el.viaData()
      await tic()
      el.pousserFav()
      await tic()
      assert.deepEqual(textes(el, 'b'), ['r4 D', 'n'])
      assert.deepEqual(textes(el, 'i'), ['r1', 'r5', 'r3 F', 'r4 D', 'r2', 'r6'])
    })

    it('écriture servie champ par champ par la variable de la liste, puis échange : aucune ligne relue', async () => {
      const el = hote('sel-cache')
      await propre(el)
      el.fine()
      await tic()
      const c = espion(el)
      el.echanger()
      await tic()
      assert.equal(c.n, 0)
      assert.deepEqual(textes(el, 'i'), ['r1', 'r2', 'r3 F F', 'r4', 'r5', 'r6'])
    })

    it('aucun avertissement de ligne changée sans passer par MJS', () => {
      assert.deepEqual(avis.filter((a) => /sans passer par MJS|without going through MJS/.test(a)), [])
    })
  })
}
