// une animation du runtime peut en appeler une autre (`µ._mjs_animFrom`, l'enveloppe de fade, fly, scale, blur, rotate et slide ; `µ._mjs_animLen`, la longueur que lisent fly et blur : des pièces communes, hors de µ.anim) : le bundler
// la joint à celles que l'appli écrit, une seule fois, et ne joint rien à une appli qui n'en écrit aucune

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COEUR = /µ\._mjs_animFrom\s*=/g
const LONGUEUR = /µ\._mjs_animLen\s*=/g

async function construire(nom: string, corps: string): Promise<string> {
  const root   = mjsTmp('anim-dependances-' + nom)
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'essai-app.mjs'), ['<script>', '$on = true', '</script>', corps, ''].join('\n'))
  const manifeste = join(root, 'dist', 'assets', 'bundle.js')
  const bundler   = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'dist', 'assets'), manifestPath: manifeste, js: 'bundle', env: 'dev', minify: false } as any)
  const stats     = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  return readFileSync(manifeste, 'utf-8')
}

describe('le fichier des animations : une animation qui en appelle une autre part avec elle', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['fade', 'fly', 'scale', 'blur', 'rotate', 'slide']) {
    it(`*${nom} seul : l'enveloppe commune est là, une fois, et la longueur seulement pour fly et blur`, async () => {
      const js = await construire(nom, `{if $on}<p @in=*${nom}>x</p>{end}`)
      assert.equal((js.match(COEUR) ?? []).length, 1, `µ._mjs_animFrom doit être défini une fois pour *${nom}`)
      assert.equal((js.match(LONGUEUR) ?? []).length, nom === 'fly' || nom === 'blur' ? 1 : 0, `µ._mjs_animLen pour *${nom}`)
      assert.match(js, new RegExp(`µ\\.anim\\.${nom}\\s*=`), `µ.anim.${nom} manque`)
    })
  }

  it('plusieurs transitions qui partent d\'un état : une seule enveloppe, une seule longueur, chacune sa part', async () => {
    const js = await construire('plusieurs', '{if $on}<p @in=*fade @out=*fly(up)>x</p><p @in=*scale @out=*blur>y</p><p @transition=*slide>z</p>{end}')
    assert.equal((js.match(COEUR) ?? []).length, 1)
    assert.equal((js.match(LONGUEUR) ?? []).length, 1)
    for (const nom of ['fade', 'fly', 'scale', 'blur', 'slide']) assert.match(js, new RegExp(`µ\\.anim\\.${nom}\\s*=`), nom)
  })

  it('une transition qui n\'en appelle aucune autre n\'apporte pas l\'enveloppe', async () => {
    const js = await construire('iris', '{if $on}<p @in=*iris>x</p>{end}')
    assert.match(js, /µ\.anim\.iris\s*=/)
    assert.equal((js.match(COEUR) ?? []).length, 0)
  })

  it('une appli sans transition ne reçoit aucune animation', async () => {
    const js = await construire('aucune', '<p>x</p>')
    assert.deepEqual(js.match(/µ\.anim\.(?!_)\w+\s*=/g) ?? [], [])
  })
})
