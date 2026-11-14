// une liste à choix multiples (`<select multiple>`) liée à une variable de règle de liste : ses choix partent dans la variable quand
// ils respectent la règle, avec ou sans bornes ; aucun choix vaut null quand la règle accepte null (`| null`), une liste vide sinon ;
// un choix qui viole la règle est retenu comme sur tout champ lié (la liste revient à la valeur de sa variable, avec la bulle d'un
// champ texte de même règle), même au premier geste depuis null ; un élément hors de sa plage est ramené à la borne, dans la liste et
// dans la variable — une liste ramenée qui sort encore de la règle revient à sa variable ; la valeur rendue est celle que votre code a
// écrite en dernier (options arrivées après la pose, champ texte écrit par le code), sinon le texte accepté en dernier, tel qu'il
// était tapé (« 007 », « 12.50 ») ; une option qui écrit le nombre autrement (`01`) porte l'élément 1 d'une liste `int`, même arrivée
// après la pose, quand une variable libre choisit l'option de son texte exact ; une règle qui n'est pas une liste garde son message de
// développement ; une liste simple et une variable libre ne changent pas — Chromium, Firefox et WebKit, en développement et en
// production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const LETTRES = '<option>a</option><option>b</option><option>c</option><option>longue</option>'
const NOMBRES = '<option>5</option><option>20</option><option>25</option>'

const SOURCE = [
  '<vars>',
  '  $tags     string 1..5[] ..2 | null',
  '  $bornes   string 1..5[] 1..2',
  '  $ouverts  string[] | null',
  '  $libres   string[]',
  '  $notes    int 0..20[]',
  '  $rares    int 0..20[]',
  '  $un       string 1..5',
  '  $miroir   string 1..5[] ..2 | null',
  '  $str      string',
  '  $mn       int 0..20[] 2..3',
  '  $b12n     string 1..5[] 1..2 | null',
  '  $tard     string 1..5[] ..2',
  '  $t        string 1..5',
  '  $q        int 0..100',
  '  $prix     float 0..100',
  '  $nb       float 0..100',
  '  $mois     int 1..12[] ..2',
  '  $mo2      int 1..12[]',
  '  $mo3      int 1..12[]',
  '</vars>',
  '',
  '<script>',
  '  $tags    = null',
  "  $bornes  = ['a']",
  '  $ouverts = null',
  '  $libres  = []',
  '  $notes   = []',
  '  $rares   = []',
  "  $un      = 'a'",
  '  $miroir  = null',
  '  $libre   = []',
  "  $str     = 'a'",
  '  $mn      = [5, 20]',
  '  $b12n    = null',
  "  $tard    = ['a', 'd']",
  "  $opts    = ['a', 'b']",
  "  $t       = 'a'",
  '  $q       = 10',
  '  $prix    = 10',
  '  $nb      = 10',
  '  $mois    = []',
  '  $mo2     = []',
  '  $mo3     = [1]',
  '  $mlib    = [1]',
  '  $mopts   = []',
  '</script>',
  '',
  `<select id="tags" aria-label="tags" multiple value=!{$tags}>${LETTRES}</select>`,
  `<select id="bornes" aria-label="bornes" multiple value=!{$bornes}>${LETTRES}</select>`,
  `<select id="ouverts" aria-label="ouverts" multiple value=!{$ouverts}>${LETTRES}</select>`,
  `<select id="libres" aria-label="libres" multiple value=!{$libres}>${LETTRES}</select>`,
  `<select id="notes" aria-label="notes" multiple value=!{$notes}>${NOMBRES}</select>`,
  '<select id="rares" aria-label="rares" multiple value=!{$rares}><option>5</option><option>25</option></select>',
  `<select id="un" aria-label="un" value=!{$un}>${LETTRES}</select>`,
  `<select id="libre" aria-label="libre" multiple value=!{$libre}>${LETTRES}</select>`,
  '<input id="miroir" aria-label="miroir" value=!{$miroir}>',
  `<select id="str" aria-label="str" multiple value=!{$str}>${LETTRES}</select>`,
  `<select id="mn" aria-label="mn" multiple value=!{$mn}>${NOMBRES}</select>`,
  `<select id="b12n" aria-label="b12n" multiple value=!{$b12n}>${LETTRES}</select>`,
  '<select id="tard" aria-label="tard" multiple value=!{$tard}>{for o in $opts}<option value={o}>{o}</option>{end}</select>',
  "<button id=\"ajoute\" @click={$opts = $opts.concat(['d'])}>ajoute</button>",
  '<input id="t" aria-label="t" value=!{$t}>',
  "<button id=\"ecrit\" @click={$t = 'zz'}>ecrit</button>",
  '<input id="q" aria-label="q" value=!{$q}>',
  '<input id="prix" aria-label="prix" value=!{$prix}>',
  '<input id="nb" aria-label="nb" type="number" value=!{$nb}>',
  '<select id="mois" aria-label="mois" multiple value=!{$mois}><option value="01">janvier</option><option value="02">février</option><option value="03">mars</option></select>',
  '<select id="mo2" aria-label="mo2" multiple value=!{$mo2}><option value="01">janvier</option><option value="13">treize</option></select>',
  '<select id="mo3" aria-label="mo3" multiple value=!{$mo3}>{for o in $mopts}<option value={o}>{o}</option>{end}</select>',
  "<button id=\"arrivent\" @click={$mopts = ['01', '02']}>arrivent</button>",
  '<select id="mlib" aria-label="mlib" multiple value=!{$mlib}><option value="01">janvier</option><option value="02">février</option></select>',
  '<p id="etat">{JSON.stringify([$tags, $bornes, $ouverts, $libres, $notes, $un, $libre, $rares, $str, $mn, $b12n, $tard, $t, $q, $prix, $nb, $mois, $mo2, $mo3, $mlib])}</p>',
].join('\n') + '\n'

