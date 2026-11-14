// `<@@select>` lié dans les deux sens à une variable de nombre (`int`, `float`) dont les options écrivent le nombre autrement
// (`<@@option value="02">`) : la variable qui vaut 2 choisit l'option `02` (`2.50` pour 2.5), choisir « 02 » écrit 2 et la liste
// garde l'option choisie, une valeur remise par votre code choisit l'option qui l'écrit autrement, la liste à choix multiples aussi ;
// une variable libre et une variable `string` comparent le texte, comme avant ; deux options `02` et `2` dans la même liste suivent
// la règle de la liste native — Chromium, Firefox et WebKit, en développement et en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const MOIS  = '<@@option value="01">janvier</@@option><@@option value="02">fevrier</@@option><@@option value="10">octobre</@@option>'
const DEUX  = '<@@option value="02">fevrier</@@option><@@option value="2">deux</@@option>'

const SOURCE = [
  '<vars>',
  '  $n   int',
  '  $f   float 0..10',
  '  $m   int 0..20[]',
  '  $s   string',
  '  $d   int',
  '  $nat int',
  '</vars>',
  '',
  '<script>',
  '  $n   = 2',
  '  $f   = 2.5',
  '  $m   = [2]',
  '  $lib = 2',
  "  $s   = '2'",
  '  $d   = 2',
  '  $nat = 2',
  '</script>',
  '',
  `<@@select id="n" aria-label="n" value=!{$n}>${MOIS}</@@select>`,
  '<button id="ecrit" @click={$n = 1}>ecrit</button>',
  '<@@select id="f" aria-label="f" value=!{$f}><@@option value="2.50">deux et demi</@@option><@@option value="5.00">cinq</@@option></@@select>',
  `<@@select id="m" aria-label="m" multiple value=!{$m}>${MOIS}</@@select>`,
  `<@@select id="lib" aria-label="lib" value=!{$lib}>${MOIS}</@@select>`,
  `<@@select id="s" aria-label="s" value=!{$s}>${DEUX}</@@select>`,
  `<@@select id="d" aria-label="d" value=!{$d}>${DEUX}</@@select>`,
  '<select id="nat" aria-label="nat" value=!{$nat}><option value="02">fevrier</option><option value="2">deux</option></select>',
  '<p id="etat">{JSON.stringify([$n, $f, $m, $lib, $s, $d, $nat])}</p>',
].join('\n') + '\n'

// la place de chaque variable dans l'état affiché
const AT = { n: 0, f: 1, m: 2, lib: 3, s: 4, d: 5, nat: 6 } as const

const MODES = { dev: {}, prod: { env: 'prod', js: 'bundle' } } as const

async function construire(mode: keyof typeof MODES): Promise<string> {
  const root = mjsTmp('select-liaison-typee-' + mode)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'liste.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/m', ...MODES[mode] } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return out
}

// l'élément d'id `id`, dans l'ombre du composant ; l'ombre d'une liste du cœur
const CHAMP = `(i) => { const h = document.querySelector('mjs-liste'); return (h._shadow || h).querySelector('#' + i) }`
const DANS  = `(i) => { const s = (${CHAMP})(i); return s._shadow || s.shadowRoot || s }`

const lire      = (page: any) => page.evaluate(`JSON.parse((${CHAMP})('etat').textContent)`)
// le libellé du bouton de la liste, et s'il est le texte d'attente (rien de choisi)
const etiquette = (page: any, id: string) => page.evaluate(`(${DANS})(${JSON.stringify(id)}).querySelector('.select-label').textContent.trim()`)
const attente   = (page: any, id: string) => page.evaluate(`(${DANS})(${JSON.stringify(id)}).querySelector('.select-label').classList.contains('placeholder')`)
// ouvre la liste (si elle ne l'est pas) puis clique la ligne de ce libellé
const choisir   = async (page: any, id: string, libelle: string) => {
  const vu = await page.evaluate(`(() => { const d = (${DANS})(${JSON.stringify(id)}); const b = d.querySelector('.select-btn'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); return true })()`)
  assert.ok(vu)
  await page.waitForTimeout(80)
  const ok = await page.evaluate(`(() => { const r = Array.from((${DANS})(${JSON.stringify(id)}).querySelectorAll('.select-option[role=option]')).find((o) => o.textContent.includes(${JSON.stringify(libelle)})); if (r) r.click(); return !!r })()`)
  assert.ok(ok, `${id} : ligne « ${libelle} » introuvable`)
  await page.waitForTimeout(80)
}
const natif     = async (page: any, valeur: string) => { await (await page.evaluateHandle(`(${CHAMP})('nat')`)).asElement().selectOption(valeur); await page.waitForTimeout(80) }
const choixNatif = (page: any) => page.evaluate(`Array.from((${CHAMP})('nat').selectedOptions).map((o) => o.textContent)`)

