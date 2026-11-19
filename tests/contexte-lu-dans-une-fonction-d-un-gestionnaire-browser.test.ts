// Un contexte (`§§theme`) lu dans une `function(){}` d'un gestionnaire se lit sur le composant, quel que soit l'appel : gestionnaire d'un
// événement natif, d'une émission d'un enfant, d'une ligne de `{for}` ; `this` lu dans le corps reste celui de l'appel. Une fonction
// appelée avec un autre `this` (`k.call({ nom })`, un composant enfant) lit aussi le contexte du composant qui a écrit le gestionnaire. Vraies constructions, page réelle (production
// en module : mode strict), Chromium et Firefox
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves, type Cible } from './helpers/liaison-navigateur.js'

const L = (...l: string[]) => l.join('\n') + '\n'
const sources: Record<string, string> = {
  'c-emet.mjs': L('<button class="go" @click.emit.pick>go</button>'),
  'c-fournit.mjs': L('<script>', "§§theme = valeur: 'clair'", '</script>', '<i class="f">f</i>'),
  'cx-parent.mjs': L(
    '<script>', "§§theme = valeur: 'sombre'", "$v = ''", '$l = [1]', '</script>',
    '<p class="v">{$v}</p>',
    "<button class=\"natif\" @click={lire = function() { return §§theme.valeur }; $v = 'natif:' + lire()}>a</button>",
    "<@c-emet @pick={$v = 'emis:' + [1].map(function(n) { return §§theme.valeur }).join()}></@c-emet>",
    '<@c-fournit></@c-fournit>',
    "<button class=\"enfant\" @click={$v = 'enfant:' + (function() { return §§theme.valeur }).call(el.getRootNode().querySelector('mjs-c-fournit'))}>e</button>",
    '{for n in $l}',
    "<button class=\"ligne\" @click={$v = 'ligne:' + [n].map(function(x) { return §§theme.valeur + x }).join()}>{n}</button>",
    '{end}',
    "<button class=\"this\" @click={h = function() { return this.nom }; $v = 'this:' + h.call({ nom: 'appelant' })}>t</button>",
    "<button class=\"mixte\" @click={k = function() { return this.nom + ':' + §§theme.valeur }; $v = 'mixte:' + k.call({ nom: 'appelant' })}>m</button>",
  ),
}

const trouve = `const trouve = (r, s) => { if (!r) return null; const x = r.querySelector(s); if (x) return x; for (const e of r.querySelectorAll('*')) { const y = e._shadow ? trouve(e._shadow, s) : null; if (y) return y } return null }`

// chaque bouton cliqué tour à tour, la valeur affichée après chacun, et ce que la page a levé
async function cliquer(browser: any, cible: Cible, boutons: string[]): Promise<{ vus: string[], graves: string[] }> {
  const o = await charger(browser, cible, 'mjs-cx-parent')
  try {
    await o.page.waitForFunction(`(() => { ${trouve}; return !!trouve(document.querySelector('mjs-cx-parent')?._shadow, '.go') })()`, null, { timeout: 8000 })
    const vus: string[] = []
    for (const b of boutons) {
      await o.page.evaluate(`(() => { ${trouve}; trouve(document.querySelector('mjs-cx-parent')._shadow, '${b}').click() })()`)
      await o.page.waitForTimeout(150)
      vus.push(await o.page.evaluate(`(() => { ${trouve}; return trouve(document.querySelector('mjs-cx-parent')._shadow, '.v').textContent })()`))
    }
    return { vus, graves: graves(o) }
  }
  finally {
    await o.fermer()
  }
}

for (const moteurNom of ['chromium', 'firefox']) {
  describe(`gestionnaire : un contexte lu dans une function(){} se lit sur le composant (${moteurNom})`, function () {
    this.timeout(180000)
    let browser: any = null
    let cible: Cible
    before(async function () {
      const playwright = await import('playwright')
      const moteur     = (playwright as any)[moteurNom]
      if (!existsSync(moteur.executablePath())) this.skip()
      browser = await moteur.launch()
      cible   = await construire('bundle', sources, ['mjs-cx-parent'])
    })
    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    it('événement natif, émission d\'un enfant, ligne de {for}, `this` lu dans le corps : la valeur attendue, rien de levé', async () => {
      const lu = await cliquer(browser, cible, ['.natif', '.go', '.ligne', '.this'])
      assert.deepEqual(lu, { vus: ['natif:sombre', 'emis:sombre', 'ligne:sombre1', 'this:appelant'], graves: [] })
    })
    it('une fonction appelée avec un composant enfant pour `this` lit le contexte du composant qui a écrit le gestionnaire, pas celui de l\'enfant', async () => {
      const lu = await cliquer(browser, cible, ['.enfant'])
      assert.deepEqual(lu, { vus: ['enfant:sombre'], graves: [] })
    })
    it('une fonction appelée avec un autre `this` lit le contexte du composant', async () => {
      const lu = await cliquer(browser, cible, ['.mixte'])
      assert.deepEqual(lu, { vus: ['mixte:appelant:sombre'], graves: [] })
    })
  })
}
