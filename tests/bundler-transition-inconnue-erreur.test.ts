// Une transition (`@in=*titre`, `@out=*titre`, `@transition=*titre`, avec ou sans `.global` et `.shared`) que rien ne définit arrête la
// construction : ni un effet de la bibliothèque, ni un effet de l'appli (fichier `*.effects.mjs`), ni une animation que l'appli crée par
// `µanim.create 'nom'` ou `µanim.crossfade 'base'` (le nom écrit entre guillemets, dans un composant ou dans un module du projet).
// L'erreur dit où le nom est écrit (fichier et ligne), le nom le plus proche et comment créer la transition ; elle est la même en
// développement et en production, et aucun réglage `lint` ne la coupe. Un nom que seul un script cite (`µ.anim.fadde`) reste un
// avertissement du type `animation`.

import assert from 'node:assert/strict'
import { cpSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { ALIAS_TABLE_MIN_USES } from '../src/bundler/effects-files.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

type Langue = 'fr' | 'en'

async function construire(nom: string, fichiers: Record<string, string>, reglages: Record<string, unknown> = {}, langue: Langue = 'fr') {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, f)), { recursive: true })
    writeFileSync(join(srcDir, f), src)
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...reglages })
  setMessagesLang(langue)
  try {
    const stats = await bundler.compile()
    return { stats, srcDir, messages: stats.errors.map((e: any) => String(e.message)), avertissements: stats.warnings as string[] }
  }
  finally {
    setMessagesLang('fr')
    await bundler.close()
  }
}

// la même directive posée de sept façons, une par fichier, sur la ligne 2
const ECRITS: Record<string, string> = {
  'in.mjs':            '<p>un</p>\n<div class="a" @in=*titre>x</div>',
  'out.mjs':           '<p>un</p>\n<div class="a" @out=*titre>x</div>',
  'transition.mjs':    '<p>un</p>\n<div class="a" @transition=*titre>x</div>',
  'reglages.mjs':      '<p>un</p>\n<div class="a" @in=*titre(duration: 1s)>x</div>',
  'global.mjs':        '<p>un</p>\n<div class="a" @in.global=*titre>x</div>',
  'shared.mjs':        '<p>un</p>\n<div class="a" @transition.shared=*titre>x</div>',
  'global-shared.mjs': '<p>un</p>\n<div class="a" @transition.global.shared=*titre>x</div>'
}
const FICHIERS = Object.keys(ECRITS).map((f) => f.replace(/\.mjs$/, ''))

const FR_TETE  = "[ModularJS] *titre : transition inconnue — ni un effet de la bibliothèque, ni un effet de votre projet, ni une animation créée par µanim.create."
const FR_QUEUE = " Pour la créer : *titre = *fade(…) dans un fichier *.effects.mjs de votre projet, ou µanim.create 'titre', … (µanim.crossfade 'base' pour la paire baseSend et baseReceive) dans un <script>, écrit tel quel avec le nom entre guillemets : la construction ne lit ni un nom calculé, ni un appel fait par une variable (a = µ.anim) ou une déstructuration ({ create } = µ.anim)."
const queueDe  = (nom: string) => FR_QUEUE.replaceAll('titre', nom)
const EN_TETE  = "[ModularJS] *titre: unknown transition — neither a library effect, nor an effect of your project, nor an animation created by µanim.create."
const EN_QUEUE = " To create it: *titre = *fade(…) in a *.effects.mjs file of your project, or µanim.create 'titre', … (µanim.crossfade 'base' for the baseSend and baseReceive pair) in a <script>, written exactly like that with the name between quotes: the build reads neither a computed name, nor a call made through a variable (a = µ.anim) or a destructuring ({ create } = µ.anim)."

