// µlayout (le modèle choisi) : sa lecture se voit dans le code, pas dans le texte, et les noms de
// modèles qu'elle compare sont tous relevés. Le script est lu quel que soit son langage (TypeScript
// compris, dont le compilateur réécrit guillemets et parenthèses) ; dans le HTML, seul le code entre
// accolades compte — une page qui PARLE de µlayout (`<p>La rune µlayout…</p>`, `<code>µlayout</code>`)
// ne déclare rien, et un `$layout` cité dans une chaîne ou un commentaire n'est pas une variable
// homonyme. Les noms comparés viennent du code : `switch µlayout` et ses `when`, `[…].includes(µlayout)`
// comptent ; un commentaire ou un texte qui les cite, non.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const STYLE_BIG = '<style name="big">\n  p\n    font-size: 2em\n</style>\n'

async function construire(etiquette: string, fichiers: Record<string, string>) {
  const root   = mjsTmp('modeles-mulayout-' + etiquette)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  await bundler.close()
  return { outDir, erreurs: stats.errors.map((e: any) => e.message).join('\n') }
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const noms = (data: any) => Object.keys(data.layoutCss).sort()

describe('µlayout : lu dans le code, noms de modèles relevés dans le code', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('la lecture de µlayout', () => {
    it('dans un script TypeScript, comme en Civet', async () => {
      for (const [lang, code] of [['ts', '  const mode = (): string => µlayout;'], ['js', '  const mode = () => µlayout;'], ['civet', '  mode := -> µlayout']]) {
        const { data } = await transpile(`<script lang="${lang}">\n${code}\n</script>\n<p>{mode()}</p>\n`, { moduleName: 'lecture-' + lang })
        assert.equal(data.layoutRune, true, lang)
      }
    })

    it('au montage, un composant TypeScript dont le modèle vient d\'une variable du parent charge le style de ce modèle', async () => {
      const b = await construire('ts', {
        'carte.mjs': `<script lang="ts">\n  const mode = (): string => µlayout;\n</script>\n<p class="l">{mode()}</p>\n${STYLE_BIG}`,
        'page.mjs':  "<script>\n  $m = 'big'\n</script>\n<@carte class=\"x\" layout={$m}></@carte>\n",
      })
      assert.equal(b.erreurs, '')
      const files  = readdirSync(b.outDir).filter((f) => f.endsWith('.js'))
      const code   = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))].map((f) => stripEsm(readFileSync(join(b.outDir, f), 'utf-8'))).join('\n')
      const window: any = new Window({ url: 'http://localhost/' })
      const requetes: string[] = []
      try {
        window.fetch = async (u: string) => { requetes.push(String(u)); return { ok: true, text: async () => 'p{font-size:2em}' } }
        window.eval(`${code}\nglobalThis.µ = µ;`)
        window.document.body.innerHTML = '<mjs-page></mjs-page>'
        const page  = window.document.querySelector('mjs-page')
        const texte = () => page._shadow?.querySelector('.x')?._shadow?.querySelector('.l')?.textContent ?? ''
        await attendre(() => texte() !== '' && requetes.length > 0, 1000)
        assert.equal(texte(), 'big')
        assert.deepEqual(requetes.filter((u) => /carte\.big\.css/.test(u)).length, 1)
      }
      finally {
        window.close()
      }
    })

    it('une page qui parle de µlayout dans son texte ne déclare rien', async () => {
      const texte = await transpile('<p>La rune µlayout lit le modèle.</p>\n', { moduleName: 'parle-texte' })
      assert.equal(texte.data.layoutRune, false)
      const code = await transpile('<code>µlayout</code>\n<p>ok</p>\n', { moduleName: 'parle-code' })
      assert.equal(code.data.layoutRune, false)
    })

    it('un $layout cité dans une chaîne n\'est pas une variable homonyme', async () => {
      const { data } = await transpile("<script>\n  msg = 'voir $layout'\n</script>\n<p>La rune µlayout lit le modèle, {msg}.</p>\n", { moduleName: 'homonyme-chaine' })
      assert.equal(data.layoutRune, false)
    })

    it('ni dans un commentaire du script, quand µlayout est vraiment lu', async () => {
      const { data } = await transpile("<script>\n  # pas de $layout ici : le modèle vient de µlayout\n  mode := -> µlayout\n</script>\n<p>{mode()}</p>\n", { moduleName: 'homonyme-commentaire' })
      assert.equal(data.layoutRune, true)
    })

    it('une vraie variable $layout à côté de µlayout reste refusée', async () => {
      await assert.rejects(transpile('<script>\n  $layout = 1\n</script>\n<p>{µlayout}</p>\n', { moduleName: 'homonyme-vrai' }), /\$layout/)
    })

    it('dans une interpolation du HTML, µlayout est bien lu', async () => {
      const { data } = await transpile('<p>{µlayout}</p>\n', { moduleName: 'lecture-html' })
      assert.equal(data.layoutRune, true)
    })
  })

  describe('les noms comparés à µlayout', () => {
    it('switch µlayout : chaque when est un modèle', async () => {
      const { data } = await transpile(`<script>\n  label := switch µlayout\n    when 'timer' then 'T'\n    when 'mini', 'micro' then 'M'\n    else 'D'\n</script>\n<p>{label}</p>\n${STYLE_BIG}`, { moduleName: 'noms-switch' })
      assert.deepEqual(noms(data), ['big', 'micro', 'mini', 'timer'])
    })

    it('[…].includes(µlayout) : chaque nom de la liste', async () => {
      const { data } = await transpile("<script>\n  petit := ['mini', 'micro'].includes(µlayout)\n</script>\n<p>{petit}</p>\n", { moduleName: 'noms-includes' })
      assert.deepEqual(noms(data), ['micro', 'mini'])
    })

    it('dans le HTML aussi : {if […].includes(µlayout)}', async () => {
      const { data } = await transpile("<p>{if ['mini', 'micro'].includes(µlayout)}petit{end}</p>\n", { moduleName: 'noms-includes-html' })
      assert.deepEqual(noms(data), ['micro', 'mini'])
    })

    it('en TypeScript aussi', async () => {
      const { data } = await transpile("<script lang=\"ts\">\n  const petit = (): boolean => µlayout === 'mini';\n</script>\n<p>{petit()}</p>\n", { moduleName: 'noms-ts' })
      assert.deepEqual(noms(data), ['mini'])
    })

    it('un nom cité dans un commentaire ou dans le texte n\'est pas un modèle', async () => {
      const { data } = await transpile("<script>\n  # µlayout is 'fantome'\n  mode := -> µlayout is 'vrai'\n</script>\n<p>µlayout is 'texte'</p>\n<p>{mode()}</p>\n", { moduleName: 'noms-commentaire' })
      assert.deepEqual(noms(data), ['vrai'])
    })

    it('au build : un nom tiré d\'un switch se choisit en dur sans erreur', async () => {
      const b = await construire('switch', {
        'carte.mjs': `<script>\n  label := switch µlayout\n    when 'timer' then 'T'\n    else 'D'\n</script>\n<p>{label}</p>\n${STYLE_BIG}`,
        'page.mjs':  '<@carte layout="timer"></@carte>\n',
      })
      assert.equal(b.erreurs, '')
    })
  })
})
