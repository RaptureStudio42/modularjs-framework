// Le carnet des objets gardés n'entre dans le cœur que pour l'appli dont une unité range un objet du magasin (`$$x`) ou d'un état de
// module (`µ$$x`) là où une variable `$` d'un composant peut le prendre : affectation d'une variable ou d'une prop, nom qui le garde,
// fonction qui le rend, boucle du script, fonction de l'appli qui le reçoit, ligne d'un `{for}` du magasin passée à un composant. Une
// appli qui ne fait que lire le magasin pour l'écran et en écrire les champs, ou qui n'a pas de magasin, n'en reçoit rien, et ses
// lignes d'avant reviennent à l'octet (blocs `<no-ledger>`)
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, projectBlocks, terminateSharedWorkerPool } from '../src/bundler/index.js'

const MAGASIN = "$$m = [{ id: 1, nom: 'a', adr: { ville: 'v' } }]\n"
const ECRAN   = '<p>{$sel?.nom}</p>\n'
const AVEC: Record<string, Record<string, string>> = {
  'variable prise dans le magasin':       { 'a.mjs': '<script>\n  ' + MAGASIN + '  $sel = null\n</script>\n\n' + ECRAN + '<button @click={$sel = $$m[0]}>s</button>\n' },
  'prop prise dans le magasin':           { 'c.mjs': '<p>{$item?.nom}</p>\n', 'a.mjs': '<script>\n  ' + MAGASIN + '</script>\n\n<@c item={$$m[0]}></@c>\n' },
  'ligne du magasin passée à un composant': { 'c.mjs': '<p>{$item?.nom}</p>\n', 'a.mjs': '<script>\n  ' + MAGASIN + '</script>\n\n{for r in $$m}<@c item={r}></@c>{end}\n' },
  'fonction de module qui le rend':       { 'm.module.civet.mjs': MAGASIN + 'export premier = -> $$m[0]\n', 'a.mjs': "@import premier 'm.module.civet.mjs'\n\n<script>\n  $sel = null\n</script>\n\n" + ECRAN + '<button @click={$sel = premier()}>s</button>\n' },
  'nom qui garde un élément trouvé':      { 'a.mjs': '<script>\n  ' + MAGASIN + '  $sel = null\n  choisir = ->\n    t = $$m.find((x) -> x.id is 1)\n    $sel = t\n</script>\n\n' + ECRAN + '<button @click={choisir()}>s</button>\n' },
  'boucle du script':                     { 'a.mjs': '<script>\n  ' + MAGASIN + '  $sel = null\n  choisir = ->\n    for t of $$m\n      $sel = t\n</script>\n\n' + ECRAN + '<button @click={choisir()}>s</button>\n' },
  "fonction de l'appli qui le reçoit":    { 'a.mjs': '<script>\n  ' + MAGASIN + '  $sel = null\n  garder = (t) -> $sel = t\n</script>\n\n' + ECRAN + '<button @click={garder($$m[0])}>s</button>\n' },
  'ligne du magasin gardée par son gestionnaire': { 'a.mjs': '<script>\n  ' + MAGASIN + '  $sel = null\n</script>\n\n' + ECRAN + '{for r in $$m}<button @click={$sel = r}>s</button>{end}\n' },
  'ligne du magasin passée à une fonction':  { 'a.mjs': '<script>\n  ' + MAGASIN + '  $sel = null\n  garder = (t) -> $sel = t\n</script>\n\n' + ECRAN + '{for r in $$m}<button @click={garder(r)}>s</button>{end}\n' },
  'élément d\'une valeur dérivée':          { 'c.mjs': '<script>\n  $sel = null\n</script>\n\n<p>{$sel?.nom}</p>\n<button @click={$sel = $items[0]}>s</button>\n', 'a.mjs': '<script>\n  ' + MAGASIN + '  $vis = $$m.filter((x) -> x.id > 0)\n</script>\n\n<@c items={$vis}></@c>\n' },
  'valeur dérivée par une méthode de JavaScript': { 'c.mjs': '<script>\n  $sel = null\n</script>\n\n<p>{$sel?.nom}</p>\n<button @click={$sel = $items[0]}>s</button>\n', 'a.mjs': '<script>\n  $$o = { a: { nom: \'a\' } }\n  $vis = Object.values($$o)\n</script>\n\n<@c items={$vis}></@c>\n' },
  'état de module rendu par une fonction': { 'p.module.civet.mjs': "export µ$$panier = { items: [{ nom: 'a' }] }\nexport premierP = -> µ$$panier.items[0]\n", 'a.mjs': "@import premierP 'p.module.civet.mjs'\n\n<script>\n  $sel = null\n</script>\n\n" + ECRAN + '<button @click={$sel = premierP()}>s</button>\n' },
  'objet gardé dont un champ est incrémenté': { 'a.mjs': '<script>\n  ' + MAGASIN + '  $sel = null\n</script>\n\n' + ECRAN + '<button @click={$sel = $$m[0]}>s</button>\n<button @click={$$m[0].id++}>+</button>\n' }
}
const SANS: Record<string, Record<string, string>> = {
  "magasin lu pour l'écran et écrit": {
    'taches.module.civet.mjs': "$$taches = [{ id: 1, nom: 'a', fait: false, adr: { ville: 'v' } }]\n$$compte = 0\nexport ajouter = (nom) -> $$taches.push({ id: $$taches.length + 1, nom, fait: false, adr: { ville: '' } })\nexport renommer = (i, v) -> $$taches[i].nom = v\n",
    'liste.mjs': "@import ajouter renommer 'taches.module.civet.mjs'\n\n<script>\n  $filtre = ''\n  $total = $$taches.length\n</script>\n\n<h1>{$$taches.length} tâches, {$$compte} clics, {$total}</h1>\n<label>filtre <input bind:value={$filtre}></label>\n{if $$taches.length > 3}<p>beaucoup</p>{end}\n{for t in $$taches}<li class={t.fait ? 'f' : ''}>{t.nom} {t.adr.ville}<button @click={t.fait = !t.fait}>ok</button></li>{end}\n<button @click={ajouter('n' + $$taches.length)}>a</button>\n<button @click={renommer(0, 'Z')}>r</button>\n<button @click={$$compte = $$compte + 1}>c</button>\n<button @click={$$taches[0].adr.ville = 'W'}>d</button>\n<button @click={$$compte += 1}>e</button>\n"
  },
  'valeurs simples lues dans le magasin': { 'a.mjs': "<script>\n  " + MAGASIN + "  $$prix = 3\n  $$user = { nom: 'u' }\n  $n = 0\n  $ok = false\n  fmt = (l) -> l.toUpperCase()\n</script>\n\n<p>{$n} {$ok} {fmt(µlang)} {$$m.length}</p>\n<button @click={$n = $$m.length}>a</button>\n<button @click={$n = $$prix * 2}>b</button>\n<button @click={$ok = !$$user}>c</button>\n<button @click={$$m = [...$$m, { id: 2, nom: 'b', adr: { ville: 'w' } }]}>d</button>\n<button @click={$n = if $$prix > 2 then 1 else 0}>e</button>\n" },
  'sans magasin': { 'a.mjs': '<script>\n  $n = 0\n  $o = { a: 1 }\n</script>\n\n<p>{$n} {$o.a}</p>\n<button @click={$n++}>+</button>\n<button @click={$o.a = 2}>a</button>\n' },
  // la variable de travail d'un `++` / `--` ne reçoit que l'ancienne valeur, que l'opérateur convertit en nombre
  'magasin et état de module incrémentés': {
    'p.module.civet.mjs': "export µ$$compte = { n: 0 }\nexport compter = ->\n  µ$$compte.n++\n  null\n",
    'a.mjs': "@import compter 'p.module.civet.mjs'\n\n<script>\n  " + MAGASIN + "  $$c = 0\n  moins = ->\n    $$c--\n    null\n</script>\n\n<p>{$$c} {$$m[0].id}</p>\n<button @click={$$c++}>a</button>\n<button @click={--$$c}>b</button>\n<button @click={moins()}>c</button>\n<button @click={$$m[0].id++}>d</button>\n<button @click={compter()}>e</button>\n"
  }
}

