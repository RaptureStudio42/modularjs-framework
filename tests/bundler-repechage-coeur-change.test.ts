// En développement, un composant en échec garde sa dernière version bonne… tant qu'elle tourne encore. Quand un autre
// composant change le cœur au même tour, l'ancienne version importe l'ancien cœur, que le ménage retire juste après la
// publication du manifeste : la reprendre publierait un composant mort au navigateur. Elle n'est donc pas reprise, un
// avertissement le dit ; quand le cœur ne change pas, la reprise reste la règle.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const COMPOSANT_A  = '<script>\n  $x = 1\n</script>\n<p>{$x}</p>\n'
const A_HTML_BRUT  = '<script>\n  $x = "<b>1</b>"\n</script>\n<p>{{$x}}</p>\n'
const COMPOSANT_B  = '<script>\n  $y = 2\n</script>\n<p>{$y}</p>\n'
const B_EN_ECHEC   = '<script>\n  $y = [2\n</script>\n<p>{$y}</p>\n'

const coeurs = (out: string) => readdirSync(out).filter(f => /^mjs_core-[0-9a-z]{5}\.js$/.test(f))

// chaque fichier que le manifeste nomme existe, et chaque cœur qu'il importe aussi
function cassees(out: string, manifeste: Record<string, string>): string[] {
  const r: string[] = []
  for (const [cle, url] of Object.entries(manifeste)) {
    if (!url.endsWith('.js')) continue
    const fichier = join(out, url.split('/').pop()!)
    if (!existsSync(fichier)) { r.push(`${cle} → ${url} absent`); continue }
    for (const m of readFileSync(fichier, 'utf-8').matchAll(/mjs_core-[0-9a-z]{5}\.js/g)) if (!existsSync(join(out, m[0]))) r.push(`${cle} importe ${m[0]}, absent`)
  }
  return r
}

function projet(prefixe: string) {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'a.mjs'), COMPOSANT_A)
  writeFileSync(join(src, 'b.mjs'), COMPOSANT_B)
  return { src, out, bundler: new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js') }) }
}

describe('repêchage en développement : jamais une version qui importe un cœur retiré', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('b en échec pendant que a change le cœur : b n\'est pas repris, un avertissement le dit, rien de publié n\'importe un cœur absent', async () => {
    const { src, out, bundler } = projet('repechage-coeur-change')
    const s1 = await bundler.compile()
    assert.deepEqual(s1.errors.map(e => e.message), [])
    const coeur1 = coeurs(out)

    writeFileSync(join(src, 'a.mjs'), A_HTML_BRUT)
    writeFileSync(join(src, 'b.mjs'), B_EN_ECHEC)
    const s2 = await bundler.compile()
    assert.equal(s2.errors.length, 1, s2.errors.map(e => e.message).join('\n'))
    assert.notDeepEqual(coeurs(out), coeur1, 'précondition : le cœur a changé')
    assert.deepEqual(cassees(out, s2.manifest), [])
    assert.equal(s2.manifest.b, undefined, 'b n\'est pas repris')
    assert.ok(!s2.warnings.some(w => w.includes('reste servie')), `aucun avertissement de reprise : ${s2.warnings.join(' | ')}`)
    assert.ok(s2.warnings.some(w => w.includes('b :') && w.includes("n'est plus servie")), `un avertissement dit que b n'est plus servi : ${s2.warnings.join(' | ')}`)
    const publie = readFileSync(join(out, 'bundle.js'), 'utf-8').split('\n').find(l => l.startsWith('const µPaths = '))!
    assert.ok(!publie.includes('"b"'), `b absent du manifeste publié : ${publie}`)
  })

  it('b en échec, cœur inchangé : la dernière version bonne de b reste servie', async () => {
    const { src, out, bundler } = projet('repechage-coeur-stable')
    const s1 = await bundler.compile()
    assert.deepEqual(s1.errors.map(e => e.message), [])

    writeFileSync(join(src, 'b.mjs'), B_EN_ECHEC)
    const s2 = await bundler.compile()
    assert.equal(s2.errors.length, 1, s2.errors.map(e => e.message).join('\n'))
    assert.equal(s2.manifest.b, s1.manifest.b, 'b repris')
    assert.deepEqual(cassees(out, s2.manifest), [])
    assert.ok(s2.warnings.some(w => w.includes('reste servie')), `avertissement de reprise : ${s2.warnings.join(' | ')}`)
  })
})
