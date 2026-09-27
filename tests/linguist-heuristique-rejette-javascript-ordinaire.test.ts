// l'heuristique Linguist qui distingue un composant ModularJS (.mjs) d'un module JavaScript
// ordinaire (même extension) classait à tort deux fichiers JavaScript VALIDES en ModularJS :
// un module qui embarque un gabarit HTML dans une chaîne (un `<script>` isolé sur sa propre
// ligne, à l'intérieur d'un template literal), et un module dont un commentaire mentionne
// « @import » sans en avoir la syntaxe. Cette suite vérifie que les motifs collés dans
// heuristics.yml.entry reconnaissent encore tous les échantillons ModularJS réels et
// rejettent du JavaScript ordinaire, y compris ces deux cas.
//
// Linguist compile ces motifs avec Ruby/Oniguruma, pas avec le moteur JS : `^`/`$` y sont
// TOUJOURS ancrés par LIGNE (aucun réglage ne change ce comportement, contrairement à JS), et
// `\A` ancre en tête du FICHIER ENTIER. `\A` n'existe pas en JavaScript : le moteur le lit
// comme la lettre littérale « A », SANS erreur (`/\A/.test('A')` vaut `true`) — un piège
// silencieux qui validerait un motif changé de sens sans le dire. Pour tester ici le même sens
// qu'en Ruby, `compileCommeOniguruma` traduit le `\A` de tête en `^` SANS le flag `m` (« début
// de la chaîne entière », comportement par défaut de JS), et compile tout motif par ligne
// (`^…$`) AVEC le flag `m` pour retrouver le comportement toujours actif de Ruby. Les motifs
// eux-mêmes ne portent que des backreferences NUMÉROTÉES (`\1`), communes aux deux moteurs —
// aucune backreference nommée, aucun lookbehind.

import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const ICI          = dirname(fileURLToPath(import.meta.url))
const HEURISTIQUES = join(ICI, '..', 'editors', 'linguist', 'heuristics.yml.entry')
const SAMPLES_DIR  = join(ICI, '..', 'editors', 'linguist', 'samples')
const CORE_DIR     = join(ICI, '..', 'src', 'core-modules')

// le fichier collé n'est pas un document YAML autonome : deux sections séparées par un
// commentaire de transition (le bloc `extensions/rules`, puis le bloc `modularjs:` qui doit
// se coller sous `named_patterns:` ailleurs dans le vrai heuristics.yml). On isole la 2de
// section et on la dédente de 2 espaces pour la parser comme un mapping normal.
function chargerMotifsBruts (): string[] {
  const texte = readFileSync(HEURISTIQUES, 'utf8')
  const debut = texte.indexOf('\n  modularjs:')
  assert.ok(debut >= 0, 'section « modularjs: » introuvable dans heuristics.yml.entry')
  const fragment  = texte.slice(debut + 1).replace(/^  /gm, '')
  const doc: any  = parseYaml(fragment)
  assert.ok(Array.isArray(doc.modularjs) && doc.modularjs.length > 0, 'liste de motifs « modularjs » vide ou absente')
  return doc.modularjs
}

// traduit un motif écrit pour Oniguruma (Ruby, moteur réel de Linguist) en RegExp JS qui se
// comporte PAREIL, plutôt que de compiler le texte tel quel (cf. bannière de tête du fichier)
function compileCommeOniguruma (source: string): RegExp {
  if(source.startsWith('\\A')) return new RegExp('^' + source.slice(2))
  return new RegExp(source, 'm')
}

function estReconnuModularJS (motifs: RegExp[], contenu: string): boolean {
  return motifs.some((motif) => motif.test(contenu))
}

