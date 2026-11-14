// `$x = $x` et `$$x = $$x`, la variable ou la clé du magasin écrite avec sa propre valeur, exactement, sont refusés à la construction,
// partout où le compilateur les lit : script du composant (Civet, CoffeeScript, JavaScript, TypeScript), gestionnaire du gabarit,
// `<script module>`, fichier d'un magasin ; avec ou sans espaces, `;`, parenthèses autour d'un côté, lue comme une valeur. Le message
// (français et anglais, au vouvoiement) cite la forme écrite à sa place `fichier.mjs:ligne:colonne` et dit d'écrire `µrefresh($x)`, ou
// `µrefresh($$x)` ; l'état de module (`µ$$x = µ$$x`), une nouvelle valeur dans la clé touchée ; une valeur dérivée, la variable `$`
// qu'elle lit. Une forme que seules les passes d'écriture lisent (`$x = $x as T`, écrite sur deux lignes) est citée à sa place, et
// dans le gabarit, le gestionnaire fautif, jamais une écriture ordinaire écrite avant lui. Restent des écritures ordinaires :
// `$o.a = $o.a`, `$x = $x + 1`, `$x = $x or 0`, `$x = $y`, `x = x`, `$x == $x`, une suite sur la ligne d'après, une chaîne ou un
// commentaire qui cite `$x = $x`

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang, getMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

// le fichier d'un magasin qui déclare l'état de module `µ$$nom`
const magasin = (nom: string): string => `export µ$$${nom} = { v: 0 }\n`

// un composant : son script (langage `lang`), puis son gabarit
const composant = (script: string, gabarit = '<p>{$x}</p>', lang = ''): string => `<script${lang ? ` lang="${lang}"` : ''}>\n${script}\n</script>\n${gabarit}\n`

