// garde de fin de `mjs build` : chaque fichier que la sortie cite y existe (adresses `.js` des modules sous le préfixe public de la
// sortie, manifeste et sa table des chemins, liste de `mjs-precache.json`). Une sortie saine passe ; un module repris d'un cache
// abîmé qui cite un fichier absent arrête la construction (code 1, l'absent et le module qui le cite nommés), et le cache ne garde
// plus ce module : la construction suivante le recompile, sa sortie est celle d'une construction complète. La garde elle-même, sur
// des cas connus : un module retiré de la sortie est vu (cité par le manifeste et par le module qui l'importe), un fichier que seule
// la liste du précache cite aussi ; rien n'est vu dans une sortie saine

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { citedMissing } from '../src/bundler/cited-files.js'
import { mjsTmp } from './helpers/tmp.js'
import { PNG, build, files, gaps, write } from './helpers/construction-cache.js'

const wallet = 'class Wallet\n  gems = (w) -> w.gems + 1\n'
const header = '<script lang="js">\n  $n = µWallet.gems({ gems: 2 });\n</script>\n\n<header class="entete">{$n}</header>\n'

function projet(prefixe: string): string {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'app/modularjs')
  write(join(root, 'mjs.config.json'), '{}\n')
  write(join(root, 'node_modules/.keep'), '')
  write(join(src, 'Wallet.class.mjs'), wallet)
  write(join(src, 'app-header.mjs'), header)
  write(join(src, 'app-layout.page.mjs'), `@import default AppHeader 'app-header.mjs'\n\n<div class="mise-en-page">\n  <@app-header></@app-header>\n</div>\n`)
  write(join(src, 'galerie.mjs'), '<img src="µasset(\'img/logo.png\')">\n<p>galerie</p>\n')
  write(join(src, 'img/logo.png'), PNG)
  return root
}

// construction de production dans un dossier neuf `<root>/runs/<nom>` (sortie sous public/assets/modularJS_compiled)
function construire(root: string, nom: string, cache = true): { out: string, dir: string, status: number, sortie: string } {
  const dir = join(root, 'runs', nom)
  const out = join(dir, 'public/assets/modularJS_compiled')
  const b   = build(root, ['--prod', ...(cache ? ['--cache'] : []), '--output', out, '--manifest', join(dir, 'bundle.js')])
  return { out, dir, status: b.status, sortie: b.out }
}

const delivered = (out: string): string[] => [...files(out).keys()].map(rel => join(out, rel))

describe('mjs build : garde de fin, chaque fichier cité existe', function () {
  this.timeout(180_000)

  it('cache abîmé : le module repris qui cite un fichier absent arrête la construction, la suivante le recompile', function () {
    const root  = projet('garde-cites-cache')
    const first = construire(root, 'premiere')
    assert.equal(first.status, 0, first.sortie)
    assert.doesNotMatch(first.sortie, /que cite la sortie/, first.sortie)
    // le .js gardé d'app-layout, faussé à la main : il cite une version d'app-header qui n'existe nulle part
    const gardes = join(root, 'node_modules/.cache/mjs/build/files')
    const layout = readdirSync(gardes).find(f => /^app-layout-\w{5}\.js$/.test(f))!
    const entete = readdirSync(gardes).find(f => /^app-header-\w{5}\.js$/.test(f))!
    writeFileSync(join(gardes, layout), readFileSync(join(gardes, layout), 'utf-8').replace(entete, 'app-header-zzzzz.js'))
    const fautive = construire(root, 'fautive')
    assert.equal(fautive.status, 1, fautive.sortie)
    assert.match(fautive.sortie, /1 fichier que cite la sortie manque/, fautive.sortie)
    assert.ok(fautive.sortie.includes(`app-header-zzzzz.js ← ${layout}`), fautive.sortie)
    assert.match(fautive.sortie, /Le cache \(--cache\) ne garde plus les modules qui les citent/, fautive.sortie)
    const suivante = construire(root, 'suivante')
    assert.equal(suivante.status, 0, suivante.sortie)
    const complete = construire(root, 'complete', false)
    assert.equal(complete.status, 0, complete.sortie)
    assert.deepEqual(gaps(suivante.dir, complete.dir), [], 'la construction suivante recompile le module : sortie d\'une construction complète')
  })

  it('la garde sur des cas connus : sortie saine, module retiré, fichier que seul le précache cite retiré', function () {
    const root = projet('garde-cites-cas')
    const run  = construire(root, 'saine', false)
    assert.equal(run.status, 0, run.sortie)
    const manifest = join(run.dir, 'bundle.js')
    const saine    = citedMissing(run.out, '/assets/modularJS_compiled', manifest, delivered(run.out))
    assert.deepEqual(saine.missing, [])
    assert.ok(saine.files >= 4 && saine.bytes > 0, `lu : ${saine.files} fichiers, ${saine.bytes} octets`)
    const names  = [...files(run.out).keys()]
    const entete = names.find(f => /^app-header-\w{5}\.js$/.test(f))!
    const layout = names.find(f => /^app-layout-\w{5}\.js$/.test(f))!
    const logo   = names.find(f => /^logo-\w+\.png$/.test(f))!
    rmSync(join(run.out, entete))
    rmSync(join(run.out, logo))
    const vus = citedMissing(run.out, '/assets/modularJS_compiled', manifest, delivered(run.out)).missing
    assert.deepEqual(vus.map(m => m.file).sort(), [entete, logo].sort(), JSON.stringify(vus))
    assert.ok(vus.some(m => m.file === entete && (m.by === layout || m.by === 'bundle.js')), JSON.stringify(vus))
    assert.ok(vus.some(m => m.file === logo && m.by === 'mjs-precache.json'), JSON.stringify(vus))
  })
})
