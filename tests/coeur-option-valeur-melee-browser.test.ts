// `value="n{$x}"` (texte fixe et variable mêlés) suit `$x` sur chaque sorte de balise, au départ puis à chaque changement, dans chaque mode de
// construction et au rendu du serveur : chaque balise reçoit la valeur par la porte qu'elle écoute. Prop `$value` : `<@@option>` (ligne de {for},
// hors boucle, VALUE en majuscules), `<@@radio>`, `<@@checkbox>`, `<@@select>`, un composant du projet qui déclare `$value`, un composant défini
// après le premier dessin. Propriété `value`, comme toujours : `<option>` native, un composant sans `$value` (lu par `el.value`), un composant à
// accesseur `value` propre. Sur la même page, titre, style et part mêlés d'une balise de composant (attribut lu par `[titre]` et `:host([titre])`)
// et la balise mjs-… tierce restent écrits en attribut
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MODES, construire, charger } from './helpers/liaison-navigateur.js'
import type { Cible, Mode } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'p-opt.mjs': [
    '<script>', '$n = 1', "$nom = 'Ana'", "$col = 'blue'", '$rows = [{ id: 1, n: 5 }, { id: 2, n: 7 }]', "$v = '01'", "$v2 = '01'",
    'bump = ->', '  $n += 1', "  $nom = 'Bea'", "  $col = 'red'", '  $rows = $rows.map((r)-> r.id == 1 ? { ...r, n: r.n + 4 } : r)', "  $v = '0' + $rows[0].n", "  $v2 = '0' + $n", '</script>',
    '<form class="f"><@@select name="pick" value={$v}>{for x in $rows by id}<@@option value="0{x.n}">L{x.id}</@@option>{end}<@@option value="0{$n}">M</@@option></@@select></form>',
    '<form class="f2"><@@select name="pick2" value={$v2}><@@option VALUE="0{$n}">U</@@option></@@select><@@radio name="r" value="r{$n}" checked={true}>R</@@radio><@@checkbox name="c" value="c{$n}" checked={true}>C</@@checkbox>',
    '<@@select name="s3" value="0{$n}"><@@option value="01">1</@@option><@@option value="02">2</@@option><@@option value="03">3</@@option></@@select><select name="nat"><option value="n{$n}">N</option></select></form>',
    '<@fiche class="r" titre="Bonjour {$nom}" style="color: {$col}" part="p{$n}"></@fiche>',
    '<@pa class="pa" value="p{$n}"></@pa><@pg class="pg" value="g{$n}"></@pg><@pv class="pv" value="w{$n}"></@pv><@pt class="pt" value="t{$n}"></@pt><@pw class="pw" value="x{$n}"></@pw><@pw class="pw2" VALUE="y{$n}"></@pw>',
    '<mjs-tiers class="t" label="a{$n}"></mjs-tiers>',
    '<button class="go" @click={bump()}>go</button>',
  ].join('\n') + '\n',
  'fiche.mjs': ['<script>', "$titre = ''", '</script>', '<p class="t">{$titre}</p>', '<style>', ':host([titre]) .t', '  color: rgb(255, 0, 0)', '</style>'].join('\n') + '\n',
  'pa.mjs': '<p class="vu">pa</p>\n',
  'pg.mjs': '<p class="vu">pg</p>\n',
  'pv.mjs': ['<script>', "$value = ''", '</script>', '<p class="vu">{$value}</p>'].join('\n') + '\n',
  'pt.mjs': ['<script>', "$value = ''", '</script>', '<p class="vu">{$value}</p>'].join('\n') + '\n',
  'pw.mjs': ['<script>', "$value = ''", 'µeffect =>', "  (@__vus ?= []).push(String($value) + '|' + String(@value))", '</script>', '<p class="vu">{$value}</p>'].join('\n') + '\n',
}

// accesseur `value` propre de mjs-pa, posé sur sa classe à sa définition, qui note chaque valeur reçue ; mjs-pt n'est défini qu'à la demande de la page
const AVANT_PAGE = `(() => {
  const definir = customElements.define.bind(customElements)
  customElements.define = (nom, classe, options) => {
    if (nom === 'mjs-pa') Object.defineProperty(classe.prototype, 'value', { configurable: true, get() { return this.__v ?? '' }, set(v) { (this.__recus ??= []).push(v); this.__v = v } })
    if (nom === 'mjs-pt' && !window.__definirPt) { window.__definirPt = () => definir(nom, classe, options); return }
    return definir(nom, classe, options)
  }
})()`
const avecAvantPage = (browser: any) => ({ newContext: async (o: any) => { const ctx = await browser.newContext(o); await ctx.addInitScript(AVANT_PAGE); return ctx } })

