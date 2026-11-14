// tout le code MJS finit par `.mjs` : `x.civet.mjs`, `x.coffee.mjs` et `x.js.mjs` sont des modules que MJS compile (µ, runes,
// `@import`), jamais des composants ; un `.civet` ou un `.coffee` ordinaire est une bibliothèque, compilée par son seul langage,
// et la construction s'arrête quand elle se sert d'une écriture de MJS (µ, une directive, une affectation que MJS seul déclare)

import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

interface Construction { erreurs: string[], avis: string[], sorties: Record<string, string> }

// un projet jetable : ses fichiers, puis une construction (développement par défaut) ; `retouche` modifie des fichiers et reconstruit
async function construire(fichiers: Record<string, string>, options: Record<string, unknown> = {}, retouche?: Record<string, string>): Promise<Construction[]> {
  const racine  = mkdtempSync(join(tmpdir(), 'modules-mjs-'))
  const src     = join(racine, 'src')
  const out     = join(racine, 'out')
  const journal = [console.log, console.warn, console.error]
  const ecrire  = (lot: Record<string, string>) => {
    for (const [nom, texte] of Object.entries(lot)) {
      mkdirSync(dirname(join(src, nom)), { recursive: true })
      writeFileSync(join(src, nom), texte)
    }
  }
  ecrire(fichiers)
  console.log = console.warn = console.error = () => {}
  try {
    const b: any = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(racine, 'bundle.js'), minify: false, ...options } as any)
    const tours: Construction[] = []
    for (const lot of retouche ? [null, retouche] : [null]) {
      if (lot) ecrire(lot)
      const st: any = await b.compile()
      const sorties: Record<string, string> = {}
      for (const f of readdirSync(out)) if (f.endsWith('.js')) sorties[f] = readFileSync(join(out, f), 'utf-8')
      tours.push({ erreurs: (st.errors ?? []).map((e: any) => String(e?.message ?? e)), avis: (st.warnings ?? []).map((e: any) => String(e?.message ?? e)), sorties })
    }
    return tours
  }
  finally {
    [console.log, console.warn, console.error] = journal
    rmSync(racine, { recursive: true, force: true })
  }
}

// la sortie publiée d'un nom (`outil-<empreinte>.js`), et son texte
const sortie = (c: Construction, nom: string): [string, string] | undefined => Object.entries(c.sorties).find(([f]) => new RegExp(`^${nom.replace(/\./g, '\\.')}-[0-9a-z]{4,12}\\.js$`).test(f))

const composant = (chemin: string, noms = 'f') => `<script>\n@import { ${noms} } '${chemin}'\nload = -> $r = f()\n</script>\n<p>{$r}</p>\n`