// [sources, place citée, forme citée, remède dit]
const FAUTES: Record<string, [Record<string, string>, string, string, string]> = {
  civet: [{ 'aa-civet.mjs': composant('$x = 1\n@f = ->\n  $x = $x') }, 'aa-civet.mjs:4:3', '$x = $x', 'µrefresh($x)'],
  coffee: [{ 'aa-coffee.mjs': composant('$x = 1\n@f = ->\n  $x = $x', '<p>{$x}</p>', 'coffee') }, 'aa-coffee.mjs:4:3', '$x = $x', 'µrefresh($x)'],
  javascript: [{ 'aa-js.mjs': composant('$x = 1;\n@f = function() {\n  $x = $x;\n};', '<p>{$x}</p>', 'js') }, 'aa-js.mjs:4:3', '$x = $x', 'µrefresh($x)'],
  typescript: [{ 'aa-ts.mjs': composant('$x = 1;\n@f = function() {\n  $x = $x;\n};', '<p>{$x}</p>', 'ts') }, 'aa-ts.mjs:4:3', '$x = $x', 'µrefresh($x)'],
  sansEspaces: [{ 'aa-colle.mjs': composant('$x = 1\n@f = ->\n  $x=$x;') }, 'aa-colle.mjs:4:3', '$x = $x', 'µrefresh($x)'],
  parentheseADroite: [{ 'aa-pard.mjs': composant('$x = 1\n@f = ->\n  $x = ( $x )') }, 'aa-pard.mjs:4:3', '$x = $x', 'µrefresh($x)'],
  parentheseAGauche: [{ 'aa-parg.mjs': composant('$x = 1\n@f = ->\n  ($x) = $x') }, 'aa-parg.mjs:4:3', '$x = $x', 'µrefresh($x)'],
  lueCommeValeur: [{ 'aa-valeur.mjs': composant('$x = {n: 1}\n@f = -> window.v = ($x = $x).n') }, 'aa-valeur.mjs:3:21', '$x = $x', 'µrefresh($x)'],
  sousCondition: [{ 'aa-si.mjs': composant('$x = 1\n@f = (c) ->\n  $x = $x if c') }, 'aa-si.mjs:4:3', '$x = $x', 'µrefresh($x)'],
  gestionnaire: [{ 'aa-gest.mjs': composant('$x = 1', '<button @click={$x = $x}>{$x}</button>') }, 'aa-gest.mjs:4:17', '$x = $x', 'µrefresh($x)'],
  magasinScript: [{ 'aa-mag.mjs': composant('$$aak = {n: 1}\n@f = ->\n  $$aak = $$aak', '<p>{$$aak.n}</p>') }, 'aa-mag.mjs:4:3', '$$aak = $$aak', 'µrefresh($$aak)'],
  magasinGestionnaire: [{ 'aa-magg.mjs': composant('$$aak = {n: 1}', '<button @click={$$aak = $$aak}>{$$aak.n}</button>') }, 'aa-magg.mjs:4:17', '$$aak = $$aak', 'µrefresh($$aak)'],
  magasinScriptModule: [{ 'aa-sm.mjs': `<script module>\nwindow.f = ->\n  $$aak = $$aak\n</script>\n${composant('$$aak = {n: 1}', '<p>{$$aak.n}</p>')}` }, 'aa-sm.mjs:3:3', '$$aak = $$aak', 'µrefresh($$aak)'],
  magasinScriptModuleJs: [{ 'aa-smjs.mjs': `<script module lang="js">\nwindow.f = function() { $$aak = $$aak; };\n</script>\n${composant('$$aak = {n: 1}', '<p>{$$aak.n}</p>')}` }, 'aa-smjs.mjs:2:25', '$$aak = $$aak', 'µrefresh($$aak)'],
  magasinFichier: [{ 'aa-f.module.civet.mjs': `${magasin('aaf')}\nwindow.f = -> $$aak = $$aak\n` }, 'aa-f.module.civet.mjs:3:15', '$$aak = $$aak', 'µrefresh($$aak)'],
  magasinFichierCoffee: [{ 'aa-fc.module.coffee.mjs': `${magasin('aac')}\nwindow.f = -> $$aak = $$aak\n` }, 'aa-fc.module.coffee.mjs:3:15', '$$aak = $$aak', 'µrefresh($$aak)'],
  etatDeModule: [{ 'aa-etat.mjs': composant("@import µ$$aaq 'aa-q.module.civet.mjs'\n@f = -> µ$$aaq = µ$$aaq", '<p>{µ$$aaq.v}</p>'), 'aa-q.module.civet.mjs': magasin('aaq') }, 'aa-etat.mjs:3:9', 'µ$$aaq = µ$$aaq', 'µ$$aaq.lignes = [...µ$$aaq.lignes]'],
  deuxLignes: [{ 'aa-2l.mjs': composant('$x = 1\n@f = ->\n  $x =\n    $x') }, 'aa-2l.mjs:4:3', '$x = $x', 'µrefresh($x)'],
  typescriptAs: [{ 'aa-as.mjs': composant('$x = 1;\n@f = function() {\n  $x = $x as number;\n};', '<p>{$x}</p>', 'ts') }, 'aa-as.mjs:4:3', '$x = $x', 'µrefresh($x)'],
  magasinDeuxLignes: [{ 'aa-m2l.mjs': composant('$$aak = {n: 1}\n@f = ->\n  $$aak =\n    $$aak', '<p>{$$aak.n}</p>') }, 'aa-m2l.mjs:4:3', '$$aak = $$aak', 'µrefresh($$aak)'],
  gestionnaireApresUnCalcul: [{ 'aa-g2.mjs': composant('$x = 1', '<button @click={$x = $x + 1}>a</button>\n<button @click={$x = $x}>{$x}</button>') }, 'aa-g2.mjs:5:17', '$x = $x', 'µrefresh($x)'],
  magasinGestionnaireApresUnChemin: [{ 'aa-mg2.mjs': composant('$$aak = {n: 1}', '<button @click={$$aak = $$aak.n}>a</button>\n<button @click={$$aak = $$aak}>{$$aak.n}</button>') }, 'aa-mg2.mjs:5:17', '$$aak = $$aak', 'µrefresh($$aak)'],
  gestionnaireDeuxLignes: [{ 'aa-g2l.mjs': composant('$x = 1', '<button @click={$x =\n  $x}>{$x}</button>') }, 'aa-g2l.mjs:4:17', '$x = $x', 'µrefresh($x)'],
}

