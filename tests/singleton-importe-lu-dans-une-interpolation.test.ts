// Un singleton importé (`@import µ$$X`) se lit `µ$$X` partout, y compris dans le code d'une interpolation de
// chaîne : `"#{µ$$X.y}"` (Civet, Coffee), `` `${µ$$X.y}` ``, une interpolation imbriquée, une expression, un attribut
// ou un gestionnaire du gabarit. La lecture compile comme hors interpolation (`$X.y`) ; `$$X`, le store global, reste
// refusé sur un nom importé, et un `µ$$X` sans import reste refusé, comme hors interpolation.
//
// Défaut : la réécriture `µ$$X` → `$X` du transpileur met chaque chaîne de côté d'un seul bloc, interpolations
// comprises. Le `µ$$X` interpolé arrivait tel quel au lexeur, qui laissait passer le `µ` puis refusait `$$X` comme une
// lecture du store global (« consommez-le avec µ$$X », alors qu'il l'était déjà) ; un nom non importé, ou déclaré par
// le module lui-même, y sortait `µµ.store.X`, une erreur qui n'éclatait qu'au navigateur.
//
// Dans un module (le <script module> d'un composant, un module autonome), le lexeur laissait ensuite passer tout nom :
// `"#{µ$$Inconnu.a}"`, ni importé ni déclaré, compilait en `$Inconnu.a`, une erreur au chargement du module, quand le
// même nom hors interpolation est refusé à la compilation.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile, applyMjsSugarToScript, singletonsDeclares } from '../src/transpiler/index.js'
import { tokenize } from '../src/lexer/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const IMPORT = `@import µ$$Boite 'stores/boite.module.civet'\n`

async function compile(source: string): Promise<string> {
  const { output } = await transpile(source, { moduleName: 'sonde' })
  return output
}

async function erreurDe(source: string): Promise<string> {
  try {
    await transpile(source, { moduleName: 'sonde' })
  }
  catch (e: any) {
    return String(e?.message ?? e)
  }
  assert.fail('la compilation aurait dû échouer')
}

const script = (lignes: string[], gabarit = '<p>x</p>', lang = '') => `${IMPORT}<script${lang}>\n${lignes.join('\n')}\n</script>\n${gabarit}\n`

// ni symbole laissé tel quel, ni lecture du store global à la place du singleton
function sansResidu(output: string): void {
  assert.doesNotMatch(output, /µ\$\$|µµ|µ\.store\.Boite/)
}

describe('singleton importé lu dans une interpolation de chaîne', () => {
  it('témoin hors interpolation : `µ$$Boite.a` compile en `$Boite.a`', async () => {
    const out = await compile(script([ 'lire := ->', '  s := µ$$Boite.a', '  console.log s' ]))
    assert.match(out, /const s = \$Boite\.a\b/)
  })

  it('composant complet : `"#{µ$$Boite.a}_#{µ$$Boite.b}"` dans le <script>, `{µ$$Boite.a}` dans le gabarit', async () => {
    const source = `${IMPORT}\n<script>\n  lire := ->\n    s := "#{µ$$Boite.a}_#{µ$$Boite.b}"\n    console.log s\n</script>\n\n<button type="button" @click={lire()}>{µ$$Boite.a}</button>\n`
    const out    = await compile(source)
    assert.match(out, /const s = `\$\{\$Boite\.a\}_\$\{\$Boite\.b\}`/)
    assert.match(out, /_mjs_updText\('t\d+', \$Boite\.a\)/)
    sansResidu(out)
  })

  it('Coffee : `"#{µ$$Boite.a}"`, la même lecture', async () => {
    const out = await compile(script([ 'lire = ->', '  s = "n#{µ$$Boite.a}"', '  console.log s' ], '<p>x</p>', ' lang="coffee"'))
    assert.match(out, /\$Boite\.a\b/)
    sansResidu(out)
  })

  it('gabarit à backtick `` `${µ$$Boite.a}` `` dans le <script>', async () => {
    const out = await compile(script([ 'lire := ->', '  s := `n${µ$$Boite.a}`', '  console.log s' ]))
    assert.match(out, /`n\$\{\$Boite\.a\}`/)
    sansResidu(out)
  })

  it('interpolation imbriquée `"a#{ "b#{µ$$Boite.a}" }"`', async () => {
    const out = await compile(script([ 'lire := ->', '  s := "a#{ "b#{µ$$Boite.a}" }"', '  console.log s' ]))
    assert.match(out, /`b\$\{\$Boite\.a\}`/)
    sansResidu(out)
  })

  it('chaîne sur plusieurs lignes `"""…#{µ$$Boite.a}…"""`', async () => {
    const out = await compile(script([ 'lire := ->', '  s := """', '    n#{µ$$Boite.a}', '  """', '  console.log s' ]))
    assert.match(out, /n\$\{\$Boite\.a\}/)
    sansResidu(out)
  })

  it('<script module> du composant : `"#{µ$$Boite.a}"`, la même lecture', async () => {
    const out = await compile(`${IMPORT}<script module>\nmsg := "n#{µ$$Boite.a}"\n</script>\n<p>x</p>\n`)
    assert.match(out, /const msg = `n\$\{\$Boite\.a\}`/)
    sansResidu(out)
  })

  it('une chaîne simple n\'interpole pas : `\'#{µ$$Boite.a}\'` reste du texte', async () => {
    const out = await compile(script([ 'lire := ->', '  s := \'n#{µ$$Boite.a}\'', '  console.log s' ]))
    assert.match(out, /'n#\{µ\$\$Boite\.a\}'/)
  })
})

