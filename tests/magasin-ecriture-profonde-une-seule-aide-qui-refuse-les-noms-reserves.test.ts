// magasin `$$` — une écriture profonde passe par une seule aide, `µ._mjs_storeDeepSet`, que ses clés soient écrites
// dans le code (`$$o.a.b = v`, `$$o['a'][0] = v`) ou calculées (`$$o[k].b = v`) : elle écrit là où JavaScript écrit,
// sauf une clé qui vaut `'__proto__'`, `'constructor'` ou `'prototype'`, calculée ou écrite en dur (`$$o['__proto__'].x`,
// `$$o.constructor.x`) — refusée, rien n'est écrit, un avertissement nomme le segment. Un prototype ou une fonction
// rangés dans le magasin par une lecture (`$$o.p = $$o[k]`, puis `$$o.p.x = v`) n'ont que des clés permises : l'aide
// refuse l'objet atteint, rien n'est écrit, l'avertissement nomme le segment qui y mène (la garde ne touche pas les
// lectures) — en développement comme en production, Civet et CoffeeScript

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const CIVET = `<script>
  $$o = { a: { b: 0, l: [0] }, p: null }
  @ecrit = (v) -> $$o.a.b = v
  @ecritTexte = (v) -> $$o['a']['b'] = v
  @ecritIndice = (v) -> $$o.a.l[0] = v
  @ajoute = -> $$o.a.b += 1
  @incremente = -> $$o.a.b++
  @motif = (v) -> [$$o.a.b] = [v]
  @ecritCle = (k, v) -> $$o[k].b = v
  @ecritMele = (k, v) -> $$o.a[k].polluK = v
  @ecritProtoEnDur = (v) -> $$o['__proto__'].polluK = v
  @ecritConstructeurEnDur = (v) -> $$o.constructor.polluK = v
  @range = (k) -> $$o.p = $$o[k]
  @ecritRange = (v) -> $$o.p.polluK = v
  @ecritVide = (v) -> $$o.x.y = v
</script>

<p class="etat">{$$o.a.b} {$$o.a.l[0]}</p>
`

const COFFEE = `<script lang="coffee">
$$c = { a: { b: 0 } }
@cEcrit = (v) -> $$c.a.b = v
@cEcritCle = (k, v) -> $$c[k].b = v
</script>

<p class="etat">{$$c.a.b}</p>
`

async function construire(prefixe: string, prod: boolean): Promise<{ code: string, sortie: string }> {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'rapide-civet.mjs'), CIVET)
  writeFileSync(join(srcDir, 'rapide-coffee.mjs'), COFFEE)
  const opts: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(opts)
  const stats   = await bundler.compile()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  await bundler.close()
  if (prod) return { code: readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, ''), sortie: '' }
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
  const appli = files.filter((f) => f.startsWith('rapide-')).map((f) => readFileSync(join(outDir, f), 'utf-8')).join('\n')
  return { code: files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n'), sortie: appli }
}

