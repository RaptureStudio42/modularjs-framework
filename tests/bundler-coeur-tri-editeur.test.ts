// La construction n'envoie de l'éditeur de texte riche (<@@editor>, <@@toolbar>) que ce que l'appli peut utiliser, avec les repères `@@` du
// fichier de chaque module (même mécanisme que `other` de <@@select>) :
// - le mode « répondre » (attribut `answer`) : son code, ses lignes à cocher et leur style ne partent que si une page écrit `answer` (l'attribut `paste`
//   ne pèse que 15 octets gzip : il n'a pas de morceau à part) ;
// - chaque outil (`h2 h3 quote bold italic underline strike ul ol check link undo redo clear`) : l'icône et le dessin du bouton, et pour le lien sa ligne
//   d'adresse, pour les cases à cocher la fabrication d'une liste, ne partent que si l'appli peut afficher l'outil. Elle le peut quand une de ses balises
//   `<@@editor>` n'a pas d'attribut `toolbar` (ou `<@@toolbar>` pas de `tools`), a une valeur calculée ou un étalement `{...p}` (le build ne sait pas), ou
//   nomme l'outil. Ce qui AFFICHE une liste à cocher déjà présente dans la valeur et la coche ne dépend d'aucun outil.
// - un éditeur « répondre » écrit tel quel (`answer`, `answer="true"`) n'affiche jamais sa barre : sa liste `toolbar` ne compte pas, il n'est pas « tous les outils » ;
//   `answer={…}`, `answer="false"` (toute casse : `"FALSE"`, `"False"`, qui laissent le mode éteint) ou un étalement gardent la règle prudente ;
// - le raccourci du lien et celui des cases n'agissent que si la barre de l'éditeur montre l'outil : le petit code qui interroge les barres (editor.mjs) et l'inscription de
//   la barre auprès de son éditeur (toolbar.mjs) ne partent que si l'appli peut montrer l'un des deux outils ;
// - l'avertissement du développement quand un script pose `answer` alors qu'aucune page ne l'écrit, comme celui de `other` de <@@select> ;
// - le message d'un nom d'outil inconnu est rangé avec les messages de la console : ni son texte ni sa traduction ne sont dans la barre envoyée.
// Le développement prend la même décision que la production. Elle est prise sur les seules pages du projet, avant qu'un module cœur ne soit compilé : l'éditeur écrit lui-même
// une `<@@toolbar tools={…}>` calculée dans son gabarit, qui ne doit pas compter.
//
// Statique, avec un Bundler réel et le catalogue réel du framework, sur le texte non minifié (les noms du code y survivent).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { selectCoreSections, RESUME_LABEL } from '../src/bundler/core-sections.js'
import { mjsTmp } from './helpers/tmp.js'

type Chunks = { editeur: string, barre: string }

const SCRIPT = '<script>\n  $v = \'<p>x</p>\'\n  $c = [0]\n  $t = \'bold\'\n  $p = {}\n</script>\n'

// ce que chaque morceau laisse dans le code envoyé (noms du code et textes qui survivent à la minification)
const REPONDRE = ['answerHtml', 'lineTag', 'keysOf', 'tickAt', 'answerKey', 'syncTicks', 'aria-checked']
const LIEN     = ['openLink', 'applyLink', 'removeLink', 'closeLink', 'urlOf', 'createLink', 'link-url']
const CASES    = ['listAfter']
// ce qui affiche une liste à cocher et la coche : jamais lié à un outil
const TOUJOURS = ['readBlocks', 'boxHit', 'toggleCheck', 'data-checklist', 'fixup']

// l'interrogation des barres par l'éditeur (le raccourci du lien et des cases), et l'inscription de la barre auprès de son éditeur
const CLES_EDITEUR = ['barShows']
const CLES_BARRE   = ['_mjsBars']
const AVIS_ANSWER  = 'dev.editorAnswerScript'
const INCONNU      = 'coreToolbarUnknown'

// la barre : l'entrée de chaque outil (clé du libellé) et le dessin de son icône
const BARRE_LIEN  = ['toolLink', 'M6.8 9.2a3']
const BARRE_CASES = ['toolCheck', 'M2.7 4.6l1.2']
const BARRE_UL    = ['toolUl', '<circle']
const BARRE_OL    = ['toolOl', '<text x']
const BARRE_UNDO  = ['toolUndo', 'M5.5 3.5L2.5']
const BARRE_REDO  = ['toolRedo', 'M10.5 3.5l3']
const BARRE_CLEAR = ['toolClear', 'M2.5 3.5h8']
const BARRE_GRAS  = ['toolBold', 'g-bold']
const BARRE_ITAL  = ['toolItalic', 'g-italic']
const BARRE_SOUL  = ['toolUnderline', 'g-underline']
const BARRE_BARRE = ['toolStrike', 'g-strike']
const BARRE_TITRE = ['toolH2', 'toolH3', 'g-head']
// le style des icônes, celui des lettres, et le séparateur d'une liste : propres à un groupe d'outils
const BARRE_ICONES = ['.ico{']
const BARRE_LETTRES = ['.glyph{']
const BARRE_SEPARATEUR = ["role='separator'"]
const BARRE_CITE  = ['toolQuote', 'g-quote']
const BARRE_TOUT  = [...BARRE_LIEN, ...BARRE_CASES, ...BARRE_UL, ...BARRE_OL, ...BARRE_UNDO, ...BARRE_REDO, ...BARRE_CLEAR, ...BARRE_GRAS, ...BARRE_ITAL, ...BARRE_SOUL, ...BARRE_BARRE, ...BARRE_TITRE, ...BARRE_CITE, ...BARRE_ICONES, ...BARRE_LETTRES, ...BARRE_SEPARATEUR]

