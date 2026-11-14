// une liste simple (`<select>`) liée dans les deux sens à une variable `int`, avec ou sans plage, dont les options écrivent le nombre
// autrement (`<option value="02">`) : la variable qui vaut 2 choisit l'option `02`, même arrivée après la liste ; choisir « 02 »
// écrit 2, sans bulle, et la liste garde l'option choisie ; un choix refusé rend l'option de la valeur de sa variable écrite par votre
// code ; un nombre ramené à sa borne choisit l'option qui l'écrit autrement (`05` pour 5), et sans option de la borne la liste revient
// à sa variable, jamais vide ; l'option vide écrit null sous une règle qui refuse le texte vide et accepte null (`int 1..12 | null`),
// le texte vide sous `string | null` ; une variable libre choisit l'option de son texte exact, comme avant ; sous une règle `float`,
// l'option `2.50` porte 2.5 ; sans règle (magasin typé par un composant pas encore chargé), l'option vide passe telle quelle —
// Chromium, Firefox et WebKit, en développement et en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const OPTIONS = '<option value="01">un</option><option value="02">deux</option><option value="10">dix</option>'

const SOURCE = [
  '<vars>',
  '  $n  int',
  '  $p  int 1..12',
  '  $b  int 1..5',
  '  $t  int 1..12',
  '  $f  float 0..10',
  '  $bz int 1..5',
  '  $nl int 1..12 | null',
  '  $sn string | null',
  '</vars>',
  '',
  '<script>',
  '  $n    = 2',
  '  $p    = 10',
  '  $b    = 1',
  '  $t    = 2',
  '  $lib  = 2',
  '  $opts = []',
  '  $f    = 2.5',
  '  $bz   = 1',
  '  $nl   = 2',
  "  $sn   = 'a'",
  '  $$gs  = 2',
  '</script>',
  '',
  `<select id="n" aria-label="n" value=!{$n}>${OPTIONS}</select>`,
  `<select id="p" aria-label="p" value=!{$p}><option value="">aucun</option>${OPTIONS}</select>`,
  '<button id="ecrit" @click={$p = 1}>ecrit</button>',
  '<select id="b" aria-label="b" value=!{$b}><option value="01">un</option><option value="02">deux</option><option value="05">cinq</option><option value="10">dix</option></select>',
  '<select id="t" aria-label="t" value=!{$t}>{for o in $opts}<option value={o}>{o}</option>{end}</select>',
  "<button id=\"arrivent\" @click={$opts = ['01', '02', '10']}>arrivent</button>",
  '<select id="lib" aria-label="lib" value=!{$lib}><option value="01">un</option><option value="02">deux</option></select>',
  '<select id="f" aria-label="f" value=!{$f}><option value="2.50">deux et demi</option><option value="5.00">cinq</option></select>',
  `<select id="bz" aria-label="bz" value=!{$bz}>${OPTIONS}</select>`,
  '<button id="trois" @click={$bz = 3}>trois</button>',
  `<select id="nl" aria-label="nl" value=!{$nl}><option value="">aucun</option>${OPTIONS}</select>`,
  '<select id="sn" aria-label="sn" value=!{$sn}><option value="">aucun</option><option value="a">a</option><option value="b">b</option></select>',
  `<select id="gs" aria-label="gs" value=!{$$gs}><option value="">aucun</option>${OPTIONS}</select>`,
  '<p id="etat">{JSON.stringify([$n, $p, $b, $t, $lib, $f, $bz, $nl, $sn, $$gs])}</p>',
].join('\n') + '\n'

// la règle de $$gs est posée par le <vars> d'un autre composant, absent de la page : en développement, elle n'arrive qu'avec lui
const REGLE = ['<vars>', '  $$gs int 1..12 | null', '</vars>', '', '<p>{$$gs}</p>'].join('\n') + '\n'

// la place de chaque variable dans l'état affiché
const AT = { n: 0, p: 1, b: 2, t: 3, lib: 4, f: 5, bz: 6, nl: 7, sn: 8, gs: 9 } as const

const MODES = { dev: {}, prod: { env: 'prod', js: 'bundle' } } as const

async function construire(mode: keyof typeof MODES): Promise<string> {
  const root = mjsTmp('liaison-liste-simple-typee-' + mode)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'liste.mjs'), SOURCE)
  writeFileSync(join(src, 'regle.mjs'), REGLE)
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/m', ...MODES[mode] } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return out
}

