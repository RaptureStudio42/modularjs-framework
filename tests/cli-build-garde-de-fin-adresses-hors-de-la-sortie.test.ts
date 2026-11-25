// garde de fin de `mjs build` : une adresse qui n'est pas un fichier de la sortie ne l'arrête pas — une route du serveur qui finit
// par `.js` quand la sortie est la racine servie (aucun préfixe), une adresse calculée dans un gabarit, un fichier posé à la main
// dans le dossier de sortie (la garde regarde le disque) ; un nom à empreinte absent est vu, même sans préfixe

import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, write } from './helpers/construction-cache.js'

const bouton = (corps: string): string => `<script lang="js">\n${corps}\n</script>\n\n<button class="b" @click={@go()}>go</button>\n`

function projet(prefixe: string, script: string): string {
  const root = mjsTmp(prefixe)
  write(join(root, 'mjs.config.json'), '{}\n')
  write(join(root, 'node_modules/.keep'), '')
  write(join(root, 'app/modularjs/comp.mjs'), bouton(script))
  return root
}

describe('mjs build : garde de fin, les adresses qui ne sont pas des fichiers de la sortie', function () {
  this.timeout(180_000)

  it('sortie servie à la racine : une route du serveur en .js passe, un nom à empreinte absent est vu', function () {
    const route = projet('garde-racine-route', '  $u = "/api/liste.js";\n  @go = function() { fetch($u); };')
    const ok    = build(route, ['--prod', '--output', join(route, 'public'), '--manifest', join(route, 'bundle.js')])
    assert.equal(ok.status, 0, ok.out)
    assert.doesNotMatch(ok.out, /que cite la sortie/, ok.out)
    const fantome = projet('garde-racine-fantome', '  $u = "/fantome-abcde.js";\n  @go = function() { fetch($u); };')
    const vu      = build(fantome, ['--prod', '--output', join(fantome, 'public'), '--manifest', join(fantome, 'bundle.js')])
    assert.equal(vu.status, 1, vu.out)
    assert.match(vu.out, /fantome-abcde\.js ← comp-\w{5}\.js/, vu.out)
  })

  it('adresse calculée dans un gabarit, fichier posé à la main dans la sortie : la construction passe', function () {
    const calcule = projet('garde-gabarit', '  $n = "x";\n  @go = function() { import(`/assets/modularJS_compiled/${$n}.js`); };')
    const run     = build(calcule, ['--prod', '--output', join(calcule, 'public/assets/modularJS_compiled'), '--manifest', join(calcule, 'bundle.js')])
    assert.equal(run.status, 0, run.out)
    const main = projet('garde-pose-a-la-main', '  $u = "/assets/modularJS_compiled/vendor-lib.js";\n  @go = function() { const s = document.createElement("script"); s.src = $u; document.head.append(s); };')
    write(join(main, 'public/assets/modularJS_compiled/vendor-lib.js'), 'window.x = 1\n')
    for (const args of [['--prod'], ['--prod', '--cache'], ['--prod', '--cache']]) {
      const tour = build(main, [...args, '--output', join(main, 'public/assets/modularJS_compiled'), '--manifest', join(main, 'bundle.js')])
      assert.equal(tour.status, 0, tour.out)
    }
  })
})
