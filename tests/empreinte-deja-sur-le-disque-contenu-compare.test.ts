// Empreinte déjà sur le disque — pourquoi ce test existe.
//
// Le nom d'un fichier émis vient de son contenu (5 caractères d'empreinte). La garde qui refuse deux contenus sous le même nom ne
// voyait que les fichiers de la construction en cours : un fichier de ce nom laissé par une construction d'avant n'était jamais
// relu, la construction restait verte et l'ancien contenu restait servi sous ce nom, alors que la doc promet que le build échoue.
// Même saut pour un fichier inchangé quand la carte des sources (`sourceMap`) est activée après coup : il restait sans le lien vers
// sa carte.
//
// Ce que le test garde : un fichier déjà présent est relu ; même contenu, rien n'est réécrit ; seul le lien vers la carte diffère,
// il est réécrit ; un autre contenu sous le même nom fait échouer la construction, en nommant le fichier.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const comp = (marque: string) => ['<script>', '  $x = 1', '</script>', `<p class="ok">{$x} ${marque}</p>`].join('\n')

async function construire(opts: any, regler?: (b: any) => void): Promise<any> {
  const b = new Bundler(opts)
  if (regler) regler(b)
  const stats = await b.compile()
  await b.close()
  return stats
}

function projet(nom: string): { src: string, out: string, opts: any } {
  const root = mjsTmp(nom)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  return { src, out, opts: { sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/out', js: 'split', env: 'dev' } }
}

const fichierDe = (out: string) => readdirSync(out).find(f => /^a-[0-9a-z]{5}\.js$/.test(f))!

describe('empreinte déjà sur le disque — le contenu est comparé', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un autre contenu sous une empreinte déjà sur le disque fait échouer la construction, en nommant le fichier', async () => {
    const { src, out, opts } = projet('empreinte-collision')
    // toutes les empreintes forcées à la même valeur : la collision (une chance sur 60 millions) arrive à coup sûr
    const forcer = (b: any) => { b.fingerprintOf = (c: string | Buffer) => ({ short: 'aaaaa', full: createHash('md5').update(c).digest('hex') }) }
    writeFileSync(join(src, 'a.mjs'), comp('AVANT'))
    const s1 = await construire({ ...opts, sourceMap: 'never' }, forcer)
    assert.equal(s1.errors.length, 0, s1.errors.map((e: any) => e.message).join('\n'))
    assert.ok(readFileSync(join(out, 'a-aaaaa.js'), 'utf-8').includes('AVANT'))
    writeFileSync(join(src, 'a.mjs'), comp('APRES'))
    const s2       = await construire({ ...opts, sourceMap: 'never' }, forcer)
    const messages = s2.errors.map((e: any) => e.message).join('\n')
    assert.ok(s2.errors.length > 0, `construction verte, et a-aaaaa.js porte : ${readFileSync(join(out, 'a-aaaaa.js'), 'utf-8').includes('APRES') ? 'APRES' : 'AVANT'}`)
    assert.match(messages, /a-aaaaa\.js/, `le fichier n'est pas nommé : ${messages}`)
  })

  it('même contenu : le fichier déjà sur le disque n\'est pas réécrit', async () => {
    const { src, out, opts } = projet('empreinte-meme-contenu')
    writeFileSync(join(src, 'a.mjs'), comp('pareil'))
    assert.equal((await construire({ ...opts, sourceMap: 'never' })).errors.length, 0)
    const f     = fichierDe(out)
    const avant = statSync(join(out, f)).mtimeMs
    await new Promise(resolve => setTimeout(resolve, 30))
    const s2 = await construire({ ...opts, sourceMap: 'never' })
    assert.equal(s2.errors.length, 0, s2.errors.map((e: any) => e.message).join('\n'))
    assert.equal(statSync(join(out, f)).mtimeMs, avant, 'le fichier inchangé a été réécrit')
  })

  it('carte des sources activée après coup : le fichier inchangé reçoit le lien vers sa carte', async () => {
    const { src, out, opts } = projet('empreinte-carte-apres-coup')
    writeFileSync(join(src, 'a.mjs'), comp('a'))
    assert.equal((await construire({ ...opts, sourceMap: 'never' })).errors.length, 0)
    const s2 = await construire({ ...opts, sourceMap: 'always' })
    assert.equal(s2.errors.length, 0, s2.errors.map((e: any) => e.message).join('\n'))
    const f = fichierDe(out)
    assert.equal(existsSync(join(out, `${f}.map`)), true, 'la carte n\'est pas écrite')
    assert.ok(readFileSync(join(out, f), 'utf-8').includes(`//# sourceMappingURL=${f}.map`), 'le fichier inchangé reste sans lien vers sa carte')
  })
})