async function construire(prefixe: string, source: string, options: Record<string, unknown> = { env: 'prod' }): Promise<Chunks> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hote.mjs'), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), js: 'split', minify: false, ...options } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
  const fichiers = readdirSync(outDir)
  const lire     = (re: RegExp): string => {
    const f = fichiers.find((x) => re.test(x))
    assert.ok(f, `${re} attendu parmi : ${fichiers.join(', ')}`)
    return readFileSync(join(outDir, f!), 'utf-8')
  }
  return { editeur: lire(/^core-editor-.*\.js$/), barre: lire(/^core-toolbar-.*\.js$/) }
}

const pose = (code: string, marqueurs: string[], dit: string): void => {
  for (const m of marqueurs) assert.ok(code.includes(m), `${dit} : « ${m} » attendu`)
}

const absent = (code: string, marqueurs: string[], dit: string): void => {
  for (const m of marqueurs) assert.ok(!code.includes(m), `${dit} : « ${m} » ne devrait pas être envoyé`)
}

const page = (balises: string): string => SCRIPT + balises + '\n'

describe('éditeur riche — la production n\'envoie que ce que l\'appli utilise', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('le mode « répondre » (attribut answer)', () => {
    it('aucune page n\'écrit answer : ni son code, ni ses lignes à cocher ; l\'affichage et le cochage d\'une liste restent', async () => {
      const c = await construire('allege-sans-answer', page('<@@editor name="e" value=!{$v}></@@editor>'))
      absent(c.editeur, REPONDRE, 'sans answer')
      pose(c.editeur, TOUJOURS, 'sans answer')
    })

    for (const [forme, balise] of [
      ['answer nu', '<@@editor name="e" answer value={$v} checked=!{$c}></@@editor>'],
      ['answer="true"', '<@@editor name="e" answer="true" value={$v} checked=!{$c}></@@editor>'],
      ['answer={$c}', '<@@editor name="e" answer={$c} value={$v}></@@editor>'],
      ['answer=!{$c}', '<@@editor name="e" answer=!{$c} value={$v}></@@editor>'],
      ['la balise littérale', '<mjs-core-editor name="e" answer value={$v} checked=!{$c}></mjs-core-editor>'],
    ] as const) {
      it(`une page écrit ${forme} : le mode « répondre » reste`, async () => {
        const c = await construire('allege-answer', page(balise))
        pose(c.editeur, [...REPONDRE, ...TOUJOURS], forme)
      })
    }

    it('un étalement {...p} sur la balise : le build ne sait pas, tout reste', async () => {
      const c = await construire('allege-answer-etalement', page('<@@editor name="e" {...$p} value=!{$v}></@@editor>'))
      pose(c.editeur, REPONDRE, 'étalement')
    })

    it('answer sur une autre balise ou dans un autre attribut ne compte pas', async () => {
      const c = await construire('allege-answer-ailleurs', page('<@@editor name="answer" value=!{$v} placeholder="answer"></@@editor><div answer></div><@@checkbox name="c" answer></@@checkbox>'))
      absent(c.editeur, REPONDRE, 'answer ailleurs')
    })

    it('le développement tranche comme la production : sans answer, ni son code, ni ses lignes à cocher', async () => {
      const c = await construire('allege-answer-dev', page('<@@editor name="e" value=!{$v}></@@editor>'), { env: 'dev' })
      absent(c.editeur, REPONDRE, 'développement')
      pose(c.editeur, TOUJOURS, 'développement')
    })
  })

  describe('un éditeur « répondre » n\'affiche jamais sa barre : il ne compte pas comme « tous les outils »', () => {
    for (const [forme, balise] of [
      ['answer nu', '<@@editor name="e" answer value={$v} checked=!{$c}></@@editor>'],
      ['answer=""', '<@@editor name="e" answer="" value={$v} checked=!{$c}></@@editor>'],
      ['answer="true"', '<@@editor name="e" answer="true" value={$v} checked=!{$c}></@@editor>'],
      ['answer nu et toolbar="bold italic" (la liste ne s\'affiche jamais)', '<@@editor name="e" answer toolbar="bold italic" value={$v} checked=!{$c}></@@editor>'],
      ['la balise littérale', '<mjs-core-editor name="e" answer value={$v} checked=!{$c}></mjs-core-editor>'],
    ] as const) {
      it(`${forme} : le mode reste, aucun outil n'est envoyé`, async () => {
        const c = await construire('allege-rep-sans-barre', page(balise))
        pose(c.editeur, [...REPONDRE, ...TOUJOURS], forme)
        absent(c.editeur, [...LIEN, ...CASES, ...CLES_EDITEUR], forme)
        absent(c.barre, [...BARRE_TOUT, ...CLES_BARRE], forme)
      })
    }

    for (const [forme, balise] of [
      ['answer="false"', '<@@editor name="e" answer="false" value=!{$v}></@@editor>'],
      ['answer="FALSE"', '<@@editor name="e" answer="FALSE" value=!{$v}></@@editor>'],
      ['answer="False"', '<@@editor name="e" answer="False" value=!{$v}></@@editor>'],
      ['answer={$c}', '<@@editor name="e" answer={$c} value={$v}></@@editor>'],
      ['answer=!{$c}', '<@@editor name="e" answer=!{$c} value={$v}></@@editor>'],
      ['answer="{$t}"', '<@@editor name="e" answer="{$t}" value={$v}></@@editor>'],
      ['un étalement {...p}', '<@@editor name="e" answer {...$p} value={$v}></@@editor>'],
    ] as const) {
      it(`${forme} : le build ne sait pas si la barre s'affiche, tous les outils`, async () => {
        const c = await construire('allege-rep-prudent', page(balise))
        pose(c.editeur, [...LIEN, ...CASES, ...CLES_EDITEUR], forme)
        pose(c.barre, [...BARRE_TOUT, ...CLES_BARRE], forme)
      })
    }

    it('un éditeur « répondre » et un éditeur restreint : seuls les outils du second', async () => {
      const c = await construire('allege-rep-et-restreint', page('<@@editor name="a" answer toolbar="check" value={$v} checked=!{$c}></@@editor><@@editor name="b" toolbar="bold italic" value=!{$v}></@@editor>'))
      pose(c.barre, [...BARRE_GRAS, ...BARRE_ITAL], 'répondre et restreint')
      absent(c.barre, [...BARRE_CASES, ...BARRE_LIEN, ...BARRE_UL, ...BARRE_UNDO], 'répondre et restreint')
      absent(c.editeur, [...LIEN, ...CASES], 'répondre et restreint')
      pose(c.editeur, REPONDRE, 'répondre et restreint')
    })

    it('une barre séparée sans tools qui vise l\'éditeur « répondre » : ses boutons existent (grisés), tous les outils', async () => {
      const c = await construire('allege-rep-barre-separee', page('<@@toolbar for="z"></@@toolbar><@@editor id="z" answer value={$v} checked=!{$c}></@@editor>'))
      pose(c.barre, BARRE_TOUT, 'barre séparée')
    })

    it('un éditeur « répondre » et une barre séparée restreinte : les outils de la barre séparée seuls', async () => {
      const c = await construire('allege-rep-barre-restreinte', page('<@@toolbar for="z" tools="underline"></@@toolbar><@@editor id="z" answer value={$v} checked=!{$c}></@@editor>'))
      pose(c.barre, BARRE_SOUL, 'barre séparée restreinte')
      absent(c.barre, [...BARRE_LIEN, ...BARRE_GRAS], 'barre séparée restreinte')
    })
  })

  describe('les outils : le code et l\'icône ne partent que si l\'appli peut afficher l\'outil', () => {
    it('toolbar="bold italic" : ni le lien, ni les cases à fabriquer, ni les icônes ; gras et italique restent', async () => {
      const c = await construire('allege-bi', page('<@@editor name="e" toolbar="bold italic" value=!{$v}></@@editor>'))
      absent(c.editeur, [...LIEN, ...CASES], 'barre bold italic, éditeur')
      pose(c.editeur, TOUJOURS, 'barre bold italic, éditeur')
      pose(c.barre, [...BARRE_GRAS, ...BARRE_ITAL], 'barre bold italic, barre')
      absent(c.barre, [...BARRE_LIEN, ...BARRE_CASES, ...BARRE_UL, ...BARRE_OL, ...BARRE_UNDO, ...BARRE_REDO, ...BARRE_CLEAR, ...BARRE_SOUL, ...BARRE_BARRE, ...BARRE_TITRE, ...BARRE_CITE], 'barre bold italic, barre')
      pose(c.barre, BARRE_LETTRES, 'barre bold italic, lettres')
      absent(c.barre, [...BARRE_ICONES, ...BARRE_SEPARATEUR], 'barre bold italic, icônes et séparateur')
    })

    it('un séparateur | dans une liste : sa ligne et son style restent ; sans lui ils partent', async () => {
      const avec = await construire('allege-separateur', page('<@@editor name="e" toolbar="bold | italic" value=!{$v}></@@editor>'))
      pose(avec.barre, [...BARRE_SEPARATEUR, ...BARRE_GRAS, ...BARRE_ITAL], 'avec séparateur')
      const sans = await construire('allege-sans-separateur', page('<@@editor name="e" toolbar="bold italic" value=!{$v}></@@editor>'))
      absent(sans.barre, BARRE_SEPARATEUR, 'sans séparateur')
    })

    it('que des icônes (toolbar="link undo") : pas de style de lettres ni de titres ; que des lettres : pas de style d\'icônes', async () => {
      const icones = await construire('allege-icones', page('<@@editor name="e" toolbar="link undo" value=!{$v}></@@editor>'))
      pose(icones.barre, [...BARRE_ICONES, ...BARRE_LIEN, ...BARRE_UNDO], 'que des icônes')
      absent(icones.barre, [...BARRE_LETTRES, ...BARRE_TITRE, ...BARRE_GRAS], 'que des icônes')
      const lettres = await construire('allege-lettres', page('<@@editor name="e" toolbar="h2 quote" value=!{$v}></@@editor>'))
      pose(lettres.barre, [...BARRE_LETTRES, 'toolH2', 'g-head', ...BARRE_CITE], 'que des lettres')
      absent(lettres.barre, [...BARRE_ICONES, ...BARRE_LIEN, 'toolH3'], 'que des lettres')
    })

    it('sans attribut toolbar : tous les outils', async () => {
      const c = await construire('allege-tous', page('<@@editor name="e" value=!{$v}></@@editor>'))
      pose(c.editeur, [...LIEN, ...CASES], 'sans toolbar, éditeur')
      pose(c.barre, BARRE_TOUT, 'sans toolbar, barre')
    })

    it('toolbar vide (toolbar="") ou sans valeur (toolbar) : tous les outils, comme l\'éditeur', async () => {
      const a = await construire('allege-vide', page('<@@editor name="e" toolbar="" value=!{$v}></@@editor>'))
      pose(a.editeur, LIEN, 'toolbar=""')
      pose(a.barre, BARRE_TOUT, 'toolbar=""')
      const b = await construire('allege-booleen', page('<@@editor name="e" toolbar value=!{$v}></@@editor>'))
      pose(b.editeur, LIEN, 'toolbar nu')
      pose(b.barre, BARRE_TOUT, 'toolbar nu')
    })

    it('une entité HTML dans la liste (toolbar="bold&#32;link") : le navigateur la lit autrement, tous les outils', async () => {
      const c = await construire('allege-entite', page('<@@editor name="e" toolbar="bold&#32;link" value=!{$v}></@@editor>'))
      pose(c.editeur, LIEN, 'entité')
      pose(c.barre, BARRE_TOUT, 'entité')
    })

    it('une valeur calculée (toolbar={$t}, toolbar=!{$t}, toolbar="bold {$t}") : tous les outils', async () => {
      for (const [i, balise] of [
        '<@@editor name="e" toolbar={$t} value=!{$v}></@@editor>',
        '<@@editor name="e" toolbar=!{$t} value=!{$v}></@@editor>',
        '<@@editor name="e" toolbar="bold {$t}" value=!{$v}></@@editor>',
      ].entries()) {
        const c = await construire('allege-calcule' + i, page(balise))
        pose(c.editeur, [...LIEN, ...CASES], balise)
        pose(c.barre, BARRE_TOUT, balise)
      }
    })

    it('un étalement {...p} : tous les outils', async () => {
      const c = await construire('allege-tous-etalement', page('<@@editor name="e" toolbar="bold" {...$p} value=!{$v}></@@editor>'))
      pose(c.editeur, [...LIEN, ...CASES], 'étalement')
      pose(c.barre, BARRE_TOUT, 'étalement')
    })

    it('une seule balise sans toolbar parmi d\'autres restreintes : tous les outils', async () => {
      const c = await construire('allege-une-complete', page('<@@editor name="a" toolbar="bold" value=!{$v}></@@editor><@@editor name="b" value=!{$v}></@@editor>'))
      pose(c.editeur, LIEN, 'une barre complète')
      pose(c.barre, BARRE_TOUT, 'une barre complète')
    })

    it('plusieurs éditeurs restreints : l\'union de leurs outils (le séparateur | n\'est pas un outil)', async () => {
      const c = await construire('allege-union', page('<@@editor name="a" toolbar="bold | link" value=!{$v}></@@editor><@@editor name="b" toolbar="  check   undo " value=!{$v}></@@editor>'))
      pose(c.editeur, [...LIEN, ...CASES], 'union')
      pose(c.barre, [...BARRE_GRAS, ...BARRE_LIEN, ...BARRE_CASES, ...BARRE_UNDO], 'union')
      absent(c.barre, [...BARRE_ITAL, ...BARRE_UL, ...BARRE_OL, ...BARRE_REDO, ...BARRE_CLEAR, ...BARRE_SOUL, ...BARRE_BARRE, ...BARRE_TITRE, ...BARRE_CITE], 'union')
    })

    it('toolbar="link" seul : le lien reste, les cases partent', async () => {
      const c = await construire('allege-lien', page('<@@editor name="e" toolbar="link" value=!{$v}></@@editor>'))
      pose(c.editeur, LIEN, 'toolbar link')
      absent(c.editeur, CASES, 'toolbar link')
      pose(c.barre, BARRE_LIEN, 'toolbar link')
      absent(c.barre, BARRE_CASES, 'toolbar link')
    })

    it('toolbar="check" seul : les cases à fabriquer restent, le lien part', async () => {
      const c = await construire('allege-cases', page('<@@editor name="e" toolbar="check" value=!{$v}></@@editor>'))
      pose(c.editeur, CASES, 'toolbar check')
      absent(c.editeur, LIEN, 'toolbar check')
      pose(c.barre, BARRE_CASES, 'toolbar check')
    })

    it('toolbar="none" et aucune barre séparée : aucun outil, mais l\'affichage et le cochage d\'une liste restent', async () => {
      const c = await construire('allege-aucun', page('<@@editor name="e" toolbar="none" value=!{$v}></@@editor>'))
      absent(c.editeur, [...LIEN, ...CASES], 'toolbar none')
      pose(c.editeur, TOUJOURS, 'toolbar none')
      absent(c.barre, BARRE_TOUT, 'toolbar none')
    })

    it('une barre séparée : ses tools comptent (<@@toolbar tools="link">), un éditeur toolbar="none" à côté', async () => {
      const c = await construire('allege-barre-seule', page('<@@toolbar for="z" tools="link bold"></@@toolbar><@@editor id="z" toolbar="none" value=!{$v}></@@editor>'))
      pose(c.editeur, LIEN, 'barre séparée')
      absent(c.editeur, CASES, 'barre séparée')
      pose(c.barre, [...BARRE_LIEN, ...BARRE_GRAS], 'barre séparée')
      absent(c.barre, [...BARRE_CASES, ...BARRE_ITAL], 'barre séparée')
    })

    it('une barre séparée sans tools : tous les outils', async () => {
      const c = await construire('allege-barre-complete', page('<@@toolbar for="z"></@@toolbar><@@editor id="z" toolbar="bold" value=!{$v}></@@editor>'))
      pose(c.editeur, LIEN, 'barre séparée sans tools')
      pose(c.barre, BARRE_TOUT, 'barre séparée sans tools')
    })

    it('une barre séparée à tools calculés : tous les outils', async () => {
      const c = await construire('allege-barre-calculee', page('<@@toolbar for="z" tools={$t}></@@toolbar><@@editor id="z" toolbar="none" value=!{$v}></@@editor>'))
      pose(c.editeur, LIEN, 'barre à tools calculés')
      pose(c.barre, BARRE_TOUT, 'barre à tools calculés')
    })

    it('la balise littérale mjs-core-editor et mjs-core-toolbar comptent comme <@@editor> et <@@toolbar>', async () => {
      const c = await construire('allege-litteral', page('<mjs-core-editor name="e" toolbar="check" value=!{$v}></mjs-core-editor><mjs-core-toolbar for="z" tools="undo"></mjs-core-toolbar>'))
      pose(c.editeur, CASES, 'balises littérales')
      absent(c.editeur, LIEN, 'balises littérales')
      pose(c.barre, [...BARRE_CASES, ...BARRE_UNDO], 'balises littérales')
      absent(c.barre, BARRE_LIEN, 'balises littérales')
    })

    it('l\'attribut tools sur un éditeur (ou toolbar sur une barre) n\'est pas la liste d\'outils : tous les outils', async () => {
      const c = await construire('allege-mauvais-attribut', page('<@@editor name="e" tools="bold" value=!{$v}></@@editor>'))
      pose(c.editeur, LIEN, 'tools sur un éditeur')
      pose(c.barre, BARRE_TOUT, 'tools sur un éditeur')
    })

    it('un composant du projet qui enveloppe l\'éditeur compte comme une page', async () => {
      const root   = mjsTmp('allege-enveloppe')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'hote.mjs'), '<@riche></@riche>\n')
      writeFileSync(join(srcDir, 'riche.mjs'), page('<@@editor name="e" toolbar="underline" value=!{$v}></@@editor>'))
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), js: 'split', minify: false, env: 'prod' } as any)
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: Error) => e.message).join('\n'))
      const barre = readFileSync(join(root, 'out', readdirSync(join(root, 'out')).find((f) => /^core-toolbar-/.test(f))!), 'utf-8')
      pose(barre, BARRE_SOUL, 'composant enveloppe')
      absent(barre, [...BARRE_LIEN, ...BARRE_GRAS], 'composant enveloppe')
    })

    it('le développement tranche comme la production, avec une barre restreinte', async () => {
      const c = await construire('allege-dev', page('<@@editor name="e" toolbar="bold" value=!{$v}></@@editor>'), { env: 'dev' })
      absent(c.editeur, [...LIEN, ...CASES, ...REPONDRE, ...CLES_EDITEUR], 'développement, éditeur')
      pose(c.editeur, TOUJOURS, 'développement, éditeur')
      pose(c.barre, BARRE_GRAS, 'développement, barre')
      absent(c.barre, [...BARRE_LIEN, ...BARRE_CASES, ...BARRE_UL, ...BARRE_OL, ...BARRE_UNDO, ...BARRE_REDO, ...BARRE_CLEAR, ...BARRE_ITAL, ...BARRE_SOUL, ...BARRE_BARRE, ...BARRE_TITRE, ...BARRE_CITE, ...CLES_BARRE], 'développement, barre')
    })

    it('la page « répondre » à barre restreinte : le mode reste, le lien part', async () => {
      const c = await construire('allege-repondre-restreint', page('<@@editor name="e" answer toolbar="bold" value={$v} checked=!{$c}></@@editor>'))
      pose(c.editeur, [...REPONDRE, ...TOUJOURS], 'répondre, barre restreinte')
      absent(c.editeur, [...LIEN, ...CASES], 'répondre, barre restreinte')
    })

    it('l\'interrogation des barres (raccourcis du lien et des cases) et l\'inscription de la barre ne partent que si l\'appli peut montrer l\'un des deux outils', async () => {
      const sans = await construire('allege-cles-sans', page('<@@editor name="e" toolbar="bold italic undo" value=!{$v}></@@editor>'))
      absent(sans.editeur, CLES_EDITEUR, 'sans lien ni cases, éditeur')
      absent(sans.barre, CLES_BARRE, 'sans lien ni cases, barre')
      for (const [liste, dit] of [['bold link', 'le lien'], ['check', 'les cases']] as const) {
        const avec = await construire('allege-cles-avec', page(`<@@editor name="e" toolbar="${liste}" value=!{$v}></@@editor>`))
        pose(avec.editeur, CLES_EDITEUR, `${dit}, éditeur`)
        pose(avec.barre, CLES_BARRE, `${dit}, barre`)
      }
    })

    it('les repères ne sortent jamais dans le code envoyé', async () => {
      const c = await construire('allege-reperes', page('<@@editor name="e" toolbar="bold" value=!{$v}></@@editor>'))
      for (const code of [c.editeur, c.barre]) {
        const fuites = code.split('\n').filter((l) => /(?:^|\s)(?:#|\/\/|<!--) @@(?:\s|$)/.test(l))
        assert.deepEqual(fuites, [], 'aucune ligne de repère dans le code envoyé')
      }
    })
  })

  describe('l\'avertissement du développement : answer posé par un script', () => {
    it('développement, aucune page n\'écrit answer : l\'avertissement est dans le module', async () => {
      const c = await construire('allege-avis-dev', page('<@@editor name="e" value=!{$v}></@@editor>'), { env: 'dev' })
      pose(c.editeur, [AVIS_ANSWER], 'développement sans answer')
    })

    it('développement, une page écrit answer : pas d\'avertissement, le mode part aussi en production', async () => {
      const c = await construire('allege-avis-dev-ecrit', page('<@@editor name="e" answer value={$v} checked=!{$c}></@@editor>'), { env: 'dev' })
      absent(c.editeur, [AVIS_ANSWER], 'développement avec answer')
    })

    it('développement, answer calculé ou étalé : le build ne sait pas, pas d\'avertissement', async () => {
      for (const balise of ['<@@editor name="e" answer={$c} value={$v}></@@editor>', '<@@editor name="e" {...$p} value={$v}></@@editor>']) {
        const c = await construire('allege-avis-dev-calcule', page(balise), { env: 'dev' })
        absent(c.editeur, [AVIS_ANSWER], balise)
      }
    })

    it('production : jamais d\'avertissement', async () => {
      const c = await construire('allege-avis-prod', page('<@@editor name="e" value=!{$v}></@@editor>'))
      absent(c.editeur, [AVIS_ANSWER], 'production')
    })
  })

  describe('le message d\'un nom d\'outil inconnu : rangé avec les messages de la console', () => {
    it('production : la clé reste dans la barre, ni le texte français ni l\'anglais', async () => {
      const c = await construire('allege-inconnu-prod', page('<@@editor name="e" toolbar="bold italic" value=!{$v}></@@editor>'))
      pose(c.barre, [INCONNU], 'production')
      absent(c.barre, ['existe pas, il est ignoré', 'does not exist, it is ignored', 'outils connus', 'known tools'], 'production')
    })

    it('développement : la clé et le texte français de secours restent au site d\'appel, l\'anglais n\'est plus dans la barre', async () => {
      const c = await construire('allege-inconnu-dev', page('<@@editor name="e" toolbar="bold italic" value=!{$v}></@@editor>'), { env: 'dev' })
      pose(c.barre, [INCONNU, 'existe pas, il est ignoré'], 'développement')
      absent(c.barre, ['does not exist, it is ignored', 'known tools'], 'développement')
    })
  })

  describe('les repères des deux fichiers du cœur', () => {
    const lire = (nom: string): string => readFileSync(new URL(`../src/core-modules/${nom}.mjs`, import.meta.url), 'utf-8')
    const garder = (tout: boolean) => (): boolean => tout

    for (const nom of ['editor', 'toolbar']) {
      it(`${nom}.mjs : tel quel il porte tout, et chaque repère est bien fermé`, () => {
        const texte = lire(nom)
        assert.doesNotThrow(() => selectCoreSections(`${nom}.mjs`, texte, garder(true)))
        assert.doesNotThrow(() => selectCoreSections(`${nom}.mjs`, texte, garder(false)))
      })

      it(`${nom}.mjs : sans ses morceaux repérés, le texte garde les numéros de ligne du fichier`, () => {
        const texte = lire(nom)
        const reduit = selectCoreSections(`${nom}.mjs`, texte, (kind) => kind === 'alt')
        assert.equal(reduit.split('\n').length, texte.split('\n').length)
      })
    }

    it('chaque étiquette est l\'attribut answer de l\'éditeur, le fait « reprise » ou un outil (tool-<nom>) connu', () => {
      const connus = new Set(['answer', RESUME_LABEL, ...['h2', 'h3', 'quote', 'bold', 'italic', 'underline', 'strike', 'ul', 'ol', 'check', 'link', 'undo', 'redo', 'clear', 'icons', 'glyphs', 'heads', 'separator', 'keys', 'script'].map((t) => `tool-${t}`)])
      for (const nom of ['editor', 'toolbar']) {
        const vues = new Set<string>()
        selectCoreSections(`${nom}.mjs`, lire(nom), (_kind, attr) => { vues.add(attr); return true })
        for (const v of vues) assert.ok(connus.has(v), `${nom}.mjs : l'étiquette « ${v} » n'est ni un attribut ni un outil de l'éditeur`)
      }
    })
  })
})

