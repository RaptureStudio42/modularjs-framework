// valeur de `pop`, `shift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`, `set` d'une Map, `add` d'un Set sur l'état local : brute,
// avec l'enveloppe comme avec le réglage `proxy: false` (`$l.pop() === o`, `structuredClone`, `µraw` sous un objet, `indexOf`) ; une
// écriture qui part d'elle (directe, par un nom, un motif, une boucle, un rappel, après une virgule, par une fonction de comparaison écrite
// dans le composant) passe par l'aide gardée du composant — une clé venue de l'extérieur (`constructor`, `__proto__`) n'atteint aucun
// prototype ; avec l'enveloppe, `$l.sort(f)[0].x = v` redessine l'écran ; une fonction de comparaison que le compilateur ne lit pas et une
// valeur passée à une fonction, hors de la garde (limites écrites dans docs/11), ne font aucun avertissement ; la clé calculée d'un motif
// est lue une fois, sans case partagée, avec le texte entier de ses crochets. happy-dom (production, les deux modes), puis Chromium, Firefox et WebKit (production, les deux modes)

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { charger } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const LISTE = '[{ n: 3, x: \'\' }, { n: 1, x: \'\' }, { n: 2, x: \'\' }]'
const INIT  = `$l = ${LISTE}; $g = [[1], [2], [3]]; $m = new Map([['a', { n: 1 }]]); $s = new Set([{ n: 1 }]);`

// une forme d'écriture par méthode `(k, v)`, `k` venu de l'extérieur
const FORMES: Record<string, string> = {
  pop:           '$l.pop()[k].polluK = v',
  shiftNom:      'const t = $l.shift(); t[k].polluK = v',
  spliceMotif:   'const [a] = $l.splice(0, 1); a[k].polluK = v',
  spliceRappel:  '$l.splice(0, 2).forEach((t) => { t[k].polluK = v; })',
  spliceBoucle:  'for (const t of $l.splice(0, 2)) t[k].polluK = v',
  popMotifCle:   'const { [k]: c } = $l.pop(); c.polluK = v',
  reverse:       '$l.reverse()[k].polluK = v',
  sortChaine:    '$l.sort((a, b) => a.n - b.n)[0][k].polluK = v',
  fill:          '$l.fill({ n: 0 })[0][k].polluK = v',
  copyWithin:    '$l.copyWithin(0, 1)[0][k].polluK = v',
  mapSet:        '$m.set(\'b\', { n: 2 }).get(\'b\')[k].polluK = v',
  setAdd:        '$s.add({ n: 2 }).forEach((t) => { t[k].polluK = v; })',
  triNomme:      'cle = k; $l.sort(cmp)',
  triDeclare:    'cle = k; $l.sort(cmpDecl)',
  popPousse:     '$g.pop()[k].push(v)',
  shiftSupprime: 'delete $l.shift()[k].polluD',
  virgule:       '(0, $l.pop())[k].polluK = v',
  instance:      'this.t = $l.pop(); this.t[k].polluK = v',
}

