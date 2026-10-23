// `@flip` dans un `{for}` : l'étiquette `mjs-key` posée sur la balise est la clé du `by` du `{for}`, lue sur l'élément comme la liste la lit
// pour reconnaître ses lignes. Sans `by`, l'étiquette reste l'`id` de l'élément, à défaut l'indice de création de la ligne.
// Quand la ligne porte plusieurs balises `@flip`, à n'importe quelle profondeur de son gabarit, l'étiquette de chacune se termine par `#` et sa
// place parmi ces balises : les balises d'un même `{if}` … `{else}` se partagent les mêmes places (une seule est là à la fois), une balise
// d'une liste imbriquée compte pour cette liste et non pour la liste qui l'enveloppe.
// Dans une liste imbriquée, l'étiquette commence par celle de chaque ligne qui l'enveloppe, de la plus extérieure à la plus intérieure,
// séparées par le caractère `\u241f` (␟) : deux lignes intérieures de même clé sous deux lignes extérieures ne portent pas la même étiquette.
// Le comportement au navigateur est dans flip-cle-du-by-browser.test.ts, flip-places-racines-browser.test.ts et
// flip-identite-profonde-browser.test.ts : ici, le code émis.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('@flip — étiquette mjs-key d\'une ligne de {for} : la clé du `by`', function () {
  this.timeout(20000)
  after(async () => { await terminateSharedWorkerPool() })

  async function compiler(source: string): Promise<{ errors: string[], code: string }> {
    const root   = mjsTmp('flipcle')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'comp.mjs'), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    let code      = ''
    if (stats.errors.length === 0) code = readFileSync(join(outDir, readdirSync(outDir).find((f) => /^comp-/.test(f))!), 'utf-8')
    await bundler.close()
    return { errors: stats.errors.map((e) => e.message), code }
  }

  const SCRIPT = '<script>\n  $rows = [{ cid: 1, id: 7 }, { cid: 2, id: 7 }]\n</script>\n'

  // l'expression de l'étiquette, telle que la ligne la pose à sa création : `_mjs_updAttrNode(balise, "mjs-key", (…))`, ou le gabarit de texte
  // `…` quand l'étiquette porte une place
  const etiquettes = (code: string): string[] => Array.from(code.matchAll(/_mjs_updAttrNode\(\w+, "mjs-key", (?:\((.*?)\)|(`.*?`))(?:, 1)?\);/g), (m) => m[1] ?? m[2])

  it('`by cid` : l\'étiquette est la clé `cid` de l\'élément, jamais son `id`', async () => {
    const r = await compiler(SCRIPT + '<ul>\n  {for s in $rows by cid}\n    <li @flip=200>{s.cid}</li>\n  {end}\n</ul>\n')
    assert.deepEqual(r.errors, [])
    assert.deepEqual(etiquettes(r.code), ['s?.cid ?? index'])
  })

  it('`by cid` et un index nommé : le repli d\'une clé absente est l\'index de la ligne, sous son nom', async () => {
    const r = await compiler(SCRIPT + '<ul>\n  {for i, s in $rows by cid}\n    <li @flip=200>{s.cid}</li>\n  {end}\n</ul>\n')
    assert.deepEqual(r.errors, [])
    assert.deepEqual(etiquettes(r.code), ['s?.cid ?? i'])
  })

  it('sans `by` : l\'étiquette reste l\'`id` de l\'élément, à défaut l\'indice de création', async () => {
    const r = await compiler(SCRIPT + '<ul>\n  {for s in $rows}\n    <li @flip=200>{s.cid}</li>\n  {end}\n</ul>\n')
    assert.deepEqual(r.errors, [])
    assert.deepEqual(etiquettes(r.code), ['s.id !== undefined ? s.id : index'])
  })

  it('une liste dans une liste : l\'étiquette de la ligne intérieure suit son `by` et commence par celle de la ligne extérieure', async () => {
    const source = '<script>\n  $groupes = [{ gid: 1, items: [{ iid: 1 }, { iid: 2 }] }]\n</script>\n{for g in $groupes by gid}\n  <ul>\n    {for it in g.items by iid}\n      <li @flip=200>{it.iid}</li>\n    {end}\n  </ul>\n{end}\n'
    const r = await compiler(source)
    assert.deepEqual(r.errors, [])
    assert.deepEqual(etiquettes(r.code), ['(g?.gid ?? _mjs_idx_0) + "\\u241f" + (it?.iid ?? index)'])
  })

  describe('une liste dans une liste : l\'étiquette de la ligne intérieure porte celle des lignes qui l\'enveloppent', function () {
    const SEP = ' + "\\u241f" + '
    const imbriquee = (entete: string, interieur: string, corps = '<li @flip=200>{it.iid}</li>') => `<script>\n  $groupes = [{ gid: 1, items: [{ iid: 1 }] }]\n</script>\n${entete}\n  <ul>\n    ${interieur}\n      ${corps}\n    {end}\n  </ul>\n{end}\n`

    it('trois niveaux : la ligne de chaque niveau, du plus extérieur au plus intérieur, avec son propre indice de repli', async () => {
      const source = '<script>\n  $a = [{ aid: 1, bs: [{ bid: 1, cs: [{ cid: 1 }] }] }]\n</script>\n{for a in $a by aid}\n  {for b in a.bs by bid}\n    {for c in b.cs by cid}\n      <li @flip=200>{c.cid}</li>\n    {end}\n  {end}\n{end}\n'
      const r = await compiler(source)
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiquettes(r.code), ['(a?.aid ?? _mjs_idx_0)' + SEP + '(b?.bid ?? _mjs_idx_1)' + SEP + '(c?.cid ?? index)'])
    })

    it('une ligne extérieure sans `by` : son `id`, à défaut son indice, comme pour une liste seule', async () => {
      const r = await compiler(imbriquee('{for g in $groupes}', '{for it in g.items by iid}'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiquettes(r.code), ['(g.id !== undefined ? g.id : _mjs_idx_0)' + SEP + '(it?.iid ?? index)'])
    })

    it('une ligne intérieure sans `by` : son `id`, à défaut son indice, après celle de la ligne extérieure', async () => {
      const r = await compiler(imbriquee('{for g in $groupes by gid}', '{for it in g.items}'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiquettes(r.code), ['(g?.gid ?? _mjs_idx_0)' + SEP + '(it.id !== undefined ? it.id : index)'])
    })

    it('un index nommé à chaque niveau : le repli de la ligne intérieure est son index, celui de la ligne extérieure reste interne', async () => {
      const r = await compiler(imbriquee('{for j, g in $groupes by gid}', '{for i, it in g.items by iid}'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiquettes(r.code), ['(g?.gid ?? _mjs_idx_0)' + SEP + '(it?.iid ?? i)'])
    })

    it('le même nom d\'élément aux deux niveaux : la ligne extérieure, masquée, ne compte que par son indice', async () => {
      const r = await compiler(imbriquee('{for x in $groupes by gid}', '{for x in x.items by iid}', '<li @flip=200>{x.iid}</li>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiquettes(r.code), ['_mjs_idx_0' + SEP + '(x?.iid ?? index)'])
    })

    it('l\'index de la ligne intérieure reprend le nom de l\'élément extérieur : il le masque de même', async () => {
      const r = await compiler(imbriquee('{for g in $groupes by gid}', '{for g, it in g.items by iid}'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiquettes(r.code), ['_mjs_idx_0' + SEP + '(it?.iid ?? g)'])
    })

    it('l\'élément d\'une ligne extérieure en masque un autre plus bas : seul celui qui est masqué se replie sur son indice', async () => {
      const source = '<script>\n  $a = [{ aid: 1, bs: [{ bid: 1, cs: [{ cid: 1 }] }] }]\n</script>\n{for a in $a by aid}\n  {for b in a.bs by bid}\n    {for a in b.cs by cid}\n      <li @flip=200>{a.cid}</li>\n    {end}\n  {end}\n{end}\n'
      const r = await compiler(source)
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiquettes(r.code), ['_mjs_idx_0' + SEP + '(b?.bid ?? _mjs_idx_1)' + SEP + '(a?.cid ?? index)'])
    })

    it('la balise de la ligne extérieure garde l\'étiquette d\'une liste seule', async () => {
      const source = '<script>\n  $groupes = [{ gid: 1, items: [{ iid: 1 }] }]\n</script>\n{for g in $groupes by gid}\n  <section @flip=200>{g.gid}</section>\n  {for it in g.items by iid}\n    <li @flip=200>{it.iid}</li>\n  {end}\n{end}\n'
      const r = await compiler(source)
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiquettes(r.code).sort(), ['(g?.gid ?? _mjs_idx_0)' + SEP + '(it?.iid ?? index)', 'g?.gid ?? index'])
    })

    it('plusieurs balises dans la ligne intérieure : la place suit l\'étiquette de la ligne extérieure', async () => {
      const r = await compiler(imbriquee('{for g in $groupes by gid}', '{for it in g.items by iid}', '<li @flip=200>{it.iid}</li>\n      <li @flip=200>{it.iid}</li>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiquettes(r.code).sort(), ['`${(g?.gid ?? _mjs_idx_0)' + SEP + '(it?.iid ?? index)}#0`', '`${(g?.gid ?? _mjs_idx_0)' + SEP + '(it?.iid ?? index)}#1`'])
    })

    it('une liste dans un `{if}` de la ligne extérieure : la chaîne est la même', async () => {
      const source = '<script>\n  $groupes = [{ gid: 1, on: true, items: [{ iid: 1 }] }]\n</script>\n{for g in $groupes by gid}\n  {if g.on}\n    {for it in g.items by iid}\n      <li @flip=200>{it.iid}</li>\n    {end}\n  {end}\n{end}\n'
      const r = await compiler(source)
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiquettes(r.code), ['(g?.gid ?? _mjs_idx_0)' + SEP + '(it?.iid ?? index)'])
    })
  })

  describe('plusieurs balises racines : chacune porte sa place dans le gabarit de la ligne', function () {
    const ligne = (corps: string, entete = '{for s in $rows by cid}') => SCRIPT + '<ul>\n  ' + entete + '\n' + corps + '\n  {end}\n</ul>\n'
    const A = '`${s?.cid ?? index}#'
    // les étiquettes des blocs sont émises après celles de la ligne : l'ordre du code n'est pas celui du gabarit
    const etiq = (code: string): string[] => etiquettes(code).sort()

    it('deux balises côte à côte : les places 0 et 1', async () => {
      const r = await compiler(ligne('    <li @flip=200>{s.cid}</li>\n    <li @flip=200>{s.cid}</li>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '1`'])
    })

    it('deux balises sous un même `{if}` : les places 0 et 1', async () => {
      const r = await compiler(ligne('    {if s.cid > 1}\n      <li @flip=200>{s.cid}</li>\n      <li @flip=200>{s.cid}</li>\n    {end}'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '1`'])
    })

    it('chacune sous son `{if}` : les places 0 et 1, trois balises 0, 1 et 2', async () => {
      const deux = await compiler(ligne('    {if s.cid > 1}<li @flip=200>{s.cid}</li>{end}\n    {if s.cid > 2}<li @flip=200>{s.cid}</li>{end}'))
      assert.deepEqual(deux.errors, [])
      assert.deepEqual(etiq(deux.code), [A + '0`', A + '1`'])
      const trois = await compiler(ligne('    <li @flip=200>{s.cid}</li>\n    {if s.cid > 1}<li @flip=200>{s.cid}</li>{end}\n    <li @flip=200>{s.cid}</li>'))
      assert.deepEqual(trois.errors, [])
      assert.deepEqual(etiq(trois.code), [A + '0`', A + '1`', A + '2`'])
    })

    it('un `{if}` avec `{else}`, une balise par branche : une seule place, donc l\'étiquette de la ligne sans suffixe', async () => {
      const r = await compiler(ligne('    {if s.cid > 1}<li @flip=200>{s.cid}</li>{else}<li @flip=200>{s.cid} bis</li>{end}'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), ['s?.cid ?? index', 's?.cid ?? index'])
    })

    it('un `{if}` à deux balises et un `{else}` à une : les branches se partagent les places 0 et 1, puis 0', async () => {
      const r = await compiler(ligne('    {if s.cid > 1}\n      <li @flip=200>{s.cid}</li>\n      <li @flip=200>{s.cid}</li>\n    {else}\n      <li @flip=200>{s.cid} bis</li>\n    {end}'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '0`', A + '1`'])
    })

    it('un `{if}` à deux balises et un `{else}` à une, suivi d\'une balise fixe : le bloc occupe les places de sa plus longue branche, la balise fixe a la 2', async () => {
      const r = await compiler(ligne('    {if s.cid > 1}\n      <li @flip=200>{s.cid}</li>\n      <li @flip=200>{s.cid}</li>\n    {else}\n      <li @flip=200>{s.cid} bis</li>\n    {end}\n    <li @flip=200>{s.cid}</li>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '0`', A + '1`', A + '2`'])
    })

    it('un `{if}` avec `{elsif}` et `{else}` suivi d\'une balise fixe : les trois branches partagent la place 0, la balise fixe a la 1', async () => {
      const r = await compiler(ligne('    {if s.cid > 2}<li @flip=200>a</li>{elsif s.cid > 1}<li @flip=200>b</li>{else}<li @flip=200>c</li>{end}\n    <li @flip=200>{s.cid}</li>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '0`', A + '0`', A + '1`'])
    })

    it('un `{if}` dans un `{if}` : les places se suivent, chacune est à elle', async () => {
      const r = await compiler(ligne('    {if s.cid > 0}\n      <li @flip=200>a</li>\n      {if s.cid > 1}<li @flip=200>b</li>{end}\n      <li @flip=200>c</li>\n    {end}'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '1`', A + '2`'])
    })

    it('un `{key}` entre deux balises fixes : les places 0, 1 et 2', async () => {
      const r = await compiler(ligne('    <li @flip=200>a</li>\n    {key s.cid}<li @flip=200>b</li>{end}\n    <li @flip=200>c</li>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '1`', A + '2`'])
    })

    it('une balise plus profonde que la racine a, elle aussi, sa place : les places se suivent dans l\'ordre du gabarit', async () => {
      const r = await compiler(ligne('    <li @flip=200>a</li>\n    <li @flip=200>b <span @flip=200>c</span></li>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '1`', A + '2`'])
    })

    it('une balise racine et une plus profonde : les places 0 et 1, plus d\'étiquette commune', async () => {
      const r = await compiler(ligne('    <li @flip=200>a <span @flip=200>b</span></li>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '1`'])
    })

    it('deux balises sous une même balise de la ligne : les places 0 et 1', async () => {
      const r = await compiler(ligne('    <section><h4 @flip=200>a</h4><p @flip=200>b</p></section>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '1`'])
    })

    it('une seule balise plus profonde que la racine : l\'étiquette de la ligne sans suffixe', async () => {
      const r = await compiler(ligne('    <section><h4>a</h4><p @flip=200>b</p></section>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), ['s?.cid ?? index'])
    })

    it('des balises à plusieurs profondeurs : les places suivent l\'ordre du gabarit, balise avant ses enfants', async () => {
      const r = await compiler(ligne('    <section @flip=200><div><h4 @flip=200>a</h4></div><p @flip=200>b</p></section>\n    <footer @flip=200>c</footer>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '1`', A + '2`', A + '3`'])
    })

    it('sous une balise, un `{if}` et son `{else}` à une balise chacun, suivis d\'une balise fixe : les branches partagent la place 0, la fixe a la 1', async () => {
      const r = await compiler(ligne('    <section>{if s.cid > 1}<h4 @flip=200>a</h4>{else}<h4 @flip=200>b</h4>{end}<p @flip=200>c</p></section>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '0`', A + '1`'])
    })

    it('sous une balise, un `{if}` dans un `{if}` et un `{key}` : chaque balise a sa place', async () => {
      const r = await compiler(ligne('    <section>{if s.cid > 0}<h4 @flip=200>a</h4>{if s.cid > 1}<h5 @flip=200>b</h5>{end}{end}{key s.cid}<p @flip=200>c</p>{end}</section>'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), [A + '0`', A + '1`', A + '2`'])
    })

    it('une balise de la liste imbriquée ne compte pas pour la liste qui l\'enveloppe', async () => {
      const source = '<script>\n  $groupes = [{ gid: 1, items: [{ iid: 1 }] }]\n</script>\n{for g in $groupes by gid}\n  <section @flip=200>\n    <ul>\n      {for it in g.items by iid}\n        <li @flip=200>{it.iid}</li>\n      {end}\n    </ul>\n  </section>\n{end}\n'
      const r = await compiler(source)
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), ['(g?.gid ?? _mjs_idx_0) + "\\u241f" + (it?.iid ?? index)', 'g?.gid ?? index'])
    })

    it('sans `by` : l\'`id` de l\'élément (à défaut l\'indice) suivi de la place', async () => {
      const r = await compiler(ligne('    <li @flip=200>a</li>\n    <li @flip=200>b</li>', '{for s in $rows}'))
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), ['`${s.id !== undefined ? s.id : index}#0`', '`${s.id !== undefined ? s.id : index}#1`'])
    })

    it('une liste dans une liste : chaque liste compte ses propres places', async () => {
      const source = '<script>\n  $groupes = [{ gid: 1, items: [{ iid: 1 }] }]\n</script>\n{for g in $groupes by gid}\n  <ul>\n    {for it in g.items by iid}\n      <li @flip=200>{it.iid}</li>\n      <li @flip=200>{it.iid}</li>\n    {end}\n  </ul>\n  <p @flip=200>{g.gid}</p>\n{end}\n'
      const r = await compiler(source)
      assert.deepEqual(r.errors, [])
      assert.deepEqual(etiq(r.code), ['`${(g?.gid ?? _mjs_idx_0) + "\\u241f" + (it?.iid ?? index)}#0`', '`${(g?.gid ?? _mjs_idx_0) + "\\u241f" + (it?.iid ?? index)}#1`', 'g?.gid ?? index'])
    })
  })
})
