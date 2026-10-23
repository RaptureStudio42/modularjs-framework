// `µ.elementAt(x, y)` rend `null` pour un point qu'aucun élément n'occupe — hors de la fenêtre, et aussi quand
// une coordonnée n'est pas un nombre fini : NaN, Infinity, undefined, null, une chaîne (même vide ou numérique),
// un tableau, un booléen (une mesure qui a échoué, ou un type qu'on ne convertit pas en silence), ou un nombre
// que le navigateur ne sait pas lire (Firefox refuse tout ce qui dépasse un flottant simple, comme 1e39).
// Défaut garanti absent : le navigateur refuse ces valeurs (`document.elementFromPoint` lève une TypeError),
// l'erreur traversait `µ.elementAt` jusqu'à l'appelant ; et le test de nombre fini convertissait d'abord —
// null, '', [] et true valaient 0 et rendaient l'élément du coin (0, 0).
// Gardes : un point sur un élément du composant rend l'élément le plus profond (jusque dans son ombre) ; un
// point hors de la fenêtre rend `null` comme avant ; seule la TypeError du navigateur est avalée : toute autre
// erreur d'`elementFromPoint` (une racine qui casse autrement) remonte à l'appelant.
// Chromium et Firefox : c'est le navigateur qui lève l'erreur, happy-dom ne la reproduit pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'sonde-point.mjs': '<script>\n$v = 0\n</script>\n<button class="b">ici</button>\n<style>\n.b\n  display: block\n  width: 120px\n  height: 40px\n</style>\n'
}

for (const nomNavigateur of ['chromium', 'firefox'] as const) {
  describe('µ.elementAt : coordonnée qui n\'est pas un nombre fini → null, sans erreur (' + nomNavigateur + ' réel)', function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let navigateur: any

    before(async function () {
      present = await navigateurPresent(nomNavigateur)
      if (!present) {
        console.log('  ℹ️  ' + nomNavigateur + ' non installé, test de µ.elementAt sauté. Activer : `npx playwright install ' + nomNavigateur + '`')
        return
      }
      const root   = mjsTmp('element-at')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
      // la page appelle µ.elementAt elle-même (la construction ne lit pas ce script) : demandée par la configuration
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: ['element_at'] })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
      script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      const playwright = await import('playwright')
      navigateur = await playwright[nomNavigateur].launch()
    })

    after(async () => {
      if (navigateur) await navigateur.close()
      await terminateSharedWorkerPool()
    })

    it('NaN, Infinity, undefined, null, chaînes, tableaux, booléens et nombres hors plage rendent null sans lever d\'erreur ; un vrai point rend l\'élément', async function () {
      if (!present) { this.skip(); return }
      const page = await navigateur.newPage()
      try {
        const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><mjs-sonde-point></mjs-sonde-point><script>${script}</script></body></html>`
        await page.route('http://mjs.test/**', (route: any) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
        await page.goto('http://mjs.test/')
        await page.waitForFunction(() => !!(document.querySelector('mjs-sonde-point') as any)?._shadow?.querySelector('.b'))
        const rendu = await page.evaluate(() => {
          const µ = (window as any).µ
          const essai = (x: any, y: any) => {
            try {
              const e = µ.elementAt(x, y)
              return e === null ? 'null' : e.tagName.toLowerCase() + '.' + e.className
            } catch (err: any) {
              return 'erreur ' + err.name
            }
          }
          const essaiRacine = (erreur: Error) => {
            try {
              const e = µ._mjs_elementAt(10, 10, { elementFromPoint: () => { throw erreur } })
              return e === null ? 'null' : 'élément'
            } catch (err: any) {
              return 'erreur ' + err.name
            }
          }
          return {
            racineTypeError:  essaiRacine(new TypeError('hors plage')),
            racineRangeError: essaiRacine(new RangeError('autre erreur')),
            nan:          essai(NaN, 10),
            infini:       essai(Infinity, 10),
            moinsInfini:  essai(10, -Infinity),
            indefini:     essai(undefined, undefined),
            indefiniUn:   essai(10, undefined),
            nul:          essai(null, null),
            nulUn:        essai(10, null),
            texte:        essai('abc', 10),
            vide:         essai('', ''),
            numerique:    essai('10', '10'),
            tableaux:     essai([], []),
            booleens:     essai(true, true),
            tresGrand:    essai(1e39, 10),
            tresPetit:    essai(10, -1e39),
            maxValue:     essai(Number.MAX_VALUE, 10),
            horsFenetre:  essai(-50, -50),
            vrai:         essai(10, 10)
          }
        })
        assert.deepEqual(rendu, {
          racineTypeError:  'null',
          racineRangeError: 'erreur RangeError',
          nan:          'null',
          infini:       'null',
          moinsInfini:  'null',
          indefini:     'null',
          indefiniUn:   'null',
          nul:          'null',
          nulUn:        'null',
          texte:        'null',
          vide:         'null',
          numerique:    'null',
          tableaux:     'null',
          booleens:     'null',
          tresGrand:    'null',
          tresPetit:    'null',
          maxValue:     'null',
          horsFenetre:  'null',
          vrai:         'button.b'
        })
      } finally { await page.close() }
    })
  })
}
