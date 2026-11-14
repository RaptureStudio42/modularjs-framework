// magasin `$$` : l'élément d'une copie faite par `map` ou `flatMap` passe par l'aide gardée, même quand le rappel fait des objets neufs
// (`({ ...t })`). La copie peut recevoir une valeur venue d'ailleurs, qui peut être un prototype rangé par une clé venue de données
// (`$$cfg[k]`, `k` vaut `'__proto__'`) : `fill`, `with`, `toSpliced`, `concat`, un étalement mêlé (`[...copie, v]`), `push` (puis
// l'élément lu, une boucle `for … of`, `pop()`), `unshift` (puis un rappel `forEach`), `n[0] = …`, `Object.assign` ; une clé calculée
// (`n[k]`, `k` vaut `'__proto__'` ou `'constructor'`) ou `constructor` écrit mène de la copie à `Array.prototype` ou `Array`. Écrite
// telle quelle, chacune de ces écritures poserait son champ sur `Object.prototype`, `Array.prototype` ou `Array` : gardée, elle est
// refusée, sans erreur, avec un avertissement en développement. JavaScript (17 écritures), Civet et CoffeeScript (7 chacune),
// composant et module importé, avec l'enveloppe et avec `proxy: false`, développement et production. Témoin : l'élément même d'une
// copie faite d'objets neufs reçoit l'écriture, sans avertissement

import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// JavaScript : chaque méthode met une valeur du magasin dans une copie faite d'objets neufs, ou suit une clé de la copie, puis y écrit
const FORMES_JS: Record<string, string> = {
  neuf:         'const n = $$jliste.map((t) => ({ ...t, x: 1 })); n[0].polluK = v; return n[0].polluK;',
  fill:         '$$jliste.map((t) => ({ ...t })).fill($$jcfg[k])[0].polluK = v;',
  with:         '$$jliste.map((t) => ({ ...t })).with(0, $$jcfg[k])[0].polluK = v;',
  toSpliced:    '$$jliste.map((t) => ({ ...t })).toSpliced(0, 0, $$jcfg[k])[0].polluK = v;',
  concatListe:  '$$jliste.map((t) => ({ ...t })).concat([$$jcfg[k]])[1].polluK = v;',
  etale:        '[...$$jliste.map((t) => ({ ...t })), $$jcfg[k]][1].polluK = v;',
  pousse:       'const n = $$jliste.map((t) => ({ ...t })); n.push($$jcfg[k]); n[1].polluK = v;',
  pousseBoucle: 'const n = $$jliste.map((t) => ({ ...t })); n.push($$jcfg[k]); for (const u of n) u.polluK = v;',
  pousseRappel: 'const n = $$jliste.map((t) => ({ ...t })); n.unshift($$jcfg[k]); n.forEach((u) => { u.polluK = v; });',
  indice:       'const n = $$jliste.map((t) => ({ ...t })); n[0] = $$jcfg[k]; n[0].polluK = v;',
  pop:          'const n = $$jliste.map((t) => ({ ...t })); n.push($$jcfg[k]); n.pop().polluK = v;',
  assign:       'const n = $$jliste.map((t) => ({ ...t })); Object.assign(n, [$$jcfg[k]]); n[0].polluK = v;',
  cleCopie:     'const n = $$jliste.map((t) => ({ ...t })); n[k].polluK = v;',
  cleDirecte:   '$$jliste.map((t) => ({ ...t }))[k].polluK = v;',
  ctorEcrit:    '$$jliste.map((t) => ({ ...t })).constructor.polluK = v;',
  flatFill:     '$$jliste.flatMap((t) => [{ ...t }]).fill($$jcfg[k])[0].polluK = v;',
}

const JS = `<script lang="js">
  $$jliste = [{ id: 1, x: 0 }];
  $$jcfg = { a: 1 };
  @remettre = function() { $$jliste = [{ id: 1, x: 0 }]; };
${Object.entries(FORMES_JS).map(([nom, f]) => `  @${nom} = function(k, v) { ${f} };`).join('\n')}
</script>
<p class="etat">{$$jliste.length}</p>
`

