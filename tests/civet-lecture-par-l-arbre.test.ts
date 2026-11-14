// LA DÉCLARATION D'UNE VARIABLE DU SCRIPT SUIT LA LECTURE DE CIVET : CORPS DE CLASSE, PREMIÈRE AFFECTATION, PORTÉE.
//
// ModularJS déclare lui-même une variable affectée sans déclaration ; Civet compile le script sans `autoVar` ni `autoLet`.
// La passe ligne par ligne de ModularJS se trompait là où seule la structure du script tranche : un champ de classe ouvert
// par une forme qu'elle ne reconnaissait pas (`new class`, `enregistre class`, classe rendue par une fonction…) devenait
// une variable (« Identifier 'total' has already been declared », `NaN` masqué, `eval` refusé par l'analyseur) ; une
// réaffectation plus bas était déclarée après une première affectation qu'elle n'avait pas vue (« Cannot access 'o' before
// initialization ») ; une variable affectée dans un bloc `do` restait à ce bloc (« o is not defined »). L'arbre de Civet
// tranche désormais ces cas. Chaque cas est comparé à Civet seul avec `"civet autoVar"`, dont ModularJS suit la portée : la
// fonction entière (fermeture dans une boucle, lecture avant l'affectation dans une expression).
//
// Les déclarations que la passe note gardent leur ligne jusqu'à Civet, même quand le sucre de ModularJS ajoute une ligne en
// tête (déclaration de `µ_state` devant un commentaire) ; un nom affecté seulement dans une autre fonction (paramètre,
// variable propre) n'est pas déclaré dans celle où la passe l'avait posé, comme avec `"civet autoVar"`.
//
// Une variable affectée dans le corps d'une `function` (ou d'une méthode) est une variable de cette fonction, comme avec
// `"civet autoVar"`, sauf si la portée qui l'entoure l'affecte aussi : elle était partagée avec cette portée, d'où des valeurs
// fausses sans erreur (récursion, deux appels `async` en même temps, fonction qui en appelle une autre affectant le même nom).

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '@danielx/civet'
import { transpile } from '../src/transpiler/index.js'
import { compileServerFile } from '../src/cli/server-entry.js'
import { applyMjsSugarToScript, singletonsDeclares } from '../src/transpiler/sugar.js'
import { tokenize } from '../src/lexer/index.js'
import { getAdapter } from '../src/languages/index.js'
import { declarationsDeLaPasse, type DeclarationsDeLaPasse } from '../src/languages/civet-declarations.js'

const enLigne = (js: string) => 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
const message = (e: any) => 'erreur : ' + String(e?.message ?? e).split('\n')[0]

let dossier = ''
let numero  = 0

// valeur rendue par `f()` d'un fichier serveur compilé par ModularJS, ou le message de l'erreur
const valeurMjs = async (src: string): Promise<string> => {
  try {
    const fichier = join(dossier, `essai-${numero++}.server.mjs`)
    writeFileSync(fichier, src)
    const r   = await compileServerFile(fichier, dossier)
    const mod = await import((r.startsWith('file:') ? r : enLigne(r)) + '#' + numero)
    return JSON.stringify(await mod.f())
  }
  catch (e: any) {
    return message(e)
  }
}

// même chose, compilé par Civet seul avec `"civet autoVar"`
const valeurCivet = async (src: string): Promise<string> => {
  try {
    const js  = await compile('"civet autoVar"\n' + src, { js: true }) as unknown as string
    const mod = await import(enLigne(js) + '#' + numero++)
    return JSON.stringify(await mod.f())
  }
  catch (e: any) {
    return message(e)
  }
}