describe('singleton importé lu dans une interpolation du gabarit', () => {
  it('expression `{"n#{µ$$Boite.a}"}`', async () => {
    const out = await compile(`${IMPORT}<p>{"n#{µ$$Boite.a}"}</p>\n`)
    assert.match(out, /_mjs_updText\('t\d+', `n\$\{\$Boite\.a\}`\)/)
    sansResidu(out)
  })

  it('expression à backtick `{`n${µ$$Boite.a}`}`', async () => {
    const out = await compile(`${IMPORT}<p>{\`n\${µ$$Boite.a}\`}</p>\n`)
    assert.match(out, /_mjs_updText\('t\d+', `n\$\{\$Boite\.a\}`\)/)
    sansResidu(out)
  })

  it('attribut `title={"n#{µ$$Boite.a}"}`', async () => {
    const out = await compile(`${IMPORT}<p title={"n#{µ$$Boite.a}"}>t</p>\n`)
    assert.match(out, /'title', `n\$\{\$Boite\.a\}`/)
    sansResidu(out)
  })

  it('gestionnaire `@click={console.log "n#{µ$$Boite.a}"}`', async () => {
    const out = await compile(`${IMPORT}<button @click={console.log "n#{µ$$Boite.a}"}>t</button>\n`)
    assert.match(out, /console\.log\(`n\$\{\$Boite\.a\}`\)/)
    sansResidu(out)
  })
})

describe('les refus gardent leur rôle dans une interpolation', () => {
  it('`"#{$$Boite.a}"` sur un nom importé : refusé, situé', async () => {
    const message = await erreurDe(script([ 'lire := ->', '  s := "n#{$$Boite.a}"', '  console.log s' ]))
    assert.match(message, /sonde\.script:4:\d+ /)
    assert.match(message, /« \$\$Boite » : « Boite » est un singleton importé/)
  })

  it('`{"n#{$$Boite.a}"}` dans le gabarit : refusé', async () => {
    assert.match(await erreurDe(`${IMPORT}<p>{"n#{$$Boite.a}"}</p>\n`), /« \$\$Boite » : « Boite » est un singleton importé/)
  })

  it('témoin : le store global `$$panier`, non importé, se lit toujours `µ.store.panier` dans une interpolation', async () => {
    const out = await compile(script([ 'lire := ->', '  s := "n#{$$panier.total}"', '  console.log s' ], '<p>{"m#{$$panier.total}"}</p>'))
    assert.match(out, /const s = `n\$\{µ\.store\.panier\.total\}`/)
    assert.match(out, /_mjs_updText\('t\d+', `m\$\{µ\.store\.panier\.total\}`\)/)
  })

  it('`"#{µ$$Inconnu.a}"` sans import : refusé comme hors interpolation', async () => {
    const hors = await erreurDe(`<script>\nlire := ->\n  s := µ$$Inconnu.a\n</script>\n<p>x</p>\n`)
    const dans = await erreurDe(`<script>\nlire := ->\n  s := "n#{µ$$Inconnu.a}"\n</script>\n<p>x</p>\n`)
    assert.match(hors, /« µ\$\$Inconnu » utilisé sans « @import µ\$\$Inconnu »/)
    assert.match(dans, /« µ\$\$Inconnu » utilisé sans « @import µ\$\$Inconnu »/)
  })

  it('`{"n#{µ$$Inconnu.a}"}` sans import, dans le gabarit : refusé', async () => {
    assert.match(await erreurDe(`<p>{"n#{µ$$Inconnu.a}"}</p>\n`), /« µ\$\$Inconnu » utilisé sans « @import µ\$\$Inconnu »/)
  })

  it('<script module> du composant : `"#{µ$$Inconnu.a}"` sans import, refusé comme hors interpolation, situé', async () => {
    const hors = await erreurDe(`<script module>\nmsg := µ$$Inconnu.a\n</script>\n<p>x</p>\n`)
    const dans = await erreurDe(`<script module>\nmsg := "n#{µ$$Inconnu.a}"\n</script>\n<p>x</p>\n`)
    assert.match(hors, /« µ\$\$Inconnu » utilisé sans « @import µ\$\$Inconnu »/)
    assert.match(dans, /sonde\.module:2:12 \[ModularJS\] « µ\$\$Inconnu » utilisé sans « @import µ\$\$Inconnu »/)
  })

  it('<script module> du composant : `"#{µ$$Boite.a}"` sur son propre `export µ$$Boite`, même verdict que hors interpolation', async () => {
    const hors = await erreurDe(`<script module>\nexport µ$$Boite = { a: 1 }\nmsg := µ$$Boite.a\n</script>\n<p>x</p>\n`)
    const dans = await erreurDe(`<script module>\nexport µ$$Boite = { a: 1 }\nmsg := "n#{µ$$Boite.a}"\n</script>\n<p>x</p>\n`)
    assert.match(hors, /« µ\$\$Boite » utilisé sans « @import µ\$\$Boite »/)
    assert.match(dans, /sonde\.module:3:12 \[ModularJS\] « µ\$\$Boite » utilisé sans « @import µ\$\$Boite »/)
  })
})

