// LA PORTÉE D'UN NOM DU GABARIT S'ARRÊTE AU BLOC QUI LE DÉCLARE.
//
// Le générateur collecte les noms que le gabarit introduit lui-même — variable et index d'un
// `{for}`, nom d'un `{const}`, argument d'une branche `{await}` — dans un ensemble UNIQUE pour
// tout le composant, puis le transpileur retirait ces noms de la liste prédéclarée des
// gestionnaires inline, pour TOUS les gestionnaires. Un gestionnaire situé AILLEURS que dans le
// bloc concerné subissait donc quand même le retrait : Civet y déclarait une copie locale
// (`let number = 5`), et l'écriture était SILENCIEUSEMENT perdue — ni au build, ni au clic, pas
// un mot. Même fuite sur les constantes : une `:=` du `<script>` homonyme d'un nom de gabarit
// n'était plus contrôlée, la réaffectation passait, la perte restait muette.
//
// Deux moitiés à vérifier, jamais l'une sans l'autre :
//   · un gestionnaire HORS du bloc écrit la variable du `<script>` (ou le build refuse, si
//     c'est une constante `:=` — réaffecter une constante depuis un gestionnaire est une faute,
//     elle se dit à la compilation) ;
//   · un gestionnaire DANS le bloc garde le nom LOCAL au handler — c'est ce que fait le
//     squelette de reconstruction (`item = __arr_0[__idx_0]`, posé en tête de handler), et un
//     `{const}`/argument de branche homonyme d'une var du `<script>` ne doit pas l'écraser.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Window } from 'happy-dom'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

/** le code des gestionnaires inline seul — jamais le `<script>` qui les précède, qui porte
 * légitimement ses propres `let <nom>` (`this._mjs_dir` ferme la zone des gestionnaires) */
async function gestionnaires(src: string, opts: any = {}): Promise<string> {
  const { output } = await transpile(src, { moduleName: 'card', ...opts })
  const debut = output.indexOf('_mjs_inline')
  assert.ok(debut > 0, 'aucun gestionnaire inline dans la sortie')
  const fin = output.indexOf('this._mjs_dir', debut)
  return output.slice(debut, fin > 0 ? fin : undefined)
}

describe('gestionnaires — portée des noms que le gabarit introduit', function () {
  describe('hors du bloc : le nom est celui du <script>', function () {
    it('argument d\'une branche {await} : l\'écriture vise la var du <script>', async function () {
      const batch = await gestionnaires(
        "<script>\n  number = 0\n</script>\n<button @click={number = 5}>go</button>\n{await $p}{success number}<p>{number}</p>{end}\n",
      )
      assert.match(batch, /number = 5/, 'le gestionnaire doit écrire la var du <script>')
      assert.doesNotMatch(batch, /let number\b/, "AVANT : `let number = 5` — copie locale jetée à la sortie du handler")
    })

    it('variable de boucle : l\'écriture vise la var du <script>', async function () {
      const batch = await gestionnaires(
        "<script>\n  item = 'du script'\n  $list = [1, 2]\n</script>\n{for item in $list}<p>{item}</p>{end}\n<button @click={item = 'clic'}>go</button>\n",
      )
      assert.match(batch, /item = 'clic'/, 'le gestionnaire doit écrire la var du <script>')
      assert.doesNotMatch(batch, /let item\b/, "AVANT : `let item = 'clic'` — copie locale, écriture muette")
    })

    it('index de boucle : même chose pour le nom d\'index', async function () {
      const batch = await gestionnaires(
        "<script>\n  index = 99\n  $list = [1, 2]\n</script>\n{for x, index in $list}<p>{x}</p>{end}\n<button @click={index = 0}>go</button>\n",
      )
      assert.match(batch, /index = 0/, 'le gestionnaire doit écrire la var du <script>')
      assert.doesNotMatch(batch, /let index\b/, "AVANT : `let index = 0` — copie locale, écriture muette")
    })

    it('nom d\'un {const} : l\'écriture vise la var du <script>', async function () {
      const batch = await gestionnaires(
        "<script>\n  total = 0\n  $list = [1]\n</script>\n{for x in $list}{const total = 3}<p>{total}</p>{end}\n<button @click={total = 7}>go</button>\n",
      )
      assert.match(batch, /total = 7/, 'le gestionnaire doit écrire la var du <script>')
      assert.doesNotMatch(batch, /let total\b/, "AVANT : `let total = 7` — copie locale, écriture muette")
    })
  })

  describe('hors du bloc : une constante := est refusée au build', function () {
    it('constante du <script>, homonyme d\'un argument de branche {await}', async function () {
      await assert.rejects(
        () => transpile("<script>\n  number := 0\n</script>\n<button @click={number = 5}>go</button>\n{await $p}{success number}<p>{number}</p>{end}\n", { moduleName: 'card' }),
        /déclaré CONSTANT/,
        "AVANT : le retrait GLOBAL sortait `number` du contrôle de constance — le build passait et l'écriture disparaissait",
      )
    })

    it('constante du <script module>, homonyme d\'un nom de {const}', async function () {
      await assert.rejects(
        () => transpile("<script module>\n  total := 0\n</script>\n<script>\n  $list = [1]\n</script>\n{for x in $list}{const total = 3}<p>{total}</p>{end}\n<button @click={total = 7}>go</button>\n", { moduleName: 'card' }),
        /déclaré CONSTANT/,
        "AVANT : `moduleConsts` subissait le même retrait — la réaffectation compilait puis levait au premier clic",
      )
    })

    it('constante du <script>, opérateur composé, homonyme d\'une variable de boucle', async function () {
      await assert.rejects(
        () => transpile("<script>\n  item := 0\n  $list = [1]\n</script>\n{for item in $list}<p>{item}</p>{end}\n<button @click={item += 1}>go</button>\n", { moduleName: 'card' }),
        /déclaré CONSTANT/,
      )
    })
  })

  describe('dans le bloc : le nom reste local au gestionnaire', function () {
    it('le squelette de reconstruction reste posé pour la boucle, et pour elle SEULE', async function () {
      // le gestionnaire DANS la boucle lit sa variable (la réaffecter est refusé au build : ce n'est
      // qu'une copie, cf. handler-locaux-gabarit-lecture.test.ts) ; celui de DEHORS écrit la var du <script>
      const batch = await gestionnaires(
        "<script>\n  item = 'du script'\n  $list = [1, 2]\n</script>\n{for item in $list}<button @click={console.log(item)}>{item}</button>{end}\n<button @click={item = 'hors'}>go</button>\n",
      )
      assert.equal(
        (batch.match(/let item = __arr_0\[__idx_0\]/g) ?? []).length, 1,
        'le gestionnaire DANS la boucle garde SA reconstruction, celui de dehors n\'en a pas',
      )
    })

    it('liaison two-way hors boucle : même retrait, même local en trop', async function () {
      const batch = await gestionnaires(
        "<script>\n  item = 'du script'\n  $list = ['a']\n</script>\n{for item in $list}<p>{item}</p>{end}\n<input aria-label=\"x\" value=!{item}>\n",
      )
      assert.match(batch, /return item = ref/, 'la liaison doit écrire la var du <script>')
      assert.doesNotMatch(batch, /let item\b/, "AVANT : `let item = ref` — la valeur montante partait dans une copie jetable")
    })

    it('chemin Coffee (templateLang "js") : même découpage par gestionnaire', async function () {
      const batch = await gestionnaires(
        "<script>\n  item = 'du script'\n  $list = [1, 2]\n</script>\n{for item in $list}<button @click={console.log(item)}>x</button>{end}\n<button @click={item = 'clic'}>go</button>\n",
        { templateLang: 'js' },
      )
      assert.match(batch, /item = __arr_0\[__idx_0\]/, 'la reconstruction de la boucle reste locale')
      assert.match(batch, /return item = 'clic'/, 'le gestionnaire de dehors écrit la var du <script>')
      assert.equal(
        (batch.match(/^\s*var .*\bitem\b/gm) ?? []).length, 1,
        "AVANT : `var item;` en tête du gestionnaire de dehors — la sienne, écrite puis jetée",
      )
    })
  })
})

