// un rappel de transition (`@introstart`, `@introend`, `@outrostart`, `@outroend`) se compile en fonction, comme un gestionnaire :
// une écriture qui suit un `return` de premier niveau prévient l'état ; un `await` rend le rappel `async` ; les gardes des
// gestionnaires s'y appliquent (JavaScript produit illisible, constante du script ou variable du gabarit réaffectée, setTimeout) ;
// une faute de Civet y est citée `fichier.mjs:ligne:colonne`, comme celle d'une balise globale d'un script
// JavaScript ou TypeScript. `unless` en fin d'instruction ne prend que son instruction, entre deux `;` de premier niveau

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const net     = (s: unknown) => String(s).replace(/\x1b\[[0-9;]*m/g, '')
const lisible = (sortie: string) => acorn.parse(sortie.replace(/µ\.asset\(('[^']+')\)/g, '$1'), { ecmaVersion: 'latest', sourceType: 'module' })
// le code d'un rappel dans la sortie, jusqu'au rappel suivant ou au départ de l'intro
const rappel  = (sortie: string, cle = 'introend') => new RegExp(`_mjs_cb_${cle} = ([^\\n]*?)(?= _mjs_node\\._mjs_cb_| if \\(_mjs_node\\._mjs_intro)`).exec(sortie)?.[1] ?? ''

async function sortieDe(source: string, opts: Record<string, unknown> = {}): Promise<string> {
  const r: any = await transpile(source, { moduleName: 'pos', ...opts } as any)
  return String(r.output)
}

async function refus(source: string, opts: Record<string, unknown> = {}): Promise<string> {
  try {
    const sortie = await sortieDe(source, opts)
    return `CONSTRUIT :: ${rappel(sortie)}`
  }
  catch (e: any) {
    return net(e?.message ?? e)
  }
}

const RETOURS: [string, string, Record<string, unknown>][] = [
  ['`return unless $v` en Civet', '  return unless $v\n  $x = 1', {}],
  ['`if (!$v) return` en Civet', '  if (!$v) return\n  $x = 1', {}],
]

describe('rappels de transition : return, await, gardes des gestionnaires, positions des fautes', function () {
  this.timeout(60000)
  after(() => terminateSharedWorkerPool())

  for (const [reglage, mode] of [['défaut', {}], ['proxy: false', { proxy: false }]] as const) {
    for (const [forme, corps, opts] of RETOURS) {
      it(`${forme} au premier niveau : l'écriture qui suit prévient l'état (${reglage})`, async () => {
        const sortie = await sortieDe(`<script>\n$v = true\n$x = 0\n</script>\n<p :transition=*fade @introend={\n${corps}\n}>x</p>\n<p>{$x}</p>`, { ...mode, ...opts })
        assert.match(rappel(sortie), /µ\._set\(_mjsThis, 'x', 1\)/, rappel(sortie))
        assert.doesNotThrow(() => lisible(sortie), rappel(sortie))
      })
    }
  }

  for (const [langue, opts] of [['Civet', {}]] as const) {
    it(`\`await\` dans un rappel (${langue}) : rappel \`async\`, JavaScript lisible, l'écriture prévient l'état`, async () => {
      const sortie = await sortieDe('<script>\n$x = 0\n</script>\n<p :transition=*fade @introend={await Promise.resolve(); $x = 1}>x</p>', opts)
      assert.doesNotThrow(() => lisible(sortie), rappel(sortie))
      assert.match(rappel(sortie), /^async \(\) => \{/, rappel(sortie))
      assert.match(rappel(sortie), /µ\._set\(_mjsThis, 'x', 1\)/, rappel(sortie))
    })
  }

  it('`await` dans une fonction du rappel seulement : le rappel reste une fonction ordinaire', async () => {
    const sortie = await sortieDe('<script>\n$x = 0\n</script>\n<p :transition=*fade @introend={\n  f := ->\n    await Promise.resolve()\n    $x = 1\n  f()\n}>x</p>', {})
    assert.doesNotThrow(() => lisible(sortie), rappel(sortie))
    assert.match(rappel(sortie), /^\(\) => \{/, rappel(sortie))
  })

  // les refus des gardes dans un rappel parlent d'un rappel de transition, jamais d'un gestionnaire ni d'un clic, et le citent à sa
  // place dans le .mjs : la ligne, et la colonne du nom fautif quand il est écrit
  const PAS_UN_GESTIONNAIRE = /gestionnaire|premier clic|pos\.inlines/

  it('JavaScript produit illisible (`$x = 1 if $v; $y = 2`) : refusé comme rappel de transition, à la ligne de sa balise, pas par le bundler', async () => {
    const m = await refus('<script>\n$x = 0\n$v = true\n$y = 0\n</script>\n<p :transition=*fade @introend={$x = 1 if $v; $y = 2}>x</p>')
    assert.match(m, /pos\.mjs:6 : le rappel de transition @introend compile en JavaScript invalide/, m)
    assert.doesNotMatch(m, /pos\.mjs:6:\d|Ligne \d+ produite/, m)
    assert.doesNotMatch(m, PAS_UN_GESTIONNAIRE, m)
  })

  it('constante du script réaffectée dans un rappel : refusée, citée à la ligne et à la colonne de son nom', async () => {
    const m = await refus('<script>\ncompteur := 0\n</script>\n<p :transition=*fade @introend={compteur = 1}>x</p>')
    assert.match(m, /pos\.mjs:4:33 : le rappel de transition @introend réaffecte « compteur », déclaré CONSTANT/, m)
    assert.doesNotMatch(m, PAS_UN_GESTIONNAIRE, m)
    const ligne3 = await refus('<script>\ncompteur := 0\n$x = 0\n</script>\n<div>\n  <p :transition=*fade @introend={$x = 1\n    $x = compteur\n    compteur += 2}>x</p>\n</div>')
    assert.match(ligne3, /pos\.mjs:8:5 : le rappel de transition @introend réaffecte « compteur »/, ligne3)
  })

  it('variable d\'un {for} réaffectée dans un rappel : refusée, citée à son nom ; masquée ou écrite par champ, permise', async () => {
    const m = await refus('<script>\n$l = [{ n: 0 }]\n</script>\n{for x in $l}<p :transition=*fade @introend={x = { n: 5 }}>{x.n}</p>{end}')
    assert.match(m, /pos\.mjs:4:46 : le rappel de transition @introend réaffecte « x », posé par le HTML du composant/, m)
    assert.doesNotMatch(m, PAS_UN_GESTIONNAIRE, m)
    const sortie = await sortieDe('<script>\n$l = [{ n: 0 }]\n</script>\n{for x in $l}<p :transition=*fade @introend={x := { n: 0 }; x.n = 1} @outroend={x.n++}>{x.n}</p>{end}')
    assert.doesNotThrow(() => lisible(sortie))
  })

  it('setTimeout dans un rappel : refusé, cité à la ligne et à la colonne de son nom', async () => {
    const m = await refus('<script>\n$x = 0\n</script>\n<p :transition=*fade @introend={setTimeout((-> $x = 1), 10)}>x</p>')
    assert.match(m, /pos\.mjs:4:33 \(rappel de transition @introend\) : « setTimeout » est refusé/, m)
    assert.doesNotMatch(m, PAS_UN_GESTIONNAIRE, m)
  })

  it('les mêmes refus dans un gestionnaire gardent leurs messages', async () => {
    const constante = await refus('<script>\ncompteur := 0\n</script>\n<button @click={compteur = 1}>x</button>')
    assert.match(constante, /un gestionnaire d'événement réaffecte « compteur »/, constante)
    const minuterie = await refus('<script>\n$x = 0\n</script>\n<button @click={setTimeout((-> $x = 1), 10)}>x</button>')
    assert.match(minuterie, /'pos\.mjs', ligne 4 \(gestionnaire du gabarit\) : « setTimeout » est refusé/, minuterie)
  })

  it('faute de Civet dans un rappel : citée à sa ligne et à sa colonne du .mjs', async () => {
    const m = await refus('<script>\n$x = 0\n</script>\n<div>\n  <p>a</p>\n  <p :transition=*fade @introend={$x = = 1}>x</p>\n</div>')
    assert.match(m, /pos\.mjs:6:40\b/, m)
    assert.doesNotMatch(m, /pos\.inlines/, m)
  })

  for (const [nom, script, opts] of [['script JavaScript', '<script lang="js">\n$n = 0;\n</script>', {}], ['script TypeScript', '<script lang="ts">\n$n = 0;\n</script>', {}]] as const) {
    it(`faute dans une balise globale d'un ${nom} : citée à sa ligne et à sa colonne du .mjs`, async () => {
      const m = await refus(`${script}\n<p>{$n}</p>\n<@window @resize={$n = = 1} />`, opts)
      assert.match(m, /pos\.mjs:5:24\b/, m)
      assert.doesNotMatch(m, /pos\.globales/, m)
    })
  }

  it('`t := $o; t.c = 3 unless t.c` dans un rappel et dans un gestionnaire : `unless` ne prend que la dernière instruction', async () => {
    for (const attribut of [':transition=*fade @introend', '@click']) {
      const sortie = await sortieDe(`<script>\n$o = { c: 0 }\n</script>\n<button ${attribut}={t := $o; t.c = 3 unless t.c}>x</button>`)
      assert.doesNotThrow(() => lisible(sortie), attribut)
    }
  })

  it('`$x = 1 unless $v; $y = 2` dans un gestionnaire : `unless` ne prend pas l\'instruction qui suit', async () => {
    const sortie = await sortieDe('<script>\n$x = 0\n$v = false\n$y = 0\n</script>\n<button @click={$x = 1 unless $v; $y = 2}>x</button>')
    assert.doesNotThrow(() => lisible(sortie))
    assert.match(sortie, /µ\._set\(_mjsThis, 'y', 2\)/)
    assert.doesNotMatch(sortie, /!\(\$\.v;/)
  })
})