describe('heuristique Linguist .mjs — ModularJS contre JavaScript ordinaire', () => {
  let motifs: RegExp[] = []

  before(() => {
    motifs = chargerMotifsBruts().map(compileCommeOniguruma)
  })

  describe('échantillons réels — doivent rester reconnus', () => {
    const fichiers = [
      ...readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.mjs')).map((f) => join(SAMPLES_DIR, f)),
      ...readdirSync(CORE_DIR).filter((f) => f.endsWith('.mjs')).map((f) => join(CORE_DIR, f)),
    ]

    // garde muette : une liste vide ferait passer la suite pour verte sans avoir rien vérifié
    it('la liste des échantillons réels n\'est pas vide', () => {
      assert.ok(fichiers.length >= 10, `seulement ${fichiers.length} fichier(s) trouvé(s) sous samples/ + core-modules/`)
    })

    for(const chemin of fichiers) {
      it(`reconnaît ${chemin.replace(ICI, 'tests')}`, () => {
        const contenu = readFileSync(chemin, 'utf8')
        assert.ok(estReconnuModularJS(motifs, contenu), `aucun motif ne reconnaît ${chemin}`)
      })
    }

    it('le seul motif de tête (\\A\\s*<) suffit déjà à tous les reconnaître', () => {
      // preuve du raisonnement qui justifie d'avoir retiré les motifs <script>/<style>/<theme>
      // par LIGNE : le premier bloc d'un composant réel est toujours son tout premier octet
      const motifDeTete = motifs[0]
      const manques      = fichiers.filter((chemin) => !motifDeTete.test(readFileSync(chemin, 'utf8')))
      assert.deepEqual(manques, [], `fichiers qui ne commencent pas par un chevron : ${manques.join(', ')}`)
    })
  })

  describe('directives — forme réelle reconnue par son PROPRE motif', () => {
    // syntaxe reprise telle quelle de composants réels (src/transpiler/directives.ts et des
    // fichiers applicatifs qui en usent), une ligne par directive. Le motif de tête (\A\s*<)
    // est écarté ici : un contenu qui commence par <script> serait reconnu par lui seul, et le
    // test ne dirait plus rien du motif de la directive
    const positifs: Record<string, string> = {
      '@i18n':    '@i18n \'code\'\n\n<script>\n</script>\n',
      '@persist': '<script>\n  @persist $savedLocation\n</script>\n',
      '@import':  '@import trapFocus \'tuto/attachments.module.civet\'\n\n<script>\n</script>\n',
      '@routes':  '<script>\n  @routes =\n    \'app-view\':\n      \'/posts/(:id)\': \'post-page\'\n</script>\n',
      '@preload': '<script>\n  @preload on\n</script>\n',
    }

    for(const [nom, contenu] of Object.entries(positifs)) {
      it(`reconnaît la directive ${nom} sous sa forme réelle`, () => {
        const motifsDeDirective = motifs.slice(1)
        assert.ok(estReconnuModularJS(motifsDeDirective, contenu), `${nom} : aucun motif de directive ne matche « ${contenu.trim()} »`)
      })
    }

    it('@css et @display ne sont pas des motifs : leur forme de racine est refusée par le compilateur', () => {
      const motifsDeDirective = motifs.slice(1)
      assert.equal(estReconnuModularJS(motifsDeDirective, '@css reset base\n'), false)
      assert.equal(estReconnuModularJS(motifsDeDirective, '@display block\n'), false)
    })
  })

  describe('JavaScript ordinaire — ne doit jamais être pris pour du ModularJS', () => {
    const negatifs: Record<string, string> = {
      'module JS ordinaire, sans rien de spécial': `
export function sum (a, b) {
  return a + b
}
`,
      'gabarit HTML injecté depuis une chaîne (le <script> de la chaîne, pas du composant)': `
export function injectPreview (target) {
  const tpl = \`
<script>
  console.log('preview loaded')
</script>
\`
  target.innerHTML = tpl
}
`,
      'commentaire qui mentionne « @import » sans la syntaxe de la directive': `
/*
@import used to be handled by a bundler plugin here; this file no longer needs it.
*/
export function noop () {}
`,
      'commentaire qui mentionne « @persist » sans un $nom derrière': `
// remember to @persist your preferences somewhere before shipping this
export const FLAG = true
`,
      'commentaire qui mentionne « @routes » sans = ni [': `
// @routes are configured centrally by the router, not per component
export default {}
`,
      'commentaire qui mentionne « @preload » sans valeur reconnue': `
// use @preload wisely to avoid layout jank on slow connections
export function load () {}
`,
      'commentaire qui mentionne « @display » qui continue après la valeur': `
// @display block is only a suggestion here, see the full docs for details
export function style () {}
`,
      'commentaire qui mentionne « @i18n » sans section entre guillemets': `
// @i18n is intentionally unsupported in this legacy module
export const LABEL = 'ok'
`,
    }

    for(const [nom, contenu] of Object.entries(negatifs)) {
      it(`rejette : ${nom}`, () => {
        assert.equal(estReconnuModularJS(motifs, contenu), false, `un motif a reconnu à tort : « ${contenu.trim()} »`)
      })
    }
  })
})