describe('modules .civet.mjs / .coffee.mjs et bibliothèques .civet / .coffee', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const mode of ['dev', 'prod']) {
    it(`un module .civet.mjs reçoit µ, ses runes et @import, publié sous le nom de l'ancien .civet (${mode})`, async () => {
      const [c] = await construire({
        'alpha.mjs':          composant('outils/outil.civet.mjs'),
        'outils/outil.civet.mjs': "@import { base } 'outils/base.civet'\nexport f := -> µ.log('x') ; base() + 1\n",
        'outils/base.civet':  'export base := -> 41\n',
      }, mode === 'prod' ? { env: 'prod' } : {})
      assert.deepEqual(c.erreurs, [])
      const outil = sortie(c, 'outil')
      assert.ok(outil, `sortie outil-<empreinte>.js absente : ${Object.keys(c.sorties).join(', ')}`)
      assert.match(outil[1], /mjs_core/)
      assert.ok(!c.avis.some(a => /outil\.civet/.test(a) && /HTML/.test(a)), c.avis.join('\n'))
      assert.ok(!sortie(c, 'outil.civet'), 'un module .civet.mjs n\'est pas un composant')
    })
  }

  it('un module .coffee.mjs reçoit µ, compilé en CoffeeScript', async () => {
    const [c] = await construire({ 'alpha.mjs': composant('outil.coffee.mjs'), 'outil.coffee.mjs': "export f = -> µ.log('x') ; 42\n" })
    assert.deepEqual(c.erreurs, [])
    assert.match(sortie(c, 'outil')?.[1] ?? '', /mjs_core/)
  })

  it('µimport charge un module .civet.mjs et une bibliothèque .coffee', async () => {
    const [c] = await construire({
      'alpha.mjs':       "<script>\nload = ->\n  m := await µimport('outil.civet.mjs')\n  n := await µimport('lib.coffee')\n  $r = m.f() + n.g()\n</script>\n<p>{$r}</p>\n",
      'outil.civet.mjs': "export f := -> µ.log('x') ; 1\n",
      'lib.coffee':      'export g = -> 2\n',
    })
    assert.deepEqual(c.erreurs, [])
  })

  it('une bibliothèque .civet se compile par Civet seul, sans le cœur, importée par un composant et par un module', async () => {
    const [c] = await construire({
      'alpha.mjs':       composant('lib.civet', 'double'),
      'outil.civet.mjs': "@import { double } 'lib.civet'\nexport f := -> µ.log(double(2))\n",
      'beta.mjs':        composant('outil.civet.mjs'),
      'lib.civet':       'export double := (x) -> x * 2\nexport f := -> double(21)\n',
    })
    assert.deepEqual(c.erreurs, [])
    const lib = sortie(c, 'lib')
    assert.ok(lib, Object.keys(c.sorties).join(', '))
    assert.doesNotMatch(lib[1], /mjs_core|µ/)
  })

  it('une bibliothèque importe ses voisines par un import natif relatif, réécrit vers leur nom à empreinte', async () => {
    const [c] = await construire({
      'alpha.mjs':   composant('lib/a.civet'),
      'lib/a.civet': "import { b } from './b.coffee'\nimport { c } from './c.js'\nexport f := -> b() + c()\n",
      'lib/b.coffee': 'export b = -> 40\n',
      'lib/c.js':    'export const c = () => 2\n',
    })
    assert.deepEqual(c.erreurs, [])
    const a = sortie(c, 'a')?.[1] ?? ''
    assert.match(a, /b-[0-9a-z]{4,12}\.js/)
    assert.match(a, /c-[0-9a-z]{4,12}\.js/)
    assert.doesNotMatch(a, /\.\/b\.coffee|\.\/c\.js/)
  })

  const refus: [string, string, string][] = [
    ['lib.civet', "export f := -> µ.log('x')\n", 'µ'],
    ['lib.coffee', "export f = -> µ.log('x')\n", 'µ'],
    ['lib.civet', "@import { g } 'autre.civet'\nexport f := -> g()\n", '@import'],
    ['lib.civet', 'compteur = 0\nexport f := -> compteur += 1\n', 'une affectation sans déclaration'],
    ['lib.civet', '# un commentaire\nexport f := -> 1\n', 'un commentaire #'],
    ['lib.civet', 'export µ$$compte := { n: 0 }\nexport f := -> µ$$compte.n\n', 'un magasin µ$$'],
    ['lib.civet', 'export f := (l) ->\n  s .= 0\n  for x in l\n    s += x\n  s\n', 'for … in'],
  ]
  for (const mode of ['dev', 'prod']) {
    for (const [nom, texte, quoi] of refus) {
      it(`une bibliothèque ${nom} qui se sert de ${quoi} arrête la construction et dit de la nommer ${nom}.mjs (${mode})`, async () => {
        const [c] = await construire({ 'alpha.mjs': composant(nom), [nom]: texte, 'autre.civet': 'export g := -> 1\n' }, mode === 'prod' ? { env: 'prod' } : {})
        assert.ok(c.erreurs.some(e => e.includes(nom) && e.includes(`${nom}.mjs`)), c.erreurs.join('\n') || 'aucune erreur')
      })
    }
  }

  it('µ dans une chaîne, un commentaire ou un nom lié n\'arrête pas une bibliothèque', async () => {
    const [c] = await construire({ 'alpha.mjs': composant('lib.civet'), 'lib.civet': "// µ en commentaire\nunite := 'µs'\nexport f := (µx) -> µx + unite\n" })
    assert.deepEqual(c.erreurs, [])
  })

  it('x.civet et x.civet.mjs côte à côte : la construction s\'arrête et nomme les deux', async () => {
    const [c] = await construire({ 'alpha.mjs': composant('outil.civet.mjs'), 'outil.civet.mjs': "export f := -> µ.log('x')\n", 'outil.civet': 'export f := -> 1\n' })
    assert.ok(c.erreurs.some(e => /outil\.civet\.mjs/.test(e) && /outil\.civet(?!\.mjs)/.test(e)), c.erreurs.join('\n') || 'aucune erreur')
  })

  for (const [nom, avant, apres] of [['outil.civet.mjs', "export f := -> µ.log('a') ; 1\n", "export f := -> µ.log('b') ; 2\n"], ['outil.civet', 'export f := -> 1\n', 'export f := -> 2\n']]) {
    it(`modifier ${nom} recompile le composant qui l'importe`, async () => {
      const [t1, t2] = await construire({ 'alpha.mjs': composant(nom), [nom]: avant }, {}, { [nom]: apres })
      assert.deepEqual([...t1.erreurs, ...t2.erreurs], [])
      const v1 = sortie(t1, 'outil')?.[0]
      const v2 = sortie(t2, 'outil')?.[0]
      assert.ok(v1 && v2 && v1 !== v2, `${v1} / ${v2}`)
      assert.ok(sortie(t2, 'alpha')?.[1].includes(v2!), 'le composant importe la nouvelle sortie')
    })
  }
})