describe('une transition au nom inconnu arrête la construction', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('en français : une seule erreur pour le nom, qui cite chaque fichier et la ligne de sa balise, et dit comment créer la transition', async () => {
    const r = await construire('transition-inconnue-fr', ECRITS)
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    const message = r.messages[0]
    assert.ok(message.startsWith(FR_TETE), message)
    assert.ok(message.endsWith(FR_QUEUE), message)
    for (const f of FICHIERS) assert.match(message, new RegExp(`/${f}\\.mjs \\(ligne 2\\)`), f)
    assert.doesNotMatch(message, /Vouliez-vous dire/)
    assert.ok(!r.avertissements.some((w) => /Animation inconnue/.test(w)), r.avertissements.join('\n'))
  })

  it('le texte exact, pour un seul fichier', async () => {
    const r = await construire('transition-inconnue-texte', { 'c.mjs': ECRITS['in.mjs'] })
    assert.deepEqual(r.messages, [`${FR_TETE} Écrite dans ${r.srcDir}/c.mjs (ligne 2).${FR_QUEUE}`])
  })

  it('en anglais aussi', async () => {
    const r = await construire('transition-inconnue-en', ECRITS, {}, 'en')
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    const message = r.messages[0]
    assert.ok(message.startsWith(EN_TETE), message)
    assert.ok(message.endsWith(EN_QUEUE), message)
    for (const f of FICHIERS) assert.match(message, new RegExp(`/${f}\\.mjs \\(line 2\\)`), f)
    assert.ok(!r.avertissements.some((w) => /Unknown animation/.test(w)), r.avertissements.join('\n'))
  })

  it('le texte exact en anglais, pour un seul fichier', async () => {
    const r = await construire('transition-inconnue-texte-en', { 'c.mjs': ECRITS['in.mjs'] }, {}, 'en')
    assert.deepEqual(r.messages, [`${EN_TETE} Written in ${r.srcDir}/c.mjs (line 2).${EN_QUEUE}`])
  })

  it('en production aussi', async () => {
    const r = await construire('transition-inconnue-prod', ECRITS, { env: 'prod' })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.ok(r.messages[0].startsWith(FR_TETE), r.messages[0])
  })

  it('aucun réglage lint ne la coupe : `lint: { animation: false }` ne retire que l\'avertissement d\'un nom cité par un script', async () => {
    const r = await construire('transition-inconnue-lint', {
      'dir.mjs':    ECRITS['in.mjs'],
      'script.mjs': '<script lang="coffee">\n  a = µ.anim.fadde\n</script>\n<p>{a}</p>'
    }, { lint: { animation: false } })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.ok(r.messages[0].startsWith(FR_TETE), r.messages[0])
    assert.ok(!r.avertissements.some((w) => /fadde/.test(w)), r.avertissements.join('\n'))
  })

  it('un nom par erreur, dans l\'ordre des noms', async () => {
    const r = await construire('transition-inconnue-deux', {
      'a.mjs': '<p>un</p>\n<div class="a" @in=*zebre>x</div>',
      'b.mjs': '<p>un</p>\n<div class="a" @out=*titre>x</div>'
    })
    assert.equal(r.stats.errors.length, 2, r.messages.join('\n'))
    assert.match(r.messages[0], /^\[ModularJS\] \*titre : transition inconnue/)
    assert.match(r.messages[0], /\/b\.mjs \(ligne 2\)/)
    assert.match(r.messages[1], /^\[ModularJS\] \*zebre : transition inconnue/)
    assert.match(r.messages[1], /\/a\.mjs \(ligne 2\)/)
  })

  it('une directive écrite dans un fichier inclus (`<@include>`) est citée avec ce fichier', async () => {
    const r = await construire('transition-inconnue-inclus', {
      'page.mjs':    '<p>un</p>\n<@include ligne>\n',
      '_ligne.mjs':  '<div class="a" @in=*titre>x</div>\n'
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /^\[ModularJS\] \*titre : transition inconnue/)
    assert.match(r.messages[0], /\/_ligne\.mjs \(ligne 1\)/)
  })

  it('une directive citée dans un commentaire HTML ou dans un exemple de code n\'est pas une directive', async () => {
    const r = await construire('transition-inconnue-commentaire', {
      'doc.mjs': '<!-- @in=*titre -->\n<pre><code>@out=*titre</code></pre>\n<script lang="coffee">\n  a = µ.anim.titre\n</script>\n<p>{a}</p>'
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    const avertissement = r.avertissements.find((w) => /Animation inconnue : 'titre'/.test(w)) ?? ''
    assert.ok(avertissement, r.avertissements.join('\n'))
    assert.doesNotMatch(avertissement, /Écrite dans/)
  })
})

describe('le nom le plus proche est proposé', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un effet de la bibliothèque à deux lettres', async () => {
    const r = await construire('transition-inconnue-proche', { 'v.mjs': '<p>un</p>\n<div class="a" @out=*fadeee>x</div>' })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /^\[ModularJS\] \*fadeee : transition inconnue/)
    assert.match(r.messages[0], /\/v\.mjs \(ligne 2\)\. Vouliez-vous dire \*fade \? Pour la créer/)
  })

  it('un effet de l\'appli', async () => {
    const r = await construire('transition-inconnue-proche-appli', {
      'a.effects.mjs': '<effects>\n  *entree = *fly(up, distance: 30px)\n</effects>',
      'v.mjs':         '<p>un</p>\n<div class="a" @in=*entreee>x</div>'
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /\/v\.mjs \(ligne 2\)\. Vouliez-vous dire \*entree \? Pour la créer/)
  })

  it('en anglais', async () => {
    const r = await construire('transition-inconnue-proche-en', { 'v.mjs': '<p>un</p>\n<div class="a" @out=*fadeee>x</div>' }, {}, 'en')
    assert.match(r.messages[0], /\/v\.mjs \(line 2\)\. Did you mean \*fade\? To create it/)
  })

  it('à un seul caractère d\'un effet de la bibliothèque, l\'erreur est celle de la balise, inchangée', async () => {
    const r = await construire('transition-inconnue-fadee', { 'v.mjs': '<p>un</p>\n<div class="a" @in=*fadee>x</div>' })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /\[ModularJS\] \*fadee \(ligne 2\) : effet inconnu — effets disponibles : .*Vouliez-vous dire \*fade \?/)
    assert.doesNotMatch(r.messages[0], /transition inconnue/)
  })
})

describe('ce que la construction connaît ne change pas', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const connus = {
    'a.effects.mjs':  '<effects>\n  *titre = *fade(duration: 1s)\n  *monte(y: 20px) =\n    opacity: 0\n    transform: translateY($y)\n</effects>',
    'alias.mjs':      '<p>un</p>\n<div class="a" @in=*titre @out=*monte(y: 40px)>x</div>',
    'lib.mjs':        '<p>un</p>\n<div class="a" @in=*fade @out=*fly(up) @transition.global=*slide>x</div>',
    'toupie.mjs':     "<script>\n  µanim.create('toupie', { duration: 1000 })\n</script>\n<div @in=*toupie>x</div>",
    'todo.mjs':       "<script>\n  µanim.crossfade('todo', { duration: 600 })\n</script>\n<div @in=*todoReceive(key: 1) @out=*todoSend(key: 1)>x</div>",
    'reglages.civet': "export reglage = ->\n  µanim.create 'tourbillon', { duration: 800 }\n",
    'tourne.mjs':     "@import reglage 'reglages.civet'\n\n<script>\n  reglage()\n</script>\n<div @in=*tourbillon>x</div>"
  }

  it('un alias ou un effet CSS du fichier d\'effets, un effet de la bibliothèque, µanim.create, µanim.crossfade et un module du projet : ni erreur ni avertissement', async () => {
    const r = await construire('transition-inconnue-connus', connus)
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    assert.ok(!r.avertissements.some((w) => /nimation inconnue/.test(w)), r.avertissements.join('\n'))
  })

  it('un nom que seul un script cite (µ.anim.fadde) reste un avertissement, sans lieu à citer', async () => {
    const r = await construire('transition-inconnue-script', { 'c.mjs': '<script lang="coffee">\n  a = µ.anim.fadde\n</script>\n<p>{a}</p>' })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    const avertissement = r.avertissements.find((w) => /Animation inconnue/.test(w) && w.includes('fadde')) ?? ''
    assert.ok(avertissement, r.avertissements.join('\n'))
    assert.match(avertissement, /\[lint\.animation\]/)
    assert.doesNotMatch(avertissement, /Écrite dans/)
  })

  it('un nom calculé (µanim.create(nom, …)) n\'est pas lu : la transition est une erreur, qui dit la forme que la construction lit', async () => {
    const r = await construire('transition-inconnue-calcule', {
      'dyn.mjs': "<script>\n  nom = 'dynamique'\n  µanim.create(nom, { duration: 500 })\n</script>\n<div @in=*dynamique>x</div>"
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /^\[ModularJS\] \*dynamique : transition inconnue/)
    assert.ok(r.messages[0].endsWith(queueDe('dynamique')), r.messages[0])
  })
})