async function monter(code: string, prod: boolean) {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[] = []
  window.eval(prod ? code : `${code}\nglobalThis.µ = µ;`)
  if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
  window.document.body.innerHTML = '<mjs-rapide-civet></mjs-rapide-civet><mjs-rapide-coffee></mjs-rapide-coffee>'
  const civet  = window.document.querySelector('mjs-rapide-civet')
  const coffee = window.document.querySelector('mjs-rapide-coffee')
  const etat   = () => civet._shadow?.querySelector('.etat')?.textContent
  const cetat  = () => coffee._shadow?.querySelector('.etat')?.textContent
  const fin    = Date.now() + 3000
  while (!(etat() && cetat()) && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
  return { window, civet, coffee, avis, etat, cetat }
}

const pause = () => new Promise((r) => setTimeout(r, 40))

// écriture relevée, sous le nom `cle`, sur les prototypes et constructeurs de la page, puis retirée
function pollution(window: any, cle: string): string[] {
  const vus = window.eval(`[Object.prototype, Object, Array.prototype, Function.prototype].map((t, i) => Object.prototype.hasOwnProperty.call(t, '${cle}') ? ['Object.prototype', 'Object', 'Array.prototype', 'Function.prototype'][i] + '.${cle} = ' + t['${cle}'] : '').filter(Boolean)`)
  window.eval(`delete Object.prototype.${cle}; delete Object.${cle}; delete Array.prototype.${cle}; delete Function.prototype.${cle}`)
  return [...vus]
}

describe('magasin $$ : une écriture profonde, une seule aide, qui refuse les noms réservés', function () {
  this.timeout(180000)
  const builds: Record<string, { code: string, sortie: string }> = {}

  before(async function () {
    this.timeout(240000)
    builds.dev  = await construire('chemin-rapide', false)
    builds.prod = await construire('chemin-rapide-prod', true)
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('compilé : toute écriture profonde passe par µ._mjs_storeDeepSet, clé calculée et nom réservé compris, sans navigation dans le code compilé', () => {
    const s = builds.dev.sortie
    // valeur lue (retour implicite) : l'appel est dans une fonction qui rend la valeur, son début reste le même
    const ab = s.match(/µ\._mjs_storeDeepSet\("o", \["a", "b"\], /g) ?? []
    assert.equal(ab.length, 5, '$$o.a.b = v, $$o[\'a\'][\'b\'] = v, += 1, ++, [$$o.a.b] = [v]')
    assert.match(s, /µ\._mjs_storeDeepSet\("o", \["a", "l", 0\], /, '$$o.a.l[0] = v')
    assert.match(s, /µ\._mjs_storeDeepSet\("c", \["a", "b"\], /, 'CoffeeScript : $$c.a.b = v')
    assert.match(s, /µ\._mjs_storeDeepSet\("o", \[k, "b"\], /, '$$o[k].b = v')
    assert.match(s, /µ\._mjs_storeDeepSet\("o", \["a", k, "polluK"\], /, '$$o.a[k].polluK = v')
    assert.match(s, /µ\._mjs_storeDeepSet\("o", \["__proto__", "polluK"\], /, '$$o[\'__proto__\'].polluK = v')
    assert.match(s, /µ\._mjs_storeDeepSet\("o", \["constructor", "polluK"\], /, '$$o.constructor.polluK = v')
    assert.match(s, /µ\._mjs_storeDeepSet\("c", \[k, "b"\], /, 'CoffeeScript : $$c[k].b = v')
    assert.doesNotMatch(s, /_mjs_storeDeepSetStatic|_mjs_storeAt|_mjs_guardPath/, 'une seule aide, aucune navigation gardée')
  })

  for (const mode of ['dev', 'prod']) {
    const nom = mode === 'dev' ? 'développement' : 'production'

    it(`${nom} : les écritures par des clés écrites dans le code écrivent et redessinent`, async () => {
      const { window, civet, coffee, etat, cetat } = await monter(builds[mode].code, mode === 'prod')
      try {
        assert.equal(civet.ecrit(5), 5)
        await pause()
        assert.equal(etat(), '5 0')
        civet.ecritTexte(6)
        civet.ecritIndice(7)
        await pause()
        assert.equal(etat(), '6 7')
        civet.ajoute()
        assert.equal(civet.incremente(), 7)
        await pause()
        assert.equal(etat(), '8 7')
        civet.motif(9)
        await pause()
        assert.equal(etat(), '9 7')
        civet.ecritCle('a', 10)
        await pause()
        assert.equal(etat(), '10 7')
        coffee.cEcrit(3)
        coffee.cEcritCle('a', 4)
        await pause()
        assert.equal(cetat(), '4')
        assert.throws(() => civet.ecritVide(1), (e: any) => e.name === 'TypeError', 'un vide sur le chemin lève la TypeError de JavaScript')
      }
      finally {
        window.close()
      }
    })

    it(`${nom} : une clé calculée, un nom réservé écrit en dur, un prototype ou une fonction rangés par une lecture sont refusés`, async () => {
      const { window, civet, coffee, avis, etat } = await monter(builds[mode].code, mode === 'prod')
      try {
        const ecarts: string[] = []
        // `attendu` : ce qui est écrit, relevé sous le nom écrit (`cle`) ; `seg` : le segment refusé que nomme
        // l'avertissement (développement), aucun avertissement sans lui
        const jouer = (cas: string, f: () => any, cle: string, attendu: string[], seg?: string) => {
          avis.length = 0
          try {
            f()
          }
          catch (e: any) {
            ecarts.push(`${cas} : ${e.name}: ${e.message}`)
          }
          const p = pollution(window, cle)
          if (p.join(' ; ') !== attendu.join(' ; ')) ecarts.push(`${cas} : écrit ${p.join(' ; ') || 'rien'} au lieu de ${attendu.join(' ; ') || 'rien'}`)
          const avisAttendu = seg ? avis.length === 1 && avis[0].includes(`segment « ${seg} »`) : avis.length === 0
          if (mode === 'dev' && !avisAttendu) ecarts.push(`${cas} : avertissements ${JSON.stringify(avis)}`)
        }
        jouer('clé calculée', () => civet.ecritCle('__proto__', 1), 'b', [], '__proto__')
        jouer('clé calculée, CoffeeScript', () => coffee.cEcritCle('__proto__', 2), 'b', [], '__proto__')
        jouer('clé calculée mêlée à des clés écrites', () => civet.ecritMele('__proto__', 'x'), 'polluK', [], '__proto__')
        jouer('clé calculée en tableau', () => civet.ecritMele(['__proto__'], 'y'), 'polluK', [], '__proto__')
        jouer('clé calculée constructor', () => civet.ecritMele('constructor', 'z'), 'polluK', [], 'constructor')
        jouer('__proto__ écrit en dur', () => civet.ecritProtoEnDur('x'), 'polluK', [], '__proto__')
        jouer('constructor écrit en dur', () => civet.ecritConstructeurEnDur('x'), 'polluK', [], 'constructor')
        civet.range('__proto__')
        jouer('prototype rangé, chemin aux clés écrites dans le code', () => civet.ecritRange('x'), 'polluK', [], '__proto__')
        civet.range('constructor')
        jouer('Object rangé, chemin aux clés écrites dans le code', () => civet.ecritRange('x'), 'polluK', [], 'constructor')
        assert.deepEqual(ecarts, [])
        await pause()
        assert.equal(etat(), '0 0', 'rien d\'autre n\'est écrit')
      }
      finally {
        window.close()
      }
    })
  }
})
