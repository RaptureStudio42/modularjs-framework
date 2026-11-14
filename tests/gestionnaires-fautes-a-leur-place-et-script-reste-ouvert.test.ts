// les fautes des gestionnaires citées à leur place : un <script> qui s'arrête au milieu d'une expression (`a +`) prenait sans un
// mot la première ligne que <@window>, <@document> ou <@body> lui ajoutent (le gestionnaire, la valeur de départ d'une liaison),
// il est refusé à son dernier signe ; un gestionnaire resté ouvert dans un groupe `{for}`, ou `{$k ?}`, suivi d'un autre, est cité
// à son `}` et non au voisin qu'il avale ;
// `return unless $v` écrit sur une ligne se construit. Chaque cas passe par le chemin du bundler (transpileFromMsg)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'
import { mjsTmp } from './helpers/tmp.js'

const J  = (...l: string[]) => l.join('\n') + '\n'
const SC = ['<script>', '$x = 1', '$k = 0', '$v = true', 'f = (a...) -> a', '</script>']

// `fichier:ligne:colonne` de la `k`-ième marque (à partir de 0) sur la ligne `n` (à partir de 1) de `lignes`
function place(fichier: string, lignes: string[], n: number, marque: string, k = 0): string {
  let i = lignes[n - 1].indexOf(marque)
  for (let j = 0; j < k; j++) i = lignes[n - 1].indexOf(marque, i + 1)
  return `${fichier}:${n}:${i + 1}`
}

interface Cas { id: string, fichiers: Record<string, string>, attendu: string, opts?: Record<string, unknown> }
const cas: Cas[] = []
const ajoute = (id: string, fichiers: Record<string, string>, attendu: string, opts?: Record<string, unknown>) => cas.push({ id, fichiers, attendu, opts })
let L: string[]

// un <script> resté ouvert, suivi d'une balise du langage
L = ['<script>', '$x = 1', 'g = (a) ->', '  a +', '</script>', '<@window @resize={$x = 3} />']
ajoute('script dont la fonction finit sur `+`, <@window>', { 'main.mjs': J(...L) }, place('main.mjs', L, 4, '+'))
L = ['<script>', '$x = 1', 'y = $x +', '</script>', '<@window @resize={$x = 3} />']
ajoute('script qui finit sur `+` à sa racine, <@window>', { 'main.mjs': J(...L) }, place('main.mjs', L, 3, '+'))
L = ['<script>', '$x = 1', 'g = (a) ->', '  a and', '</script>', '<@document @click={$x = 3} />']
ajoute('script qui finit sur `and`, <@document>', { 'main.mjs': J(...L) }, place('main.mjs', L, 4, 'd'))
L = ['<script>', '$x = 1', 'g = (a) ->', '  f a,', '</script>', '<@body @click={$x = 3} />']
ajoute('script qui finit sur une virgule, <@body>', { 'main.mjs': J(...L) }, place('main.mjs', L, 4, ','))
L = ['<script>', '$x = 1', 'onR = -> $x++', 'g = (a) ->', '  a +', '</script>', '<@window @resize=onR />']
ajoute('script ouvert, gestionnaire sans accolades', { 'main.mjs': J(...L) }, place('main.mjs', L, 5, '+'))
L = ['<script>', '$x = 1', 'g = (a) ->', '  a + # fin', '', '</script>', '<@window @resize={$x = 3} />']
ajoute('script ouvert, commentaire en fin de ligne', { 'main.mjs': J(...L) }, place('main.mjs', L, 4, '+'))
L = ['<script>', '$y = 0', 'g = (a) ->', '  a +', '</script>', '<@window scrollY=!{$y} />']
ajoute('script ouvert, liaison de <@window>', { 'main.mjs': J(...L) }, place('main.mjs', L, 4, '+'))
L = ['<script>', '$x = 1', 'g = (a) ->', '  a +', '</script>', '<@body :class{$x}="actif" />']
ajoute('script ouvert, classe de <@body>', { 'main.mjs': J(...L) }, place('main.mjs', L, 4, '+'))
L = ['<script>', '$x = 1', 'g = (a) ->', '  a +', '</script>', '<@failed>oups</@failed>', '<@window @resize={$x = 3} />']
ajoute('script ouvert, <@failed> avant <@window>', { 'main.mjs': J(...L) }, place('main.mjs', L, 4, '+'))
L = ['<script>', '$x = 1', 'g = (a) ->', '  a +', '</script>', '<@failed>oups</@failed>', '<p>{$x}</p>']
ajoute('script ouvert, <@failed> seul', { 'main.mjs': J(...L) }, place('main.mjs', L, 4, '+'))
const H = ['<script>', 'g = (a) ->', '  a +', '</script>', '<p>h</p>']
ajoute('script d\'un partiel ouvert, <@window> du composant', { 'main.mjs': J('<script>', '$x = 1', '</script>', '<@include h>', '<@window @resize={$x = 3} />'), '_h.mjs': J(...H) }, place('_h.mjs', H, 3, '+'))