// une transition de la bibliothèque dont le fichier d'animation manque (un dossier d'exécution incomplet) n'est pas un nom inconnu : l'avertissement nomme
// le dossier, la construction n'est pas arrêtée par une erreur qui accuserait le nom
describe('une transition de la bibliothèque dont le fichier manque n\'est pas un nom inconnu', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('@in=*fade avec un dossier d\'exécution sans animations : un avertissement qui nomme le dossier, aucune erreur', async () => {
    const runtimeDir = join(mjsTmp('transition-inconnue-runtime'), 'runtime')
    cpSync(fileURLToPath(new URL('../src/runtime', import.meta.url)), runtimeDir, { recursive: true, filter: (source) => !/[\\/]animations([\\/]|$)/.test(source) })
    const r = await construire('transition-inconnue-sans-animations', { 'c.mjs': '<p>un</p>\n<div class="a" @in=*fade>x</div>' }, { runtimeDir })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    const avertissement = r.avertissements.find((w) => /Animation inconnue : 'fade'/.test(w)) ?? ''
    assert.ok(avertissement, r.avertissements.join('\n'))
    assert.ok(avertissement.includes(join(runtimeDir, 'animations')), avertissement)
  })
})

// en développement (`mjs dev`) : chaque recompilation rend ses erreurs à l'appelant — le serveur les affiche en surimpression dans le
// navigateur — et la console les imprime ; l'erreur disparaît à la sauvegarde qui crée la transition, sans toucher au composant
describe('en développement, l\'erreur suit les sauvegardes', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  type Passage = { changed: string, erreurs: string[] }

  async function attendre(passages: Passage[], vers: (p: Passage) => boolean, ms = 40000): Promise<Passage> {
    const debut = Date.now()
    for (;;) {
      const trouve = passages.find(vers)
      if (trouve) return trouve
      if (Date.now() - debut > ms) throw new Error(`rien après ${ms} ms : ${JSON.stringify(passages)}`)
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }

  it('l\'erreur sort au premier passage et dans la console, la sauvegarde d\'un alias la retire sans retoucher le composant', async () => {
    const root   = mjsTmp('transition-inconnue-dev')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'c.mjs'), ECRITS['in.mjs'])
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const passages: Passage[] = []
    const imprime: string[]   = []
    const erreurOrigine = console.error
    console.error = (...args: unknown[]) => { imprime.push(args.join(' ')) }
    try {
      await bundler.watch({ onRecompile: (changed, stats) => { passages.push({ changed, erreurs: (stats?.errors ?? []).map((e: any) => String(e.message)) }) } })
      const premier = await attendre(passages, (p) => p.changed === '<initial>')
      assert.equal(premier.erreurs.length, 1, premier.erreurs.join('\n'))
      assert.ok(premier.erreurs[0].startsWith(FR_TETE), premier.erreurs[0])
      assert.ok(imprime.some((l) => l.includes(FR_TETE)), imprime.join('\n'))

      writeFileSync(join(srcDir, 'a.effects.mjs'), '<effects>\n  *titre = *fade(duration: 1s)\n</effects>')
      const apres = await attendre(passages, (p) => p.changed.endsWith('a.effects.mjs'))
      assert.deepEqual(apres.erreurs, [], apres.erreurs.join('\n'))

      writeFileSync(join(srcDir, 'c.mjs'), '<p>un</p>\n<div class="a" @in=*titrr>x</div>')
      const faute = await attendre(passages, (p) => p.changed.endsWith('c.mjs'))
      assert.equal(faute.erreurs.length, 1, faute.erreurs.join('\n'))
      assert.match(faute.erreurs[0], /^\[ModularJS\] \*titrr : transition inconnue/)
      assert.match(faute.erreurs[0], /Vouliez-vous dire \*titre \?/)
    }
    finally {
      console.error = erreurOrigine
      await bundler.close()
    }
  })

  it('les fichiers qui créent les transitions restent en cache pendant qu\'on sauve le composant qui les pose : aucune fausse erreur', async () => {
    const root   = mjsTmp('transition-inconnue-dev-cache')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'reglages.civet'), "export reglage = ->\n  µanim.create 'tourbillon', { duration: 800 }\n")
    writeFileSync(join(srcDir, 'toupie.mjs'), "<script>\n  µanim.create('toupie', { duration: 500 })\n</script>\n<p>toupie</p>")
    writeFileSync(join(srcDir, 'c.mjs'), '<p>un</p>\n<div class="a" @in=*tourbillon @out=*toupie>x</div>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const passages: Passage[] = []
    try {
      await bundler.watch({ onRecompile: (changed, stats) => { passages.push({ changed, erreurs: (stats?.errors ?? []).map((e: any) => String(e.message)) }) } })
      const premier = await attendre(passages, (p) => p.changed === '<initial>')
      assert.deepEqual(premier.erreurs, [], premier.erreurs.join('\n'))

      writeFileSync(join(srcDir, 'c.mjs'), '<p>deux</p>\n<div class="a" @in=*tourbillon @out=*toupie>x</div>')
      const apres = await attendre(passages, (p) => p.changed.endsWith('c.mjs'))
      assert.deepEqual(apres.erreurs, [], apres.erreurs.join('\n'))
    }
    finally {
      await bundler.close()
    }
  })
})