// la place de chaque variable dans l'état affiché
const AT = { tags: 0, bornes: 1, ouverts: 2, libres: 3, notes: 4, un: 5, libre: 6, rares: 7, str: 8, mn: 9, b12n: 10, tard: 11, t: 12, q: 13, prix: 14, nb: 15, mois: 16, mo2: 17, mo3: 18, mlib: 19 } as const

const MODES = { dev: {}, prod: { env: 'prod', js: 'bundle' } } as const

async function construire(mode: keyof typeof MODES): Promise<string> {
  const root = mjsTmp('liaison-liste-multiple-typee-' + mode)
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

// le champ d'id `id`, dans l'ombre du composant
const CHAMP = `(i) => { const h = document.querySelector('mjs-liste'); return (h._shadow || h).querySelector('#' + i) }`

const lire    = (page: any) => page.evaluate(`JSON.parse((${CHAMP})('etat').textContent)`)
const choix   = (page: any, id: string) => page.evaluate(`Array.from((${CHAMP})(${JSON.stringify(id)}).selectedOptions).map((o) => o.value)`)
const texte   = (page: any, id: string) => page.evaluate(`(${CHAMP})(${JSON.stringify(id)}).value`)
const champ   = async (page: any, id: string) => (await page.evaluateHandle(`(${CHAMP})(${JSON.stringify(id)})`)).asElement()
const choisir = async (page: any, id: string, valeurs: string | string[]) => { await (await champ(page, id)).selectOption(valeurs); await page.waitForTimeout(50) }
// la bulle du garde, posée juste après son champ (au-delà d'un calque d'effet) : son texte, ou '' sans bulle
const bulle   = (page: any, id: string) => page.evaluate(`(() => { let n = (${CHAMP})(${JSON.stringify(id)}).nextElementSibling; while (n && n.hasAttribute('mjs-fx-layer')) n = n.nextElementSibling; return n && n.hasAttribute('mjs-fx-guard-tip') ? n.textContent : '' })()`)
// la liste et sa variable d'accord : les choix de la liste, ceux de la variable (null : aucun choix)
const accord  = async (page: any, id: keyof typeof AT, attendu: unknown) => {
  const v = (await lire(page))[AT[id]]
  assert.deepEqual(v, attendu, `${id} : la variable`)
  assert.deepEqual(await choix(page, id), v === null ? [] : v.map(String), `${id} : la liste montre sa variable`)
}

for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
  describe(`liste à choix multiples liée à une variable typée — ${mode} (navigateurs réels)`, function () {
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
        let bulleTexte = ''

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
          // la bulle d'un champ texte lié à la même règle, refusé : celle qu'une liste refusée doit montrer
          const miroir = await champ(page, 'miroir')
          await miroir.fill('x')
          await miroir.press('Enter')
          bulleTexte = await bulle(page, 'miroir')
        })

        after(async () => { if (browser) await browser.close() })

        it('les choix qui respectent la règle partent dans la variable — avec ou sans bornes, avec ou sans | null ; une variable libre comme avant', async () => {
          assert.deepEqual((await lire(page)).slice(0, 8), [null, ['a'], null, [], [], 'a', [], []])
          await choisir(page, 'tags', ['a', 'b'])
          await choisir(page, 'bornes', ['a', 'b'])
          await choisir(page, 'ouverts', ['a', 'c'])
          await choisir(page, 'libres', ['a', 'b', 'c', 'longue'])
          await choisir(page, 'notes', ['5'])
          await choisir(page, 'libre', ['a', 'b'])
          assert.deepEqual((await lire(page)).slice(0, 8), [['a', 'b'], ['a', 'b'], ['a', 'c'], ['a', 'b', 'c', 'longue'], [5], 'a', ['a', 'b'], []])
          assert.equal(await bulle(page, 'tags'), '', 'aucune bulle sur un choix permis')
          assert.deepEqual(erreurs, [])
        })

        it('un choix qui viole la règle est retenu : la liste revient à sa variable, avec la bulle d\'un champ texte de même règle ; aucun choix vaut null sous | null, une liste vide sinon', async () => {
          assert.ok(bulleTexte !== '', 'le champ texte refusé montre une bulle')
          await choisir(page, 'tags', ['a', 'b', 'c'])
          await accord(page, 'tags', ['a', 'b'])
          assert.equal(await bulle(page, 'tags'), bulleTexte)
          await choisir(page, 'tags', ['a', 'longue'])
          await accord(page, 'tags', ['a', 'b'])
          await choisir(page, 'bornes', [])
          await accord(page, 'bornes', ['a', 'b'])
          assert.notEqual(await bulle(page, 'bornes'), '', 'aucun choix pour un au moins, sans | null : refusé')
          await choisir(page, 'tags', [])
          await accord(page, 'tags', null)
          assert.equal(await bulle(page, 'tags'), '', 'un choix permis retire la bulle')
          await choisir(page, 'ouverts', [])
          await accord(page, 'ouverts', null)
          await choisir(page, 'libres', [])
          await accord(page, 'libres', [])
          assert.deepEqual(erreurs, [])
        })

        it('un élément hors de sa plage est ramené à la borne, dans la liste et dans la variable ; une liste ramenée qui sort encore de la règle revient à sa variable', async () => {
          await choisir(page, 'notes', ['5', '25'])
          await accord(page, 'notes', [5, 20])
          // sans option de la borne, le choix ramené tombe : ni dans la liste, ni dans la variable
          await choisir(page, 'rares', ['5', '25'])
          await accord(page, 'rares', [5])
          // 20 et 25 pour deux à trois éléments : 25 ramené à 20 laisse un seul choix — la liste revient à sa variable
          await choisir(page, 'mn', ['20', '25'])
          await accord(page, 'mn', [5, 20])
          assert.notEqual(await bulle(page, 'mn'), '', 'le refus se dit')
          await choisir(page, 'mn', ['5', '20', '25'])
          await accord(page, 'mn', [5, 20])
          assert.deepEqual(erreurs, [])
        })

        it('une règle avec | null partie de null : le premier refus revient à null, aucun choix rend null', async () => {
          await choisir(page, 'b12n', ['a', 'b', 'c'])
          await accord(page, 'b12n', null)
          assert.notEqual(await bulle(page, 'b12n'), '')
          await choisir(page, 'b12n', ['a'])
          await accord(page, 'b12n', ['a'])
          await choisir(page, 'b12n', [])
          await accord(page, 'b12n', null)
          await choisir(page, 'b12n', ['a', 'b'])
          await choisir(page, 'b12n', ['a', 'b', 'c'])
          await accord(page, 'b12n', ['a', 'b'])
          assert.deepEqual(erreurs, [])
        })

        it('la valeur rendue est celle que votre code a écrite en dernier : options arrivées après la pose, champ texte écrit par le code', async () => {
          assert.deepEqual(await choix(page, 'tard'), ['a'], 'l\'option d n\'existe pas encore')
          await (await champ(page, 'ajoute')).click()
          await page.waitForTimeout(100)
          await accord(page, 'tard', ['a', 'd'])
          await choisir(page, 'tard', ['a', 'd', 'b'])
          await accord(page, 'tard', ['a', 'd'])
          assert.notEqual(await bulle(page, 'tard'), '')
          await choisir(page, 'tard', ['b'])
          await accord(page, 'tard', ['b'])
          await (await champ(page, 'ecrit')).click()
          await page.waitForTimeout(50)
          assert.equal(await texte(page, 't'), 'zz')
          const t = await champ(page, 't')
          await t.fill('abcdefg')
          await t.press('Enter')
          assert.equal(await texte(page, 't'), 'zz', 'le champ revient à la valeur écrite par le code')
          assert.equal((await lire(page))[AT.t], 'zz')
          assert.deepEqual(erreurs, [])
        })

        it('après un refus, le champ rend le texte accepté en dernier tant que la variable garde la valeur qu\'il a donnée : « 007 » reste « 007 », « 12.50 » reste « 12.50 »', async () => {
          for (const [id, bon, mauvais, valeur] of [['q', '007', 'x', 7], ['prix', '12.50', 'abc', 12.5], ['nb', '12.50', '', 12.5]] as const) {
            const c = await champ(page, id)
            await c.fill(bon)
            await c.press('Tab')
            assert.equal((await lire(page))[AT[id]], valeur, `${id} : la variable reçoit le nombre`)
            await c.fill(mauvais)
            await c.press('Enter')
            assert.equal(await texte(page, id), bon, `${id} : le champ rend le texte accepté`)
            assert.equal((await lire(page))[AT[id]], valeur, `${id} : la variable garde sa valeur`)
            assert.notEqual(await bulle(page, id), '', `${id} : le refus se dit`)
          }
          assert.deepEqual(erreurs, [])
        })

        it('une option dont la valeur s\'écrit autrement que l\'élément (`01` pour 1) reste choisie après un refus ou une borne', async () => {
          await choisir(page, 'mois', ['01', '03'])
          assert.deepEqual((await lire(page))[AT.mois], [1, 3])
          await choisir(page, 'mois', ['01', '02', '03'])
          assert.deepEqual(await choix(page, 'mois'), ['01', '03'], 'la liste revient à sa variable')
          assert.deepEqual((await lire(page))[AT.mois], [1, 3])
          assert.notEqual(await bulle(page, 'mois'), '', 'le refus se dit')
          // 13 ramené à 12, sans option de cette valeur : ce choix tombe, celui de 01 reste
          await choisir(page, 'mo2', ['01', '13'])
          assert.deepEqual(await choix(page, 'mo2'), ['01'])
          assert.deepEqual((await lire(page))[AT.mo2], [1])
          assert.deepEqual(erreurs, [])
        })

        it('un nombre sans option de son texte exact : sous une variable typée, l\'option qui l\'écrit autrement est choisie, même arrivée après la pose ; une variable libre choisit l\'option de son texte exact', async () => {
          assert.deepEqual(await choix(page, 'mo3'), [], 'aucune option encore')
          await (await champ(page, 'arrivent')).click()
          await page.waitForTimeout(100)
          assert.deepEqual(await choix(page, 'mo3'), ['01'], 'l\'option 01, arrivée après la pose, porte l\'élément 1')
          assert.deepEqual((await lire(page))[AT.mo3], [1])
          await choisir(page, 'mo3', ['01', '02'])
          assert.deepEqual((await lire(page))[AT.mo3], [1, 2])
          assert.deepEqual(await choix(page, 'mo3'), ['01', '02'], 'la liste montre sa variable')
          // variable libre : 1 n'est pas le texte « 01 », rien n'est choisi — que l'appli ait des types ou non
          assert.deepEqual(await choix(page, 'mlib'), [])
          assert.deepEqual((await lire(page))[AT.mlib], [1])
          await choisir(page, 'mlib', ['01'])
          assert.deepEqual((await lire(page))[AT.mlib], ['01'], 'son choix écrit le texte de l\'option')
          assert.deepEqual(erreurs, [])
        })

        it('une règle qui n\'est pas une liste sur une liste à choix multiples : la variable ne change pas, le développement le dit', async () => {
          await choisir(page, 'str', ['b'])
          assert.equal((await lire(page))[AT.str], 'a')
          assert.deepEqual(await choix(page, 'str'), ['b'], 'la liste garde le choix, sans bulle')
          assert.equal(await bulle(page, 'str'), '')
          const dit = avert.some((x) => x.includes('$str refuse ["b"]'))
          assert.equal(dit, mode === 'dev', mode === 'dev' ? 'le message de développement' : 'rien en production')
          assert.deepEqual(erreurs, [])
        })

        it('une liste simple comme avant : son choix part dans la variable, un choix hors de la règle est retenu', async () => {
          await choisir(page, 'un', 'b')
          assert.equal((await lire(page))[AT.un], 'b')
          await choisir(page, 'un', 'longue')
          assert.deepEqual(await choix(page, 'un'), ['b'])
          assert.equal((await lire(page))[AT.un], 'b')
          assert.notEqual(await bulle(page, 'un'), '')
          assert.deepEqual(erreurs, [])
        })
      })
    }
  })
}