describe('Bundler.coreToolShown — l\'outil peut-il être affiché par l\'appli ?', () => {
  const texts = (toolbar: string | null) => ({ names: ['toolbar'], spread: false, texts: { toolbar } })

  function withRefs(refs: unknown[], complete = true): Bundler {
    const bundler = new Bundler({ sourceDir: '/nulle/part/src', outputDir: '/nulle/part/out', manifestPath: '/nulle/part/bundle.js' })
    ;(bundler as any).pendingTagRefs = refs
    ;(bundler as any).tagRefsComplete = complete
    if (complete) (bundler as any).pageTools = (bundler as any).toolsOfPages()
    return bundler
  }
  const ask = (bundler: Bundler, tool: string): string => (bundler as any).coreToolShown(tool)

  it('avant que les références du projet soient lues : unknown, jamais no', () => {
    assert.equal(ask(withRefs([], false), 'link'), 'unknown')
  })

  it('aucune référence à l\'éditeur ni à la barre : unknown (le doute vaut oui)', () => {
    assert.equal(ask(withRefs([]), 'link'), 'unknown')
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'select', kind: 'raccourci-coeur', attrs: texts('bold') }]), 'link'), 'unknown')
  })

  it('une liste écrite : yes pour les outils nommés, no pour les autres', () => {
    const bundler = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold link') }])
    assert.equal(ask(bundler, 'bold'), 'yes')
    assert.equal(ask(bundler, 'link'), 'yes')
    assert.equal(ask(bundler, 'check'), 'no')
  })

  it('un attribut absent, vide, calculé, ou un étalement : unknown pour tous les outils', () => {
    for (const attrs of [{ names: [], spread: false, texts: {} }, texts(''), texts('  '), texts(null), { names: [], spread: true, texts: {} }, { names: ['toolbar'], spread: false }]) {
      const bundler = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs }, { file: 'b.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold') }])
      assert.equal(ask(bundler, 'link'), 'unknown', JSON.stringify(attrs))
    }
  })

  it('une référence qui n\'a pas rapporté ses attributs : unknown', () => {
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'editor', kind: 'litteral-coeur' }]), 'link'), 'unknown')
  })

  it('la barre lit `tools`, l\'éditeur lit `toolbar`, chacun ignore l\'attribut de l\'autre', () => {
    const barre = withRefs([{ file: 'a.mjs', name: 'toolbar', kind: 'raccourci-coeur', attrs: { names: ['tools'], spread: false, texts: { tools: 'undo' } } }])
    assert.equal(ask(barre, 'undo'), 'yes')
    assert.equal(ask(barre, 'link'), 'no')
    const mauvais = withRefs([{ file: 'a.mjs', name: 'toolbar', kind: 'raccourci-coeur', attrs: texts('undo') }])
    assert.equal(ask(mauvais, 'link'), 'unknown')
  })

  it('`none` n\'est pas un outil : aucun outil, mais la réponse est sûre (no)', () => {
    const bundler = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('none') }])
    assert.equal(ask(bundler, 'link'), 'no')
    assert.equal(ask(bundler, 'bold'), 'no')
  })

  it('un groupe (icons, glyphs, heads) est vrai dès que l\'un de ses outils est nommé ; separator quand une liste écrit |', () => {
    const bundler = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold | link') }])
    assert.equal(ask(bundler, 'icons'), 'yes')
    assert.equal(ask(bundler, 'glyphs'), 'yes')
    assert.equal(ask(bundler, 'separator'), 'yes')
    assert.equal(ask(bundler, 'heads'), 'no')
    const lettres = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold italic') }])
    assert.equal(ask(lettres, 'icons'), 'no')
    assert.equal(ask(lettres, 'separator'), 'no')
    assert.equal(ask(withRefs([]), 'icons'), 'unknown')
  })

  it('le groupe script n\'a aucun outil : jamais yes, même quand une liste écrit « script » ; no dès que la construction tranche les outils, unknown dans le doute', () => {
    const bundler = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold script') }])
    assert.equal(ask(bundler, 'script'), 'no')
    assert.equal(ask(bundler, 'link'), 'no')
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold') }]), 'script'), 'no')
    assert.equal(ask(withRefs([]), 'script'), 'unknown')
  })

  it('un nom qui est aussi une propriété de tout objet (constructor, toString) n\'est pas un groupe', () => {
    const bundler = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold') }])
    assert.equal(ask(bundler, 'constructor'), 'no')
    assert.equal(ask(bundler, 'toString'), 'no')
  })

  it('les références au projet et aux autres modules ne comptent pas, la casse non plus', () => {
    const bundler = withRefs([
      { file: 'a.mjs', name: 'editor', kind: 'raccourci-dev', attrs: texts('link') },
      { file: 'a.mjs', name: 'field', kind: 'raccourci-coeur', attrs: texts('link') },
      { file: 'a.mjs', name: 'Editor', kind: 'litteral-coeur', attrs: { names: ['TOOLBAR'], spread: false, texts: { toolbar: 'bold' } } },
    ])
    assert.equal(ask(bundler, 'link'), 'no')
    assert.equal(ask(bundler, 'bold'), 'yes')
  })

  it('un éditeur écrit en mode « répondre » tel quel n\'affiche jamais sa barre : sa liste ne compte pas, même vide ou calculée', () => {
    const rep = (answer: string | null, toolbar: string | null) => ({ names: ['answer', 'toolbar'], spread: false, texts: { answer, toolbar } })
    for (const answer of ['', 'true', 'oui']) {
      for (const toolbar of [null, '', 'bold link']) {
        const bundler = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: rep(answer, toolbar) }])
        assert.equal(ask(bundler, 'link'), 'no', `answer=${JSON.stringify(answer)} toolbar=${JSON.stringify(toolbar)}`)
        assert.equal(ask(bundler, 'bold'), 'no')
        assert.equal(ask(bundler, 'keys'), 'no')
      }
    }
  })

  it('answer calculé, « false », absent, ou un étalement : la barre de l\'éditeur compte comme avant', () => {
    const rep = (answer: string | null | undefined, toolbar: string | null, spread = false) => ({ names: ['toolbar'], spread, texts: answer === undefined ? { toolbar } : { answer, toolbar } })
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: rep(null, null) }]), 'link'), 'unknown', 'answer calculé, pas de toolbar')
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: rep('false', null) }]), 'link'), 'unknown', 'answer="false", pas de toolbar')
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: rep(undefined, null) }]), 'link'), 'unknown', 'answer absent, pas de toolbar')
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: rep('', 'bold', true) }]), 'bold'), 'unknown', 'answer nu mais un étalement : il peut le défaire')
    const nomme = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: rep(null, 'bold') }])
    assert.equal(ask(nomme, 'bold'), 'yes', 'answer calculé, toolbar écrit : la liste compte')
    assert.equal(ask(nomme, 'link'), 'no')
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: rep('false', 'link') }]), 'link'), 'yes', 'answer="false" : un éditeur ordinaire')
  })

  it('un éditeur « répondre » et un autre éditeur : seules les listes du second comptent ; une barre séparée compte toujours', () => {
    const rep = { names: ['answer', 'toolbar'], spread: false, texts: { answer: '', toolbar: 'check' } }
    const bundler = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: rep }, { file: 'b.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold') }])
    assert.equal(ask(bundler, 'bold'), 'yes')
    assert.equal(ask(bundler, 'check'), 'no')
    const barre = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: rep }, { file: 'b.mjs', name: 'toolbar', kind: 'raccourci-coeur', attrs: { names: [], spread: false, texts: {} } }])
    assert.equal(ask(barre, 'link'), 'unknown', 'une barre séparée sans tools montre tous les outils')
  })

  it('un modèle de l\'éditeur « répondre » (editor--compact answer) n\'est pas sûr de ne pas afficher de barre : sa liste compte', () => {
    const bundler = withRefs([{ file: 'a.mjs', name: 'editor--compact', kind: 'raccourci-coeur', attrs: { names: ['answer', 'toolbar'], spread: false, texts: { answer: '', toolbar: 'link' } } }])
    assert.equal(ask(bundler, 'link'), 'yes')
  })

  it('le groupe keys (link et check, les deux outils dont le raccourci dépend de la barre) est vrai dès que l\'un des deux est nommé', () => {
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold link') }]), 'keys'), 'yes')
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('check') }]), 'keys'), 'yes')
    assert.equal(ask(withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold italic undo') }]), 'keys'), 'no')
    assert.equal(ask(withRefs([]), 'keys'), 'unknown')
  })

  it('un modèle de l\'éditeur (editor--compact) compte comme un éditeur', () => {
    const bundler = withRefs([{ file: 'a.mjs', name: 'editor--compact', kind: 'raccourci-coeur', attrs: texts('link') }])
    assert.equal(ask(bundler, 'link'), 'yes')
  })

  it('la réponse est prise sur les références du projet au moment où elles sont toutes lues : une référence venue après (l\'éditeur écrit sa barre) ne compte pas', () => {
    const bundler = withRefs([{ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: texts('bold') }])
    ;(bundler as any).pendingTagRefs.push({ file: 'editor.mjs', name: 'toolbar', kind: 'raccourci-coeur', attrs: { names: ['tools'], spread: false, texts: { tools: null } } })
    assert.equal(ask(bundler, 'link'), 'no')
  })
})
