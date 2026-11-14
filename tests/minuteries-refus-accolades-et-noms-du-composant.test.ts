// refus de setTimeout / setInterval : formes des accolades du gabarit qui passaient (nom assemblé, `@attach`), chaînes
// d'accès à l'objet global (`frames`, `ownerDocument.defaultView`), et noms que le composant déclare lui-même, libres
// (`@import`, racine du <script>, test d'existence)
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const S = (...l: string[]) => ['<p>{$x}</p>', '<script lang="coffee">', '$x = 0', ...l, '</script>'].join('\n')
const G = (gabarit: string, ...l: string[]) => [gabarit, '<script lang="coffee">', '$x = 0', ...l, '</script>'].join('\n')

const verdict = async (src: string): Promise<string> => {
  try {
    await transpile(src, { moduleName: 'essai' })
    return 'accepté'
  }
  catch (e: any) {
    const m = String(e?.message ?? e)
    if (/refusé dans un composant/.test(m)) return 'refusé : script'
    if (/refusé dans une accolade du gabarit/.test(m)) return 'refusé : gabarit'
    return 'autre erreur : ' + m.split('\n')[0]
  }
}

const CAS: [string, string, string][] = [
  ["interpolation : window['set' + 'Timeout']", 'refusé : gabarit', G("<p>{window['set' + 'Timeout']((-> $x = 1), 10)}</p>")],
  ["attribut lié : window['set' + 'Interval']", 'refusé : gabarit', G("<p title={window['set' + 'Interval']((-> $x = 1), 10)}>a</p>")],
  ["interpolation : self['setTime' + 'out']", 'refusé : gabarit', G("<p>{self['setTime' + 'out']((-> $x = 1), 10)}</p>")],
  ['@attach : setTimeout dans la fonction', 'refusé : gabarit', G('<p :attach={(n) -> setTimeout (-> n.focus()), 10}>a</p>')],
  ['interpolation : frames.setTimeout', 'refusé : gabarit', G('<p>{frames.setTimeout((-> $x = 1), 10)}</p>')],
  ['script : frames.setTimeout', 'refusé : script', S('frames.setTimeout (-> $x = 1), 10')],
  ['script : window.frames.setInterval', 'refusé : script', S('window.frames.setInterval (-> $x = 1), 10')],
  ['script : document.body.ownerDocument.defaultView.setTimeout', 'refusé : script', S('document.body.ownerDocument.defaultView.setTimeout (-> $x = 1), 10')],
  ["script : ownerDocument.defaultView de la balise du composant", 'refusé : script', S('µmount ->', '  @ownerDocument.defaultView.setInterval (-> $x = 1), 10', '  null')],
  ['script : @import setTimeout puis appel', 'accepté', S("@import setTimeout './outils.js'", '$x = setTimeout(1)')],
  ['gabarit : @import setTimeout puis {setTimeout(2)}', 'accepté', G('<p>{setTimeout(2)}</p>', "@import setTimeout './outils.js'")],
  ['gabarit : fonction de la racine du script nommée setTimeout', 'accepté', G('<p>{setTimeout(2)}</p>', 'setTimeout = (n) -> n * 2')],
  ['script : existence setTimeout?', 'accepté', S('$x = setTimeout?')],
  ['script : existence window.setTimeout?', 'accepté', S('$x = window.setTimeout?')],
  ['script : setInterval != null', 'accepté', S('$x = setInterval != null')],
  ['gabarit : chaîne entre crochets qui cite setTimeout', 'accepté', G("<p>{['setTimeout'][0]}</p>")],
  ['script : setTimeout nu, toujours refusé', 'refusé : script', S('setTimeout (-> $x = 1), 10')],
  ['gabarit : {setTimeout(…)} nu, toujours refusé', 'refusé : gabarit', G('<p>{setTimeout((-> $x = 1), 10)}</p>')],
]

describe('minuteries : accolades du gabarit, chaînes de l’objet global, noms du composant', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [nom, attendu, src] of CAS) {
    it(`${nom} → ${attendu}`, async () => {
      assert.equal(await verdict(src), attendu)
    })
  }

  it('accolade illisible : refusée si son texte nomme une minuterie hors des chaînes, acceptée sinon', async () => {
    const utils: any = await import('../src/generator/utils.js')
    assert.equal(typeof utils.refuserMinuterieDuGabarit, 'function')
    assert.throws(() => utils.refuserMinuterieDuGabarit('setTimeout(f, 1) +'), /setTimeout/)
    assert.doesNotThrow(() => utils.refuserMinuterieDuGabarit("'setTimeout' +"))
  })
})
