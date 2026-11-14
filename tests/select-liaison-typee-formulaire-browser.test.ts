// `<@@select name="…">` lié à une variable de nombre typée (`int`, `float`, liste `int 0..20[]`) dans un vrai formulaire : la valeur
// part sous le texte de son option (`n=02` pour 2, `m[]=02` et `m[]=10`, `f=2.50`, `z=00` pour 0), au départ, après un choix et après
// une valeur remise par votre code, dans `new FormData(form)` comme dans l'envoi POST du navigateur ; une option `value={false}` n'est
// jamais prise pour 0 (ni montrée, ni envoyée). Une appli sans liste `other` (le cas courant) et une appli qui en a une, car la
// construction ne garde le code de `other` que dans la seconde — Chromium, Firefox et WebKit, en développement et en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const MOIS = '<@@option value="01">janvier</@@option><@@option value="02">fevrier</@@option><@@option value="10">octobre</@@option>'

const source = (autre: boolean) => [
  '<vars>',
  '  $n  int',
  '  $m  int 0..20[]',
  '  $f  float 0..10',
  '  $z  int',
  '  $nn int | null',
  '</vars>',
  '',
  '<script>',
  '  $n  = 2',
  '  $m  = [2]',
  '  $f  = 2.5',
  '  $z  = 0',
  '  $nn = 0',
  '</script>',
  '',
  '<form id="fo" method="post" action="http://mjs.test/envoi">',
  `  <@@select id="n" name="n" aria-label="n" value=!{$n}>${MOIS}</@@select>`,
  '  <button type="button" id="ecrit" @click={$n = 1}>ecrit</button>',
  `  <@@select id="m" name="m[]" aria-label="m" multiple value=!{$m}>${MOIS}</@@select>`,
  '  <@@select id="f" name="f" aria-label="f" value=!{$f}><@@option value="2.50">deux et demi</@@option><@@option value="5.00">cinq</@@option></@@select>',
  '  <@@select id="z" name="z" aria-label="z" value=!{$z}><@@option value="">vide</@@option><@@option value="00">zero</@@option><@@option value="1">un</@@option></@@select>',
  '  <@@select id="nn" name="nn" aria-label="nn" value=!{$nn}><@@option value="">vide</@@option><@@option value={false}>faux</@@option><@@option value="1">un</@@option></@@select>',
  autre ? '  <@@select id="o" name="o" aria-label="o" other><@@option value="a">a</@@option></@@select>' : '',
  '</form>',
  '<p id="etat">{JSON.stringify([$n, $m, $f, $z, $nn])}</p>',
].join('\n') + '\n'

const MODES = { dev: {}, prod: { env: 'prod', js: 'bundle' } } as const

async function construire(mode: keyof typeof MODES, autre: boolean): Promise<string> {
  const root = mjsTmp('select-typee-formulaire-' + mode + (autre ? '-autre' : ''))
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'liste.mjs'), source(autre))
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
// les champs que le formulaire enverrait, `nom=valeur`, dans l'ordre du formulaire
const champs    = (page: any) => page.evaluate(`Array.from(new FormData((${CHAMP})('fo'))).map(([k, v]) => k + '=' + v)`)
const etiquette = (page: any, id: string) => page.evaluate(`(${DANS})(${JSON.stringify(id)}).querySelector('.select-label').textContent.trim()`)
const attente   = (page: any, id: string) => page.evaluate(`(${DANS})(${JSON.stringify(id)}).querySelector('.select-label').classList.contains('placeholder')`)
// les champs d'un envoi, `nom=valeur` : urlencodé (envoi du navigateur) ou multipart (le même formulaire envoyé par `fetch`)
const lireEnvoi = (type: string, corps: string) => type.includes('multipart/form-data')
  ? Array.from(corps.matchAll(/name="([^"]*)"\r\n\r\n([^\r]*)\r\n/g), (m) => m[1] + '=' + m[2])
  : Array.from(new URLSearchParams(corps)).map(([k, v]) => k + '=' + v)
// ouvre la liste (si elle ne l'est pas) puis clique la ligne de ce libellé
const choisir   = async (page: any, id: string, libelle: string) => {
  await page.evaluate(`(() => { const b = (${DANS})(${JSON.stringify(id)}).querySelector('.select-btn'); if (b.getAttribute('aria-expanded') !== 'true') b.click() })()`)
  await page.waitForTimeout(80)
  const ok = await page.evaluate(`(() => { const r = Array.from((${DANS})(${JSON.stringify(id)}).querySelectorAll('.select-option[role=option]')).find((o) => o.textContent.trim() === ${JSON.stringify(libelle)}); if (r) r.click(); return !!r })()`)
  assert.ok(ok, `${id} : ligne « ${libelle} » introuvable`)
  await page.waitForTimeout(80)
}

