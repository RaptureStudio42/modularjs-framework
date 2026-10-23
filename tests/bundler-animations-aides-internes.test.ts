// l'enveloppe de fade, fly, scale, blur, rotate et slide, et la lecture d'une longueur que fly et blur appellent, sont des aides internes : elles ne sont pas
// des animations. Hors de µ.anim, donc hors de ce que `@in=*nom` peut viser (un nom inconnu arrête la construction, comme une faute de frappe) et de ce que
// `µanim.create 'nom'` écrase (créer une animation nommée « from » ou « len » ne casse pas les six transitions)

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// construit une appli ; rend ses avertissements, ses erreurs et le fichier des animations (celui que le navigateur charge), prêt à être joué
async function construire(nom: string, corps: string, erreurAttendue = false) {
  const root   = mjsTmp('anim-aides-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'essai-app.mjs'), ['<script>', '$on = true', '</script>', corps, ''].join('\n'))
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'dev', minify: false } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (!erreurAttendue) assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const fichier = existsSync(outDir) ? readdirSync(outDir).find((f) => /^mjs_anims-.*\.js$/.test(f)) : undefined
  return { warnings: stats.warnings as string[], erreurs: stats.errors.map((e: any) => String(e.message)), anims: fichier ? stripEsm(readFileSync(join(outDir, fichier), 'utf-8')) : '' }
}

// un µ minimal : les courbes (la résolution suffit), la fenêtre qui lit une balise nue
function jouer(code: string, essai: (µ: any) => void) {
  const µ: any = { easing: { resolve: (e: any) => e, linear: 'linear', cubicOut: 'cubicOut' } }
  new Function('µ', code)(µ)
  const avant = (globalThis as any).window
  ;(globalThis as any).window = { getComputedStyle: () => ({ opacity: '1', transform: 'none', filter: 'none' }) }
  try { essai(µ) } finally { (globalThis as any).window = avant }
}

describe('animations : l\'enveloppe et la longueur sont des aides internes, pas des animations', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('µ.anim ne porte que les animations de l\'appli : ni « from » ni « len »', async () => {
    const { anims } = await construire('cles', '{if $on}<p @in=*fade @out=*fly(up)>x</p><p @in=*blur>y</p>{end}')
    jouer(anims, (µ) => assert.deepEqual(Object.keys(µ.anim).sort(), ['blur', 'fade', 'fly']))
  })

  // `*len` est déjà refusé à la construction (aucun effet ne porte ce nom) : seul `*from` passait pour une animation de l'appli
  it('@in=*from : le nom n\'est pas une animation, la construction s\'arrête comme pour une faute de frappe', async () => {
    const { erreurs } = await construire('inconnue-from', '{if $on}<p @in=*from>x</p>{end}', true)
    const erreur = erreurs.find((m) => /transition inconnue/.test(m) && m.includes('*from'))
    assert.ok(erreur, `*from n'arrête pas la construction. erreurs :\n${erreurs.join('\n')}`)
    // l'erreur dit aussi où la directive s'écrit : le fichier et la ligne de sa balise
    assert.match(erreur!, /essai-app\.mjs \(ligne 4\)/)
  })

  it('créer des animations nommées « from » et « len » (µanim.create) ne casse ni fade, ni fly, ni blur', async () => {
    const { anims } = await construire('ecrasees', '{if $on}<p @in=*fade @out=*fly(up)>x</p><p @in=*blur>y</p>{end}')
    jouer(anims, (µ) => {
      // ce que µanim.create 'from' et µanim.create 'len' font : ranger une fabrique sous ce nom dans µ.anim
      µ.anim.from = () => { throw new Error('« from » de l\'auteur appelée par une transition du framework') }
      µ.anim.len  = () => { throw new Error('« len » de l\'auteur appelée par une transition du framework') }
      assert.equal(µ.anim.fade({ duration: 123 }).intro({}).duration, 123)
      assert.equal(µ.anim.fly({ x: '10px' }).intro({}).css(0.5, 0.5).transform, 'translate(5px, 0px)')
      assert.equal(µ.anim.blur({ amount: '4px' }).intro({}).css(0.5, 0.5).filter, 'blur(2px)')
    })
  })
})
