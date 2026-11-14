// `<@@select>` lié à une variable typée, dans un vrai formulaire, comparé cas par cas à une liste native `<select>` liée de la même façon
// (variable, option montrée, champs de `new FormData(form)`, envoi POST du navigateur) : un choix que la règle refuse ramène la liste
// sur la valeur de la variable (option vide sous `int`, option `abc` sous `int 1..12`, option `abc` ajoutée sous `int 0..20[]`), et
// l'option vide vaut « aucun choix », null, quand la règle refuse le texte vide mais accepte null (`int | null`), comme aucun choix
// d'une liste à choix multiples sous `int 0..20[] | null`. Une variable `string` et une variable libre restent telles qu'avant —
// Chromium, Firefox et WebKit, en développement et en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const UNE  = (o: string) => `<${o} value="">vide</${o}><${o} value="1">un</${o}><${o} value="2">deux</${o}><${o} value="abc">abc</${o}>`
const PLUS = (o: string) => `<${o} value="1">un</${o}><${o} value="2">deux</${o}><${o} value="abc">abc</${o}>`

// règle (vide : variable libre), valeur de départ, option touchée (texte et libellé), puis ce que la liste native donne après le geste
const CAS = [
  { id: 'a', regle: 'int', depart: '1', geste: '', libelle: 'vide', valeur: 1, montre: 'un', envoi: ['1'] },
  { id: 'b', regle: 'int | null', depart: '1', geste: '', libelle: 'vide', valeur: null, montre: 'vide', envoi: [''] },
  { id: 'c', regle: 'int 1..12', depart: '1', geste: 'abc', libelle: 'abc', valeur: 1, montre: 'un', envoi: ['1'] },
  { id: 'm', regle: 'int 0..20[]', depart: '[1]', geste: 'abc', libelle: 'abc', valeur: [1], envoi: ['1'], multiple: true },
  { id: 'mn', regle: 'int 0..20[] | null', depart: '[1]', geste: '1', libelle: 'un', valeur: null, envoi: [], multiple: true },
  { id: 's', regle: 'string', depart: "'1'", geste: '', libelle: 'vide', valeur: '', montre: 'vide', envoi: [''] },
  { id: 'l', regle: '', depart: "'1'", geste: '', libelle: 'vide', valeur: '', montre: 'vide', envoi: [''] },
] as const

const nom = (id: string, multiple?: boolean) => id + (multiple ? '[]' : '')

const source = () => [
  '<vars>',
  ...CAS.filter((c) => c.regle).flatMap((c) => [`  $${c.id} ${c.regle}`, `  $n${c.id} ${c.regle}`]),
  '</vars>',
  '',
  '<script>',
  ...CAS.flatMap((c) => [`  $${c.id} = ${c.depart}`, `  $n${c.id} = ${c.depart}`]),
  '</script>',
  '',
  '<form id="fo" method="post" action="http://mjs.test/envoi">',
  ...CAS.flatMap((c) => {
    const m = 'multiple' in c ? ' multiple' : ''
    const o = 'multiple' in c ? PLUS : UNE
    return [
      `  <@@select id="${c.id}" name="${nom(c.id, 'multiple' in c)}" aria-label="${c.id}"${m} value=!{$${c.id}}>${o('@@option')}</@@select>`,
      `  <select id="n${c.id}" name="${nom('n' + c.id, 'multiple' in c)}" aria-label="n${c.id}"${m} value=!{$n${c.id}}>${o('option')}</select>`,
    ]
  }),
  '</form>',
  `<p id="etat">{JSON.stringify([${CAS.map((c) => `$${c.id}, $n${c.id}`).join(', ')}])}</p>`,
].join('\n') + '\n'

const MODES = { dev: {}, prod: { env: 'prod', js: 'bundle' } } as const

async function construire(mode: keyof typeof MODES): Promise<string> {
  const root = mjsTmp('select-typee-refus-' + mode)
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'liste.mjs'), source())
  const bundler = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), urlPrefix: '/m', ...MODES[mode] } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return out
}

// l'élément d'id `id`, dans l'ombre du composant ; l'ombre d'une liste du cœur
const CHAMP = `(i) => { const h = document.querySelector('mjs-liste'); return (h._shadow || h).querySelector('#' + i) }`
const DANS  = `(i) => { const s = (${CHAMP})(i); return s._shadow || s.shadowRoot || s }`

// les variables, par id de liste ; les valeurs qu'un champ envoie ; l'option montrée par une liste du cœur, par une liste native
const lire      = async (page: any) => {
  const v = await page.evaluate(`JSON.parse((${CHAMP})('etat').textContent)`)
  return Object.fromEntries(CAS.flatMap((c, i) => [[c.id, v[2 * i]], ['n' + c.id, v[2 * i + 1]]]))
}
const envoi     = (page: any, champ: string) => page.evaluate(`new FormData((${CHAMP})('fo')).getAll(${JSON.stringify(champ)})`)
const champs    = (page: any) => page.evaluate(`Array.from(new FormData((${CHAMP})('fo'))).map(([k, v]) => k + '=' + v)`)
const etiquette = (page: any, id: string) => page.evaluate(`(${DANS})(${JSON.stringify(id)}).querySelector('.select-label').textContent.trim()`)
const montree   = (page: any, id: string) => page.evaluate(`(() => { const o = (${CHAMP})(${JSON.stringify(id)}).selectedOptions[0]; return o ? o.textContent.trim() : '' })()`)
const lireEnvoi = (type: string, corps: string) => type.includes('multipart/form-data')
  ? Array.from(corps.matchAll(/name="([^"]*)"\r\n\r\n([^\r]*)\r\n/g), (m) => m[1] + '=' + m[2])
  : Array.from(new URLSearchParams(corps)).map(([k, v]) => k + '=' + v)