// un gestionnaire resté ouvert dans un groupe `{for}` (un nom du gabarit recouvre un nom du script), qui avale son voisin
L = ['<script>', '$x = 1', '$k = 0', 'x = 3', '</script>', '<button @click={$k = 1}>a</button>', '{for x in [1]}<button @click={$x = x +}>b</button><button @click={$k = x}>c</button>{end}']
ajoute('{for} en groupe, voisin sur la même ligne', { 'main.mjs': J(...L) }, place('main.mjs', L, 7, '}>'))
L = ['<script>', '$x = 1', '$k = 0', 'x = 3', '</script>', '<button @click={$k = 1}>a</button>', '{for x in [1]}', '<button @click={$x = x *}>b</button>', '<button @click={$k = x}>c</button>', '{end}']
ajoute('{for} en groupe, voisin à la ligne suivante', { 'main.mjs': J(...L) }, place('main.mjs', L, 8, '}>'))
L = ['<script>', '$x = 1', '$k = 0', '</script>', '<button @click={$k = 1}>a</button>', '{for x in [1]}', '<button @click={$x = x *}>b</button>', '<button @click={$k = x}>c</button>', '{end}']
ajoute('{for}, voisin à la ligne suivante', { 'main.mjs': J(...L) }, place('main.mjs', L, 7, '}>'))

// `{$k ?}` suivi d'un autre gestionnaire
L = [...SC, '<button @click={$k ?}>a</button>', '<button @click={$k = 2}>z</button>']
ajoute('`{$k ?}` suivi d\'un gestionnaire à la ligne suivante', { 'main.mjs': J(...L) }, place('main.mjs', L, 7, '}>'))
L = [...SC, '<button @click={$k ?}>a</button><button @click={$k = 2}>z</button>']
ajoute('`{$k ?}` suivi d\'un gestionnaire sur la même ligne', { 'main.mjs': J(...L) }, place('main.mjs', L, 7, '}>'))


// les messages d'une construction : l'erreur levée (null sans erreur), la console, le code produit
async function construire(id: string, fichiers: Record<string, string>, opts: Record<string, unknown> = {}): Promise<{ erreur: string | null, sortie: string }> {
  const dir = mjsTmp(`gestionnaires-fautes-${id.replace(/[^\w-]+/g, '-')}`)
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(dir, nom)), { recursive: true })
    writeFileSync(join(dir, nom), texte)
  }
  const orig = { warn: console.warn, error: console.error, log: console.log }
  console.warn = console.error = console.log = () => {}
  try {
    const r = await transpileFromMsg({ type: 'transpile', id: 1, content: fichiers['main.mjs'], moduleName: 'main', baseDir: dir, sourceDir: dir, preResolvedAssets: {}, ...opts } as any)
    return { erreur: (r?.data?.macroErrors ?? []).length > 0 ? String(r.data.macroErrors[0]) : null, sortie: String(r?.output ?? '') }
  }
  catch (e: any) {
    return { erreur: String(e?.message ?? e).replace(/\x1b\[[0-9;]*m/g, ''), sortie: '' }
  }
  finally {
    Object.assign(console, orig)
  }
}