describe('gestionnaires — l\'écriture perdue, mesurée au clic', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('var du <script> homonyme d\'une variable de boucle : le clic l\'écrit vraiment', async function () {
    const src = [
      '<script>',
      "  item = 'du script'",
      "  $vu = ''",
      "  $list = ['a', 'b']",
      '  lire = -> item',
      '</script>',
      '<div>',
      '{for item in $list}',
      '<p class="row">{item}</p>',
      '<button class="dans" @click={$vu = item}>dans</button>',
      '{end}',
      "<button class=\"hors\" @click={item = 'clic'; $vu = lire()}>hors</button>",
      '<p class="vu">{$vu}</p>',
      '</div>',
    ].join('\n')

    const root = mjsTmp('hgcl')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hgcl.mjs'), src)

    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

    const window: any = new Window({ url: 'http://localhost/' })
    const document: any = window.document
    const errors: any[] = []
    window.addEventListener('error', (e: any) => errors.push(e.error ?? e.message))
    const stripEsm = (s: string) => s
      .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
      .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
      .replace(/\bexport\s+default\s+/g, '')
      .replace(/\bexport\s+/g, '')
      .replace(/import\.meta\.url/g, "'http://localhost/'")
    const files = readdirSync(outDir)
    const coreFile = files.find((f: string) => /^mjs_core-/.test(f))
    const compFile = files.find((f: string) => /^hgcl-/.test(f))
    window.eval(`${stripEsm(readFileSync(join(outDir, coreFile!), 'utf-8'))}\nglobalThis.µ = µ;\n${stripEsm(readFileSync(join(outDir, compFile!), 'utf-8'))}`)
    document.body.innerHTML = '<mjs-hgcl></mjs-hgcl>'
    const el: any = document.body.firstElementChild
    await new Promise(r => setTimeout(r, 80))

    // ce composant a DEUX groupes de gestionnaires (celui de la boucle, qui voit `item`,
    // et celui de dehors, qui voit la var du <script>) : les deux lots sont compilés à part
    // et écrits par INDEX dans `_mjs_inline` — le routage d'événement doit rester juste
    assert.equal(el._shadow.querySelectorAll('.row').length, 2)
    assert.equal(el._shadow.querySelectorAll('.dans').length, 2)

    el._shadow.querySelector('.dans').click()
    await new Promise(r => setTimeout(r, 30))
    assert.equal(
      el._shadow.querySelector('.vu').textContent.trim(), 'a',
      'le gestionnaire DANS la boucle garde SON item reconstruit',
    )

    el._shadow.querySelector('.hors').click()
    await new Promise(r => setTimeout(r, 30))
    assert.equal(errors.length, 0, errors.map(String).join(' / '))
    assert.equal(
      el._shadow.querySelector('.vu').textContent.trim(), 'clic',
      "AVANT : `item` déclarée locale au handler → la var du <script> gardait 'du script'",
    )
  })
})