const SOURCE = `<script lang="js">
  ${INIT}
  $o = { mailles: µraw([{ n: 1 }, { n: 2 }, { n: 3 }]) };
  $gm = [{ get a() { lus++; return 'A'; }, b: 'B' }];
  $re = [{ get a() { const { [cle2]: z } = $re[0]; return 'A' + z; }, b: 'B' }];
  $d = [{ a: 1, constructor: 'Renault' }];
  let cle, lus = 0, cle2 = 'b';
  const scene = [...$o.mailles];
  const cmp = (a, b) => { a[cle].polluK = 1; return 0; };
  function cmpDecl(a, b) { b[cle].polluK = 1; return 0; }
  const garder = (x) => x;
  @remettre = function() { ${INIT} };
  @lire = function() { return JSON.stringify([$l, $g, [...$m.values()], [...$s]]); };
${Object.entries(FORMES).map(([n, f]) => `  @${n} = function(k, v) { ${f}; };`).join('\n')}
  @valeurs = function() {
    const o = { n: 9 };
    $l.push(o);
    const r = [String($l.pop() === o)];
    try { r.push(JSON.stringify(structuredClone($l.pop()))); } catch (e) { r.push(e.name); }
    try { r.push(JSON.stringify(structuredClone(µraw($l.splice(0, 1))))); } catch (e) { r.push(e.name); }
    const lu = $o.mailles[2];
    const sorti = $o.mailles.pop();
    r.push(String(sorti === lu), String(scene.indexOf(sorti)), String(scene.indexOf($o.mailles.splice(0, 1)[0])));
    return r.join(' ');
  };
  @motifs = function(k) { const { [k]: x } = $gm[0]; const { [k]: y } = $re[0]; const { [(0, k)]: z } = $d[0]; let q; ({ [k + 'z']: q = 7 } = $d[0]); const { ['construc' + 'tor']: w } = $d[0]; return [x, lus, y, z, q, w].join(','); };
  @trier = function() { $l.sort((p, q) => p.n - q.n)[0].x = 'T'; };
  @signale = function(cmp2) { $l.sort(cmp2); garder($l.pop()); };
</script>
<p class="etat">{$l.length}|{$l.length ? $l[0].x : '-'}</p>
`

// pollution des prototypes et fonctions de la page par chaque forme, pour `constructor` puis `__proto__`
const TRACEUR = `globalThis.__parcours = async (formes) => {
  const c = document.querySelector('mjs-sz-brut')
  const T = [Object.prototype, Object, Array.prototype, Array, Function.prototype, Function, Map.prototype, Set.prototype]
  const N = ['Object.prototype', 'Object', 'Array.prototype', 'Array', 'Function.prototype', 'Function', 'Map.prototype', 'Set.prototype']
  const own = (t, p) => Object.prototype.hasOwnProperty.call(t, p)
  const pollues = []
  for (const f of formes) for (const k of ['constructor', '__proto__']) {
    for (const t of T) Object.defineProperty(t, 'polluD', { value: 1, configurable: true, writable: true })
    try { await c[f](k, 1) } catch (e) {}
    T.forEach((t, i) => { for (const p of ['polluK', '0']) if (own(t, p)) pollues.push(f + ' ' + k + ' → ' + N[i] + '.' + p); if (!own(t, 'polluD')) pollues.push(f + ' ' + k + ' → ' + N[i] + '.polluD retiré') })
    if (Array.prototype.length) pollues.push(f + ' ' + k + ' → Array.prototype.length')
    for (const t of T) { delete t.polluK; delete t.polluD; delete t[0] }
    Array.prototype.length = 0
    c.remettre()
  }
  return pollues
}`

const VALEURS_ATTENDUES = 'true {"n":2,"x":""} [{"n":3,"x":""}] true 2 0'
const MOTIFS_ATTENDUS   = 'A,1,AB,1,7,Renault'

type Construit = { racine: string, code: string, avis: string[] }

