// Une transition au nom inconnu écrite avec un réglage sans nom (`*volet(down)`, `*zorglub(duration: 1s, down)`) arrête la construction
// sur « transition inconnue », comme le même nom écrit seul : la construction juge le nom avant le réglage. Le message d'une transition
// créée par `µanim.create` (« n'a pas de réglage principal ») reste celui d'un nom que l'appli crée vraiment, avec le fichier et la ligne
// de la directive, aussi quand le composant sort du cache de `mjs build --cache`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

type Langue = 'fr' | 'en'

const FR_TETE  = (nom: string) => `[ModularJS] *${nom} : transition inconnue — ni un effet de la bibliothèque, ni un effet de votre projet, ni une animation créée par µanim.create.`
const FR_QUEUE = (nom: string) => ` Pour la créer : *${nom} = *fade(…) dans un fichier *.effects.mjs de votre projet, ou µanim.create '${nom}', … (µanim.crossfade 'base' pour la paire baseSend et baseReceive) dans un <script>, écrit tel quel avec le nom entre guillemets : la construction ne lit ni un nom calculé, ni un appel fait par une variable (a = µ.anim) ou une déstructuration ({ create } = µ.anim).`
const EN_TETE  = (nom: string) => `[ModularJS] *${nom}: unknown transition — neither a library effect, nor an effect of your project, nor an animation created by µanim.create.`
const SANS_NOM = /une transition créée par µanim\.create n'a pas de réglage principal|has no main setting/

// construit `fichiers` une fois par tour, dans le même dossier (le cache d'un tour sert au suivant)
async function construire(nom: string, fichiers: Record<string, string>, reglages: Record<string, unknown> = {}, langue: Langue = 'fr', tours = 1) {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
  const resultats: string[][] = []
  setMessagesLang(langue)
  try {
    for (let i = 0; i < tours; i++) {
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...reglages })
      try {
        const stats = await bundler.compile()
        resultats.push(stats.errors.map((e: any) => String(e.message)))
      }
      finally {
        await bundler.close()
      }
    }
  }
  finally {
    setMessagesLang('fr')
  }
  return { srcDir, resultats }
}

const CREE = "<script>\n  µanim.create('toupie', { duration: 1000 })\n</script>\n<div :in=*toupie(down)>x</div>"


describe('une transition au nom inconnu écrite avec un réglage sans nom', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('*volet(down) et *zorglub(duration: 1s, down) : « transition inconnue », une erreur par nom, avec le fichier et la ligne', async () => {
    const r = await construire('reglage-sans-nom-fr', {
      'a.mjs': '<p>un</p>\n<div :in=*volet(down)>x</div>',
      'b.mjs': '<p>un</p>\n<div :out=*zorglub(duration: 1s, down)>x</div>'
    })
    const messages = r.resultats[0]
    assert.equal(messages.length, 2, messages.join('\n'))
    assert.ok(messages[0].startsWith(FR_TETE('volet')), messages[0])
    assert.ok(messages[0].includes(`Écrite dans ${r.srcDir}/a.mjs (ligne 2).`), messages[0])
    assert.ok(messages[0].endsWith(FR_QUEUE('volet')), messages[0])
    assert.ok(messages[1].startsWith(FR_TETE('zorglub')), messages[1])
    assert.ok(messages[1].includes(`Écrite dans ${r.srcDir}/b.mjs (ligne 2).`), messages[1])
    for (const m of messages) assert.doesNotMatch(m, SANS_NOM)
  })

  it('en anglais aussi', async () => {
    const r = await construire('reglage-sans-nom-en', { 'c.mjs': '<p>un</p>\n<div :in=*zorglub(down)>x</div>' }, {}, 'en')
    const messages = r.resultats[0]
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.ok(messages[0].startsWith(EN_TETE('zorglub')), messages[0])
    assert.ok(messages[0].includes(`Written in ${r.srcDir}/c.mjs (line 2).`), messages[0])
    assert.doesNotMatch(messages[0], SANS_NOM)
  })

  it('en production aussi', async () => {
    const r = await construire('reglage-sans-nom-prod', { 'c.mjs': '<p>un</p>\n<div :in=*volet(down)>x</div>' }, { env: 'prod' })
    const messages = r.resultats[0]
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.ok(messages[0].startsWith(FR_TETE('volet')), messages[0])
    assert.doesNotMatch(messages[0], SANS_NOM)
  })

  it('une transition créée par µanim.create garde son message, avec le fichier et la ligne de la directive', async () => {
    const r = await construire('reglage-sans-nom-cree', { 'c.mjs': CREE })
    const messages = r.resultats[0]
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /\*toupie.*une transition créée par µanim\.create n'a pas de réglage principal — nommez chaque réglage \(\*toupie\(duration: 400ms\)\)/)
    assert.match(messages[0], /c\.mjs/)
    assert.match(messages[0], /\(ligne 4\)/)
    assert.doesNotMatch(messages[0], /transition inconnue/)
  })

  it('sous `--cache`, le second tour dit la même erreur : nom inconnu comme nom créé', async () => {
    const inconnu = await construire('reglage-sans-nom-cache-inconnu', { 'c.mjs': '<p>un</p>\n<div :in=*volet(down)>x</div>' }, { cache: true }, 'fr', 2)
    for (const messages of inconnu.resultats) {
      assert.equal(messages.length, 1, messages.join('\n'))
      assert.ok(messages[0].startsWith(FR_TETE('volet')), messages[0])
    }
    const cree = await construire('reglage-sans-nom-cache-cree', { 'c.mjs': CREE }, { cache: true }, 'fr', 2)
    for (const messages of cree.resultats) {
      assert.equal(messages.length, 1, messages.join('\n'))
      assert.match(messages[0], SANS_NOM)
    }
  })
})
