// `transpile()` appelé seul (exporté par le paquet) ne voit qu'un fichier : il refuse une transition hors bibliothèque écrite avec un réglage
// sans nom (`*zorglub(down)`, `*toupie(down)`), comme `compileSingle` ; seule la construction, qui voit tous les fichiers, juge le nom en fin
// de tour. Aucun réglage ne disparaît sans rien dire ; des réglages tous nommés passent

import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SANS_NOM_FR = (nom: string) => new RegExp(`\\*${nom} : une transition créée par µanim\\.create n'a pas de réglage principal — nommez chaque réglage \\(\\*${nom}\\(duration: 400ms\\)\\)`)
const SANS_NOM_EN = (nom: string) => new RegExp(`\\*${nom}: a transition created by µanim\\.create has no main setting — name each setting \\(\\*${nom}\\(duration: 400ms\\)\\)`)

describe('transpile() seul : un réglage sans nom d’une transition hors bibliothèque est refusé', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('*zorglub(down) et *zorglub(duration: 1s, down) : refusés', async () => {
    await assert.rejects(transpile('<div :in=*zorglub(down)>x</div>'), SANS_NOM_FR('zorglub'))
    await assert.rejects(transpile('<div :out=*zorglub(duration: 1s, down)>x</div>'), SANS_NOM_FR('zorglub'))
  })

  it('une transition créée par µanim.create dans le même fichier (*toupie(down)) : refusée aussi', async () => {
    await assert.rejects(transpile("<script>\n  µanim.create('toupie', { duration: 1000 })\n</script>\n<div :in=*toupie(down)>x</div>"), SANS_NOM_FR('toupie'))
  })

  it('en anglais aussi', async () => {
    setMessagesLang('en')
    try {
      await assert.rejects(transpile('<div :in=*zorglub(down)>x</div>'), SANS_NOM_EN('zorglub'))
    }
    finally {
      setMessagesLang('fr')
    }
  })

  it('des réglages tous nommés passent, et partent dans le code émis', async () => {
    const { output } = await transpile('<div :in=*zorglub(duration: 1s)>x</div>')
    assert.match(output, /µ\._mjs_fxAnimCustom\("zorglub", \{"duration": 1000\}/)
  })

  it('compileSingle refuse de même', async () => {
    const root    = mjsTmp('transpile-seul-sans-nom')
    const srcDir  = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
    try {
      await assert.rejects(bundler.compileSingle('<div :in=*zorglub(down)>x</div>', { fileName: 'c.mjs' }), SANS_NOM_FR('zorglub'))
    }
    finally {
      await bundler.close()
    }
  })
})