const LIRE = `(() => {
  const sh = document.querySelector('mjs-p-opt')?._shadow
  if (!sh) return 'pas de shadow'
  const f = sh.querySelector('mjs-fiche'), t = f?._shadow?.querySelector('.t'), d2 = new FormData(sh.querySelector('.f2'))
  const pa = sh.querySelector('mjs-pa'), pg = sh.querySelector('mjs-pg'), pt = sh.querySelector('mjs-pt')
  return {
    opt: [...sh.querySelectorAll('.f mjs-core-option')].map((o) => o.getAttribute('value')),
    envoi: new FormData(sh.querySelector('.f')).get('pick'),
    opt2: [...sh.querySelectorAll('.f2 mjs-core-option')].map((o) => o.getAttribute('value')),
    envoi2: ['pick2', 'r', 'c', 's3', 'nat'].map((k) => d2.get(k)),
    nat: sh.querySelector('select[name=nat] option')?.value ?? null,
    fiche: f ? [f.getAttribute('titre'), f.matches('[titre]'), t?.textContent ?? null, t ? getComputedStyle(t).color : null, f.getAttribute('style'), f.getAttribute('part')] : 'pas de fiche',
    pa: pa ? [pa.value ?? null, pa._state?.value ?? null] : 'pas de pa',
    pg: pg ? [pg.value ?? null, pg._state?.value ?? null] : 'pas de pg',
    pv: sh.querySelector('mjs-pv')?._shadow?.querySelector('.vu')?.textContent ?? null,
    pt: pt ? [customElements.get('mjs-pt') ? 'défini' : 'inconnu', pt._shadow?.querySelector('.vu')?.textContent ?? null, Object.prototype.hasOwnProperty.call(pt, 'value') ? pt.value : null] : 'pas de pt',
    pw: [...sh.querySelectorAll('mjs-pw')].map((e) => [e._shadow?.querySelector('.vu')?.textContent ?? null, Object.prototype.hasOwnProperty.call(e, 'value') ? e.value : null, e.classList.contains('pw2') ? e.getAttribute('value') : '-', (e.__vus || []).slice(-1)[0] ?? null]),
    pwn: [...sh.querySelectorAll('mjs-pw')].map((e) => (e.__vus || []).length),
    tiers: sh.querySelector('mjs-tiers')?.getAttribute('label') ?? null,
  }
})()`
const RECUS = `(document.querySelector('mjs-p-opt')._shadow.querySelector('mjs-pa').__recus || []).join(',')`
const PRET  = `(() => { const sh = document.querySelector('mjs-p-opt')?._shadow; return !!sh?.querySelector('.go') && sh.querySelectorAll('mjs-core-option').length === 7 && sh.querySelector('mjs-fiche')?._shadow?.querySelector('.t')?.textContent === 'Bonjour Ana' })()`
const PART  = (k: number) => `document.querySelector('mjs-p-opt')._shadow.querySelector('mjs-fiche').getAttribute('part') === 'p${k}'`
const PT_VU = `document.querySelector('mjs-p-opt')._shadow.querySelector('mjs-pt')?._shadow?.querySelector('.vu')?.textContent === 't1'`
const ligne = (k: number) => (k === 1 ? '05' : k === 2 ? '09' : '013')
const ETAT  = (k: number, mode: Mode) => ({
  opt: [ligne(k), '07', `0${k}`],
  envoi: k === 1 ? '01' : ligne(k),
  opt2: [`0${k}`, '01', '02', '03'],
  envoi2: [`0${k}`, `r${k}`, `c${k}`, `0${k}`, `n${k}`],
  nat: `n${k}`,
  fiche: [k === 1 ? 'Bonjour Ana' : 'Bonjour Bea', true, k === 1 ? 'Bonjour Ana' : 'Bonjour Bea', 'rgb(255, 0, 0)', k === 1 ? 'color: blue' : 'color: red', `p${k}`],
  pa: [`p${k}`, null],
  pg: [`g${k}`, null],
  pv: `w${k}`,
  pt: ['défini', `t${k}`, k === 1 ? null : `t${k}`],
  pw: [[`x${k}`, k === 1 && mode === 'split' ? null : `x${k}`, '-', `x${k}|${k === 1 && mode === 'split' ? 'undefined' : `x${k}`}`], [`y${k}`, null, `y${k}`, `y${k}|undefined`]],
  tiers: `a${k}`,
})
// mjs-pa défini avant la première écriture : son accesseur reçoit chaque valeur (en split, la balise est écrite avant sa définition et sa
// propriété propre masque l'accesseur, comme toujours)
const ACCESSEUR_APPELE = ['dev-parents-avant', 'dev-enfants-avant', 'bundle']