for (const autre of [false, true]) {
  for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
    describe(`<@@select> typé nombre dans un formulaire — ${autre ? 'avec' : 'sans'} liste \`other\` dans l'appli, ${mode} (navigateurs réels)`, function () {
      this.timeout(120000)
      let out = ''

      before(async () => { out = await construire(mode, autre) })
      after(async () => { await terminateSharedWorkerPool() })

      for (const nom of MOTEURS) {
        describe(nom, function () {
          let browser: any
          let page: any
          let erreurs: string[]
          let corps: string | null
          let type  = ''

          before(async function () {
            if (!(await moteurPresent(nom))) {
              console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
              return this.skip()
            }
            const playwright: any = await import('playwright')
            browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
            page    = await browser.newPage()
            erreurs = []
            corps   = null
            page.on('pageerror', (e: any) => erreurs.push(String(e)))
            await page.route('http://mjs.test/**', (route: any) => {
              const url = route.request().url()
              if (url === 'http://mjs.test/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-liste></mjs-liste><script type="module" src="/m/bundle.js"></script></body></html>' })
              if (url === 'http://mjs.test/envoi') {
                corps = route.request().postData() ?? ''
                type  = route.request().headers()['content-type'] ?? ''
                return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><p>reçu</p>' })
              }
              const fichier = join(out, url.replace('http://mjs.test/m/', '').split('?')[0])
              if (!url.startsWith('http://mjs.test/m/') || !existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
              return route.fulfill({ contentType: fichier.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: readFileSync(fichier) })
            })
            await page.goto('http://mjs.test/')
            await page.waitForFunction(`!!(document.querySelector('mjs-liste') && (${CHAMP})('etat') && (${DANS})('nn').querySelector('.select-label'))`)
            await page.waitForTimeout(100)
          })

          after(async () => { if (browser) await browser.close() })

          it('au départ, chaque valeur part sous le texte de son option : n=02, m[]=02, f=2.50, z=00', async () => {
            assert.deepEqual(await lire(page), [2, [2], 2.5, 0, 0])
            assert.deepEqual([await etiquette(page, 'n'), await etiquette(page, 'm'), await etiquette(page, 'f'), await etiquette(page, 'z')], ['fevrier', 'fevrier', 'deux et demi', 'zero'])
            assert.deepEqual(await champs(page), ['n=02', 'm[]=02', 'f=2.50', 'z=00'])
            assert.deepEqual(erreurs, [])
          })

          it('une option `value={false}` n\'est jamais prise pour 0 : rien de choisi, rien d\'envoyé pour nn', async () => {
            assert.equal((await lire(page))[4], 0)
            assert.ok(await attente(page, 'nn'), 'nn : rien de choisi, comme une liste native sans option du nombre 0')
            assert.ok(!(await champs(page)).some((c: string) => c.startsWith('nn=')), 'nn : aucun champ envoyé')
          })

          it('après un choix et après une valeur remise par votre code, la valeur part sous le texte de son option', async () => {
            await choisir(page, 'n', 'octobre')
            assert.ok((await champs(page)).includes('n=10'))
            await choisir(page, 'n', 'fevrier')
            assert.equal((await lire(page))[0], 2)
            assert.ok((await champs(page)).includes('n=02'), 'le choix de « fevrier » part sous `02`')
            await page.evaluate(`(${CHAMP})('ecrit').click()`)
            await page.waitForTimeout(80)
            assert.equal(await etiquette(page, 'n'), 'janvier')
            assert.ok((await champs(page)).includes('n=01'), 'la valeur 1 remise par le code part sous `01`')
            await choisir(page, 'm', 'octobre')
            assert.deepEqual((await lire(page))[1], [2, 10])
            assert.deepEqual((await champs(page)).filter((c: string) => c.startsWith('m[]=')), ['m[]=02', 'm[]=10'])
            assert.deepEqual(erreurs, [])
          })

          it('l\'envoi du navigateur (POST) porte les mêmes champs que FormData', async () => {
            const attendus = await champs(page)
            assert.deepEqual(attendus, ['n=01', 'm[]=02', 'm[]=10', 'f=2.50', 'z=00'])
            await page.evaluate(`(${CHAMP})('fo').requestSubmit()`)
            for (let i = 0; i < 200 && corps === null; i++) await new Promise((r) => setTimeout(r, 50))
            assert.ok(corps !== null, 'le formulaire est parti')
            assert.deepEqual(lireEnvoi(type, corps!), attendus)
          })
        })
      }
    })
  }
}