const AIDES_CIVET = `export modFill = (k, v) ->
  $$liste.map((t) -> ({ ...t })).fill($$cfg[k])[0].polluK = v
  return

export modCle = (k, v) ->
  n := $$liste.map((t) -> ({ ...t }))
  n[k].polluK = v
  return
`

const CIVET = `@import modFill 'copie-map-aides.civet.mjs'
@import modCle 'copie-map-aides.civet.mjs'

<script>
  $$liste = [{ id: 1, x: 0 }]
  $$cfg = { a: 1 }
  @remettre = ->
    $$liste = [{ id: 1, x: 0 }]
    return
  @neuf = (k, v) ->
    n := $$liste.map((t) -> ({ ...t, x: 1 }))
    n[0].polluK = v
    return n[0].polluK
  @fill = (k, v) ->
    $$liste.map((t) -> ({ ...t })).fill($$cfg[k])[0].polluK = v
    return
  @pousse = (k, v) ->
    n := $$liste.map((t) -> ({ ...t }))
    n.push($$cfg[k])
    for u of n
      u.polluK = v
    return
  @cle = (k, v) ->
    n := $$liste.map((t) -> ({ ...t }))
    n[k].polluK = v
    return
  @mFill = (k, v) -> modFill(k, v)
  @mCle = (k, v) -> modCle(k, v)
</script>
<p class="etat">{$$liste.length}</p>
`

const AIDES_COFFEE = `export modFillC = (k, v) ->
  $$cliste.map((t) -> { ...t }).fill($$ccfg[k])[0].polluK = v
  return
export modCleC = (k, v) ->
  n = $$cliste.map (t) -> { ...t }
  n[k].polluK = v
  return
`

const COFFEE = `@import modFillC 'copie-map-aides.coffee.mjs'
@import modCleC 'copie-map-aides.coffee.mjs'

<script lang="coffee">
$$cliste = [{ id: 1, x: 0 }]
$$ccfg = { a: 1 }
@remettre = ->
  $$cliste = [{ id: 1, x: 0 }]
  return
@neuf = (k, v) ->
  n = $$cliste.map (t) -> { ...t, x: 1 }
  n[0].polluK = v
  return n[0].polluK
@fill = (k, v) ->
  $$cliste.map((t) -> { ...t }).fill($$ccfg[k])[0].polluK = v
  return
@pousse = (k, v) ->
  n = $$cliste.map (t) -> { ...t }
  n.push $$ccfg[k]
  for u in n
    u.polluK = v
  return
@cle = (k, v) ->
  n = $$cliste.map (t) -> { ...t }
  n[k].polluK = v
  return
@mFill = (k, v) -> modFillC(k, v)
@mCle = (k, v) -> modCleC(k, v)
</script>
<p class="etat">{$$cliste.length}</p>
`

const FICHIERS: Record<string, string> = {
  'copie-map-aides.civet.mjs': AIDES_CIVET,
  'copie-map-aides.coffee.mjs': AIDES_COFFEE,
  'copie-map-js.mjs': JS,
  'copie-map-civet.mjs': CIVET,
  'copie-map-coffee.mjs': COFFEE,
}

// balise, puis méthode et clé passée de chaque écriture que la garde refuse ; le témoin `neuf` de chaque balise à part
const parProto = (methodes: string[]) => methodes.map((m): [string, string] => [m, '__proto__'])
const REFUS: Record<string, [string, string][]> = {
  'mjs-copie-map-js':     [...parProto(['fill', 'with', 'toSpliced', 'concatListe', 'etale', 'pousse', 'pousseBoucle', 'pousseRappel', 'indice', 'pop', 'assign', 'cleCopie', 'cleDirecte', 'flatFill']), ['cleCopie', 'constructor'], ['cleDirecte', 'constructor'], ['ctorEcrit', '']],
  'mjs-copie-map-civet':  [...parProto(['fill', 'pousse', 'cle', 'mFill', 'mCle']), ['cle', 'constructor'], ['mCle', 'constructor']],
  'mjs-copie-map-coffee': [...parProto(['fill', 'pousse', 'cle', 'mFill', 'mCle']), ['cle', 'constructor'], ['mCle', 'constructor']],
}
const BALISES = Object.keys(REFUS)