describe('module autonome : son propre singleton lu dans une interpolation', () => {
  // même chaîne que le bundler pour un `.module.civet` : sucre du script, puis lexeur en mode module
  const module = (source: string) => tokenize(applyMjsSugarToScript(source, 'civet', undefined, '<script module>', 1), { moduleMode: true, singletons: singletonsDeclares(source), fileName: 'boite.module.civet', firstLine: 1 })

  it('`"#{µ$$Boite.a}"` compile comme `µ$$Boite.a` hors interpolation', () => {
    assert.match(module('export µ$$Boite = { a: 1 }\nmsg := µ$$Boite.a'), /msg := \$Boite\.a\b/)
    const out = module('export µ$$Boite = { a: 1 }\nmsg := "n#{µ$$Boite.a}"')
    assert.match(out, /msg := `n\$\{\$Boite\.a\}`/)
    sansResidu(out)
  })

  it('`"#{µ$$Inconnu.a}"`, un nom que le module ne déclare pas : refusé comme hors interpolation, situé', () => {
    assert.throws(() => module('msg := µ$$Inconnu.a'), /« µ\$\$Inconnu » utilisé sans « @import µ\$\$Inconnu »/)
    assert.throws(() => module('n := 1\nmsg := "n#{µ$$Inconnu.a}"'), /boite\.module\.civet:2:12 \[ModularJS\] « µ\$\$Inconnu » utilisé sans « @import µ\$\$Inconnu »/)
  })

  it('`export µ$Boite` déclare une variable, pas un singleton : `"#{µ$$Boite.a}"` refusé, comme hors interpolation', () => {
    assert.throws(() => module('export µ$Boite = { a: 1 }\nmsg := µ$$Boite.a'), /« µ\$\$Boite » utilisé sans « @import µ\$\$Boite »/)
    assert.throws(() => module('export µ$Boite = { a: 1 }\nmsg := "n#{µ$$Boite.a}"'), /boite\.module\.civet:2:12 \[ModularJS\] « µ\$\$Boite » utilisé sans « @import µ\$\$Boite »/)
  })
})

describe('module autonome compilé par le bundler : singleton lu dans une interpolation', function () {
  this.timeout(30000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('son `export µ$$Boite` se lit dans une interpolation ; un nom qu\'il ne déclare pas y est refusé, situé', async () => {
    const racine  = mjsTmp('singleton-interpolation')
    const sources = join(racine, 'src')
    const sortie  = join(racine, 'out')
    mkdirSync(sources, { recursive: true })
    writeFileSync(join(sources, 'boite.module.civet'), 'export µ$$Boite = { a: 1 }\nexport msg = -> "n#{µ$$Boite.a}"\n')
    writeFileSync(join(sources, 'faute.module.civet'), 'n := 1\nmsg := "n#{µ$$Inconnu.a}"\n')
    const bundler = new Bundler({ sourceDir: sources, outputDir: sortie, manifestPath: join(racine, 'bundle.js'), urlPrefix: '/assets' })
    try {
      const stats   = await bundler.compile()
      const erreurs = stats.errors.map((e) => e.message).join('\n')
      assert.match(erreurs, /faute\.module\.civet:2:12 \[ModularJS\] « µ\$\$Inconnu » utilisé sans « @import µ\$\$Inconnu »/)
      assert.doesNotMatch(erreurs, /boite\.module/)
      assert.ok(bundler.manifest['boite.module'], `module compilé attendu, manifeste : ${JSON.stringify(Object.keys(bundler.manifest))}`)
    }
    finally {
      await bundler.close()
    }
  })
})
