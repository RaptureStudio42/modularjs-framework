// un gestionnaire resté ouvert (`@click={$x = 1 +}`, `<@window @resize={f(1,}>`) est refusé, cité à son `}` dans le fichier qui
// l'écrit, partiel compris — même quand le code qui le suit (un autre gestionnaire, la suite du script) le complète au goût de
// Civet : le composant se construisait alors sans un mot, avec un gestionnaire de moins ou un code qui ne fait pas ce qui est
// écrit. Les gestionnaires complets se construisent comme avant. Chaque cas passe par le chemin du bundler (transpileFromMsg)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'
import { mjsTmp } from './helpers/tmp.js'

const J  = (...l: string[]) => l.join('\n') + '\n'
const SC = ['<script>', '$x = 1', '$k = 0', '</script>']

// `fichier:ligne:colonne` de la `k`-ième marque (à partir de 0) sur la ligne `n` (à partir de 1) de `lignes`
function place(fichier: string, lignes: string[], n: number, marque: string, k = 0): string {
  let i = lignes[n - 1].indexOf(marque)
  for (let j = 0; j < k; j++) i = lignes[n - 1].indexOf(marque, i + 1)
  return `${fichier}:${n}:${i + 1}`
}

interface Cas { id: string, fichiers: Record<string, string>, attendu: string }
const cas: Cas[] = []
const ajoute = (id: string, fichiers: Record<string, string>, attendu: string) => cas.push({ id, fichiers, attendu })
let L: string[]

// gestionnaires de balise, compilés en un seul lot
L = [...SC, '<button @click={$x = 1 +}>a</button><button @click={$k = 2}>b</button>']
ajoute('opérateur final, un autre gestionnaire sur la même ligne', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '}>'))
L = [...SC, '<button @click={$x = 1 +}>a</button>', '<button @click={$k = 2}>b</button>']
ajoute('opérateur final, un autre gestionnaire à la ligne suivante', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '}>'))
L = [...SC, '<button @click={$x = 1 and}>a</button>', '<button @click={$k = 2}>b</button>']
ajoute('`and` final', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '}>'))
L = [...SC, '<button @click={$x = 1}>a</button>', '<button @click={$k = 2 *}>b</button>', '<button @click={$k = 3}>c</button>']
ajoute('le deuxième de trois', { 'main.mjs': J(...L) }, place('main.mjs', L, 6, '}>'))
L = [...SC, '{for x in [1]}<button @click={$x = x +}>a</button>{end}', '<button @click={$k = 2}>b</button>']
ajoute('dans un {for}', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '}>'))
const R = ['<p>p</p>', '<button @click={$x = 1 +}>a</button>']
ajoute('dans un partiel, suivi d\'un gestionnaire du composant', { 'main.mjs': J(...SC, '<@include h>', '<button @click={$k = 2}>b</button>'), '_h.mjs': J(...R) }, place('_h.mjs', R, 2, '}>'))
L = [...SC, '<button @click={f([1, 2}>a</button>', '<button @click={g()}>b</button>']
ajoute('crochet ouvert, suivi d\'un autre gestionnaire', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '}>'))
L = [...SC, `<button @click={$x = $k + "${'a'.repeat(2100)}" + * 2 + $k}>b</button>`]
ajoute('faute sur une ligne longue', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '*'))