// le cache de développement : un composant en cache ne se recompile que si un nom qu'il pose ou qu'il cite a changé de statut (défini ou non par
// l'appli) depuis sa dernière compilation — pas à chaque tour parce que son script cite un nom que l'appli définit
describe('en développement, un composant en cache ne se recompile que si un nom qu\'il cite a changé de statut', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const COMPOSANTS = 50
  const ENTREE     = '<effects>\n  *entree = *fly(up, distance: 30px)\n</effects>'
  const AUTRE      = '<effects>\n  *autre = *fade(duration: 1s)\n</effects>'
  const COMPOSANT  = /[\\/]c\d+\.mjs$/

  type Tour = { changed: string, erreurs: string[], recompiles: number }
  type Ecrire = (fichier: string, contenu: string) => Promise<Tour>

  // le script de chacun cite le nom de l'appli ; les premiers le posent aussi par une directive, mais trop peu pour que l'alias entre dans la table du cœur
  // (ALIAS_TABLE_MIN_USES) : son changement recompilerait tous les composants, quel que soit le cache
  function composants(): Record<string, string> {
    const fichiers: Record<string, string> = { 'autre.mjs': '<p>autre</p>' }
    for (let i = 0; i < COMPOSANTS; i++) {
      const pose = i < ALIAS_TABLE_MIN_USES - 1 ? `\n<div class="a" @in=*entree>${i}</div>` : ''
      fichiers[`c${i}.mjs`] = `<script>\n  a = µ.anim.entree\n</script>\n<p>{a}</p>${pose}`
    }
    return fichiers
  }

  async function attendre(condition: () => boolean, ms = 40000): Promise<void> {
    const debut = Date.now()
    while (!condition()) {
      if (Date.now() - debut > ms) throw new Error(`rien après ${ms} ms`)
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }

  // le projet en veille ; `ecrire` sauve un fichier et rend le tour qu'il déclenche : ses erreurs, et combien de composants ce tour a recompilés
  // (une entrée du cache écrite pendant le tour porte la génération du tour, les entrées resservies gardent l'ancienne)
  async function enVeille(nom: string, fichiers: Record<string, string>, essai: (initial: Tour, ecrire: Ecrire) => Promise<void>): Promise<void> {
    const root   = mjsTmp(nom)
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
    const bundler       = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    const interne       = bundler as any
    const tours: Tour[] = []
    try {
      await bundler.watch({
        onRecompile: (changed, stats) => {
          const recompiles = [...interne.cache.entries()].filter(([f, entree]: [string, any]) => COMPOSANT.test(f) && entree.gen === interne.compileGeneration).length
          tours.push({ changed, erreurs: (stats?.errors ?? []).map((e: any) => String(e.message)), recompiles })
        }
      })
      await attendre(() => tours.some((t) => t.changed === '<initial>'))
      const ecrire: Ecrire = async (fichier, contenu) => {
        const avant  = tours.length
        const arrive = () => tours.slice(avant).some((t) => t.changed.endsWith(fichier))
        writeFileSync(join(srcDir, fichier), contenu)
        // sous charge le watcher peut perdre un événement : la même écriture une seconde fois le redonne
        try { await attendre(arrive, 20000) } catch { writeFileSync(join(srcDir, fichier), contenu); await attendre(arrive) }
        await new Promise((resolve) => setTimeout(resolve, 500))
        const siens = tours.slice(avant)
        return { changed: fichier, erreurs: siens[siens.length - 1].erreurs, recompiles: Math.max(...siens.map((t) => t.recompiles)) }
      }
      await essai(tours.find((t) => t.changed === '<initial>')!, ecrire)
    }
    finally {
      await bundler.close()
    }
  }

  it('50 composants dont le script cite un nom de l\'appli : un tour sans changement, ou qui ne touche qu\'un fichier sans rapport, n\'en recompile aucun', async () => {
    await enVeille('transition-inconnue-cache-stable', { 'a.effects.mjs': ENTREE, ...composants() }, async (initial, ecrire) => {
      assert.equal(initial.recompiles, COMPOSANTS, 'le premier tour compile tout : la mesure n\'est pas muette')
      assert.deepEqual(initial.erreurs, [], initial.erreurs.join('\n'))
      const identique = await ecrire('autre.mjs', '<p>autre</p>')
      assert.equal(identique.recompiles, 0, 'un tour sans changement')
      assert.deepEqual(identique.erreurs, [], identique.erreurs.join('\n'))
      const sansRapport = await ecrire('autre.mjs', '<p>autre chose</p>')
      assert.equal(sansRapport.recompiles, 0, 'un fichier sans rapport')
      assert.deepEqual(sansRapport.erreurs, [], sansRapport.erreurs.join('\n'))
    })
  })

  it('un nom que les composants posent et que l\'appli définit : ils se recompilent et l\'erreur part ; qu\'elle retire : ils se recompilent et l\'erreur revient', async () => {
    await enVeille('transition-inconnue-cache-statut', composants(), async (initial, ecrire) => {
      assert.equal(initial.recompiles, COMPOSANTS, 'le premier tour compile tout : la mesure n\'est pas muette')
      assert.equal(initial.erreurs.length, 1, initial.erreurs.join('\n'))
      assert.match(initial.erreurs[0], /^\[ModularJS\] \*entree : transition inconnue/)
      const inconnu = await ecrire('autre.mjs', '<p>autre chose</p>')
      assert.equal(inconnu.recompiles, 0, 'un fichier sans rapport, le nom est inconnu')
      assert.equal(inconnu.erreurs.length, 1, inconnu.erreurs.join('\n'))

      const defini = await ecrire('a.effects.mjs', ENTREE)
      assert.equal(defini.recompiles, COMPOSANTS, 'le nom devient défini : tous se recompilent')
      assert.deepEqual(defini.erreurs, [], defini.erreurs.join('\n'))
      const apresDefini = await ecrire('autre.mjs', '<p>autre encore</p>')
      assert.equal(apresDefini.recompiles, 0, 'un fichier sans rapport, le nom est défini')
      assert.deepEqual(apresDefini.erreurs, [], apresDefini.erreurs.join('\n'))

      const retire = await ecrire('a.effects.mjs', AUTRE)
      assert.equal(retire.recompiles, COMPOSANTS, 'le nom n\'est plus défini : tous se recompilent')
      assert.equal(retire.erreurs.length, 1, retire.erreurs.join('\n'))
      assert.match(retire.erreurs[0], /^\[ModularJS\] \*entree : transition inconnue/)
      const apresRetire = await ecrire('autre.mjs', '<p>autre fin</p>')
      assert.equal(apresRetire.recompiles, 0, 'un fichier sans rapport, le nom est de nouveau inconnu')
      assert.equal(apresRetire.erreurs.length, 1, apresRetire.erreurs.join('\n'))
    })
  })
})