// le cœur d'une construction de développement (non minifié) : le carnet s'y lit à sa fonction
async function coeur(nom: string, sources: Record<string, string>): Promise<string> {
  const root   = mjsTmp('magasin-carnet-' + nom.replace(/\W+/g, '-'))
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(sources)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const f = readdirSync(outDir).find((x) => /^mjs_core-.*\.js$/.test(x))
  return readFileSync(join(outDir, f as string), 'utf-8')
}

describe("magasin : le carnet des objets gardés n'entre que pour l'appli qui en a besoin", function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, sources] of Object.entries(AVEC)) it(`le cœur l'a : ${nom}`, async () => {
    const c = await coeur(nom, sources)
    assert.ok(c.includes('µ._mjs_ledgerSees = function'), nom)
    assert.ok(!/<\/?(?:no-)?ledger>/.test(c), 'marques retirées')
  })
  for (const [nom, sources] of Object.entries(SANS)) it(`le cœur ne l'a pas : ${nom}`, async () => {
    const c = await coeur(nom, sources)
    assert.ok(!c.includes('_mjs_ledger'), nom)
    assert.ok(!/<\/?(?:no-)?ledger>/.test(c), 'marques retirées')
  })

  it("sans le carnet, les fichiers du runtime reprennent leurs lignes d'avant, sans marque ni appel au carnet", () => {
    for (const f of ['mjs_init.ts', 'mjs_element.ts', 'mjs_store_globals.ts', 'mjs_state.ts']) {
      const texte = readFileSync(join(import.meta.dirname, '../src/runtime', f), 'utf-8')
      const sans  = projectBlocks(texte, { ledger: false })
      assert.ok(texte.includes('// <ledger>'), f)
      assert.ok(!/ledger/i.test(sans.replace(/^.*\/\/.*$/gm, '')), f + ' : aucun code du carnet')
      assert.ok(!sans.includes('<no-ledger>') && !sans.includes('<ledger>'), f + ' : marques retirées')
    }
    const magasin = projectBlocks(readFileSync(join(import.meta.dirname, '../src/runtime/mjs_store_globals.ts'), 'utf-8'), { ledger: false })
    assert.ok(/^function _mjsStoreTenants\(rootKey, w\) \{$/m.test(magasin), 'la recherche des détenteurs reprend son texte')
  })
})