// formes d'en-tête de classe que la passe ligne par ligne ne reconnaissait pas ; `c` : le champ, dans le corps
const FORMES: [string, (c: string) => string][] = [
  ['enregistre class (appel implicite)', c => `enregistre = (K) -> K\nservice := enregistre class\n  ${c}\n`],
  ['enregistre class extends B', c => `class B\nenregistre = (K) -> K\nservice := enregistre class extends B\n  ${c}\n`],
  ['new class', c => `service := new class\n  ${c}\n`],
  ['new class extends B', c => `class B\nservice := new class extends B\n  ${c}\n`],
  ['(Base) -> class extends Base', c => `fabrique := (Base) -> class extends Base\n  ${c}\n`],
  ['(Base) => class extends Base', c => `fabrique := (Base) => class extends Base\n  ${c}\n`],
  ['if … then class', c => `K := if true then class\n  ${c}\n`],
  ['[class', c => `L := [class\n  ${c}\n]\n`],
  ['@@deco class A', c => `deco = (K) -> K\n@@deco class A\n  ${c}\n`],
]

// nom, champ, suite du script, valeur attendue
const CHAMPS: [string, string, string, string][] = [
  ['total', 'total = 0', 'total := 5\nexport f = -> total\n', '5'],
  ['NaN', 'NaN = 1', 'export f = -> Number.isNaN(NaN)\n', 'true'],
  ['eval', 'eval = 1', 'export f = -> typeof eval\n', '"function"'],
]

// nom, script, valeur attendue
const CAS: [string, string, string][] = [
  ['réaffectée plus bas, dans une fonction', 'export f = ->\n  o =\n    v: 1\n  o = {v: o.v + 1}\n  o.v\n', '2'],
  ['réaffectée plus bas, au premier niveau', 'o =\n  v: 1\no = {v: o.v + 1}\nexport f = -> o.v\n', '2'],
  ['affectée dans une condition puis plus bas', 'export f = ->\n  r = null\n  if m = /a(b)/.exec("ab")\n    r = m[1]\n  m = null\n  r\n', '"b"'],
  ['affectée dans une condition puis plus bas, au premier niveau', 'r = null\nif m = /a(b)/.exec("ab")\n  r = m[1]\nm = null\nexport f = -> r\n', '"b"'],
  ['affectée dans un bloc do', 'export f = ->\n  do\n    o = {v: 1}\n  o.v\n', '1'],
  ['affectée dans un bloc do, valeur à la ligne suivante', 'export f = ->\n  do\n    o =\n      v: 1\n  o.v\n', '1'],
  ['affectée dans un bloc ouvert par then', 'export f = ->\n  if true then\n    o = 1\n  o\n', '1'],
  ['fermeture dans une boucle', 'export f = ->\n  fs = []\n  for i of [1, 2, 3]\n    v = i\n    fs.push -> v\n  fs.map (g) -> g()\n', '[3,3,3]'],
  ['fermeture dans une boucle, valeur à la ligne suivante', 'export f = ->\n  fs = []\n  for i of [1, 2, 3]\n    v =\n      i\n    fs.push -> v\n  fs.map (g) -> g()\n', '[3,3,3]'],
  ['lue avant l\'expression qui l\'affecte', 'export f = ->\n  avant = String(o)\n  String(o = 1)\n  [avant, o]\n', '["undefined",1]'],
  ['faux en-tête de classe dans une chaîne', 'export f = ->\n  if "voir: class"\n    n = 1\n  n = n + 1\n  n\n', '2'],
]