for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
  describe(`<@@select> lié à une variable de nombre typée — ${mode} (navigateurs réels)`, function () {
    this.timeout(120000)
    let out = ''

    before(async () => { out = await construire(mode) })
    after(async () => { await terminateSharedWorkerPool() })

    for (const nom of MOTEURS) {
      describe(nom, function () {
        let browser: any
        let page: any
        let erreurs: string[]
        let avert: string[]

        before(async function () {
          if (!(await moteurPresent(nom))) {
            console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
            return this.skip()
          }
          const playwright: any = await import('playwright')
          browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
          page    = await browser.newPage()
          erreurs = []
          avert   = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'warning' || m.type() === 'error') avert.push(m.text()) })
          await page.route('http://mjs.test/**', (route: any) => {
            const url = route.request().url()
            if (url === 'http://mjs.test/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-liste></mjs-liste><script type="module" src="/m/bundle.js"></script></body></html>' })
            const fichier = join(out, url.replace('http://mjs.test/m/', '').split('?')[0])
            if (!url.startsWith('http://mjs.test/m/') || !existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: fichier.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: readFileSync(fichier) })
          })
          await page.goto('http://mjs.test/')
          await page.waitForFunction(`!!(document.querySelector('mjs-liste') && (${CHAMP})('etat') && (${DANS})('d').querySelector('.select-label'))`)
          await page.waitForTimeout(100)
        })

        after(async () => { if (browser) await browser.close() })

        it('la variable qui vaut 2 choisit l\'option `02`, 2.5 l\'option `2.50` sous `float`, la liste multiple aussi', async () => {
          assert.deepEqual(await lire(page), [2, 2.5, [2], 2, '2', 2, 2])
          assert.equal(await etiquette(page, 'n'), 'fevrier')
          assert.equal(await etiquette(page, 'f'), 'deux et demi')
          assert.equal(await etiquette(page, 'm'), 'fevrier')
          assert.deepEqual(erreurs, [])
        })

        it('choisir « 10 » puis « 02 » écrit le nombre, et la liste garde l\'option choisie ; sous `float` de même', async () => {
          for (const [libelle, nombre] of [['octobre', 10], ['fevrier', 2], ['janvier', 1]] as const) {
            await choisir(page, 'n', libelle)
            assert.equal((await lire(page))[AT.n], nombre, `« ${libelle} » écrit ${nombre}`)
            assert.equal(await etiquette(page, 'n'), libelle, `la liste garde « ${libelle} »`)
          }
          await choisir(page, 'f', 'cinq')
          assert.equal((await lire(page))[AT.f], 5)
          assert.equal(await etiquette(page, 'f'), 'cinq')
          await choisir(page, 'f', 'deux et demi')
          assert.equal((await lire(page))[AT.f], 2.5)
          assert.equal(await etiquette(page, 'f'), 'deux et demi')
          assert.deepEqual(avert.filter((x) => x.includes('refuse')), [])
          assert.deepEqual(erreurs, [])
        })

        it('une valeur remise par votre code choisit l\'option qui l\'écrit autrement', async () => {
          await choisir(page, 'n', 'octobre')
          await page.evaluate(`(${CHAMP})('ecrit').click()`)
          await page.waitForTimeout(80)
          assert.equal((await lire(page))[AT.n], 1)
          assert.equal(await etiquette(page, 'n'), 'janvier')
          assert.deepEqual(erreurs, [])
        })

        it('liste multiple : cocher « octobre » ajoute 10, décocher « fevrier » retire 2', async () => {
          await choisir(page, 'm', 'octobre')
          assert.deepEqual((await lire(page))[AT.m], [2, 10])
          assert.equal(await etiquette(page, 'm'), 'fevrier, octobre')
          await choisir(page, 'm', 'fevrier')
          assert.deepEqual((await lire(page))[AT.m], [10])
          assert.equal(await etiquette(page, 'm'), 'octobre')
          assert.deepEqual(avert.filter((x) => x.includes('refuse')), [])
          assert.deepEqual(erreurs, [])
        })

        it('une variable libre compare le texte, comme avant : 2 ne choisit pas « 02 », son choix écrit le texte de l\'option', async () => {
          assert.equal((await lire(page))[AT.lib], 2)
          assert.ok(await attente(page, 'lib'), 'rien de choisi')
          await choisir(page, 'lib', 'janvier')
          assert.equal((await lire(page))[AT.lib], '01')
          assert.equal(await etiquette(page, 'lib'), 'janvier')
          assert.deepEqual(erreurs, [])
        })

        it('une variable `string` compare le texte, comme avant', async () => {
          assert.equal(await etiquette(page, 's'), 'deux')
          await choisir(page, 's', 'fevrier')
          assert.equal((await lire(page))[AT.s], '02')
          assert.equal(await etiquette(page, 's'), 'fevrier')
          assert.deepEqual(erreurs, [])
        })

        it('deux options `02` et `2` : la règle de la liste native — 2 choisit « 2 », et le choix de « 02 » se montre comme dans la liste native', async () => {
          assert.equal(await etiquette(page, 'd'), 'deux')
          assert.deepEqual(await choixNatif(page), ['deux'])
          await choisir(page, 'd', 'fevrier')
          await natif(page, '02')
          const etat = await lire(page)
          assert.equal(etat[AT.d], 2)
          assert.equal(etat[AT.nat], 2)
          assert.deepEqual([await etiquette(page, 'd')], await choixNatif(page), 'le même libellé que la liste native')
          assert.deepEqual(erreurs, [])
        })
      })
    }
  })
}
