// `<@@select>` liée à une variable de règle (`int`, `float`, `string 1..5`), comparée cas par cas à une liste native `<select>` liée
// de la même façon, après les mêmes choix : variable, option montrée, champ de `new FormData(form)`. Un texte que la règle convertit
// est accepté et la liste le garde (`2.4` sous `int` quand la variable vaut déjà 2) ; après un refus, la liste revient sur le dernier
// texte accepté (`02`) tant qu'il donne encore la valeur de la variable, comme le garde de la liste native ; au départ, une variable
// `int | null` qui vaut 0 le garde, options lues tout de suite ou plus tard (`{for}`), comme quand votre code l'écrit une fois les options
// lues (la liste annonce alors cette valeur, 0, jamais l'option vide) ; sous `int 1..12 | null`, null au départ ou écrit par votre code
// montre l'option vide, que le formulaire envoie (`""`) ; en mode `multiple`, chaque option choisie une fois, dans l'ordre des options,
// même quand une option écrit autrement un nombre déjà choisi (« 02 » quand 2 l'est) ou que votre code écrit les valeurs dans un autre
// ordre ou deux fois, au départ comme avant que les options n'arrivent (`{for}`) ; une valeur qu'aucune option ne porte se perd au choix
// suivant, comme dans la liste native, sauf dans une liste qui accepte une réponse libre (`other`), qui la garde — Chromium, Firefox et
// WebKit, en développement et en production

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { MOTEURS, moteurPresent } from './helpers/navigateurs-compiles.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

// textes des options (libellés `o0`, `o1`…, dans cet ordre)
const OA = ['', '1', '2', '02', '2.4', '2.6', ' 3 ', '3e0', '0x3', '-0', '0', 'Infinity', 'abc']
const OB = ['', '1', '2']
const OM = ['1', '2', '02', '5']
const OF = ['2.5', '2.50', '3']