describe('les fautes des gestionnaires sont citées à leur place, un <script> resté ouvert est refusé', function () {
  this.timeout(180000)

  for (const c of cas) {
    it(`${c.id} : ${c.attendu}`, async () => {
      const { erreur } = await construire(c.id, c.fichiers, c.opts)
      assert.ok(erreur !== null, `construit sans faute : ${c.id}`)
      const p = /(?:^|[\s'"«(])((?:\.{1,2}\/)?[\w./-]*\.(?:mjs|inlines|script)):(\d+)(?::(\d+))?/.exec(erreur)
      assert.equal(p ? `${p[1]}:${p[2]}:${p[3]}` : null, c.attendu, erreur.slice(0, 400))
    })
  }

  it('<script> resté ouvert : le message dit où il s\'arrête et ce qu\'il faut écrire', async () => {
    const { erreur } = await construire('script-message', { 'main.mjs': J('<script>', '$x = 1', 'g = (a) ->', '  a +', '</script>', '<@window @resize={$x = 3} />') })
    assert.match(erreur ?? '', /main\.mjs:4:5 : ce <script> s'arrête au milieu d'une expression \(« a \+ »\)/, erreur ?? '')
    assert.match(erreur ?? '', /écrivez la fin de l'expression/, erreur ?? '')
  })

  it('des scripts complets avant <@window>, <@document> et <@body> se construisent sans faute', async () => {
    for (const lignes of [
      ['<script>', '$x = 1', 'g = (a) ->', '  a + 1', '</script>', '<@window @resize={$x = 3} />'],
      ['<script>', '$x = 1', 'g = (a) ->', '</script>', '<@document @click={$x = 3} />'],
      ['<script>', '$x = 1', 'h = (a) => a++', '</script>', '<@window @resize={$x = 3} />'],
      ['<script>', '$y = 0', 'z = window.scrollY', '</script>', '<@window scrollY=!{$y} />'],
      ['<script>', '$x = 1', 'g = (a) -> a', '</script>', '<@body :class{$x}="actif" @click={$x = 2} />'],
      ['<script>', '$x = 1', 'g = (a) ->', '  a + 2', '</script>', '<@failed>oups</@failed>', '<@window @resize={$x = 3} />']
    ]) {
      const { erreur, sortie } = await construire(`complet-${lignes[3].replace(/\W+/g, '')}`, { 'main.mjs': J(...lignes) })
      assert.equal(erreur, null, lignes.join(' | '))
      assert.match(sortie, /_glb?_0/, lignes.join(' | '))
    }
  })

  it('`return unless $v` écrit sur une ligne se construit, le retour sous sa condition, la suite après lui', async () => {
    for (const [corps, opts] of [['return unless $v', {}], ['return unless $v; $x = 2', {}], ['return x unless $v', {}]] as const) {
      const { erreur, sortie } = await construire(`unless-${corps}`, { 'main.mjs': J(...SC, `<button @click={${corps}}>a</button>`) }, opts)
      assert.equal(erreur, null, corps)
      assert.match(sortie, /if \(![^\n]*\) \{\s*(?:return|throw)/, corps)
      if (corps.includes('$x = 2')) assert.match(sortie, /if \(![^\n]*\) \{\s*return;?\s*\};?\s*(?:return )?µ\._set\(_mjsThis, 'x', 2\)/, corps)
    }
  })

  it('`unless` suivi d\'une regex ou d\'une chaîne : la condition entière, jamais une flèche jamais appelée', async () => {
    for (const [corps, opts] of [['$x = 1 unless /a/.test($s)', {}], ['$x = 1 unless /A/i.test($s)', {}], ["$x = 1 unless 'a' == $s", {}]] as const) {
      const { erreur, sortie } = await construire(`unless-regex-${corps}`, { 'main.mjs': J('<script>', '$x = 0', "$s = 'abc'", '</script>', `<button @click={${corps}}>a</button>`) }, opts)
      assert.equal(erreur, null, corps)
      assert.ok(!/\$1 =>/.test(sortie), `flèche jamais appelée : ${corps}`)
      assert.match(sortie, corps.includes('/a/') ? /!\(\[\/a\/\]\[0\]\.test\(/ : corps.includes('/A/i') ? /!\(\[\/A\/i\]\[0\]\.test\(/ : /!\('a' == /, corps)
    }
  })
})
