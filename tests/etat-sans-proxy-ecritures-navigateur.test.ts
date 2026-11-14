// réglage `proxy: false` au navigateur réel : `++` et `--` (préfixes ou suffixes), chaque affectation composée (`+=`, `-=`, `*=`, `/=`,
// `%=`, `**=`, `<<=`, `>>=`, `>>>=`, `&=`, `|=`, `^=`) et logique (`||=`, `&&=`, `??=`) sur un objet de l'état redessinent, à toute
// profondeur et par indice (`$l[i].n++`), comme l'échange par un motif (`[$o.n, $o.d] = [$o.d, $o.n]`), dans une méthode, dans un
// gestionnaire en ligne et en Civet ; la valeur lue reste celle de
// JavaScript, et un `||=` ou un `??=` qui n'écrit rien laisse l'écran tel quel. Chaque écran est celui de l'enveloppe (construction sans
// le réglage), en production comme en développement. Chromium, Firefox et WebKit réels

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { libellesDuManifeste } from './helpers/libelles-manifeste.js'
import { charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

// chaque pas, une méthode ; l'écran : n a b c d bits r l0 l1
const PAS = [
  '$o.n++', '++$o.n', '$o.n--', '--$o.n',
  '$o.a += 4', '$o.a -= 1', '$o.a *= 6', '$o.a /= 3', '$o.a %= 5', '$o.a **= 2',
  '$o.bits <<= 2', '$o.bits >>= 1', '$o.bits >>>= 1', '$o.bits &= 3', '$o.bits |= 5', '$o.bits ^= 1',
  '$o.b ||= 5', '$o.d &&= 7', '$o.c ??= 3', '$o.p.q.r++', '$o.p.q.r += 10', '$l[i].n++', '$l[0].n += 5', '$o.b ||= 9', '$o.c ??= 8',
  '[$o.n, $o.d] = [$o.d, $o.n]',
]

const SOURCES: Record<string, string> = {
  'sp-formes.mjs': `<script lang="js">
  $o = { n: 0, a: 1, b: 0, c: null, d: 1, bits: 6, p: { q: { r: 0 } } };
  $l = [{ n: 0 }, { n: 10 }];
${PAS.map((f, k) => `  @f${k} = function() { const i = 1; ${f}; };`).join('\n')}
  @lu = function() { return [$o.n++, ++$o.n, $o.a += 1, $o.b ||= 9, $o.c ??= 8]; };
</script>
<p class="v">{[$o.n, $o.a, $o.b, String($o.c), $o.d, $o.bits, $o.p.q.r, $l[0].n, $l[1].n].join(' ')}</p>
<button class="plus" @click={$o.n++}>+</button>
<button class="fois" @click={$o.a *= 2}>*</button>
<p class="pret">prêt</p>
`,
  'sp-civet.mjs': `<script>
  $o = { n: 0, a: 1, b: 0 }
  @plus = -> $o.n++
  @ajoute = -> $o.a += 2
  @ou = -> $o.b ||= 5
</script>
<p class="v">{$o.n + ' ' + $o.a + ' ' + $o.b}</p>
<p class="pret">prêt</p>
`,
}

// les écrans attendus, pas après pas (la règle de JavaScript)
const ATTENDU = ['0 1 0 null 1 6 0 0 10', '1 1 0 null 1 6 0 0 10', '2 1 0 null 1 6 0 0 10', '1 1 0 null 1 6 0 0 10', '0 1 0 null 1 6 0 0 10',
  '0 5 0 null 1 6 0 0 10', '0 4 0 null 1 6 0 0 10', '0 24 0 null 1 6 0 0 10', '0 8 0 null 1 6 0 0 10', '0 3 0 null 1 6 0 0 10', '0 9 0 null 1 6 0 0 10',
  '0 9 0 null 1 24 0 0 10', '0 9 0 null 1 12 0 0 10', '0 9 0 null 1 6 0 0 10', '0 9 0 null 1 2 0 0 10', '0 9 0 null 1 7 0 0 10', '0 9 0 null 1 6 0 0 10',
  '0 9 5 null 1 6 0 0 10', '0 9 5 null 7 6 0 0 10', '0 9 5 3 7 6 0 0 10', '0 9 5 3 7 6 1 0 10', '0 9 5 3 7 6 11 0 10', '0 9 5 3 7 6 11 0 11', '0 9 5 3 7 6 11 5 11',
  '0 9 5 3 7 6 11 5 11', '0 9 5 3 7 6 11 5 11', '7 9 5 3 0 6 11 5 11']

// une construction : production en un seul fichier, ou développement (tout le JavaScript dans la page, le cœur d'abord)
async function construire(nom: string, opts: Record<string, unknown>, dev: boolean): Promise<Cible> {
  const root   = mjsTmp('sans-proxy-formes-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(dev ? root : outDir, 'bundle.js'), ...(dev ? {} : { env: 'prod', js: 'bundle', urlPrefix: '/out' }), ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const page = (corps: string) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-sp-formes></mjs-sp-formes><mjs-sp-civet></mjs-sp-civet>${corps}</body></html>`
  if (!dev) return { mode: 'bundle', racine: root, document: () => page('<script type="module" src="/out/bundle.js"></script>') }
  const rang   = (f: string) => /^mjs_core-/.test(f) ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  const script = files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n' + libellesDuManifeste(join(root, 'bundle.js'))
  return { mode: 'dev-parents-avant', racine: root, document: () => page(`<script>${script}</script>`) }
}

const cibles = new Map<string, Promise<Cible>>()
const cible  = (nom: string, opts: Record<string, unknown>, dev = false) => {
  if (!cibles.has(nom)) cibles.set(nom, construire(nom, opts, dev))
  return cibles.get(nom) as Promise<Cible>
}

// tous les pas joués dans la page, chacun suivi d'une image et d'une tâche ; les écrans de la méthode, puis ce que rend `lu()`, puis les
// deux clics en ligne, puis le composant en Civet
async function parcours(browser: any, c: Cible) {
  const o = await charger(browser, c, 'mjs-sp-formes')
  try {
    await o.page.waitForFunction('!!document.querySelector(\'mjs-sp-formes\')?._shadow?.querySelector(\'.pret\') && !!document.querySelector(\'mjs-sp-civet\')?._shadow?.querySelector(\'.pret\')', null, { timeout: 10000 })
    const r = await o.page.evaluate(`(async () => {
      const el    = document.querySelector('mjs-sp-formes')
      const cv    = document.querySelector('mjs-sp-civet')
      const pause = () => new Promise((fin) => setTimeout(() => requestAnimationFrame(() => setTimeout(fin, 0)), 20))
      const ecran = (x) => x._shadow.querySelector('p.v').textContent
      await pause()
      const pas = [ecran(el)]
      for (let k = 0; k < ${PAS.length}; k++) {
        el['f' + k]()
        await pause()
        pas.push(ecran(el))
      }
      const lu = el.lu()
      await pause()
      const apresLu = ecran(el)
      el._shadow.querySelector('button.plus').click()
      await pause()
      const plus = ecran(el)
      el._shadow.querySelector('button.fois').click()
      await pause()
      const fois = ecran(el)
      const civet = [ecran(cv)]
      for (const m of ['plus', 'ajoute', 'ou']) {
        cv[m]()
        await pause()
        civet.push(ecran(cv))
      }
      return { pas, lu, apresLu, plus, fois, civet }
    })()`)
    assert.deepEqual(graves(o), [], 'aucune erreur')
    return r
  } finally {
    await o.fermer()
  }
}

const ATTENDU_TOUT = {
  pas:     ATTENDU,
  lu:      [7, 9, 10, 5, 3],
  apresLu: '9 10 5 3 0 6 11 5 11',
  plus:    '10 10 5 3 0 6 11 5 11',
  fois:    '10 20 5 3 0 6 11 5 11',
  civet:   ['0 1 0', '1 1 0', '1 3 0', '1 3 5'],
}

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) describe(`état sans Proxy : ++, --, +=, ||= redessinent (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, test des écritures composées sans Proxy sauté. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('production, proxy: false : chaque forme redessine, la valeur lue est celle de JavaScript', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await parcours(browser, await cible('sans-prod', { proxy: false })), ATTENDU_TOUT)
  })

  it('développement, proxy: false : le même comportement', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await parcours(browser, await cible('sans-dev', { proxy: false }, true)), ATTENDU_TOUT)
  })

  it('sans le réglage, l\'enveloppe donne les mêmes écrans', async function () {
    if (!present) { this.skip(); return }
    assert.deepEqual(await parcours(browser, await cible('avec-prod', {})), ATTENDU_TOUT)
  })
})