describe('déclaration d\'une variable du script : lecture par l\'arbre de Civet', () => {
  before(() => { dossier = mkdtempSync(join(tmpdir(), 'mjs-lecture-arbre-')) })
  after(() => { rmSync(dossier, { recursive: true, force: true }) })

  for (const [forme, ecrire] of FORMES) {
    for (const [nom, champ, suite, attendu] of CHAMPS) {
      it(`champ ${nom} sous ${forme} : jamais une variable du script, comme Civet seul`, async () => {
        const src   = ecrire(champ) + suite
        const civet = await valeurCivet(src)
        assert.equal(await valeurMjs(src), civet, src)
        // un décorateur reste refusé par Node : seule compte alors l'égalité avec Civet seul
        if (!forme.startsWith('@@')) assert.equal(civet, attendu, src)
      })
    }
  }

  for (const [nom, src, attendu] of CAS) {
    it(`${nom} : comme Civet seul avec autoVar`, async () => {
      assert.equal(await valeurCivet(src), attendu, 'Civet seul')
      assert.equal(await valeurMjs(src), attendu, 'ModularJS')
    })
  }

  it('ne déclare aucun champ de `new class` dans le <script> d\'un composant', async () => {
    const { output } = await transpile('<script>\n  service := new class\n    NaN = 1\n    eval = 1\n    total = 0\n  total := 5\n  f = -> [service.total, total]\n</script>\n<p>{f()}</p>\n', { moduleName: 'essai' })
    assert.doesNotMatch(output, /\blet (?:NaN|eval|total) = undefined\b/, output)
  })

  it('déclare à la première affectation dans le <script> d\'un composant', async () => {
    const { output } = await transpile('<script>\no =\n  v: 1\no = {v: o.v + 1}\n</script>\n<p>{o.v}</p>\n', { moduleName: 'essai' })
    assert.equal(output.match(/\blet o\b/g)?.length, 1, output)
    assert.match(output, /\blet o = \{\s*v: 1/, output)
  })
})

// module `.civet` compilé comme le compile la construction (sucre de ModularJS, lexeur, puis Civet) : valeur rendue par
// `f()`, ou le message de l'erreur
const valeurModule = async (src: string): Promise<string> => {
  try {
    const passe    = declarationsDeLaPasse()
    const texte    = tokenize(applyMjsSugarToScript(src, 'civet', undefined, '<script module>', 1, undefined, passe), { moduleMode: true, singletons: singletonsDeclares(src), fileName: 'essai.civet.mjs', firstLine: 1 })
    const { code } = await getAdapter('civet').compileToJs(texte, { fileName: 'essai.civet.mjs', bare: true, declarerAffectations: true, declarationsDeLaPasse: passe })
    const mod      = await import(enLigne('const µ = {state: (o) => o}\n' + code) + '#' + numero++)
    return JSON.stringify(await mod.f())
  }
  catch (e: any) {
    return message(e)
  }
}

// déclarations notées par la passe que leur ligne ne porte plus dans le texte remis à Civet (ligne 1 pour la première)
const notesDecalees = (texte: string, passe: DeclarationsDeLaPasse): string[] => {
  const lignes         = texte.split('\n')
  const faux: string[] = []
  for (const [l, noms] of passe.enPlace) for (const nom of noms) if (!lignes[l]?.includes(`${nom} .=`)) faux.push(`${l + 1}:${nom}`)
  for (const [l, noms] of passe.hisses) for (const nom of noms) if (!lignes[l]?.includes(`${nom} .= undefined`)) faux.push(`${l + 1}:${nom}`)
  return faux
}

// sucre de ModularJS réécrit après la passe de déclaration : section, en-tête du script
const TETES: [string, string][] = [
  ['<script>', '# commentaire\nµ$total = 1\n'],
  ['<script module>', '# magasin partagé\nexport µ$$compteur = 0\n'],
  ['<script>', 'µ$total = 1  # compteur\n'],
  ['<script>', '$x = 0\nµdebug $x\n'],
  ['<script>', '$x = 0\nµinspect($x)\n'],
  ['<script>', 'µconsole\n'],
  ['<script>', '$x = 0\n$d = $x * 2\n§titre = "a"\n'],
]

// module `.civet` ouvert par un commentaire et qui emploie le magasin : champ de classe, bloc `do`, réaffectation plus bas
const MAGASIN = '# magasin partagé\nexport µ$$compteur = 0\nservice := new class\n  NaN = 1\navecDo = ->\n  do\n    o = {v: 1}\n  o.v\nreaffecte = ->\n  o =\n    v: 1\n  o = {v: o.v + 1}\n  o.v\nexport f = -> [Number.isNaN(NaN), avecDo(), reaffecte()]\n'

// nom que la passe déclare en tête du script, affecté ailleurs : cas, script, valeur attendue
const AILLEURS: [string, string, string][] = [
  ['champ de classe, même nom affecté dans une autre fonction', 'globalThis.lieuDEssai = {href: "ici"}\nclass Routeur\n  lieuDEssai = null\naller = (url) ->\n  lieuDEssai = url\n  lieuDEssai\nexport f = -> [lieuDEssai.href, aller("la"), new Routeur().lieuDEssai]\n', '["ici","la",null]'],
  ['champ de classe, même nom paramètre d\'une autre fonction', 'globalThis.lieuDEssai = {href: "ici"}\nclass Routeur\n  lieuDEssai = null\naller = (lieuDEssai) ->\n  lieuDEssai = "la"\n  lieuDEssai\nexport f = -> [lieuDEssai.href, aller("x"), new Routeur().lieuDEssai]\n', '["ici","la",null]'],
  ['champ de classe, même nom affecté dans un bloc du script', 'class Routeur\n  lieuDEssai = null\nif true\n  lieuDEssai = 1\nexport f = -> [lieuDEssai, new Routeur().lieuDEssai]\n', '[1,null]'],
  ['champ de classe, même nom affecté dans une branche d\'une fonction écrite plus haut', 'globalThis.lieuDEssai = {href: "ici"}\naller = (url) ->\n  if url\n    lieuDEssai = url\n  lieuDEssai\nclass Routeur\n  lieuDEssai = null\nexport f = -> [lieuDEssai?.href, aller("la"), new Routeur().lieuDEssai]\n', '["ici","la",null]'],
  ['champ de classe, même nom affecté par un if postfixe d\'une fonction écrite plus haut', 'globalThis.lieuDEssai = {href: "ici"}\naller = (url) ->\n  lieuDEssai = url if url\n  lieuDEssai\nclass Routeur\n  lieuDEssai = null\nexport f = -> [lieuDEssai?.href, aller("la"), new Routeur().lieuDEssai]\n', '["ici","la",null]'],
  ['champ de classe, même nom affecté dans trois fonctions', 'init = (n) ->\n  if n\n    total = n\n  total\nclass Panier\n  total = 0\na = ->\n  total = 1\n  b()\n  total\nb = ->\n  total = 2\nexport f = -> [a(), init(3), new Panier().total]\n', '[1,3,0]'],
]

// variable affectée dans le corps d'une `function` : une variable de cette fonction, sauf si la portée qui l'entoure
// l'affecte aussi ; cas, script, valeur attendue
const CORPS_DE_FUNCTION: [string, string, string][] = [
  ['deux fonctions affectent le même nom, l\'une appelle l\'autre', 'function aire(r)\n  t = r * r\n  t * 3\nfunction anneau(r1, r2)\n  t = aire(r1)\n  u = aire(r2)\n  t - u\nexport f = -> anneau(3, 2)\n', '15'],
  ['récursion', 'function compte(n)\n  a = n\n  if n > 0 then compte(n - 1)\n  a\nexport f = -> compte(3)\n', '3'],
  ['deux appels async en même temps', 'function attend(v, ms)\n  r = v\n  await new Promise (ok) -> setTimeout(ok, ms)\n  r\nexport f = -> Promise.all [attend("a", 20), attend("b", 5)]\n', '["a","b"]'],
  ['affectée dans une branche', 'function signe(n)\n  if n < 0\n    s = "moins"\n  else\n    s = "plus"\n  s\nfunction double(n)\n  s = n * 2\n  [signe(n), s]\nexport f = -> double(-1)\n', '["moins",-2]'],
  ['lue par une autre fonction', 'aller = function()\n  etat = "la"\nlire = -> typeof etat\nexport f = -> [lire(), aller(), lire()]\n', '["undefined","la","undefined"]'],
  ['paramètre réaffecté, du nom d\'une valeur globale', 'globalThis.lieuDEssai = {href: "ici"}\nfunction aller(lieuDEssai)\n  lieuDEssai = "la"\n  lieuDEssai\nexport f = -> [lieuDEssai.href, aller("x")]\n', '["ici","la"]'],
  ['affectée aussi au premier niveau : la variable du script', 'n = 1\nfunction incremente()\n  n = n + 1\nexport f = -> [incremente(), n]\n', '[2,2]'],
  ['affectée aussi dans une branche du premier niveau : la variable du script', 'if true\n  n = 1\nfunction incremente()\n  n = n + 1\nexport f = -> [incremente(), n]\n', '[2,2]'],
  ['méthode d\'une classe', 'class Compteur\n  compte(n)\n    k = n\n    if n > 0 then @compte(n - 1)\n    k\nexport f = -> new Compteur().compte(2)\n', '2'],
]

describe('déclaration d\'une variable du script : notes de la passe et portée du nom', () => {
  before(() => { dossier = mkdtempSync(join(tmpdir(), 'mjs-notes-passe-')) })
  after(() => {
    rmSync(dossier, { recursive: true, force: true })
    delete (globalThis as any).lieuDEssai
  })

  for (const [section, tete] of TETES) {
    it(`chaque déclaration notée reste à sa ligne jusqu'à Civet : ${section} ${JSON.stringify(tete)}`, () => {
      const src    = tete + 'a = 1\nf = ->\n  if a\n    o = 1\n  o\n'
      const passe  = declarationsDeLaPasse()
      const module = section === '<script module>'
      const texte  = tokenize(applyMjsSugarToScript(src, 'civet', undefined, section, 1, undefined, passe), module ? { moduleMode: true, singletons: singletonsDeclares(src), fileName: 'essai.module', firstLine: 1 } : { fileName: 'essai.script', firstLine: 1 })
      assert.ok(passe.enPlace.size + passe.hisses.size >= 2, `notes : ${JSON.stringify([...passe.enPlace, ...passe.hisses])}`)
      assert.deepEqual(notesDecalees(texte, passe), [], texte)
    })
  }

  it('module .civet ouvert par un commentaire et qui emploie le magasin : comme Civet seul', async () => {
    const civet = await valeurCivet(MAGASIN.split('\n').slice(2).join('\n'))
    assert.equal(civet, '[true,1,2]', 'Civet seul, sans l\'en-tête')
    assert.equal(await valeurModule(MAGASIN), civet, 'ModularJS')
  })

  it('ne déclare aucun champ de classe dans le <script> d\'un composant ouvert par un commentaire qui emploie µ$', async () => {
    const { output } = await transpile('<script># commentaire\nµ$total = 1\nclass A\n  NaN = 1\nf = -> Number.isNaN(NaN)\n</script>\n<p>{f()}</p>\n', { moduleName: 'essai' })
    assert.doesNotMatch(output, /\blet NaN = undefined\b/, output)
  })

  for (const [nom, src, attendu] of AILLEURS) {
    it(`${nom} : comme Civet seul avec autoVar`, async () => {
      assert.equal(await valeurCivet(src), attendu, 'Civet seul')
      assert.equal(await valeurMjs(src), attendu, 'ModularJS')
    })
  }

  for (const [nom, src, attendu] of CORPS_DE_FUNCTION) {
    it(`variable affectée dans le corps d'une function, ${nom} : comme Civet seul avec autoVar`, async () => {
      assert.equal(await valeurCivet(src), attendu, 'Civet seul')
      assert.equal(await valeurMjs(src), attendu, 'ModularJS')
    })
  }

  it('variable affectée dans le corps d\'une function : déclarée dans cette fonction, jamais en tête du script', async () => {
    const { output } = await transpile('<script>\nfunction aire(r)\n  t = r * r\n  t * 3\n</script>\n<p>{aire(2)}</p>\n', { moduleName: 'essai' })
    assert.doesNotMatch(output.split('function aire')[0], /\blet t\b/, output)
    assert.match(output, /function aire\(r\) \{\s*let t\b/, output)
  })
})