// gestionnaires de <@window>, <@document> et <@body>, versés au script
L = [...SC, '<@window @resize={$x = 1 +} />']
ajoute('<@window>, opérateur final', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '}'))
L = [...SC, '<@window @resize={f(1,} />']
ajoute('<@window>, parenthèse ouverte', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '}'))
L = [...SC, '<@window @resize={$x = 1 +} @scroll={$k = 2} />']
ajoute('<@window>, suivi d\'un autre gestionnaire de la balise', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '}'))
L = [...SC, '<@document @keydown={$x = 1 +} />', '<@body @click={$k = 2} />']
ajoute('<@document>, suivi de <@body>', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '}'))
L = [...SC, '<@window @resize={$x = 1 +} />', '<button @click={$k = 2}>b</button>']
ajoute('<@window>, suivi d\'un gestionnaire de balise', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '}'))
const W = ['<p>w</p>', '<@window @resize={$x = 1 +} />']
ajoute('<@window> dans un partiel', { 'main.mjs': J(...SC, '<@include w>'), '_w.mjs': J(...W) }, place('_w.mjs', W, 2, '}'))
L = ['<script>', '$x = 1', '$k = 0', 'f = -> $k++', '</script>', '<@window @resize={$x = 1 +} />']
ajoute('<@window>, un script qui définit une fonction', { 'main.mjs': J(...L) }, place('main.mjs', L, 6, '}'))
L = [...SC, '<@window @keydown={', '  a = 1', '  b = 2 +', '} />']
ajoute('<@window>, corps sur plusieurs lignes', { 'main.mjs': J(...L) }, place('main.mjs', L, 8, '}'))

// les messages d'une construction : l'erreur levée (null sans erreur), la console
async function construire(id: string, fichiers: Record<string, string>): Promise<{ erreur: string | null, sortie: string }> {
  const dir = mjsTmp(`gestionnaire-ouvert-${id.replace(/[^\w-]+/g, '-')}`)
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(dir, nom)), { recursive: true })
    writeFileSync(join(dir, nom), texte)
  }
  const orig = { warn: console.warn, error: console.error, log: console.log }
  console.warn = console.error = console.log = () => {}
  try {
    const r = await transpileFromMsg({ type: 'transpile', id: 1, content: fichiers['main.mjs'], moduleName: 'main', baseDir: dir, sourceDir: dir, preResolvedAssets: {} } as any)
    return { erreur: (r?.data?.macroErrors ?? []).length > 0 ? String(r.data.macroErrors[0]) : null, sortie: String(r?.output ?? '') }
  }
  catch (e: any) {
    return { erreur: String(e?.message ?? e).replace(/\x1b\[[0-9;]*m/g, ''), sortie: '' }
  }
  finally {
    Object.assign(console, orig)
  }
}

describe('un gestionnaire resté ouvert est refusé, cité à son accolade fermante', function () {
  this.timeout(180000)

  for (const c of cas) {
    it(`${c.id} : ${c.attendu}`, async () => {
      const { erreur } = await construire(c.id, c.fichiers)
      assert.ok(erreur !== null, `construit sans faute : ${c.id}`)
      const p = /(?:^|[\s'"«(])((?:\.{1,2}\/)?[\w./-]*\.mjs):(\d+):(\d+)/.exec(erreur)
      assert.equal(p ? `${p[1]}:${p[2]}:${p[3]}` : null, c.attendu, erreur.slice(0, 400))
    })
  }

  it('<@window> resté ouvert : le message dit que le gestionnaire s\'arrête au milieu d\'une expression, et ce qu\'il faut écrire', async () => {
    const { erreur } = await construire('fenetre-message', { 'main.mjs': J(...SC, '<@window @resize={$x = 1 +} />') })
    assert.match(erreur ?? '', /main\.mjs:5:27 : ce gestionnaire s'arrête au milieu d'une expression \(« \$x = 1 \+ »\)/, erreur ?? '')
    assert.match(erreur ?? '', /écrivez la fin de l'expression/, erreur ?? '')
  })

  it('des gestionnaires complets, de balise et de <@window>, se construisent sans faute', async () => {
    const { erreur, sortie } = await construire('complets', { 'main.mjs': J(...SC, '<@window @resize={$x = 1} @scroll={$k = 2 +', '  3} />', '<button @click={$x = 1 +', '  2}>a</button><button @click={$k++}>b</button>', '<button @click={f([1,', '  2])}>c</button>') })
    assert.equal(erreur, null)
    assert.match(sortie, /this\._mjs_inline = \[/)
  })
})