// liste du cœur : ouvre la liste (si elle ne l'est pas) puis clique la ligne de ce libellé (celui d'une ligne cochée a des voisins)
const choisir   = async (page: any, id: string, libelle: string) => {
  await page.evaluate(`(() => { const b = (${DANS})(${JSON.stringify(id)}).querySelector('.select-btn'); if (b.getAttribute('aria-expanded') !== 'true') b.click() })()`)
  await page.waitForTimeout(80)
  const ok = await page.evaluate(`(() => { const r = Array.from((${DANS})(${JSON.stringify(id)}).querySelectorAll('.select-option[role=option]')).find((o) => [o, ...o.querySelectorAll('*')].some((n) => n.textContent.trim() === ${JSON.stringify(libelle)})); if (r) r.click(); return !!r })()`)
  assert.ok(ok, `${id} : ligne « ${libelle} » introuvable`)
  await page.waitForTimeout(80)
}
// liste native : choisit l'option de ce texte (à choix multiples : la coche ou la décoche), comme la souris, `input` puis `change`
const natif     = (page: any, id: string, valeur: string) => page.evaluate(`(() => { const s = (${CHAMP})(${JSON.stringify(id)}); for (const o of s.options) { if (s.multiple) { if (o.value === ${JSON.stringify(valeur)}) o.selected = !o.selected } else o.selected = o.value === ${JSON.stringify(valeur)} } s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)

for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
  describe(`<@@select> lié à une variable typée : un choix refusé revient sur la variable, comme la liste native — ${mode} (navigateurs réels)`, function () {
    this.timeout(120000)
    let out = ''

    before(async () => { out = await construire(mode) })
    after(async () => { await terminateSharedWorkerPool() })

    for (const moteur of MOTEURS) {
      describe(moteur, function () {
        let browser: any
        let page: any
        let erreurs: string[]
        let corps: string | null
        let type  = ''

        before(async function () {
          if (!(await moteurPresent(moteur))) {
            console.log(`  ℹ️  ${moteur} non installé, test sauté. Activer : \`npx playwright install ${moteur}\``)
            return this.skip()
          }
          const playwright: any = await import('playwright')
          browser = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
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
          await page.waitForFunction(`!!(document.querySelector('mjs-liste') && (${CHAMP})('etat') && (${DANS})('l').querySelector('.select-label'))`)
          await page.waitForTimeout(100)
        })

        after(async () => { if (browser) await browser.close() })

        it('au départ, chaque liste montre et envoie la valeur de sa variable, comme la liste native', async () => {
          const v = await lire(page)
          for (const c of CAS) {
            assert.deepEqual(v[c.id], v['n' + c.id], `${c.id} : même valeur de départ`)
            assert.deepEqual(await envoi(page, nom(c.id, 'multiple' in c)), await envoi(page, nom('n' + c.id, 'multiple' in c)), `${c.id} : mêmes champs au départ`)
            if (!('multiple' in c)) assert.equal(await etiquette(page, c.id), await montree(page, 'n' + c.id), `${c.id} : même option montrée au départ`)
          }
          assert.deepEqual(erreurs, [])
        })

        it('les mêmes choix, dans la liste du cœur et dans la liste native', async () => {
          for (const c of CAS) {
            await natif(page, 'n' + c.id, c.geste)
            await choisir(page, c.id, c.libelle)
          }
          // le garde de la liste native juge le choix après sa pause
          await page.waitForTimeout(1500)
          assert.deepEqual(erreurs, [])
        })

        for (const c of CAS) {
          it(`${c.regle ? '`' + c.regle + '`' : 'variable libre'}${'multiple' in c ? ', à choix multiples' : ''} — option « ${c.libelle} » : variable ${JSON.stringify(c.valeur)}, champs ${JSON.stringify(c.envoi)}, comme la liste native`, async () => {
            const v = await lire(page)
            assert.deepEqual(v['n' + c.id], c.valeur, `liste native n${c.id} : variable`)
            assert.deepEqual(await envoi(page, nom('n' + c.id, 'multiple' in c)), c.envoi, `liste native n${c.id} : champs`)
            if ('montre' in c) assert.equal(await montree(page, 'n' + c.id), c.montre, `liste native n${c.id} : option montrée`)
            assert.deepEqual(v[c.id], c.valeur, `<@@select> ${c.id} : variable`)
            assert.deepEqual(await envoi(page, nom(c.id, 'multiple' in c)), c.envoi, `<@@select> ${c.id} : champs`)
            if ('montre' in c) assert.equal(await etiquette(page, c.id), c.montre, `<@@select> ${c.id} : option montrée`)
          })
        }

        it('l\'envoi du navigateur (POST) porte les mêmes champs que FormData', async () => {
          const attendus = await champs(page)
          for (const c of CAS) for (const x of c.envoi) assert.ok(attendus.includes(nom(c.id, 'multiple' in c) + '=' + x), `${c.id} : ${x} part`)
          await page.evaluate(`(${CHAMP})('fo').requestSubmit()`)
          for (let i = 0; i < 200 && corps === null; i++) await new Promise((r) => setTimeout(r, 50))
          assert.ok(corps !== null, 'le formulaire est parti')
          assert.deepEqual(lireEnvoi(type, corps!), attendus)
        })
      })
    }
  })
}
