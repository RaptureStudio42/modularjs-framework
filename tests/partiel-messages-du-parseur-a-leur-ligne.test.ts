// chaque refus du parseur pour une faute écrite dans un partiel cite sa ligne dans le partiel (« ligne 2 de _h.mjs »), jamais la
// ligne du `<@include>` qui le verse ; un partiel d'un sous-dossier est nommé par son chemin depuis le dossier du composant, et
// `mjs check --json` donne ce fichier. La même faute écrite dans le composant cite toujours sa ligne seule. Chaque cas passe par
// le chemin du bundler (transpileFromMsg), celui des messages de la construction. Les refus et avertissements du générateur qui
// citent la ligne d'un nœud (`{await}` imbriqué, attribut booléen à "false", « #{…} » dans un attribut statique) suivent la même règle

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transpileFromMsg } from '../src/bundler/transpile-msg.js'
import { toDiagnostic } from '../src/cli/check-json.js'
import { mjsTmp } from './helpers/tmp.js'

const J = (...l: string[]) => l.join('\n') + '\n'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

// la faute, écrite seule sur la deuxième ligne de son fichier, et le texte de son message
const fautes: Array<{ id: string, ligne: string, motif: RegExp }> = [
  { id: 'symbole-reserve-template, item de {for}', ligne: '{for $ in [1]}<p>b</p>{end}', motif: /« \$ » est un symbole du framework/ },
  { id: 'symbole-reserve-template, nom de {const}', ligne: '{const $ = 1}', motif: /« \$ » est un symbole du framework/ },
  { id: 'nom-reserve, item de {for}', ligne: '{for el in [1]}<p>b</p>{end}', motif: /NOM RÉSERVÉ.*\{for\}/ },
  { id: 'nom-reserve, index de {for}', ligne: '{for this, x in [1]}<p>b</p>{end}', motif: /NOM RÉSERVÉ.*`this`/ },
  { id: 'nom-reserve, {success}', ligne: '{await f()}<p>w</p>{success el}<p>b</p>{end}', motif: /NOM RÉSERVÉ.*\{success\}/ },
  { id: 'nom-reserve, {error}', ligne: '{await f()}<p>w</p>{error el}<p>b</p>{end}', motif: /NOM RÉSERVÉ.*\{error\}/ },
  { id: 'nom-reserve, {const}', ligne: '{const el = 1}', motif: /NOM RÉSERVÉ.*\{const\}/ },
  { id: 'nom-reserve, {success} orphelin', ligne: '<p>b</p>{success el}', motif: /NOM RÉSERVÉ.*\{success\}/ },
  { id: 'mot-arobase-retire, condition', ligne: '<p @class{1}="a">b</p>', motif: /« @class\{1\}="a" »/ },
  { id: 'mot-arobase-retire, mot nu', ligne: '<details @lightDom>b</details>', motif: /« @lightDom »/ },
  { id: 'mot-arobase-retire, valeur', ligne: '<p @size="320x48">b</p>', motif: /« @size="320x48" »/ },
  { id: 'mot-modificateur-evenement', ligne: '<p :size.propagate="3">b</p>', motif: /ne prend pas de modificateur/ },
  { id: 'mot-inconnu', ligne: '<p :zzz="a">b</p>', motif: /« :zzz » n'est pas un mot de MJS/ },
  { id: 'attribut-nu-non-supporte', ligne: '<div {f(1)}>b</div>', motif: /`\{f\(1\)\}` nu/ },
  { id: 'bloc-modele-nom', ligne: '{? 1a}<p>b</p>{end}', motif: /\{\? 1a\}.*un nom de modèle/ },
  { id: 'bloc-non-ferme, bloc de modèle', ligne: '{? a}<p>b</p>', motif: /\{\? a\}` ouvert/ },
  { id: 'await-option-inconnue', ligne: '{await.kep f()}<p>b</p>{end}', motif: /« \.kep » n'est pas une option/ },
  { id: 'await-sans-expression', ligne: '{await}<p>b</p>{end}', motif: /\{await\} — l'expression à attendre manque/ },
  { id: 'await-sans-expression, *skeleton', ligne: '{await *skeleton}<p>w</p>{success x}<p>b</p>{end}', motif: /\{await \*skeleton\} — l'expression/ },
  { id: 'squelette-svg', ligne: '<svg>{await f() *skeleton}{success x}<g></g>{end}</svg>', motif: /dans un <svg>/ },
  { id: 'squelette-attente-ecrite', ligne: '{await f() *skeleton}<p>w</p>{success x}<p>{x}</p>{end}', motif: /la branche d'attente est déjà écrite/ },
  { id: 'squelette-sans-success', ligne: '{await f() *skeleton}{error err}<p>e</p>{end}', motif: /le squelette se tire de la branche \{success/ },
  { id: 'for-syntaxe-invalide', ligne: '{for x}<p>b</p>{end}', motif: /\{for x\} invalide/ },
  { id: 'for-by-chemin', ligne: '{for x in [1] by a.b}<p>b</p>{end}', motif: /« by a\.b »/ },
  { id: 'for-item-index-homonyme', ligne: '{for x, x in [1]}<p>b</p>{end}', motif: /ne peuvent pas porter le même nom/ },
  { id: 'fill-sans-nom', ligne: '<mjs-c><@fill>texte</@fill></mjs-c>', motif: /<@fill> sans nom/ },
  { id: 'fill-un-seul-nom', ligne: '<mjs-c><@fill a b><p>x</p></@fill></mjs-c>', motif: /un seul nom de slot/ },
  { id: 'fill-nom-dynamique', ligne: '<mjs-c><@fill {x}><p>x</p></@fill></mjs-c>', motif: /nom dynamique refusé/ },
  { id: 'fill-texte-nu, texte', ligne: '<mjs-c><@fill a>texte</@fill></mjs-c>', motif: /texte nu dans <@fill a>/ },
  { id: 'fill-texte-nu, expression', ligne: '<mjs-c><@fill a>{x}</@fill></mjs-c>', motif: /texte nu dans <@fill a>/ },
  { id: 'fill-imbrique', ligne: '<mjs-c><@fill a><@fill b><p>x</p></@fill></@fill></mjs-c>', motif: /<@fill> imbriqué/ },
  { id: 'fill-slot-deja-pose', ligne: '<mjs-c><@fill a><p slot="b">x</p></@fill></mjs-c>', motif: /porte déjà son propre slot=/ },
  { id: 'else-if-non-supporte', ligne: '{if $x}<p>b</p>{else if $k}<p>c</p>{end}', motif: /`\{else if …\}` n'existe pas/ },
  { id: 'const-syntaxe-invalide, bloc', ligne: '{const 1}', motif: /\{const …\} invalide/ },
  { id: 'const-syntaxe-invalide, jeton', ligne: '<p>b</p>{const = 1}', motif: /\{const …\} invalide/ },
  { id: 'const-expression-vide', ligne: '{const a = }', motif: /\{const a = …\} \(ligne .*expression vide/ },
  { id: 'await-imbrique-dans-await (générateur)', ligne: '{await f()}<p>w</p>{success x}{await g()}<p>w</p>{success y}<p>{y}</p>{end}{end}', motif: /imbriqué dans la branche d'un autre \{await\}/ },
  { id: 'await-imbrique-interdit (générateur)', ligne: '{for x in [1]}{await g()}<p>w</p>{success y}<p>{y}</p>{end}{end}', motif: /imbriqué dans un \{for\}/ },
  { id: 'attribut-booleen-false (générateur, avertissement)', ligne: '<input disabled="false">', motif: /<input disabled="false"> garde/ },
  { id: 'interpolation-civet-attribut (générateur, avertissement)', ligne: '<p title="a #{x}">b</p>', motif: /attribut "title"/ }
]

// la ligne citée par le message : « ligne 2 de sous/_h.mjs » → `sous/_h.mjs:2`, « ligne 2 » → `main.mjs:2` (« Ligne » en tête compris)
function citee(m: string): string | null {
  const d = /\b[Ll]igne (\d+) de ([\p{L}\w./-]+\.mjs)/u.exec(m)
  if (d) return `${d[2]}:${d[1]}`
  const l = /\b[Ll]igne (\d+)/.exec(m)
  return l ? `main.mjs:${l[1]}` : null
}

// le message de la construction de `main.mjs` qui répond au motif : l'erreur levée, la console, les erreurs des macros
async function message(id: string, fichiers: Record<string, string>, motif: RegExp): Promise<{ texte: string, dir: string }> {
  const dir = mjsTmp(`partiel-messages-${id.replace(/[^\w-]+/g, '-')}`)
  for (const [nom, texte] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(dir, nom)), { recursive: true })
    writeFileSync(join(dir, nom), texte)
  }
  const vus: string[] = []
  const orig = { warn: console.warn, error: console.error, log: console.log }
  console.warn = console.error = console.log = (...a: unknown[]) => { vus.push(a.map(String).join(' ')) }
  try {
    const r = await transpileFromMsg({ type: 'transpile', id: 1, content: fichiers['main.mjs'], moduleName: 'main', baseDir: dir, sourceDir: dir, preResolvedAssets: {} } as any)
    for (const m of r?.data?.macroErrors ?? []) vus.push(String(m))
  }
  catch (e: any) {
    vus.unshift(String(e?.message ?? e))
  }
  finally {
    Object.assign(console, orig)
  }
  const texte = vus.map(m => m.replace(/\x1b\[[0-9;]*m/g, '')).find(m => motif.test(m.replace(/\s+/g, ' '))) ?? `(aucun message ${motif}) ${vus.join(' | ').slice(0, 300)}`
  return { texte, dir }
}

describe('un refus du parseur dans un partiel cite sa ligne dans le partiel', function () {
  this.timeout(180000)

  const versants: Array<{ nom: string, fichiers: (l: string) => Record<string, string>, attendu: string, fichier: string }> = [
    { nom: 'partiel', fichiers: (l) => ({ 'main.mjs': J('<p>0</p>', '<p>1</p>', '<@include h>'), '_h.mjs': J('<p>a</p>', l) }), attendu: '_h.mjs:2', fichier: '_h.mjs' },
    { nom: 'partiel d\'un sous-dossier', fichiers: (l) => ({ 'main.mjs': J('<p>0</p>', '<p>1</p>', '<@include sous/h>'), 'sous/_h.mjs': J('<p>a</p>', l) }), attendu: 'sous/_h.mjs:2', fichier: 'sous/_h.mjs' },
    { nom: 'composant', fichiers: (l) => ({ 'main.mjs': J('<p>0</p>', l) }), attendu: 'main.mjs:2', fichier: 'main.mjs' }
  ]
  for (const f of fautes) {
    for (const v of versants) {
      it(`${f.id} — ${v.nom} : ${v.attendu}, et le fichier pour mjs check --json`, async () => {
        const { texte, dir } = await message(`${f.id}-${v.nom}`, v.fichiers(f.ligne), f.motif)
        assert.equal(citee(texte), v.attendu, texte.slice(0, 400))
        const d = toDiagnostic(texte, 'error', { root: dir, files: new Map([['main', join(dir, 'main.mjs')]]) })
        assert.deepEqual([d.file, d.line], [v.fichier, 2], JSON.stringify(d).slice(0, 400))
      })
    }
  }

  it('un enfant d\'un <@fill> écrit sur la troisième ligne du partiel : « ligne 3 de _h.mjs »', async () => {
    const { texte } = await message('fill-ligne-3', { 'main.mjs': J('<p>0</p>', '<p>1</p>', '<@include h>'), '_h.mjs': J('<mjs-c><@fill a>', '<p>x</p>', 'texte', '</@fill></mjs-c>') }, /texte nu dans <@fill a>/)
    assert.equal(citee(texte), '_h.mjs:3', texte.slice(0, 400))
  })

  it('un partiel versé par un autre partiel, dans un dossier voisin : son chemin depuis le dossier du composant', async () => {
    const fichiers = { 'pages/main.mjs': J('<p>0</p>', '<@include ../partiels/relais>'), 'partiels/_relais.mjs': J('<p>r</p>', '<@include h>'), 'partiels/_h.mjs': J('<p>a</p>', '{? 1a}<p>b</p>{end}') }
    const dir      = mjsTmp('partiel-messages-voisin')
    for (const [nom, texte] of Object.entries(fichiers)) {
      mkdirSync(dirname(join(dir, nom)), { recursive: true })
      writeFileSync(join(dir, nom), texte)
    }
    let refus = ''
    try {
      await transpileFromMsg({ type: 'transpile', id: 1, content: fichiers['pages/main.mjs'], moduleName: 'main', baseDir: join(dir, 'pages'), sourceDir: dir, preResolvedAssets: {} } as any)
    }
    catch (e: any) {
      refus = String(e?.message ?? e)
    }
    assert.match(refus, /\{\? 1a\} ligne 2 de \.\.\/partiels\/_h\.mjs/, refus.slice(0, 400))
  })
})

describe('un partiel versé en milieu de ligne : la faute de sa première ligne cite le partiel, celle du composant le composant', function () {
  this.timeout(180000)

  const cas: Array<{ id: string, fichiers: Record<string, string>, motif: RegExp, attendu: string }> = [
    { id: 'balise mal fermée', fichiers: { 'main.mjs': J('<p>0</p><@include haut>'), '_haut.mjs': J('<div><span>x</div>') }, motif: /<span>/, attendu: '_haut.mjs:1' },
    { id: '{for} sans in', fichiers: { 'main.mjs': J('<p>0</p><@include h>'), '_h.mjs': J('{for x}<p>b</p>{end}') }, motif: /\{for x\} invalide/, attendu: '_h.mjs:1' },
    { id: 'texte nu dans un <@fill>', fichiers: { 'main.mjs': J('<p>0</p><@include h>'), '_h.mjs': J('<mjs-c><@fill a>texte</@fill></mjs-c>') }, motif: /texte nu/, attendu: '_h.mjs:1' },
    { id: 'partiel d\'un sous-dossier, versé en deuxième ligne', fichiers: { 'main.mjs': J('<p>0</p>', '<p>1</p><@include sous/h>'), 'sous/_h.mjs': J('<p :zzz="a">b</p>', '<p>c</p>') }, motif: /:zzz/, attendu: 'sous/_h.mjs:1' },
    { id: 'faute du composant avant le partiel, sur sa ligne', fichiers: { 'main.mjs': J('<div><span>x</div><@include h>'), '_h.mjs': J('<p>a</p>') }, motif: /<span>/, attendu: 'main.mjs:1' },
    { id: 'faute du composant après le partiel, sur sa ligne', fichiers: { 'main.mjs': J('<@include haut><div><span>x</div>'), '_haut.mjs': J('<p>a</p>') }, motif: /<span>/, attendu: 'main.mjs:1' }
  ]
  for (const c of cas) {
    it(`${c.id} : ${c.attendu}`, async () => {
      const { texte } = await message(`melee-${c.id}`, c.fichiers, c.motif)
      assert.equal(citee(texte), c.attendu, texte.slice(0, 400))
    })
  }
})

describe('mjs check --json : la faute du parseur écrite dans un partiel donne ce fichier', function () {
  this.timeout(180000)

  const projets: Array<{ id: string, fichiers: Record<string, string>, motif: RegExp, attendu: [string, number] }> = [
    { id: '{for} sans in, partiel d\'un sous-dossier', fichiers: { 'menu.mjs': J('<p>0</p>', '<@include sous/h>'), 'sous/_h.mjs': J('<p>a</p>', '{for x}<p>b</p>{end}') }, motif: /\{for x\} invalide/, attendu: ['app/modularjs/sous/_h.mjs', 2] },
    { id: 'nom réservé (« Ligne » en tête du message)', fichiers: { 'menu.mjs': J('<p>0</p>', '<@include h>'), '_h.mjs': J('<p>a</p>', '{for el in [1]}<p>b</p>{end}') }, motif: /NOM RÉSERVÉ/, attendu: ['app/modularjs/_h.mjs', 2] },
    { id: '<@fill> sans nom', fichiers: { 'menu.mjs': J('<p>0</p>', '<@include h>'), '_h.mjs': J('<p>a</p>', '<mjs-c><@fill>texte</@fill></mjs-c>') }, motif: /<@fill> sans nom/, attendu: ['app/modularjs/_h.mjs', 2] },
    { id: 'nom de modèle, partiel d\'un dossier voisin', fichiers: { 'pages/menu.mjs': J('<p>0</p>', '<@include ../partiels/h>'), 'partiels/_h.mjs': J('<p>a</p>', '{? 1a}<p>b</p>{end}') }, motif: /un nom de modèle/, attendu: ['app/modularjs/partiels/_h.mjs', 2] }
  ]
  for (const p of projets) {
    it(`${p.id} : ${p.attendu.join(':')}`, () => {
      const root = mjsTmp('partiel-messages-json')
      for (const [nom, texte] of Object.entries(p.fichiers)) {
        mkdirSync(dirname(join(root, 'app', 'modularjs', nom)), { recursive: true })
        writeFileSync(join(root, 'app', 'modularjs', nom), texte)
      }
      const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'check', '--json', '--root', root], { cwd: repoRoot, encoding: 'utf-8' })
      let rapport = null as any
      try { rapport = JSON.parse(r.stdout) } catch { /* sortie illisible : assert plus bas */ }
      assert.ok(rapport !== null, `${r.stdout}\n--- stderr ---\n${r.stderr}`)
      const d = [...rapport.errors, ...rapport.warnings].find((e: any) => p.motif.test(e.message))
      assert.ok(d, JSON.stringify(rapport).slice(0, 600))
      assert.deepEqual([d.file, d.line], p.attendu, JSON.stringify(d).slice(0, 400))
    })
  }
})