// règle, valeur de départ, textes choisis l'un après l'autre ; `natif` : ce que la liste native donne après ces choix (variable, option
// montrée, champs), écrit en clair pour les cas où l'ancienne liste du cœur s'en écartait ; `ecrit` : la valeur que votre code écrit
// ensuite, `tot` : celle qu'il écrit avant que les options tardives n'arrivent ; `multi` : deux listes `multiple`, où chaque texte coche
// ou décoche son option ; `autre` : la liste du cœur accepte une réponse libre (`other`), sa variable vaut ceci après les choix
type Cas = { id: string, regle: string, depart: string, gestes: string[], liste?: string[], tard?: boolean, ecrit?: string, tot?: string, multi?: boolean, natif?: [string, string, string[]], autre?: string }
const CAS: Cas[] = [
  { id: 'i24', regle: 'int', depart: '2', gestes: ['2.4'], natif: ['2', 'o4', ['2.4']] },
  { id: 'r02', regle: 'int 1..12', depart: '2', gestes: ['02', 'abc'], natif: ['2', 'o3', ['02']] },
  { id: 'rvide', regle: 'int', depart: '2', gestes: ['02', ''], natif: ['2', 'o3', ['02']] },
  { id: 'i26', regle: 'int', depart: '2', gestes: ['2.6'] },
  { id: 'i3s', regle: 'int', depart: '2', gestes: [' 3 '] },
  { id: 'i3e', regle: 'int', depart: '2', gestes: ['3e0'] },
  { id: 'i0x', regle: 'int', depart: '2', gestes: ['0x3'] },
  { id: 'j3e', regle: 'int', depart: '3', gestes: ['3e0'] },
  { id: 'im0', regle: 'int', depart: '2', gestes: ['-0'] },
  { id: 'jm0', regle: 'int', depart: '0', gestes: ['-0'] },
  { id: 'iinf', regle: 'int', depart: '2', gestes: ['Infinity'] },
  { id: 'finf', regle: 'float', depart: '2', gestes: ['Infinity'] },
  { id: 'f24', regle: 'float', depart: '2', gestes: ['2.4'] },
  { id: 's15', regle: 'string 1..5', depart: "'1'", gestes: ['02', ''] },
  { id: 's15n', regle: 'string 1..5 | null', depart: "'1'", gestes: [''] },
  { id: 'b0', regle: 'int | null', depart: '0', gestes: [], liste: OB, natif: ['0', '(aucune)', []] },
  { id: 'bfor', regle: 'int | null', depart: '0', gestes: [], tard: true, natif: ['0', '(aucune)', []] },
  { id: 'b0t', regle: 'int | null', depart: '1', gestes: [], liste: OB, ecrit: '0', natif: ['0', '(aucune)', []] },
  { id: 'bfor1', regle: 'int | null', depart: '1', gestes: ['abc'], tard: true },
  { id: 'nn0', regle: 'int 1..12 | null', depart: 'null', gestes: [], liste: OB, natif: ['null', 'o0', ['']] },
  { id: 'ovn', regle: 'int 1..12 | null', depart: '1', gestes: [], liste: OB, ecrit: 'null', natif: ['null', 'o0', ['']] },
  { id: 'mlt', regle: 'int 1..12[]', depart: '[2]', gestes: ['5', '02'], liste: OM, multi: true, natif: ['[2,2,5]', 'o1, o3', ['2', '5']] },
  { id: 'mf2', regle: 'float[]', depart: '[2.5]', gestes: ['2.50'], liste: OF, multi: true, natif: ['[2.5,2.5]', 'o0', ['2.5']] },
  { id: 'mfl', regle: 'float[]', depart: '[2.5]', gestes: ['2.50', '3'], liste: OF, multi: true, natif: ['[2.5,3]', 'o0, o2', ['2.5', '3']] },
  { id: 'mor', regle: 'int 1..12[]', depart: '[2]', gestes: [], liste: OM, multi: true, ecrit: '[5, 2, 5]', natif: ['[5,2,5]', 'o1, o3', ['2', '5']] },
  { id: 'mtd', regle: 'int 1..12[]', depart: '[2, 1, 2]', gestes: [], tard: true, multi: true, natif: ['[2,1,2]', 't1, t2', ['1', '2']] },
  { id: 'mtc', regle: 'int 1..12[]', depart: '[1]', gestes: [], tard: true, multi: true, tot: '[2, 1, 2]', natif: ['[2,1,2]', 't1, t2', ['1', '2']] },
  { id: 'mtg', regle: 'int 1..12[]', depart: '[1]', gestes: ['1'], tard: true, multi: true, tot: '[2, 1, 2]', natif: ['[2]', 't2', ['2']] },
  { id: 'mdp', regle: 'int 1..12[]', depart: '[5, 2, 5]', gestes: [], liste: OM, multi: true, natif: ['[5,2,5]', 'o1, o3', ['2', '5']] },
  { id: 'm7', regle: 'int 1..12[]', depart: '[2]', gestes: ['5'], liste: OM, multi: true, ecrit: '[2, 7]', natif: ['[2,5]', 'o1, o3', ['2', '5']] },
  { id: 'm7d', regle: 'int 1..12[]', depart: '[2, 7]', gestes: ['5'], liste: OM, multi: true, natif: ['[2,5]', 'o1, o3', ['2', '5']] },
  { id: 'm7o', regle: 'int 1..12[]', depart: '[2, 7]', gestes: ['5'], liste: OM, multi: true, autre: '[2,5,7]' },
]

const opts = (tag: string, l: string[]) => l.map((v, i) => `<${tag} value="${v}">o${i}</${tag}>`).join('')
const tard = (tag: string) => `{for o in $tard}<${tag} value={o}>{'t' + o}</${tag}>{end}`

