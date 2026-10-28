// UN HANDLER PEUT ENFIN ÉCRIRE DANS UNE VARIABLE ORDINAIRE DU `<script>`.
//
// Le batch `_mjs_inline` est compilé À PART du `<script>` composant : sa passe
// d'auto-déclaration ne connaissait AUCUN des noms déclarés à côté, alors qu'elle vit dans
// le MÊME corps de fonction (le handler les voit par closure). Elle posait donc un `let`
// local sur chaque écriture — deux pannes, aucune signalée :
//   · `@click={n = 'b'}` écrivait dans une copie jetable : l'écriture était PERDUE, sans un mot ;
//   · `@click={n = n + 1}` levait « Cannot access 'n' before initialization » au premier clic
//     (l'initialiseur du `let` lit la variable encore dans sa zone morte).
// C'est ce qui rendait `µtoggle(n, 'a', 'b')` inutilisable sur une variable nue.
//
// Le remède : passer au batch les vars top-level du `<script module>` ET du `<script>`,
// MOINS les noms que le template introduit lui-même dans le handler (variable et index de
// chaque `{for}`, que le squelette de reconstruction réassigne en tête) — sans ce filtre,
// un `<script>` portant un homonyme de la variable de boucle se ferait écraser à chaque clic.
// Le dernier cas (`nom` jamais déclaré NULLE PART) reste une faute, mais elle est désormais
// refusée AU BUILD au lieu d'attendre le premier clic.

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'

/** le corps du batch `_mjs_inline` seul — jamais le `<script>` qui le précède */
async function batchInline(src: string): Promise<string> {
  const { output } = await transpile(src, { moduleName: 'card' })
  const debut = output.indexOf('_mjs_inline = [')
  assert.ok(debut > 0, 'aucun batch _mjs_inline dans la sortie')
  const fin = output.indexOf('\n]', debut)   // le crochet fermant du BATCH, seul en tête de ligne
  return output.slice(debut, fin > 0 ? fin : undefined)
}

const attendre = (ms = 30) => new Promise((r) => setTimeout(r, ms))

/** le composant `card` construit en développement (le cœur, puis le composant) ou en production (le manifeste seul), monté dans happy-dom */
async function monter(source: string, prod: boolean): Promise<{ win: any, ombre: any }> {
  const root      = mjsTmp(`handler-vars-${prod ? 'prod' : 'dev'}`)
  const srcDir    = join(root, 'src')
  const outDir    = join(root, 'out')
  const manifeste = join(root, 'bundle.js')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'card.mjs'), source)
  const bundler = new Bundler(prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any : { sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste })
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code = prod ? stripEsm(readFileSync(manifeste, 'utf-8')) : readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  const win: any = new Window({ url: 'http://localhost/' })
  win.eval(code)
  win.document.body.innerHTML = '<mjs-card></mjs-card>'
  await attendre(80)
  const el: any = win.document.body.firstElementChild
  return { win, ombre: el._shadow || el.shadowRoot }
}

