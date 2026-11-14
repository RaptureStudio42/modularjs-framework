// une page dont la `<@@select>` est à la racine de sa vue (en `ssr:markers`, reprise telle que le serveur l'a écrite), à options d'un `{for}`
// (`value="0{x.n}"`) : retirée du document, changée pendant son absence puis remise, ou seulement remise, elle se remonte sans erreur et sa liste
// envoie la valeur de l'option choisie ; de même dans les autres façons de reprendre la page du serveur (positions, différence, remplacement) et
// sans rendu du serveur, sur les trois moteurs
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, variantes } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'p-sel.mjs': [
    '<script>', '$n = 1', '$rows = [{ id: 1, n: 5 }, { id: 2, n: 7 }]', "$v = '05'",
    'bump = ->', '  $n += 1', '  $rows = $rows.map((r)-> r.id == 1 ? { ...r, n: r.n + 4 } : r)', "  $v = '0' + $rows[0].n", '</script>',
    '<form class="f"><@@select name="pick" value={$v}>{for x in $rows by id}<@@option value="0{x.n}">L{x.id}</@@option>{end}<@@option value="0{$n}">M</@@option></@@select></form>',
    '<button class="go" @click={bump()}>go</button>',
  ].join('\n') + '\n',
}

const LIRE = `(() => {
  const sh = document.querySelector('mjs-p-sel')?._shadow
  if (!sh) return 'pas de page'
  return { opt: [...sh.querySelectorAll('.f mjs-core-option')].map((o) => o.getAttribute('value')), envoi: new FormData(sh.querySelector('.f')).get('pick') }
})()`
const CLIC     = `document.querySelector('mjs-p-sel')._shadow.querySelector('.go').click()`
const RETIRER  = `window.__page = document.querySelector('mjs-p-sel'); window.__lieu = [__page.parentNode, __page.nextSibling]; __page.remove()`
const DEHORS   = `__page._shadow.querySelector('.go').click()`
const REMETTRE = '__lieu[0].insertBefore(__page, __lieu[1])'
// chaque étape : ses gestes (une pause laisse partir la destruction différée de la page restée hors du document), puis les valeurs des options
// et celle qu'envoie la liste
const ETAPES: Array<[string, string[], string[], string]> = [
  ['départ', [], ['05', '07', '01'], '05'],
  ['changement', [CLIC], ['09', '07', '02'], '09'],
  ['page retirée, changée hors du document, remise', [RETIRER, 'pause', DEHORS, 'pause', REMETTRE], ['013', '07', '03'], '013'],
  ['page retirée puis remise sans changement', [RETIRER, 'pause', REMETTRE], ['013', '07', '03'], '013'],
  ['changement après la remise', [CLIC], ['017', '07', '04'], '017'],
]

describe('une page retirée puis remise : sa `<@@select>` se remonte sans erreur et suit ses options', function () {
  this.timeout(180000)
  const cibles: Record<string, Cible> = {}

  before(async () => {
    cibles.ssr    = await construire('ssr', SOURCES, ['mjs-p-sel'])
    cibles.bundle = await construire('bundle', SOURCES, ['mjs-p-sel'])
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const nom of ['chromium', 'firefox', 'webkit']) it(`${nom} : page retirée, changée, remise, puis changée`, async function () {
    const playwright: any = await import('playwright')
    const browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    const ecarts: string[] = []
    try {
      for (const [mode, variante] of [['bundle', ''], ...variantes('ssr').map((v) => ['ssr', v])]) {
        const o        = await charger(browser, cibles[mode], 'mjs-p-sel', variante)
        const nomEssai = variante ? `${mode}/${variante}` : mode
        try {
          await o.page.waitForFunction(`document.querySelector('mjs-p-sel')?._shadow?.querySelectorAll('mjs-core-option').length === 3`, null, { timeout: 15000 })
          await o.page.waitForTimeout(300)
          for (const [etape, gestes, opt, envoi] of ETAPES) {
            for (const g of gestes) {
              if (g === 'pause') await o.page.waitForTimeout(150)
              else await o.page.evaluate(g)
            }
            await o.page.waitForFunction(`JSON.stringify((${LIRE}).opt) === '${JSON.stringify(opt)}'`, null, { timeout: 3000 }).catch(() => {})
            await o.page.waitForTimeout(300)
            const vu = await o.page.evaluate(LIRE)
            if (JSON.stringify(vu) !== JSON.stringify({ opt, envoi })) ecarts.push(`${nomEssai} ${etape} ${JSON.stringify(vu)}`)
          }
          if (o.erreurs.length) ecarts.push(`${nomEssai} erreurs ${JSON.stringify(o.erreurs)}`)
        }
        finally {
          await o.fermer()
        }
      }
    }
    finally {
      await browser.close()
    }
    assert.deepEqual(ecarts, [])
  })
})