async function construire(nom: string, opts: Record<string, unknown>): Promise<Construit> {
  const root   = mjsTmp('valeur-brute-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'sz-brut.mjs'), SOURCE)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), env: 'prod', js: 'bundle', urlPrefix: '/out', ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  return { racine: root, code: readFileSync(join(outDir, 'bundle.js'), 'utf-8'), avis: (stats.warnings ?? []).map((w: any) => String(w.message ?? w)) }
}
const constructions = new Map<string, Promise<Construit>>()
const construction  = (nom: string, opts: Record<string, unknown>) => {
  if (!constructions.has(nom)) constructions.set(nom, construire(nom, opts))
  return constructions.get(nom)!
}
const MODES: [string, string, Record<string, unknown>][] = [['enveloppe', 'avec', {}], ['proxy: false', 'sans', { proxy: false }]]

describe('valeur de `pop` & co. sur l\'état : brute, et l\'écriture qui part d\'elle gardée par le compilateur (happy-dom)', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [mode, nom, opts] of MODES) {
    it(`${mode} : valeur brute (\`===\`, structuredClone, µraw sous un objet, indexOf), aucune forme n'atteint un prototype, motifs lus une fois`, async () => {
      const { code } = await construction(nom, opts)
      const w: any = new Window({ url: 'http://localhost/' })
      w.structuredClone = structuredClone
      w.eval(code.replace(/import\.meta\.url/g, '\'http://localhost/\'').replace(/export\s*\{[^}]*\}\s*;?/g, ''))
      w.document.body.innerHTML = '<mjs-sz-brut></mjs-sz-brut>'
      const c = w.document.querySelector('mjs-sz-brut')
      for (let i = 0; i < 300 && !c._shadow?.querySelector('.etat')?.textContent; i++) await new Promise((r) => setTimeout(r, 10))
      const valeurs = c.valeurs()
      c.remettre()
      const motifs = c.motifs('a')
      w.eval(TRACEUR)
      // tableau de la page : recopié dans celui du test
      const pollues = [...await w.__parcours(Object.keys(FORMES))]
      let ecran = ''
      if (nom === 'avec') {
        c.trier()
        await new Promise((r) => setTimeout(r, 50))
        ecran = c._shadow.querySelector('.etat').textContent
      }
      await w.happyDOM.close()
      assert.deepEqual({ valeurs, motifs, pollues, ecran }, { valeurs: VALEURS_ATTENDUES, motifs: MOTIFS_ATTENDUS, pollues: [], ecran: nom === 'avec' ? '3|T' : '' })
    })

    it(`${mode} : une fonction de comparaison que le compilateur ne lit pas, une valeur passée à une fonction — aucun avertissement`, async () => {
      const { avis } = await construction(nom, opts)
      const ligne = SOURCE.split('\n').findIndex((l) => l.includes('@signale')) + 1
      // hors de la garde, écrites dans les limites : rien à leur ligne, sauf avec le réglage l'avertissement d'une écriture que MJS ne
      // voit pas (`$l` passé à `garder`, posé avant la garde de cette valeur) ; nulle part un avertissement sur la valeur
      const permis = (a: string) => opts.proxy === false && a.includes('MJS ne voit pas ce changement')
      assert.deepEqual(avis.filter((a) => (a.includes(`ligne ${ligne} :`) && !permis(a)) || /objet brut|éléments bruts|sort par `/.test(a)), [])
    })
  }
})

describe('valeur de `pop` & co. sur l\'état : brute, et l\'écriture qui part d\'elle gardée par le compilateur (navigateurs réels)', function () {
  this.timeout(180000)
  after(() => terminateSharedWorkerPool())

  for (const moteur of ['chromium', 'firefox', 'webkit']) for (const [mode, nom, opts] of MODES) {
    it(`${moteur}, production, ${mode} : valeur brute, aucune forme n'atteint un prototype, motifs lus une fois`, async function () {
      const playwright: any = await import('playwright')
      if (!existsSync(playwright[moteur].executablePath())) { this.skip(); return }
      const browser = await playwright[moteur].launch()
      try {
        const { racine } = await construction(nom, opts)
        const page: Cible = { mode: 'bundle', racine, document: () => '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-sz-brut></mjs-sz-brut><script type="module" src="/out/bundle.js"></script></body></html>' }
        const o = await charger(browser, page, 'mjs-sz-brut')
        try {
          await o.page.waitForFunction('!!document.querySelector(\'mjs-sz-brut\')?._shadow?.querySelector(\'.etat\')?.textContent', null, { timeout: 10000 })
          const valeurs = await o.page.evaluate('(() => { const c = document.querySelector(\'mjs-sz-brut\'); const v = c.valeurs(); c.remettre(); return v })()')
          const motifs  = await o.page.evaluate('document.querySelector(\'mjs-sz-brut\').motifs(\'a\')')
          await o.page.evaluate(TRACEUR)
          const pollues = await o.page.evaluate(`globalThis.__parcours(${JSON.stringify(Object.keys(FORMES))})`)
          assert.deepEqual({ valeurs, motifs, pollues }, { valeurs: VALEURS_ATTENDUES, motifs: MOTIFS_ATTENDUS, pollues: [] })
        }
        finally {
          await o.fermer()
        }
      }
      finally {
        await browser.close()
      }
    })
  }
})