async function construire(nom: string, sansEnveloppe: boolean, prod: boolean): Promise<string> {
  const root   = mjsTmp('copie-map-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [f, source] of Object.entries(FICHIERS)) writeFileSync(join(srcDir, f), source)
  const base: any = prod ? { sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle' } : { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
  const bundler = new Bundler(sansEnveloppe ? { ...base, proxy: false } : base)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.deepEqual(stats.errors.map((e: any) => e.message), [])
  if (prod) return readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '')
  const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  return files.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;\n'
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

// joue chaque écriture telle que compilée, `k` passé en argument ; rend les relevés et les fautes
async function jouer(code: string, prod: boolean): Promise<{ releves: string[], fautes: string[] }> {
  const window: any = new Window({ url: 'http://localhost/' })
  const avis: string[]    = []
  const releves: string[] = []
  const fautes: string[]  = []
  const cibles: [string, any][] = [['Object.prototype', window.Object.prototype], ['Object', window.Object], ['Array.prototype', window.Array.prototype], ['Array', window.Array]]
  try {
    window.eval(code)
    if (!prod) window.µ.warn = (m: string) => avis.push(String(m))
    window.document.body.innerHTML = BALISES.map((b) => `<${b}></${b}>`).join('')
    const q    = (b: string) => window.document.querySelector(b)
    const pret = () => BALISES.every((b) => q(b)?._shadow?.querySelector('.etat')?.textContent)
    const fin  = Date.now() + 5000
    while (!pret() && Date.now() < fin) await pause(10)
    assert.ok(pret(), 'les trois composants sont montés')
    for (const b of BALISES) {
      for (const [m, k, temoin] of [['neuf', '__proto__', true], ...REFUS[b]] as [string, string, boolean?][]) {
        const n = avis.length
        let rendu: unknown
        let leve = ''
        try {
          rendu = q(b)[m](k, 1)
        }
        catch (e: any) {
          leve = `${e?.name} : ${String(e?.message).slice(0, 60)}`
        }
        const pollues = cibles.filter(([, t]) => Object.prototype.hasOwnProperty.call(t, 'polluK')).map(([nom]) => nom)
        for (const [, t] of cibles) delete t.polluK
        const ligne = `${b} ${m} k=${k} : pollués=[${pollues.join(', ')}] avis=${avis.length - n} lève=${leve || '-'}${temoin ? ` rendu=${String(rendu)}` : ''}`
        releves.push(ligne)
        if (pollues.length || leve) fautes.push(ligne)
        else if (temoin && (rendu !== 1 || avis.length !== n)) fautes.push(`${ligne} (témoin : l'écriture doit passer, sans avertissement)`)
        else if (!temoin && !prod && avis.length === n) fautes.push(`${ligne} (refus sans avertissement)`)
        q(b).remettre()
      }
    }
  }
  finally {
    for (const [, t] of cibles) delete t.polluK
    await window.happyDOM.close()
  }
  return { releves, fautes }
}

describe('magasin $$ : l\'élément d\'une copie faite par map ou flatMap reste gardé, même fait d\'objets neufs — la copie peut être remplie d\'ailleurs', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [mode, sansEnveloppe, prod] of [['enveloppe, développement', false, false], ['proxy: false, développement', true, false], ['enveloppe, production', false, true], ['proxy: false, production', true, true]] as [string, boolean, boolean][]) {
    it(`${mode} : les 31 écritures refusées, aucune n'atteint Object.prototype, Object, Array.prototype ou Array ; le témoin écrit`, async () => {
      const code = await construire(mode.replace(/\W+/g, '-'), sansEnveloppe, prod)
      const { releves, fautes } = await jouer(code, prod)
      assert.equal(releves.length, 34, releves.join('\n'))
      assert.deepEqual(fautes, [], releves.join('\n'))
    })
  }
})
