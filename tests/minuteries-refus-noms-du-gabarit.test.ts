// refus de setTimeout / setInterval dans le gabarit : un nom que le gabarit met en portée (variable et index d'un `{for}`,
// valeur d'une branche `{success}` / `{error}`, `{const}`, paramètres de `<@failed>`, contenu glissé dans une boucle) n'est
// pas l'objet global, dans sa portée seulement ; `!window.setTimeout` (test de présence) ne pose rien ; un nom assemblé par
// un gabarit littéral de morceaux fixes est refusé
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const S = (...l: string[]) => ['<p>{$x}</p>', '<script lang="coffee">', '$x = 0', ...l, '</script>'].join('\n')
const G = (gabarit: string, ...l: string[]) => [gabarit, '<script lang="coffee">', '$x = 0', '$l = []', '$p = null', ...l, '</script>'].join('\n')

const verdict = async (src: string): Promise<string> => {
  try {
    await transpile(src, { moduleName: 'essai' })
    return 'accepté'
  }
  catch (e: any) {
    const m = String(e?.message ?? e)
    if (/refusé dans un composant/.test(m)) return 'refusé : script'
    if (/refusé dans une accolade du gabarit/.test(m)) return 'refusé : gabarit'
    return 'autre erreur : ' + m.split('\n').slice(0, 3).join(' ')
  }
}

const CAS: [string, string, string][] = [
  ["{for top in $l} : top['set' + 'Timeout']", 'accepté', G("{for top in $l}<p>{top['set' + 'Timeout']}</p>{end}")],
  ['{for frames in $l} : frames.setInterval', 'accepté', G('{for frames in $l}<p>{frames.setInterval}</p>{end}')],
  ['{for top in $l} : top.setTimeout()', 'accepté', G('{for top in $l}<p>{top.setTimeout()}</p>{end}')],
  ['{for x, self in $l} : index nommé self', 'accepté', G('{for x, self in $l}<p>{self.setTimeout(x)}</p>{end}')],
  ['{for} : attribut lié et @attach de la boucle', 'accepté', G('{for parent in $l}<p title={parent.setInterval(1)} :attach={(n) -> parent.setTimeout(n)}>a</p>{end}')],
  ['{for} imbriqué : variable de la boucle extérieure', 'accepté', G('{for top in $l}{for y in top.liste}<p>{top.setTimeout(y)}</p>{end}{end}')],
  ['{success frames} et {error self}', 'accepté', G('{await $p}<p>attente</p>{success frames}<p>{frames.setInterval(1)}</p>{error self}<p>{self.setTimeout(1)}</p>{end}')],
  ['{const top = …}', 'accepté', G('{for x in $l}{const top = x}<p>{top.setTimeout(1)}</p>{end}')],
  ['<@failed top reset>', 'accepté', G('<@failed top reset><p>{top.setTimeout(1)}</p></@failed><p>a</p>')],
  ['<@failed err reset> : top, que le bloc ne nomme pas, reste l\'objet global', 'refusé : script', G('<@failed err reset><p>{top.setTimeout(1)}</p></@failed><p>a</p>')],
  ['contenu glissé dans une boucle', 'accepté', G('{for top in $l}<@carte><p>{top.setTimeout(1)}</p></@carte>{end}')],
  ['après la boucle, top redevient l\'objet global', 'refusé : gabarit', G('{for top in $l}<p>{top}</p>{end}<p>{top.setTimeout((-> $x = 1), 10)}</p>')],
  ['{const} d\'une boucle : rien hors de la boucle', 'refusé : gabarit', G('{for x in $l}{const top = x}<p>{top}</p>{end}<p>{top.setTimeout((-> $x = 1), 10)}</p>')],
  ['{!window.setTimeout} : test de présence', 'accepté', G('<p>{!window.setTimeout}</p>')],
  ['{!setTimeout} : test de présence', 'accepté', G('<p>{!setTimeout}</p>')],
  ['script : not window.setInterval', 'accepté', S('$x = not window.setInterval')],
  ['{!setTimeout(…)} : l\'appel reste refusé', 'refusé : gabarit', G('<p>{!setTimeout((-> $x = 1), 10)}</p>')],
  ['gabarit : globalThis[`set${\'Timeout\'}`]', 'refusé : gabarit', G("<p>{globalThis[`set${'Timeout'}`]((-> $x = 1), 10)}</p>")],
  ['script : window["set#{\'Interval\'}"] (gabarit littéral compilé)', 'refusé : script', S("window[\"set#{'Interval'}\"] (-> $x = 1), 10")],
  ['script : self[`set${\'Time\' + \'out\'}`]', 'refusé : script', S("self[\"set#{'Time' + 'out'}\"] (-> $x = 1), 10")],
]

describe('minuteries : noms du gabarit, test de présence, gabarit littéral', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const [nom, attendu, src] of CAS) {
    it(`${nom} → ${attendu}`, async () => {
      assert.equal(await verdict(src), attendu)
    })
  }
})
