// l'état universel `µ$x` (un objet partagé par tous les composants, `µ$x = { n: 1 }`) ne se lit pas dans le gabarit : `{µ$x.n}` est
// refusé ; tenu par une variable `$` du script (`$x = µ$x`), il s'affiche par elle (`{$x.n}`) et suit chaque changement de
// son champ ; un champ copié par un reffet (`µeffect -> $n = µ$x.n`) aussi — Chromium et Firefox réels

import assert from 'node:assert/strict'
import { monterComposants, type Composants } from './helpers/composants-navigateur.js'

const CAS: Record<string, string> = {
  'univ-objet':  "<script>\nµ$zunivo = { n: 1 }\n$x = µ$zunivo\n@plus = -> µ$zunivo.n++\n</script>\n<p>{$x.n}</p>\n<button @click={@plus()}>+</button>\n",
  'univ-reffet': "<script>\nµ$zunivr = { n: 1 }\nµeffect -> $n = µ$zunivr.n\n@plus = -> µ$zunivr.n++\n</script>\n<p>{$n}</p>\n<button @click={@plus()}>+</button>\n"
}

for (const moteur of ['chromium', 'firefox'] as const) {
  describe(`état universel affiché par une variable du script (${moteur} réel)`, function () {
    this.timeout(280000)
    let composants: Composants | null = null

    before(async function () {
      composants = await monterComposants(CAS, moteur)
      if (!composants) this.skip()
    })

    after(async () => {
      if (composants) await composants.fermer()
    })

    const lire = async (nom: string): Promise<string[]> => {
      const page = await composants!.client(nom, 'p')
      try {
        const texte  = (): Promise<string> => page.evaluate(`document.querySelector('mjs-${nom}')._shadow.querySelector('p').textContent`)
        const avant  = await texte()
        await page.evaluate(`document.querySelector('mjs-${nom}')._shadow.querySelector('button').click()`)
        await page.waitForTimeout(200)
        return [avant, await texte()]
      }
      finally { await page.close() }
    }

    it('$x = µ$x puis {$x.n} : affiché, et suit le changement', async () => {
      assert.deepEqual(await lire('univ-objet'), ['1', '2'])
    })

    it('µeffect -> $n = µ$x.n puis {$n} : affiché, et suit le changement', async () => {
      assert.deepEqual(await lire('univ-reffet'), ['1', '2'])
    })
  })
}
