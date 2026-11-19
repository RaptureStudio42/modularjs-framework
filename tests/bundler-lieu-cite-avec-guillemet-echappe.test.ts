// Une transition créée par `µanim.create` écrite avec un réglage sans nom (`*toupie(down)`) arrête la construction : le message cite le fichier
// et la ligne de la directive fautive, même quand un réglage de la directive, ou d'une directive juste du même nom, est un texte qui porte un
// guillemet échappé (`label: 'l\'été'`) ; la 4.0.0 citait ce lieu

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CREE = "<script>\n  µanim.create('toupie', { duration: 1000 })\n</script>\n"

async function erreurs(nom: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(nom)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js') })
  try {
    return { srcDir, messages: (await bundler.compile()).errors.map((e: any) => String(e.message)) }
  }
  finally {
    await bundler.close()
  }
}

describe('réglage sans nom d’une transition de µanim.create : le lieu est cité malgré un guillemet échappé', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('témoin : un texte sans guillemet échappé, le lieu est cité', async () => {
    const r = await erreurs('lieu-echappe-temoin', { 'a.mjs': CREE + '<p>a</p>', 'b.mjs': "<p>b</p>\n<div :in=*toupie(label: 'ete', down)>x</div>" })
    assert.equal(r.messages.length, 1, r.messages.join('\n'))
    assert.ok(r.messages[0].includes(`${r.srcDir}/b.mjs (ligne 2)`), r.messages[0])
  })

  it('la directive fautive porte un texte avec un guillemet échappé', async () => {
    const r = await erreurs('lieu-echappe-fautive', { 'a.mjs': CREE + '<p>a</p>', 'b.mjs': "<p>b</p>\n<div :in=*toupie(label: 'l\\'été', down)>x</div>" })
    assert.equal(r.messages.length, 1, r.messages.join('\n'))
    assert.ok(r.messages[0].includes(`${r.srcDir}/b.mjs (ligne 2)`), r.messages[0])
  })

  it('une directive juste plus haut porte un guillemet échappé, une apostrophe suit plus bas', async () => {
    const r = await erreurs('lieu-echappe-juste-avant', { 'b.mjs': CREE + "<div :in=*toupie(label: 'l\\'été')>a</div>\n<div :out=*toupie(down)>b</div>\n<p>C'est fini :)</p>" })
    assert.equal(r.messages.length, 1, r.messages.join('\n'))
    assert.ok(r.messages[0].includes(`${r.srcDir}/b.mjs (ligne 5)`), r.messages[0])
  })
})
