// refus de setTimeout / setInterval dans un composant : les formes détournées qui s'écrivent naturellement (objet global
// lu par une chaîne d'accès, nom assemblé de chaînes fixes, décomposition, nom déclaré dans une AUTRE portée), et ce qui
// reste permis (`typeof`, nom déclaré lu dans sa portée, autre objet)
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const script = (...l: string[]) => ['<p>{$x}</p>', '<script lang="coffee">', '$x = 0', ...l, '</script>'].join('\n')

async function verdict(source: string): Promise<string> {
  try {
    await transpile(source, { moduleName: 'essai' })
    return 'accepté'
  }
  catch (e: any) {
    const m = String(e?.message ?? e)
    if (/refusé dans (un composant|une accolade du gabarit)/.test(m)) return ['refusé', ...(m.match(/ligne \d+/) ?? [])].join(' ')
    return 'autre erreur : ' + m.split('\n')[0]
  }
}

describe('minuteries refusées : formes détournées', function () {
  this.timeout(60000)

  const REFUS: [string, string, string][] = [
    ['nom assemblé de chaînes fixes sur globalThis', script('globalThis[\'set\' + \'Timeout\'] (-> $x = 1), 10'), 'refusé ligne 4'],
    ['window.window.setTimeout', script('window.window.setTimeout (-> $x = 1), 10'), 'refusé ligne 4'],
    ['self.window.setInterval', script('self.window.setInterval (-> $x = 1), 10'), 'refusé ligne 4'],
    ['document.defaultView.setTimeout', script('document.defaultView.setTimeout (-> $x = 1), 10'), 'refusé ligne 4'],
    ['top.setInterval', script('top.setInterval (-> $x = 1), 10'), 'refusé ligne 4'],
    ['parent.setTimeout', script('parent.setTimeout (-> $x = 1), 10'), 'refusé ligne 4'],
    ['{ setTimeout: st } = window, puis st(…)', script('{setTimeout: st} = window', 'st (-> $x = 1), 10'), 'refusé ligne 4'],
    ['{ setTimeout } = window, puis setTimeout(…)', script('{setTimeout} = window', 'setTimeout (-> $x = 1), 10'), 'refusé ligne 4'],
    ['{ setInterval } = globalThis', script('{setInterval} = globalThis', 'setInterval (-> $x++), 1000'), 'refusé ligne 4'],
    ['paramètre homonyme d\'une autre fonction, puis setTimeout nu', script('bidon = (setTimeout) -> setTimeout', 'setTimeout (-> $x = 1), 100'), 'refusé ligne 5'],
    ['variable homonyme locale à une autre fonction, puis setInterval nu', script('autre = ->', '  setInterval = null', 'setInterval (-> $x++), 1000'), 'refusé ligne 6'],
    ['gestionnaire : window[\'set\' + \'Timeout\']', ['<button @click={-> window[\'set\' + \'Timeout\'] (-> $x = 1), 10}>b</button>', '<script lang="coffee">', '$x = 0', '</script>'].join('\n'), 'refusé ligne 1'],
    ['interpolation {setTimeout(…)} du gabarit', ['<p>{setTimeout((-> $x = 1), 10)}</p>', '<script lang="coffee">', '$x = 0', '</script>'].join('\n'), 'refusé'],
    ['attribut lié title={window.setInterval(…)}', ['<p title={window.setInterval((-> $x = 1), 10)}>a</p>', '<script lang="coffee">', '$x = 0', '</script>'].join('\n'), 'refusé']
  ]
  const PERMIS: [string, string][] = [
    ['typeof setTimeout', script('$x = typeof setTimeout')],
    ['typeof window.setInterval', script('$x = typeof window.setInterval')],
    ['paramètre setTimeout lu dans sa fonction', script('planifier = (setTimeout) -> setTimeout -> $x = 1')],
    ['variable setTimeout locale lue dans sa fonction', script('f = ->', '  setTimeout = (g) -> g()', '  setTimeout -> $x = 1')],
    ['paramètre window : un autre objet que le global', script('planifier = (window) -> window.setTimeout (-> $x = 1), 10')],
    ['décomposition d\'un autre objet', script('minuteur = { setTimeout: (f) -> f() }', '{setTimeout} = minuteur', 'setTimeout -> $x = 1')],
    ['nom assemblé sur un autre objet', script('o = {}', 'o[\'set\' + \'Timeout\']?()')],
    ['interpolation : typeof setTimeout', ['<p>{typeof setTimeout}</p>', '<script lang="coffee">', '$x = 0', '</script>'].join('\n')]
  ]
  for (const [quoi, source, attendu] of REFUS) it('refusé : ' + quoi, async () => { assert.equal(await verdict(source), attendu) })
  for (const [quoi, source] of PERMIS) it('permis : ' + quoi, async () => { assert.equal(await verdict(source), 'accepté') })
})