describe('valeur mêlée `value="n{$x}"` : elle suit `$x` sur chaque sorte de balise', function () {
  this.timeout(120000)
  const cibles: Partial<Record<Mode, Cible>> = {}

  before(async () => {
    for (const mode of MODES) cibles[mode] = await construire(mode, SOURCES, ['mjs-p-opt'])
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('rendu du serveur : chaque option porte sa valeur, la fiche et la balise tierce leurs attributs', () => {
    for (const variante of ['markers', 'replace']) {
      const html  = cibles.ssr!.document('mjs-p-opt', variante)
      const opt   = [...html.matchAll(/<mjs-core-option\b[^>]*?\bvalue="([^"]*)"/gi)].map((m) => m[1])
      const fiche = html.match(/<mjs-fiche\b[^>]*>/)?.[0] ?? ''
      assert.deepEqual(opt, ['05', '07', '01', '01', '01', '02', '03'], `options du serveur (${variante})`)
      assert.match(html, /<option\b[^>]*\bvalue="n1"/, `option native du serveur (${variante})`)
      for (const a of ['titre="Bonjour Ana"', 'style="color: blue"', 'part="p1"']) assert.ok(fiche.includes(a), `${a} dans ${fiche} (${variante})`)
      assert.match(html, /<mjs-tiers\b[^>]*\blabel="a1"/)
    }
  })

  for (const nom of ['chromium', 'firefox', 'webkit']) it(`${nom} : au départ puis après deux changements`, async function () {
    const playwright: any = await import('playwright')
    const browser  = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
    const ecarts: string[] = []
    const essais: Array<[Mode, string]> = nom === 'chromium'
      ? [['dev-parents-avant', ''], ['dev-enfants-avant', ''], ['bundle', ''], ['split', ''], ['ssr', 'markers'], ['ssr', 'positional'], ['ssr', 'diff']]
      : [['dev-parents-avant', ''], ['bundle', ''], ['ssr', 'positional']]
    try {
      for (const [mode, variante] of essais) {
        const o        = await charger(avecAvantPage(browser), cibles[mode]!, 'mjs-p-opt', variante)
        const nomEssai = variante ? `${mode}/${variante}` : mode
        const noter    = (etape: string, vu: unknown, attendu: unknown) => { if (JSON.stringify(vu) !== JSON.stringify(attendu)) ecarts.push(`${nomEssai} ${etape} ${JSON.stringify(vu)}`) }
        try {
          await o.page.waitForFunction(PRET, null, { timeout: 15000 })
          await o.page.waitForTimeout(300)
          noter('pt avant sa définition', (await o.page.evaluate(LIRE)).pt, ['inconnu', null, 't1'])
          await o.page.evaluate('window.__definirPt?.()')
          await o.page.waitForFunction(PT_VU, null, { timeout: 5000 }).catch(() => {})
          await o.page.waitForTimeout(300)
          const lu = async () => { const vu = await o.page.evaluate(LIRE); const nb = vu.pwn; delete vu.pwn; return [vu, nb] }
          const [depart, n0] = await lu()
          noter('départ', depart, ETAT(1, mode))
          const recus = [await o.page.evaluate(RECUS)]
          for (const k of [2, 3]) {
            await o.page.evaluate(`document.querySelector('mjs-p-opt')._shadow.querySelector('.go').click()`)
            await o.page.waitForFunction(PART(k), null, { timeout: 8000 })
            await o.page.waitForTimeout(300)
            const [vu, nb] = await lu()
            noter(`changement ${k - 1}`, vu, ETAT(k, mode))
            noter(`passages du µeffect de mjs-pw au changement ${k - 1}`, nb, n0.map((c: number) => c + k - 1))
            recus.push(await o.page.evaluate(RECUS))
          }
          if (ACCESSEUR_APPELE.includes(mode)) noter('accesseur', recus, ['p1', 'p1,p2', 'p1,p2,p3'])
          if (o.erreurs.length) ecarts.push(`${nomEssai} erreurs ${JSON.stringify(o.erreurs.slice(0, 2))}`)
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