describe('handlers — les variables ordinaires du <script>', function () {
  after(async () => { await terminateSharedWorkerPool() })

  it('une écriture nue vise la var du <script>, elle n\'en déclare plus une copie locale', async function () {
    const batch = await batchInline("<script>\n  n = 'a'\n</script>\n<button @click={n = 'b'}>x</button>\n")
    assert.match(batch, /return n = 'b'/)
    assert.doesNotMatch(batch, /let n\b/, "AVANT : `let n = 'b'` — l'écriture partait dans une copie jetée à la sortie du handler")
  })

  it('une lecture-écriture ne lève plus au premier clic', async function () {
    const batch = await batchInline("<script>\n  compteur = 0\n</script>\n<button @click={compteur = compteur + 1}>x</button>\n")
    assert.match(batch, /return compteur = compteur \+ 1/)
    assert.doesNotMatch(batch, /let compteur\b/, "AVANT : `let compteur = compteur + 1` — zone morte, « Cannot access before initialization »")
  })

  // une ligne pure d'un {for} de racine (elle ne lit que son élément et son indice) les relit sur l'entrée de la ligne
  // (`el._mjs_row._mjs_en`) ; le squelette en tête du handler les déclare toujours pour lui seul
  it('la variable de boucle reste LOCALE, même si le <script> porte un homonyme', async function () {
    const batch = await batchInline("<script>\n  item = 'du script'\n  $list = [1, 2]\n</script>\n{for item in $list}\n  <button @click={console.log(item)}>x</button>\n{end}\n")
    assert.match(batch, /let item = _mjs_ra_0\._mjs_it\b/, 'le squelette DOIT garder sa propre déclaration')
    assert.match(batch, /let index = _mjs_ra_0\._mjs_ix\b/)
  })

  // le comportement, pas la forme : le bouton d'une ligne lit l'élément de SA ligne, et le bouton hors de la boucle lit encore
  // l'homonyme du <script>, que les clics sur les lignes n'ont pas écrasé
  for (const prod of [false, true]) {
    it(`… au clic, en ${prod ? 'production' : 'développement'} : la ligne lit son élément, l'homonyme du <script> reste intact`, async function () {
      this.timeout(60000)
      const source = "<script>\n  item = 'du script'\n  $list = ['a', 'b']\n  $vu = ''\n</script>\n<p class=\"vu\">{$vu}</p>\n{for item in $list}\n  <button class=\"ligne\" @click={$vu = item}>{item}</button>\n{end}\n<button class=\"script\" @click={$vu = item}>script</button>\n"
      const { win, ombre } = await monter(source, prod)
      try {
        const vu     = () => ombre.querySelector('.vu').textContent
        const clique = async (b: any) => {
          b.dispatchEvent(new win.Event('click', { bubbles: true }))
          await attendre()
        }
        const lignes = Array.from(ombre.querySelectorAll('.ligne')) as any[]
        assert.deepEqual(lignes.map((b) => b.textContent), ['a', 'b'])
        await clique(lignes[1])
        assert.equal(vu(), 'b', 'la deuxième ligne lit son élément')
        await clique(lignes[0])
        assert.equal(vu(), 'a', 'la première ligne lit le sien')
        await clique(ombre.querySelector('.script'))
        assert.equal(vu(), 'du script', 'hors de la boucle, le nom est celui du <script>, jamais le dernier élément cliqué')
      }
      finally {
        await win.happyDOM.close()
      }
    })
  }

  it('une locale de travail du handler reste une locale', async function () {
    const batch = await batchInline('<button @click={tmp = 3; console.log(tmp)}>x</button>\n')
    assert.match(batch, /let tmp = 3/, 'un nom qui ne se relit pas dans sa propre valeur est une locale parfaitement saine')
  })

  it('un nom que RIEN ne déclare et qui se relit : refusé au build', async function () {
    await assert.rejects(
      () => transpile("<button @click={n = (n === 'a' ? 'b' : 'a')}>x</button>\n", { moduleName: 'card' }),
      /se relit dans sa propre déclaration/,
    )
  })

  it('le message nomme la variable et les deux issues', async function () {
    await assert.rejects(
      () => transpile("<button @click={sens = (sens === 'asc' ? 'desc' : 'asc')}>x</button>\n", { moduleName: 'card' }),
      (e: Error) => {
        assert.match(e.message, /« sens »/)
        assert.match(e.message, /sens = …/,   'doit proposer la déclaration dans le <script>')
        assert.match(e.message, /« \$sens »/, 'doit proposer le symbole $ pour un état réactif')
        return true
      },
    )
  })

  it('une var du <script module> reste écrivable elle aussi', async function () {
    const batch = await batchInline("<script module>\n  partage = 0\n</script>\n<script>\n  local = 1\n</script>\n<button @click={partage = 7}>x</button>\n")
    assert.match(batch, /return partage = 7/)
    assert.doesNotMatch(batch, /let partage\b/)
  })

  // ─── limites de la première implémentation ────────────
  // La première écriture collectait les noms du `<script>` par une lecture LIGNE À LIGNE du
  // texte source. Trois trous, tous muets jusqu'au premier clic — fermés en lisant l'AST du
  // JS COMPILÉ (ce sont exactement les noms qui existeront dans le corps de fonction), et en
  // enregistrant TOUS les noms que le template introduit, pas seulement ceux d'un `{for}`.
  describe('les noms collectés — l\'AST du JS émis, jamais le texte', function () {
    it('un nom écrit dans un commentaire du <script> n\'est PAS un nom du script', async function () {
      const batch = await batchInline("<script>\n###\ndocVar = 'exemple dans un commentaire'\n###\nn = 1\n</script>\n<button @click={docVar = 'x'}>x</button>\n")
      assert.match(batch, /let docVar/, "AVANT : `docVar` était pris pour une var du script → `ReferenceError` au premier clic")
    })

    it('… ni un nom écrit dans une chaîne multi-ligne', async function () {
      const batch = await batchInline("<script>\n  txt = `\nlabel = 'texte, pas du code'\n`\n</script>\n<button @click={label = 'x'}>x</button>\n")
      assert.match(batch, /let label/)
    })

    // AVANT : le clic écrivait dans le `label` du <script> — muet, aucune erreur. Le nom reste local
    // au gestionnaire (sa copie, recréée depuis le {const}) ; le réaffecter est refusé au build,
    // puisque cette écriture-là serait perdue
    it('le nom d\'un {const} reste LOCAL au handler, même si le <script> a un homonyme', async function () {
      const batch = await batchInline("<script>\n  label = 'du script'\n  $items = [{ nom: 'premier' }]\n</script>\n{for i, item in $items}\n  {const label = item.nom}\n  <button @click={console.log(label)}>{label}</button>\n{end}\n")
      assert.match(batch, /let label = _mjs_cst_\d+/, 'la copie locale est recréée depuis le {const}')
      await assert.rejects(
        batchInline("<script>\n  label = 'du script'\n  $items = [{ nom: 'premier' }]\n</script>\n{for i, item in $items}\n  {const label = item.nom}\n  <button @click={label = 'ECRASE'}>{label}</button>\n{end}\n"),
        /réaffecte « label », posé par le HTML du composant/,
      )
    })

    it('… de même pour l\'argument d\'un {success} / {error}', async function () {
      const succes = await batchInline("<script>\n  data = 'du script'\n  $p = Promise.resolve(1)\n</script>\n{await $p}\n  <p>…</p>\n{success data}\n  <button @click={console.log(data)}>y</button>\n{end}\n")
      assert.match(succes, /let data = _mjs_aw_\d+/)
      const erreur = await batchInline("<script>\n  err = 'du script'\n  $p = Promise.resolve(1)\n</script>\n{await $p}\n  <p>…</p>\n{error err}\n  <button @click={console.log(err)}>y</button>\n{end}\n")
      assert.match(erreur, /let err = _mjs_aw_\d+/)
      await assert.rejects(
        batchInline("<script>\n  data = 'du script'\n  $p = Promise.resolve(1)\n</script>\n{await $p}\n  <p>…</p>\n{success data}\n  <button @click={data = 'x'}>y</button>\n{end}\n"),
        /réaffecte « data », posé par le HTML du composant/,
      )
    })

    it('une CONSTANTE du <script> réaffectée dans un handler est refusée au build', async function () {
      // `compteur := 0` compile en `const compteur` : l'écriture lèverait « Assignment to
      // constant variable » au premier clic. Autant le dire, en nommant l'opérateur à changer.
      await assert.rejects(
        () => transpile("<script>\n  compteur := 0\n</script>\n<button @click={compteur = compteur + 1}>x</button>\n", { moduleName: 'card' }),
        /déclaré CONSTANT/,
      )
    })

    it('un helper récursif local n\'est PAS pris pour une zone morte', async function () {
      // la relecture vit dans un CORPS DE FONCTION, jouée à l'appel : aucune TDZ possible
      const batch = await batchInline('<button @click={fact = (n) => n <= 1 ? 1 : n * fact(n - 1); console.log(fact(5))}>x</button>\n')
      assert.match(batch, /let fact/)
    })
  })

  // ─── le repli historique `templateLang: "js"` (handlers compilés en Coffee) ──
  // Coffee auto-déclare NATIVEMENT et n'a pas de `predeclared` : il pose un `var n;` en tête
  // du handler. On le laisse compiler, puis on retire la déclaration de trop sur l'AST de sa
  // sortie — même résultat que Civet, par l'autre bout.
  describe('le chemin Coffee (templateLang: "js")', function () {
    const batchCoffee = async (src: string): Promise<string> => {
      const { output } = await transpile(src, { moduleName: 'card', templateLang: 'js' })
      const debut = output.indexOf('_mjs_inline = [')
      return output.slice(debut, output.indexOf('\n]', debut))
    }

    it('une écriture nue vise la var du <script>', async function () {
      const batch = await batchCoffee("<script>\n  n = 'a'\n</script>\n<button @click={n = 'b'}>x</button>\n")
      assert.match(batch, /return n = 'b'/)
      assert.doesNotMatch(batch, /var n[,;]/, "AVANT : `var n;` local — écriture perdue, sans un mot")
    })

    it('une locale de travail garde son `var`', async function () {
      const batch = await batchCoffee('<button @click={tmp = 3; console.log(tmp)}>x</button>\n')
      assert.match(batch, /var tmp/)
    })

    it('la variable de boucle garde le sien', async function () {
      const batch = await batchCoffee("<script>\n  item = 'du script'\n  $list = [1, 2]\n</script>\n{for item in $list}\n  <button @click={console.log(item)}>x</button>\n{end}\n")
      assert.match(batch, /var [^;]*\bitem\b/)
    })
  })
})