const source = () => [
  '<vars>',
  ...CAS.flatMap((c) => [`  $${c.id} ${c.regle}`, `  $n${c.id} ${c.regle}`]),
  '</vars>',
  '',
  '<script>',
  '  $tard = []',
  ...CAS.flatMap((c) => [`  $${c.id} = ${c.depart}`, `  $n${c.id} = ${c.depart}`]),
  "  µafter(300, (-> $tard = ['', '1', '2', 'abc']))",
  ...CAS.filter((c) => c.tot).map((c) => `  µafter(100, (-> $${c.id} = ${c.tot}; $n${c.id} = ${c.tot}))`),
  ...CAS.filter((c) => c.ecrit).map((c) => `  µafter(500, (-> $${c.id} = ${c.ecrit}; $n${c.id} = ${c.ecrit}))`),
  '</script>',
  '',
  '<form id="fo" method="post" action="http://mjs.test/envoi">',
  ...CAS.flatMap((c) => [
    `  <@@select id="${c.id}" name="${c.id}" aria-label="${c.id}"${c.multi ? ' multiple' : ''}${c.autre ? ' other' : ''} value=!{$${c.id}}>${c.tard ? tard('@@option') : opts('@@option', c.liste ?? OA)}</@@select>`,
    `  <select id="n${c.id}" name="n${c.id}" aria-label="n${c.id}"${c.multi ? ' multiple' : ''} value=!{$n${c.id}}>${c.tard ? tard('option') : opts('option', c.liste ?? OA)}</select>`,
  ]),
  '</form>',
].join('\n') + '\n'

const MODES = { dev: {}, prod: { env: 'prod', js: 'bundle' } } as const