// le champ d'id `id`, dans l'ombre du composant
const CHAMP = `(i) => { const h = document.querySelector('mjs-liste'); return (h._shadow || h).querySelector('#' + i) }`

const lire    = (page: any) => page.evaluate(`JSON.parse((${CHAMP})('etat').textContent)`)
const choix   = (page: any, id: string) => page.evaluate(`Array.from((${CHAMP})(${JSON.stringify(id)}).selectedOptions).map((o) => o.value)`)
const champ   = async (page: any, id: string) => (await page.evaluateHandle(`(${CHAMP})(${JSON.stringify(id)})`)).asElement()
const choisir = async (page: any, id: string, valeur: string) => { await (await champ(page, id)).selectOption(valeur); await page.waitForTimeout(50) }
// la bulle du garde, posée juste après son champ (au-delà d'un calque d'effet) : son texte, ou '' sans bulle
const bulle   = (page: any, id: string) => page.evaluate(`(() => { let n = (${CHAMP})(${JSON.stringify(id)}).nextElementSibling; while (n && n.hasAttribute('mjs-fx-layer')) n = n.nextElementSibling; return n && n.hasAttribute('mjs-fx-guard-tip') ? n.textContent : '' })()`)

for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
  describe(`liste simple liée à une variable int typée — ${mode} (navigateurs réels)`, function () {
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
          await page.waitForFunction(`!!(document.querySelector('mjs-liste') && (${CHAMP})('etat'))`)
          await page.waitForTimeout(50)
        })

        after(async () => { if (browser) await browser.close() })

        it('la variable qui vaut 2 choisit l\'option `02`, avec ou sans plage', async () => {
          assert.deepEqual(await lire(page), [2, 10, 1, 2, 2, 2.5, 1, 2, 'a', 2])
          assert.deepEqual(await choix(page, 'n'), ['02'])
          assert.deepEqual(await choix(page, 'p'), ['10'])
          assert.deepEqual(await choix(page, 'b'), ['01'])
          assert.deepEqual(erreurs, [])
        })

        it('choisir « 02 » écrit 2, sans bulle, et la liste garde l\'option choisie — avec ou sans plage', async () => {
          for (const id of ['n', 'p'] as const) {
            for (const [option, nombre] of [['01', 1], ['02', 2], ['10', 10]] as const) {
              await choisir(page, id, option)
              assert.equal((await lire(page))[AT[id]], nombre, `${id} : « ${option} » écrit ${nombre}`)
              assert.deepEqual(await choix(page, id), [option], `${id} : la liste garde « ${option} »`)
              assert.equal(await bulle(page, id), '', `${id} : aucune bulle après « ${option} »`)
            }
          }
          assert.deepEqual(avert.filter((x) => x.includes('refuse')), [])
          assert.deepEqual(erreurs, [])
        })

        it('un choix refusé rend l\'option de la valeur de sa variable, écrite par votre code', async () => {
          await (await champ(page, 'ecrit')).click()
          await page.waitForTimeout(50)
          assert.deepEqual(await choix(page, 'p'), ['01'], 'la variable écrite par le code choisit « 01 »')
          await choisir(page, 'p', '')
          assert.deepEqual(await choix(page, 'p'), ['01'], 'la liste revient à sa variable')
          assert.equal((await lire(page))[AT.p], 1)
          assert.notEqual(await bulle(page, 'p'), '', 'le refus se dit')
          assert.deepEqual(erreurs, [])
        })

        it('un nombre hors de sa plage est ramené à la borne : l\'option qui l\'écrit autrement (`05` pour 5) est choisie', async () => {
          await choisir(page, 'b', '10')
          assert.equal((await lire(page))[AT.b], 5)
          assert.deepEqual(await choix(page, 'b'), ['05'])
          assert.notEqual(await bulle(page, 'b'), '', 'la borne se dit')
          assert.deepEqual(erreurs, [])
        })

        it('un nombre ramené à une borne qu\'aucune option n\'écrit : la variable garde sa valeur, la liste revient à son option, jamais vide', async () => {
          await choisir(page, 'bz', '10')
          assert.equal((await lire(page))[AT.bz], 1)
          assert.deepEqual(await choix(page, 'bz'), ['01'], 'la liste revient à sa variable')
          assert.notEqual(await bulle(page, 'bz'), '', 'la borne se dit')
          assert.deepEqual(erreurs, [])
        })

        it('sans option de la valeur de sa variable (3, écrit par votre code), la liste reste sans choix après un ramenage, comme la liaison la montre', async () => {
          await (await champ(page, 'trois')).click()
          await page.waitForTimeout(50)
          assert.deepEqual(await choix(page, 'bz'), [], 'aucune option n\'écrit 3')
          await choisir(page, 'bz', '10')
          assert.equal((await lire(page))[AT.bz], 3)
          assert.deepEqual(await choix(page, 'bz'), [], 'jamais une option qui ne porte pas la valeur de la variable')
          assert.notEqual(await bulle(page, 'bz'), '', 'la borne se dit')
          assert.deepEqual(erreurs, [])
        })

        it('l\'option vide écrit null sous une règle qui refuse le texte vide et accepte null ; une règle qui accepte le texte vide le reçoit tel quel', async () => {
          assert.deepEqual(await choix(page, 'nl'), ['02'])
          await choisir(page, 'nl', '')
          assert.equal((await lire(page))[AT.nl], null)
          assert.deepEqual(await choix(page, 'nl'), [''], 'l\'option vide reste choisie')
          assert.equal(await bulle(page, 'nl'), '', 'aucune bulle')
          await choisir(page, 'nl', '10')
          assert.equal((await lire(page))[AT.nl], 10)
          await choisir(page, 'sn', '')
          assert.equal((await lire(page))[AT.sn], '', 'string | null : le texte vide, comme avant')
          assert.equal(await bulle(page, 'sn'), '')
          assert.deepEqual(avert.filter((x) => x.includes('refuse')), [])
          assert.deepEqual(erreurs, [])
        })

        it('un magasin typé par le <vars> d\'un composant absent de la page : sans sa règle (développement), l\'option vide passe telle quelle, sans erreur ; avec elle (production), elle vaut null', async () => {
          // en développement, la règle arrive avec le morceau de son composant, absent ici ; en production, le paquet unique la porte
          const regle = mode === 'prod'
          if (!regle) assert.equal(await page.evaluate('!!(globalThis.µ && µ._mjs_storeRules && µ._mjs_storeRules.gs)'), false, 'la règle n\'est pas encore arrivée')
          await choisir(page, 'gs', '01')
          await choisir(page, 'gs', '')
          assert.deepEqual(await choix(page, 'gs'), [''])
          assert.equal((await lire(page))[AT.gs], regle ? null : '', regle ? 'règle connue : null' : 'sans règle : le texte vide, comme avant')
          assert.deepEqual(erreurs, [])
        })

        it('une option arrivée après la liste est choisie par la variable qui porte son nombre', async () => {
          assert.deepEqual(await choix(page, 't'), [], 'aucune option encore')
          await (await champ(page, 'arrivent')).click()
          await page.waitForTimeout(100)
          assert.deepEqual(await choix(page, 't'), ['02'], 'l\'option 02, arrivée après la pose, porte 2')
          assert.equal((await lire(page))[AT.t], 2)
          await choisir(page, 't', '10')
          assert.equal((await lire(page))[AT.t], 10)
          assert.deepEqual(await choix(page, 't'), ['10'])
          assert.equal(await bulle(page, 't'), '')
          assert.deepEqual(erreurs, [])
        })

        it('une variable libre choisit l\'option de son texte exact, comme avant', async () => {
          assert.deepEqual(await choix(page, 'lib'), [], '2 n\'est pas le texte « 02 »')
          assert.equal((await lire(page))[AT.lib], 2)
          await choisir(page, 'lib', '01')
          assert.equal((await lire(page))[AT.lib], '01', 'son choix écrit le texte de l\'option')
          assert.deepEqual(erreurs, [])
        })

        it('sous une règle `float`, l\'option `2.50` porte 2.5 : la variable la choisit, la choisir écrit le nombre, sans bulle', async () => {
          assert.deepEqual(await choix(page, 'f'), ['2.50'])
          await choisir(page, 'f', '5.00')
          assert.equal((await lire(page))[AT.f], 5)
          assert.deepEqual(await choix(page, 'f'), ['5.00'])
          assert.equal(await bulle(page, 'f'), '')
          assert.deepEqual(erreurs, [])
        })
      })
    }
  })
}
