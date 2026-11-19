// Une transition créée par `µanim.create` écrite avec un réglage sans nom (`*toupie(down)`) arrête la construction : le message ne cite que
// les directives fautives, jamais une directive juste du même nom (`*toupie(duration: 200ms)`) écrite dans un autre fichier ou plus haut dans
// le même ; une directive fautive écrite dans un partiel `<@include>` est citée dans le partiel. Aussi à chaud (`mjs dev` : le même Bundler
// reconstruit, les fichiers inchangés sortent de son cache) et sous `mjs build --cache` (un Bundler neuf relit le cache du disque)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const CREE     = "<script>\n  µanim.create('toupie', { duration: 1000 })\n</script>\n"
const SANS_NOM = /\*toupie : une transition créée par µanim\.create n'a pas de réglage principal/
const FAUTIF   = '<p>b</p>\n<div :in=*toupie(down)>x</div>'
const JUSTE    = '<p>c</p>\n<div :in=*toupie(duration: 200ms)>y</div>'

// construit `fichiers`, puis reconstruit après chaque changement de `changements` : `chaud`, le même Bundler (comme `mjs dev`) ; sinon un
// Bundler neuf par tour, qui relit le cache du disque quand `reglages` le demande
async function tours(nom: string, fichiers: Record<string, string>, changements: Array<Record<string, string>> = [], reglages: Record<string, unknown> = {}, chaud = false) {
  const root     = mjsTmp(nom)
  const srcDir   = join(root, 'src')
  const ouvrir   = () => new Bundler({ sourceDir: srcDir, outputDir: join(root, 'out'), manifestPath: join(root, 'bundle.js'), ...reglages })
  const messages = [] as string[][]
  mkdirSync(srcDir, { recursive: true })
  for (const [f, src] of Object.entries(fichiers)) writeFileSync(join(srcDir, f), src)
  let bundler = ouvrir()
  try {
    for (let i = 0; i <= changements.length; i++) {
      if (i > 0) {
        for (const [f, src] of Object.entries(changements[i - 1])) writeFileSync(join(srcDir, f), src)
        if (!chaud) {
          await bundler.close()
          bundler = ouvrir()
        }
      }
      messages.push((await bundler.compile()).errors.map((e: any) => String(e.message)))
    }
  }
  finally {
    await bundler.close()
  }
  return { srcDir, messages }
}

// une seule erreur, celle du réglage sans nom, qui cite `cite` et jamais `tait`
function seulement(r: { srcDir: string }, messages: string[], cite: string, tait: string[]) {
  assert.equal(messages.length, 1, messages.join('\n'))
  assert.match(messages[0], SANS_NOM)
  assert.ok(messages[0].includes(`Écrite dans ${r.srcDir}/${cite}.`), messages[0])
  for (const f of tait) assert.ok(!messages[0].includes(`${r.srcDir}/${f}`), messages[0])
}

describe('réglage sans nom d’une transition de µanim.create : le message ne cite que les directives fautives', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('une directive juste dans un autre fichier n’est pas citée', async () => {
    const r = await tours('sans-nom-lieux-autre-fichier', { 'a.mjs': CREE + '<p>a</p>', 'b.mjs': FAUTIF, 'c.mjs': JUSTE })
    seulement(r, r.messages[0], 'b.mjs (ligne 2)', ['a.mjs', 'c.mjs'])
  })

  it('une directive juste plus haut dans le même fichier n’est pas citée', async () => {
    const r = await tours('sans-nom-lieux-meme-fichier', { 'c.mjs': CREE + '<div :in=*toupie(duration: 300ms)>a</div>\n<div :out=*toupie(down)>b</div>' })
    seulement(r, r.messages[0], 'c.mjs (ligne 5)', [])
  })

  it('deux directives fautives du même fichier sont citées toutes les deux', async () => {
    const r = await tours('sans-nom-lieux-deux-fautives', { 'c.mjs': CREE + '<div :in=*toupie(down)>a</div>\n<div :in=*toupie(duration: 1s)>b</div>\n<div :out=*toupie(duration: 1s, up)>c</div>' })
    seulement(r, r.messages[0], 'c.mjs (lignes 4, 6)', [])
  })

  it('une directive fautive écrite dans un partiel <@include> est citée dans le partiel', async () => {
    const r = await tours('sans-nom-lieux-partiel', { 'a.mjs': CREE + '<p>a</p>', 'b.mjs': '<p>b</p>\n<@include morceau>\n', '_morceau.mjs': FAUTIF, 'c.mjs': JUSTE })
    seulement(r, r.messages[0], '_morceau.mjs (ligne 2)', ['b.mjs', 'c.mjs'])
  })

  it('à chaud : le fichier fautif sorti du cache du Bundler reste cité seul, et rien n’est cité une fois corrigé', async () => {
    const r = await tours('sans-nom-lieux-a-chaud', { 'a.mjs': CREE + '<p>a</p>', 'b.mjs': FAUTIF, 'c.mjs': JUSTE }, [{ 'c.mjs': JUSTE + '\n<p>c2</p>' }, { 'b.mjs': JUSTE }], {}, true)
    seulement(r, r.messages[0], 'b.mjs (ligne 2)', ['a.mjs', 'c.mjs'])
    seulement(r, r.messages[1], 'b.mjs (ligne 2)', ['a.mjs', 'c.mjs'])
    assert.deepEqual(r.messages[2], [])
  })

  it('sous --cache : le second tour, tout entier sorti du cache du disque, cite les mêmes lieux', async () => {
    const r = await tours('sans-nom-lieux-cache', { 'a.mjs': CREE + '<p>a</p>', 'b.mjs': FAUTIF, 'c.mjs': JUSTE }, [{}], { cache: true })
    seulement(r, r.messages[0], 'b.mjs (ligne 2)', ['a.mjs', 'c.mjs'])
    seulement(r, r.messages[1], 'b.mjs (ligne 2)', ['a.mjs', 'c.mjs'])
  })
})
