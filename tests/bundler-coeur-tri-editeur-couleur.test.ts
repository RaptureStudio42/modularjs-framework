// L'outil `color` de la barre de l'éditeur riche n'a de bouton que pour un éditeur qui a une palette (`colors`) : sans `colors` sur aucun éditeur du
// projet, la construction n'envoie ni son entrée dans la barre (la clé de son libellé, sa lettre) ni son style, même quand une liste `toolbar` ou `tools`
// le nomme, en développement comme en production. Avec `colors` sur un éditeur (écrit, calculé, ou dans le doute : un étalement, un script qui nomme la
// balise), l'outil suit la règle des autres outils : il part quand une barre peut le montrer. Une liste qui nomme `color` sans palette ne réveille pas
// l'avertissement d'un outil reçu d'un script : ce n'est pas un script qui le donne. La barre d'un projet sans palette montre les mêmes boutons qu'avant,
// dans le même ordre, et un séparateur resté au bord d'une liste tombe, comme la règle des listes le veut.
// Statique, avec un Bundler réel et le catalogue réel du framework, sur le texte non minifié (les noms du code y survivent) ; la barre rendue, dans happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { monter } from './helpers/editeur-riche.js'

type Chunks = { editeur: string, barre: string }

const SCRIPT = '<script>\n  $v = \'<p>x</p>\'\n  $k = \'red\'\n  $p = {}\n</script>\n'

// ce que l'outil laisse dans la barre envoyée : la clé de son libellé et la classe de sa lettre (son entrée et son style)
const COULEUR = ['toolColor', 'g-color']
// des outils voisins, qui ne bougent pas
const AUTRES = ['toolBold', 'g-bold', 'toolStrike', 'toolLink']
// l'avertissement du développement d'un outil qu'une barre reçoit d'un script
const AVIS_SCRIPT = 'dev.toolbarToolScript'

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

describe('éditeur riche — l\'outil color ne part qu\'avec une palette', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('sans `colors` nulle part dans le projet', () => {
    it('un éditeur sans toolbar (tous les outils) : l\'outil color ne part pas, les autres restent', async () => {
      const c = await construire('outil-couleur-sans', page('<@@editor name="e" value=!{$v}></@@editor>'))
      absent(c.barre, COULEUR, 'production, sans palette')
      pose(c.barre, AUTRES, 'production, sans palette')
    })

    it('le développement tranche comme la production', async () => {
      const c = await construire('outil-couleur-sans-dev', page('<@@editor name="e" value=!{$v}></@@editor>'), { env: 'dev' })
      absent(c.barre, COULEUR, 'développement, sans palette')
      pose(c.barre, AUTRES, 'développement, sans palette')
    })

    it('une liste qui nomme color (toolbar, tools d\'une barre posée à part) : l\'outil ne part pas, l\'avertissement d\'un outil reçu d\'un script non plus', async () => {
      const c = await construire('outil-couleur-nomme', page('<@@editor name="a" toolbar="bold color" value=!{$v}></@@editor><@@toolbar for="z" tools="color link"></@@toolbar><@@editor id="z" name="b" toolbar="none" value=!{$v}></@@editor>'), { env: 'dev' })
      absent(c.barre, [...COULEUR, AVIS_SCRIPT], 'listes qui nomment color, sans palette')
      pose(c.barre, ['toolBold', 'toolLink'], 'listes qui nomment color, sans palette')
    })

    it('une liste sans color : l\'avertissement d\'un outil reçu d\'un script reste au développement', async () => {
      const c = await construire('outil-couleur-avis', page('<@@editor name="e" toolbar="bold" value=!{$v}></@@editor>'), { env: 'dev' })
      pose(c.barre, [AVIS_SCRIPT], 'toolbar="bold", développement')
      absent(c.barre, COULEUR, 'toolbar="bold", développement')
    })
  })

  describe('avec `colors` sur un éditeur : la règle des autres outils', () => {
    for (const [forme, balise] of [
      ['colors écrit', '<@@editor name="e" colors="red green" value=!{$v}></@@editor>'],
      ['colors calculé', '<@@editor name="e" colors={$k} value=!{$v}></@@editor>'],
      ['un étalement {...p} (le build ne sait pas)', '<@@editor name="e" {...$p} value=!{$v}></@@editor>'],
    ] as const) {
      it(`${forme}, sans toolbar : l'outil color part`, async () => {
        const c = await construire('outil-couleur-avec', page(balise))
        pose(c.barre, [...COULEUR, ...AUTRES], forme)
      })
    }

    it('colors écrit, mais aucune liste ne nomme color : l\'outil ne part pas', async () => {
      const c = await construire('outil-couleur-liste', page('<@@editor name="e" colors="red" toolbar="bold" value=!{$v}></@@editor>'))
      absent(c.barre, COULEUR, 'colors et toolbar="bold"')
      pose(c.barre, ['toolBold'], 'colors et toolbar="bold"')
    })
  })

  describe('la barre rendue d\'un projet sans palette', () => {
    let hote: any
    const outils = (cl: string): string => Array.from(hote._shadow.querySelector('.' + cl)._shadow.querySelector('mjs-core-toolbar')._shadow.querySelectorAll('button, .sep')).map((b: any) => b.dataset.tool ? b.dataset.tool + '/' + b.getAttribute('tabindex') : '|').join(' ')

    before(async () => {
      ;({ hote } = await monter(page('<@@editor class="tous" name="a" value={$v}></@@editor><@@editor class="bord" name="b" toolbar="bold | color" value={$v}></@@editor>'), 'outil-couleur-rendu'))
    })

    it('sans toolbar : les mêmes boutons, dans le même ordre, séparateurs compris ; le premier prend la tabulation', () => {
      assert.equal(outils('tous'), 'h2/0 h3/-1 quote/-1 | bold/-1 italic/-1 underline/-1 strike/-1 | ul/-1 ol/-1 check/-1 | link/-1 | undo/-1 redo/-1 | clear/-1')
    })

    it('une liste qui finit par color : le séparateur resté au bord tombe', () => {
      assert.equal(outils('bord'), 'bold/0')
    })
  })
})