// les écritures ordinaires, à garder telles quelles
const PERMIS: Record<string, string> = {
  'aa-ok.mjs': composant(`$o = {a: 1}
$x = 1
$y = 2
x = 3
@f = ->
  $o.a = $o.a
  $x = $x + 1
  $x = $x or 0
  $x = $y
  x = x
  b = $x == $x
  s = '$x = $x'
  # $x = $x
  $x = $x
    .toString()
  null`, '<button @click={$x = $x + 1}>{$x}{$o.a}{$y}</button>'),
  'aa-okjs.mjs': composant('$x = 1;\n$y = 2;\n@f = function() {\n  // $x = $x\n  const s = "$x = $x";\n  $x = $y;\n  return $x === $x;\n};', '<p>{$x}</p>', 'js'),
}

async function construire(sources: Record<string, string>): Promise<string[]> {
  const root   = mjsTmp('auto-affectation')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(sources)) writeFileSync(join(srcDir, nom), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), derivedMode: 'precise' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  return stats.errors.map((e: any) => String(e.message))
}

// la forme citée et le remède, dans chaque langue
const fragments = (langue: string, forme: string, remede: string): string[] => langue === 'fr' ? [`« ${forme} » est refusé`, `« ${remede} »`] : [`"${forme}" is refused`, `"${remede.replace(/lignes/g, 'items')}"`]

describe('`$x = $x` et `$$x = $$x` refusés à la construction : « écrivez µrefresh($x) »', function () {
  this.timeout(300000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const langue of ['fr', 'en']) {
    describe(langue === 'fr' ? 'en français' : 'en anglais', function () {
      let erreurs: string[]
      before(async () => {
        const avant = getMessagesLang()
        try {
          setMessagesLang(langue as 'fr' | 'en')
          erreurs = await construire(Object.assign({}, ...Object.values(FAUTES).map(([sources]) => sources)))
        }
        finally {
          setMessagesLang(avant)
        }
      })

      for (const [nom, [, place, forme, remede]] of Object.entries(FAUTES)) {
        it(nom, () => {
          const fichier = place.slice(0, place.indexOf(':'))
          const siennes = erreurs.filter((e) => e.includes(`${fichier}:`))
          assert.equal(siennes.length, 1, `${fichier} : ${siennes.length} erreur(s)\n${erreurs.join('\n')}`)
          assert.ok(siennes[0].includes(`${place} `), `${place} attendu\n${siennes[0]}`)
          for (const f of fragments(langue, forme, remede)) assert.ok(siennes[0].includes(f), `${langue} : ${f}\n${siennes[0]}`)
        })
      }
    })
  }

  it('les écritures ordinaires passent : chemin, calcul, autre variable, sans `$`, comparaison, suite à la ligne, chaîne, commentaire', async () => {
    assert.deepEqual(await construire(PERMIS), [])
  })

  it('valeur dérivée : `$d = $d` dit de signaler la variable qu\'elle lit, dans le script comme dans un gestionnaire', async () => {
    const avant = getMessagesLang()
    let erreurs: string[]
    try {
      setMessagesLang('fr')
      erreurs = await construire({ 'aa-der.mjs': composant('$a = 1\n$d = $a * 2\n@f = ->\n  $d = $d', '<p>{$d}</p>'), 'aa-derg.mjs': composant('$a = 1\n$d = $a * 2', '<button @click={$d = $d}>{$d}</button>') })
    }
    finally {
      setMessagesLang(avant)
    }
    for (const place of ['aa-der.mjs:5:3', 'aa-derg.mjs:5:17']) {
      const siennes = erreurs.filter((e) => e.includes(`${place.slice(0, place.indexOf(':'))}:`))
      assert.equal(siennes.length, 1, erreurs.join('\n'))
      assert.ok(siennes[0].includes(`${place} `), `${place} attendu\n${siennes[0]}`)
      assert.ok(siennes[0].includes('« $d = $d » : $d est une valeur dérivée') && siennes[0].includes('« µrefresh($x) »'), siennes[0])
      assert.ok(!siennes[0].includes('µrefresh($d)'), siennes[0])
    }
  })

  it('`µrefresh($x)` et `µrefresh($$x)` passent', async () => {
    assert.deepEqual(await construire({ 'aa-rune.mjs': composant('$x = 1\n$$aak = {n: 1}\n@f = ->\n  µrefresh($x)\n  µrefresh($$aak)', '<button @click={µrefresh($x)}>{$x}{$$aak.n}</button>') }), [])
  })
})