// un nom que l'appli définit n'est jamais inconnu, d'où qu'il soit cité : un script qui écrit `µ.anim.entree` ne le rend pas suspect
describe('un nom que l\'appli définit n\'est pas inconnu, d\'où qu\'il soit cité', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un alias du fichier d\'effets posé par une directive et cité aussi par un script : ni erreur ni avertissement', async () => {
    const r = await construire('transition-inconnue-alias-cite', {
      'a.effects.mjs': '<effects>\n  *entree = *fly(up, distance: 30px)\n</effects>',
      'v.mjs':         '<script lang="coffee">\n  a = µ.anim.entree\n</script>\n<p>{a}</p>\n<div class="a" @in=*entree>x</div>'
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    assert.ok(!r.avertissements.some((w) => /nimation inconnue/.test(w)), r.avertissements.join('\n'))
  })

  it('un effet CSS du fichier d\'effets, de même', async () => {
    const r = await construire('transition-inconnue-effet-cite', {
      'a.effects.mjs': '<effects>\n  *monte(y: 20px) =\n    opacity: 0\n    transform: translateY($y)\n</effects>',
      'v.mjs':         '<script lang="coffee">\n  a = µ.anim.monte\n</script>\n<p>{a}</p>\n<div class="a" @out=*monte(y: 40px)>x</div>'
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    assert.ok(!r.avertissements.some((w) => /nimation inconnue/.test(w)), r.avertissements.join('\n'))
  })
})

// les créations que la construction lit : `µanim.create 'nom'` et `µanim.crossfade 'base'`, écrits tels quels, le nom en littéral
describe('les créations de transition que la construction lit', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un gabarit sans substitution est un nom fixe : µanim.create `titre` et µanim.crossfade `todo`, dans un composant', async () => {
    const r = await construire('transition-inconnue-gabarit', {
      'c.mjs': "<script>\n  µanim.create `titre`, { duration: 500 }\n  µanim.crossfade `todo`, { duration: 600 }\n</script>\n<div @in=*titre @out=*todoSend(key: 1)>x</div>\n<div @in=*todoReceive(key: 1)>y</div>"
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    assert.ok(!r.avertissements.some((w) => /nimation inconnue/.test(w)), r.avertissements.join('\n'))
  })

  it('… et dans un module .civet du projet', async () => {
    const r = await construire('transition-inconnue-gabarit-module', {
      'reglages.civet': "export reglage = ->\n  µanim.create `tourbillon`, { duration: 800 }\n  µanim.crossfade `todo`, { duration: 600 }\n",
      'tourne.mjs':     "@import reglage 'reglages.civet'\n\n<script>\n  reglage()\n</script>\n<div @in=*tourbillon @out=*todoSend(key: 1)>x</div>\n<div @in=*todoReceive(key: 1)>y</div>"
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    assert.ok(!r.avertissements.some((w) => /nimation inconnue/.test(w)), r.avertissements.join('\n'))
  })

  it('un gabarit à substitution est un nom calculé : l\'erreur', async () => {
    const r = await construire('transition-inconnue-gabarit-calcule', {
      'dyn.mjs': "<script>\n  nom = 'dyn'\n  µanim.create `${nom}amique`, { duration: 500 }\n</script>\n<div @in=*dynamique>x</div>"
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /^\[ModularJS\] \*dynamique : transition inconnue/)
    assert.ok(r.messages[0].endsWith(queueDe('dynamique')), r.messages[0])
  })

  // µanim.crossfade 'todo' écrit dans un module du projet, comme µanim.create : la paire todoSend et todoReceive est connue
  for (const ext of ['civet', 'coffee']) {
    it(`µanim.crossfade 'todo' écrit dans un module .${ext} du projet : ni erreur ni avertissement`, async () => {
      const r = await construire(`transition-inconnue-crossfade-${ext}`, {
        [`todo.${ext}`]: "export reglage = ->\n  µanim.crossfade 'todo', { duration: 600 }\n",
        'c.mjs':         `@import reglage 'todo.${ext}'\n\n<script>\n  reglage()\n</script>\n<div @in=*todoReceive(key: 1) @out=*todoSend(key: 1)>x</div>`
      })
      assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
      assert.ok(!r.avertissements.some((w) => /nimation inconnue/.test(w)), r.avertissements.join('\n'))
    })
  }

  // les appels que la construction ne reconnaît pas : elle n'en lit pas le nom, et l'erreur dit la forme qu'elle lit
  const NON_LUES: Record<string, string> = {
    'une variable qui contient µ.anim':   "<script>\n  a = µ.anim\n  a.create 'titre', { duration: 500 }\n</script>\n<div @in=*titre>x</div>",
    'une déstructuration de µ.anim':      "<script>\n  { create } = µ.anim\n  create 'titre', { duration: 500 }\n</script>\n<div @in=*titre>x</div>",
    'globalThis.µ.anim':                  "<script>\n  globalThis.µ.anim.create 'titre', { duration: 500 }\n</script>\n<div @in=*titre>x</div>",
    'µ[\'anim\'] écrit entre crochets':    "<script>\n  µ['anim'].create 'titre', { duration: 500 }\n</script>\n<div @in=*titre>x</div>"
  }
  for (const [forme, source] of Object.entries(NON_LUES)) {
    it(`${forme} : pas lu, l'erreur dit la forme que la construction lit`, async () => {
      const r = await construire('transition-inconnue-non-lue', { 'c.mjs': source })
      assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
      assert.ok(r.messages[0].endsWith(FR_QUEUE), r.messages[0])
    })
  }
})

// un fichier du projet qui ne se compile pas peut être celui qui crée la transition : tant qu'une erreur est là, un nom introuvable n'est pas accusé
describe('un fichier en erreur de compilation ne fait pas accuser le composant qui pose la transition', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const POSE = '<p>un</p>\n<div class="a" @in=*tourbillon>x</div>'

  it('le module .civet qui crée la transition ne se compile pas : une seule erreur, la sienne', async () => {
    const r = await construire('transition-inconnue-cascade-civet', {
      'reglages.civet': "export reglage = ->\n  µanim.create 'tourbillon', { duration: 800\n",
      'c.mjs':          POSE
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /reglages\.civet/)
    assert.ok(!r.messages.some((m) => /transition inconnue/.test(m)), r.messages.join('\n'))
    assert.ok(!r.avertissements.some((w) => /nimation inconnue/.test(w)), r.avertissements.join('\n'))
  })

  it('le composant qui crée la transition ne se compile pas : une seule erreur, la sienne', async () => {
    const r = await construire('transition-inconnue-cascade-composant', {
      'crea.mjs': "<script>\n  µanim.create 'tourbillon', { duration: 800\n</script>\n<p>x</p>",
      'c.mjs':    POSE
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /crea\.mjs/)
    assert.ok(!r.messages.some((m) => /transition inconnue/.test(m)), r.messages.join('\n'))
  })

  it('le fichier d\'effets qui définit l\'alias ne se compile pas : une seule erreur, la sienne', async () => {
    const r = await construire('transition-inconnue-cascade-effets', {
      'a.effects.mjs': '<effects>\n  *tourbillon = *fadde(duration: 1s)\n</effects>',
      'c.mjs':         POSE
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /fadde/)
    assert.ok(!r.messages.some((m) => /transition inconnue/.test(m)), r.messages.join('\n'))
  })
})

// les lieux : les balises que le compilateur lit avec la directive, ni plus ni moins
describe('les lieux cités sont les balises compilées avec la directive', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une vraie balise dans un <pre> est compilée : l\'erreur la cite', async () => {
    const r = await construire('transition-inconnue-pre-balise', { 'pre.mjs': '<p>un</p>\n<pre><div class="a" @in=*titre>x</div></pre>' })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n') + '\n' + r.avertissements.join('\n'))
    assert.match(r.messages[0], /^\[ModularJS\] \*titre : transition inconnue/)
    assert.match(r.messages[0], /\/pre\.mjs \(ligne 2\)/)
  })

  it('un texte @in=*titre dans une chaîne du script n\'est pas un lieu : un avertissement sans lieu, aucune erreur', async () => {
    const r = await construire('transition-inconnue-lieu-chaine', {
      'c.mjs': "<script lang=\"coffee\">\n  exemple = '<div @in=*titre>x</div>'\n  a = µ.anim.titre\n</script>\n<p>{exemple}{a}</p>"
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    const avertissement = r.avertissements.find((w) => /Animation inconnue : 'titre'/.test(w)) ?? ''
    assert.ok(avertissement, r.avertissements.join('\n'))
    assert.doesNotMatch(avertissement, /Écrite dans/)
  })

  it('un texte @in=*titre dans un <@@code> n\'est pas un lieu : un avertissement sans lieu, aucune erreur', async () => {
    const r = await construire('transition-inconnue-lieu-code', {
      'c.mjs': '<@@code>\n  @in=*titre\n</@@code>\n<script lang="coffee">\n  a = µ.anim.titre\n</script>\n<p>{a}</p>'
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    const avertissement = r.avertissements.find((w) => /Animation inconnue : 'titre'/.test(w)) ?? ''
    assert.ok(avertissement, r.avertissements.join('\n'))
    assert.doesNotMatch(avertissement, /Écrite dans/)
  })

  it('un texte @in=*titre dans la valeur d\'un attribut n\'est pas un lieu : un avertissement sans lieu, aucune erreur', async () => {
    const r = await construire('transition-inconnue-lieu-attribut', {
      'c.mjs': '<p title="exemple : <div @in=*titre>">x</p>\n<script lang="coffee">\n  a = µ.anim.titre\n</script>\n<p>{a}</p>'
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    const avertissement = r.avertissements.find((w) => /Animation inconnue : 'titre'/.test(w)) ?? ''
    assert.ok(avertissement, r.avertissements.join('\n'))
    assert.doesNotMatch(avertissement, /Écrite dans/)
  })

  it('une vraie balise dans un <@@code> est compilée : l\'erreur la cite', async () => {
    const r = await construire('transition-inconnue-code-balise', { 'c.mjs': '<@@code>\n<div class="a" @in=*titre>x</div>\n</@@code>' })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /\/c\.mjs \(ligne 2\)/)
  })

  it('la ligne citée est celle de la balise, jamais celle d\'un texte pareil écrit ailleurs dans le fichier', async () => {
    const r = await construire('transition-inconnue-lieu-ligne', {
      'c.mjs': "<p>un</p>\n<div class=\"a\" @in=*titre>x</div>\n<script lang=\"coffee\">\n  exemple = '<div @in=*titre>x</div>'\n</script>\n<p>{exemple}</p>"
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /\/c\.mjs \(ligne 2\)\./)
  })

  it('une balise écrite dans un commentaire HTML n\'est pas un lieu : un avertissement sans lieu, aucune erreur', async () => {
    const r = await construire('transition-inconnue-lieu-commentaire', {
      'c.mjs': '<!-- <div class="a" @in=*titre>x</div> -->\n<script lang="coffee">\n  a = µ.anim.titre\n</script>\n<p>{a}</p>'
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    const avertissement = r.avertissements.find((w) => /Animation inconnue : 'titre'/.test(w)) ?? ''
    assert.ok(avertissement, r.avertissements.join('\n'))
    assert.doesNotMatch(avertissement, /Écrite dans/)
  })

  it('un commentaire sur plusieurs lignes qui contient la balise ne compte pas, ni comme lieu ni dans la ligne de la vraie directive', async () => {
    const r = await construire('transition-inconnue-lieu-commentaire-lignes', {
      'c.mjs': '<!--\n  <div class="a" @in=*titre>x</div>\n-->\n<div class="a" @in=*titre>y</div>'
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /\/c\.mjs \(ligne 4\)\./)
  })

  it('une balise sur plusieurs lignes : la ligne citée est celle où la directive est écrite', async () => {
    const r = await construire('transition-inconnue-lieu-multiligne', { 'c.mjs': '<p>un</p>\n<div\n  class="a"\n  @in=*titre>x</div>' })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /\/c\.mjs \(ligne 4\)\./)
  })

  it('deux directives d\'une même balise sur deux lignes : les deux lignes sont citées', async () => {
    const r = await construire('transition-inconnue-lieu-deux-lignes', { 'c.mjs': '<p>un</p>\n<div\n  class="a"\n  @in=*titre\n  @out=*titre>x</div>' })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /\/c\.mjs \(lignes 4, 5\)\./)
  })

  it('un < dans une expression {…} du texte n\'ouvre pas de balise : un texte @in=*titre qui la suit n\'est pas un lieu', async () => {
    const r = await construire('transition-inconnue-lieu-expression', {
      'c.mjs': '<script>\n  x = 1\n  y = 2\n  a = µ.anim.titre\n</script>\n<p>{x<y} @in=*titre</p>'
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    const avertissement = r.avertissements.find((w) => /Animation inconnue : 'titre'/.test(w)) ?? ''
    assert.ok(avertissement, r.avertissements.join('\n'))
    assert.doesNotMatch(avertissement, /Écrite dans/)
  })

  it('… et une vraie directive qui la suit est citée à sa ligne, pas à celle de l\'expression', async () => {
    const r = await construire('transition-inconnue-lieu-expression-ligne', {
      'c.mjs': '<script>\n  x = 1\n  y = 2\n</script>\n{if x<y}\n  <div class="a" @in=*titre>x</div>\n{end}'
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /\/c\.mjs \(ligne 6\)\./)
  })
})

// les formes d'ouverture de balise que la lecture des lieux doit supporter : une directive de transition connue n'est jamais accusée, une vraie
// transition inconnue l'est avec la ligne où sa directive est écrite, et aucune forme ne plante
describe('la lecture des lieux supporte toutes les formes d\'ouverture de balise', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  const COMPTE = '<script>\n  x = 1\n  y = 2\n</script>\n'
  const FORMES: Record<string, { source: (directive: string) => string, voisins?: Record<string, string> }> = {
    'une balise sur plusieurs lignes':                  { source: (d) => `<p>un</p>\n<div\n  class="a"\n  ${d}>x</div>` },
    'un attribut à accolades qui contient un >':        { source: (d) => `<p>un</p>\n<div class={x > 1 ? 'a' : 'b'} ${d}>x</div>` },
    'un > dans une valeur entre guillemets':            { source: (d) => `<p>un</p>\n<div title="a > b" ${d}>x</div>` },
    'un composant':                                     { source: (d) => `<p>un</p>\n<@card ${d}>x</@card>`, voisins: { 'card.mjs': '<p>carte</p>' } },
    'un <svg>':                                         { source: (d) => `<p>un</p>\n<svg viewBox="0 0 10 10" ${d}><path d="M0 0 L10 10"/></svg>` },
    'un {if x < y} suivi d\'une balise':                { source: (d) => `${COMPTE}{if x < y}\n  <div ${d}>x</div>\n{end}` },
    'un {if x<y} suivi d\'une balise':                  { source: (d) => `${COMPTE}{if x<y}\n  <div ${d}>x</div>\n{end}` },
    'une balise après un <textarea>':                   { source: (d) => `<p>un</p>\n<textarea aria-label="a"><div>x</div></textarea>\n<div ${d}>x</div>` }
  }
  const ligneDe = (source: string, motif: string) => source.split('\n').findIndex((l) => l.includes(motif)) + 1

  for (const [forme, { source, voisins }] of Object.entries(FORMES)) {
    it(`${forme} : une transition de la bibliothèque n'est pas accusée`, async () => {
      const r = await construire('transition-inconnue-forme-connue', { 'c.mjs': source('@in=*fade'), ...voisins })
      assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
      assert.ok(!r.avertissements.some((w) => /nimation inconnue/.test(w)), r.avertissements.join('\n'))
    })

    it(`${forme} : un nom inconnu est cité à la ligne de sa directive`, async () => {
      const texte = source('@in=*titre')
      const r     = await construire('transition-inconnue-forme-inconnue', { 'c.mjs': texte, ...voisins })
      assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
      assert.match(r.messages[0], /^\[ModularJS\] \*titre : transition inconnue/)
      assert.ok(r.messages[0].includes(`/c.mjs (ligne ${ligneDe(texte, '@in=*titre')}).`), r.messages[0])
    })
  }

  // dans un <textarea>, le navigateur ne lit que du texte : une balise écrite dedans n'y porte aucune directive
  it('une balise écrite dans un <textarea> est un texte : sa directive n\'est pas lue', async () => {
    const r = await construire('transition-inconnue-forme-textarea', { 'c.mjs': '<p>un</p>\n<textarea aria-label="a"><div @in=*titre>x</div></textarea>' })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
  })

  // le compilateur refuse ces écritures lui-même : sa faute est dite, et aucune transition n'est accusée à tort
  const REFUSEES: Record<string, string> = {
    'un commentaire HTML entre deux attributs': '<p>un</p>\n<div class="a" <!-- note --> @in=*titre>x</div>',
    'un texte courant a<b @in=*titre':          '<p>un</p>\n<p>a<b @in=*titre</p>'
  }
  for (const [forme, texte] of Object.entries(REFUSEES)) {
    it(`${forme} : la faute est celle du compilateur, aucune transition n'est accusée`, async () => {
      const r = await construire('transition-inconnue-forme-refusee', { 'c.mjs': texte })
      assert.ok(r.stats.errors.length > 0, 'le compilateur dit sa faute')
      assert.ok(!r.messages.some((m) => /transition inconnue/.test(m)), r.messages.join('\n'))
    })
  }

  it('un <textarea> qui contient le texte @in=*titre : un avertissement sans lieu, aucune erreur', async () => {
    const r = await construire('transition-inconnue-forme-textarea', {
      'c.mjs': '<p>un</p>\n<textarea aria-label="a">@in=*titre</textarea>\n<script lang="coffee">\n  a = µ.anim.titre\n</script>\n<p>{a}</p>'
    })
    assert.equal(r.stats.errors.length, 0, r.messages.join('\n'))
    const avertissement = r.avertissements.find((w) => /Animation inconnue : 'titre'/.test(w)) ?? ''
    assert.ok(avertissement, r.avertissements.join('\n'))
    assert.doesNotMatch(avertissement, /Écrite dans/)
  })

  it('un gabarit à substitution (µanim.create `mon-${x}`) n\'est pas lu et ne plante pas : le nom posé est une erreur', async () => {
    const r = await construire('transition-inconnue-forme-gabarit', {
      'c.mjs': "<script>\n  x = 'un'\n  µanim.create `mon-${x}`, { duration: 500 }\n</script>\n<div @in=*mon-un>y</div>"
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /^\[ModularJS\] \*mon-un : transition inconnue/)
    assert.ok(r.messages[0].includes('/c.mjs (ligne 5).'), r.messages[0])
  })
})

// le nom proposé est un nom que la directive accepte : une transition, un effet de l'appli, un effet qui se joue au chargement
describe('le nom proposé est utilisable comme transition', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un effet que @in refuse (*tilt) n\'est jamais proposé', async () => {
    const refus = await construire('transition-inconnue-tilt', { 'v.mjs': '<p>un</p>\n<div class="a" @in=*tilt>x</div>' })
    assert.equal(refus.stats.errors.length, 1, refus.messages.join('\n'))
    assert.doesNotMatch(refus.messages[0], /transition inconnue/)
    const r = await construire('transition-inconnue-tiltzz', { 'v.mjs': '<p>un</p>\n<div class="a" @in=*tiltzz>x</div>' })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /^\[ModularJS\] \*tiltzz : transition inconnue/)
    assert.doesNotMatch(r.messages[0], /Vouliez-vous dire/)
  })

  it('un alias de l\'appli qui règle un effet que @in refuse n\'est pas proposé non plus', async () => {
    const r = await construire('transition-inconnue-alias-refuse', {
      'a.effects.mjs': '<effects>\n  *soft = *tilt(max: 6)\n</effects>',
      'v.mjs':         '<p>un</p>\n<div class="a" @in=*sofft>x</div>'
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /^\[ModularJS\] \*sofft : transition inconnue/)
    assert.doesNotMatch(r.messages[0], /Vouliez-vous dire/)
  })

  it('une seule mesure pour la bibliothèque et pour l\'appli : deux lettres interverties comptent pour une faute, dans les deux', async () => {
    const r = await construire('transition-inconnue-mesure', {
      'a.effects.mjs': '<effects>\n  *entree = *fly(up, distance: 30px)\n</effects>',
      'v.mjs':         '<p>un</p>\n<div class="a" @in=*etnere>x</div>'
    })
    assert.equal(r.stats.errors.length, 1, r.messages.join('\n'))
    assert.match(r.messages[0], /Vouliez-vous dire \*entree \?/)
  })
})

describe('la doc dit la règle', function () {
  it('docs/10-transitions.md : un nom que rien ne définit arrête la construction, et comment le définir', () => {
    const doc = readFileSync(new URL('../docs/10-transitions.md', import.meta.url), 'utf8')
    assert.match(doc, /Un nom que rien ne définit arrête la construction/)
    assert.match(doc, /`\*titre = \*fade\(…\)`/)
    assert.match(doc, /un nom calculé/)
    assert.match(doc, /écrit tel quel/)
    assert.match(doc, /variable qui contient `µ\.anim`/)
  })

  it('docs/32-cli-et-configuration.md : le type `animation` ne parle que d\'un script, la directive est une erreur', () => {
    const ligne = readFileSync(new URL('../docs/32-cli-et-configuration.md', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('| `animation` |')) ?? ''
    assert.match(ligne, /`µ\.anim\.nom`/)
    assert.match(ligne, /`@in`, `@out` ou `@transition`.*erreur de construction/)
    assert.doesNotMatch(ligne, /@viewTransition/)
  })
})