describe('Bundler.coreToolShown(\'color\') — la palette d\'un éditeur décide', () => {
  const editeur = (texts: Record<string, string | null>, spread = false) => ({ file: 'a.mjs', name: 'editor', kind: 'raccourci-coeur', attrs: { names: Object.keys(texts), spread, texts } })

  // un dossier de sources réel et vide : aucune source du projet n'y fait douter
  function withRefs(refs: unknown[], fichiers: Record<string, string> = {}): Bundler {
    const root   = mjsTmp('outil-couleur-reponse')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [n, c] of Object.entries(fichiers)) writeFileSync(join(srcDir, n), c)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    ;(bundler as any).pendingTagRefs  = refs
    ;(bundler as any).tagRefsComplete = true
    ;(bundler as any).pageTools       = (bundler as any).toolsOfPages()
    return bundler
  }
  const ask = (bundler: Bundler, tool: string): string => (bundler as any).coreToolShown(tool)

  it('sans colors : no, même quand une liste le nomme ; les autres outils ne bougent pas', () => {
    const tous = withRefs([editeur({})])
    assert.equal(ask(tous, 'color'), 'no')
    assert.equal(ask(tous, 'bold'), 'unknown')
    const nomme = withRefs([editeur({ toolbar: 'bold color' })])
    assert.equal(ask(nomme, 'color'), 'no')
    assert.equal(ask(nomme, 'bold'), 'yes')
  })

  it('sans colors, le groupe des lettres ne compte pas color ; le groupe script répond unknown quand une liste nomme color', () => {
    const bundler = withRefs([editeur({ toolbar: 'color link' })])
    assert.equal(ask(bundler, 'glyphs'), 'no')
    assert.equal(ask(bundler, 'icons'), 'yes')
    assert.equal(ask(withRefs([editeur({ toolbar: 'bold color' })]), 'script'), 'unknown')
    assert.equal(ask(withRefs([editeur({ toolbar: 'bold' })]), 'script'), 'no')
  })

  it('colors écrit, calculé, sur un modèle ou dans un étalement : la règle des listes', () => {
    assert.equal(ask(withRefs([editeur({ colors: 'red' })]), 'color'), 'unknown')
    assert.equal(ask(withRefs([editeur({ colors: null })]), 'color'), 'unknown')
    assert.equal(ask(withRefs([editeur({}, true)]), 'color'), 'unknown')
    assert.equal(ask(withRefs([{ ...editeur({ colors: 'red' }), name: 'editor--compact' }]), 'color'), 'unknown')
    const nomme = withRefs([editeur({ colors: 'red', toolbar: 'bold color' })])
    assert.equal(ask(nomme, 'color'), 'yes')
    assert.equal(ask(nomme, 'glyphs'), 'yes')
    assert.equal(ask(withRefs([editeur({ colors: 'red', toolbar: 'bold' })]), 'color'), 'no')
  })

  it('un script du projet qui nomme la balise de l\'éditeur peut lui donner colors : dans le doute, la règle des listes', () => {
    const bundler = withRefs([editeur({})], { 'outil.civet': 'export ouvrir = -> document.querySelector(\'mjs-core-editor\')\n' })
    assert.equal(ask(bundler, 'color'), 'unknown')
  })
})