async function construire(mode: keyof typeof MODES): Promise<string> {
  const root = mjsTmp('select-typee-natif-' + mode)
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

// pour chaque cas, des deux côtés : la variable (-0 écrit tel quel), l'option montrée (son libellé, ceux des options choisies d'une liste
// `multiple` dans leur ordre ; aucune : le texte d'attente de la
// liste du cœur, « (aucune) » pour la liste native) et les champs envoyés
const lireTout = (page: any) => page.evaluate(`(() => {
  const h = document.querySelector('mjs-liste'), R = h._shadow || h, st = h._state || {}, fd = new FormData(R.querySelector('#fo')), out = {}
  const enc = (v) => Object.is(v, -0) ? '-0' : JSON.stringify(v)
  for (const id of ${JSON.stringify(CAS.map((c) => c.id))}) {
    const c = R.querySelector('#' + id), n = R.querySelector('#n' + id), lab = (c._shadow || c.shadowRoot || c).querySelector('.select-label')
    const vu = lab ? lab.textContent.trim() : '?'
    out[id] = {
      coeur: [enc(st[id]), /^[ot]/.test(vu) ? vu : '(aucune)', fd.getAll(id)],
      natif: [enc(st['n' + id]), n.selectedOptions.length ? Array.from(n.selectedOptions, (o) => o.textContent.trim()).join(', ') : '(aucune)', fd.getAll('n' + id)],
    }
  }
  return out
})()`)

// liste du cœur : ouvre la liste (si elle ne l'est pas) puis clique la ligne de ce libellé
const choisir = async (page: any, id: string, libelle: string) => {
  await page.evaluate(`(() => { const b = (${DANS})(${JSON.stringify(id)}).querySelector('.select-btn'); if (b.getAttribute('aria-expanded') !== 'true') b.click() })()`)
  await page.waitForTimeout(80)
  const ok = await page.evaluate(`(() => { const r = Array.from((${DANS})(${JSON.stringify(id)}).querySelectorAll('.select-option[role=option]')).find((o) => [o, ...o.querySelectorAll('*')].some((n) => n.textContent.trim() === ${JSON.stringify(libelle)})); if (r) r.click(); return !!r })()`)
  assert.ok(ok, `${id} : ligne « ${libelle} » introuvable`)
  await page.waitForTimeout(80)
}
// liste native : choisit l'option de ce texte (liste `multiple` : la coche ou la décoche), comme la souris, `input` puis `change`
const natif = (page: any, id: string, valeur: string, multi = false) => page.evaluate(`(() => { const s = (${CHAMP})(${JSON.stringify(id)}); for (const o of s.options) ${multi ? `if (o.value === ${JSON.stringify(valeur)}) o.selected = !o.selected` : `o.selected = o.value === ${JSON.stringify(valeur)}`}; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })) })()`)
// libellé de l'option de ce texte
const libelle = (c: Cas, g: string) => c.tard ? 't' + g : 'o' + (c.liste ?? OA).indexOf(g)

for (const mode of Object.keys(MODES) as (keyof typeof MODES)[]) {
  describe(`<@@select> liée à une variable de règle : mêmes choix, même résultat que la liste native — ${mode} (navigateurs réels)`, function () {
    this.timeout(180000)
    let out = ''

    before(async () => { out = await construire(mode) })
    after(async () => { await terminateSharedWorkerPool() })

    for (const moteur of MOTEURS) {
      describe(moteur, function () {
        let browser: any
        const erreurs: string[] = []
        let depart: any
        let apres: any

        before(async function () {
          if (!(await moteurPresent(moteur))) {
            console.log(`  ℹ️  ${moteur} non installé, test sauté. Activer : \`npx playwright install ${moteur}\``)
            return this.skip()
          }
          const playwright: any = await import('playwright')
          browser    = await playwright[moteur].launch(moteur === 'chromium' ? { args: ['--no-proxy-server'] } : {})
          const page = await browser.newPage()
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          await page.route('http://mjs.test/**', (route: any) => {
            const url = route.request().url()
            if (url === 'http://mjs.test/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-liste></mjs-liste><script type="module" src="/m/bundle.js"></script></body></html>' })
            const fichier = join(out, url.replace('http://mjs.test/m/', '').split('?')[0])
            if (!url.startsWith('http://mjs.test/m/') || !existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: fichier.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: readFileSync(fichier) })
          })
          await page.goto('http://mjs.test/')
          await page.waitForFunction(`!!(document.querySelector('mjs-liste') && (${CHAMP})('fo') && (${DANS})('bfor1').querySelector('.select-label'))`)
          // les options tardives (`{for}`) arrivent après 300 ms
          await page.waitForTimeout(1200)
          depart = await lireTout(page)
          for (const c of CAS) {
            for (const g of c.gestes) {
              await natif(page, 'n' + c.id, g, c.multi)
              await choisir(page, c.id, libelle(c, g))
            }
          }
          // le garde de la liste native juge le choix après sa pause
          await page.waitForTimeout(1500)
          apres = await lireTout(page)
        })

        after(async () => { if (browser) await browser.close() })

        it('aucune erreur dans la page', () => { assert.deepEqual(erreurs, []) })

        for (const c of CAS) {
          if (c.autre) {
            // la réponse libre d'une liste `other` : la valeur qu'aucune option ne porte reste après le choix, les options partent comme celles de la liste native
            it(`\`${c.regle}\` en liste \`other\`, départ ${c.depart}, choix ${c.gestes.map((g) => JSON.stringify(g)).join(' puis ')} : la réponse libre reste`, () => {
              assert.equal(apres[c.id].coeur[0], c.autre, `${c.id} : variable`)
              assert.deepEqual(apres[c.id].coeur[2], apres[c.id].natif[2], `${c.id} : champs des options`)
            })
            continue
          }
          it(`\`${c.regle}\`, départ ${c.depart}${c.tot ? ', ' + c.tot + ' écrit avant les options' : ''}${c.gestes.length ? ', choix ' + c.gestes.map((g) => JSON.stringify(g)).join(' puis ') : ', sans choix'} : variable, option montrée et champs de la liste native`, () => {
            assert.deepEqual(depart[c.id].coeur, depart[c.id].natif, `${c.id} : au départ`)
            if (c.natif) assert.deepEqual(apres[c.id].natif, [c.natif[0], c.natif[1], c.natif[2]], `${c.id} : liste native`)
            assert.deepEqual(apres[c.id].coeur, apres[c.id].natif, `${c.id} : après les choix`)
          })
        }
      })
    }
  })
}
