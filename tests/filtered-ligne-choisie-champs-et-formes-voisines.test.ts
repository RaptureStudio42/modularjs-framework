// dispatch filtré d'une ligne de {for} (`{$sel is x.id ? … : …}`) : à chaque geste, chaque ligne montre sa valeur — objet muté en place,
// tableau poussé, variable comparée dérivée, deux liaisons filtrées sur la même ligne, branche qui lit la variable comparée, champ de
// saisie et case cochée : l'ancienne ligne choisie se vide (un `value` ou un `checked` écrit en propriété ne part pas avec l'attribut)
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCE = `<script>
  $sel  = 1
  $t    = 'A'
  $coche = true
  $o    = {nom: 'o1'}
  $arr  = [1, 2]
  $base = 0
  $s    = $base + 1
  $l    = [{id: 1}, {id: 2}, {id: 3}]
  @renommer = (v)-> $o.nom = v
  @pousser = -> $arr.push(9)
  @remplacerO = (v)-> $o = {nom: v}
  @texte = (v)-> $t = v
  @choisir = (n)-> $sel = n
  @decaler = (n)-> $base = n
</script>
<ul class="a">{for x in $l by id}<li title={$sel is x.id ? $o.nom : 'c'}>{x.id}</li>{end}</ul>
<ul class="b">{for x in $l by id}<li title={$sel is x.id ? 'n' + $arr.length : 'c'}>{x.id}</li>{end}</ul>
<ul class="c">{for x in $l by id}<li title={$s is x.id ? $t : 'c'}>{x.id}</li>{end}</ul>
<ul class="d">{for x in $l by id}<li title={$sel is x.id ? $t : 'c'} data-x={$sel is x.id ? $o.nom : 'n'}>{x.id}</li>{end}</ul>
<ul class="e">{for x in $l by id}<li title={$sel is x.id ? 'n' + $sel : 'c'}>{x.id}</li>{end}</ul>
<ul class="f">{for x in $l by id}<li><input value={$sel is x.id ? $t : ''}></li>{end}</ul>
<ul class="g">{for x in $l by id}<li><input value={$sel is x.id ? 'oui' : ''}></li>{end}</ul>
<ul class="h">{for x in $l by id}<li><input value={$sel is x.id ? $t : 'non'}></li>{end}</ul>
<ul class="k">{for x in $l by id}<li><input type="checkbox" checked={$sel is x.id ? $coche : ''}></li>{end}</ul>
<p class="pret">ok</p>
`
type Etat = { sel: number, t: string, nom: string, n: number, base: number }
const ETAPES: [string, (el: any) => void, (e: Etat) => void][] = [
  ['renommer("o2")', el => el.renommer('o2'), e => { e.nom = 'o2' }],
  ['pousser()', el => el.pousser(), e => { e.n++ }],
  ['remplacerO("o3")', el => el.remplacerO('o3'), e => { e.nom = 'o3' }],
  ['texte("B")', el => el.texte('B'), e => { e.t = 'B' }],
  ['choisir(2)', el => el.choisir(2), e => { e.sel = 2 }],
  ['decaler(1)', el => el.decaler(1), e => { e.base = 1 }],
  ['texte("C")', el => el.texte('C'), e => { e.t = 'C' }],
  ['renommer("o4")', el => el.renommer('o4'), e => { e.nom = 'o4' }],
  ['pousser()', el => el.pousser(), e => { e.n++ }],
  ['decaler(2)', el => el.decaler(2), e => { e.base = 2 }],
  ['texte("D")', el => el.texte('D'), e => { e.t = 'D' }],
]
const attendu = (e: Etat): Record<string, string[]> => {
  const ids = [1, 2, 3]
  const ch  = (id: number, v: string, sinon: string) => e.sel === id ? v : sinon
  return {
    a: ids.map(id => `${id}:${ch(id, e.nom, 'c')}`),
    b: ids.map(id => `${id}:${ch(id, 'n' + e.n, 'c')}`),
    c: ids.map(id => `${id}:${e.base + 1 === id ? e.t : 'c'}`),
    d: ids.map(id => `${id}:${ch(id, e.t, 'c')}|${ch(id, e.nom, 'n')}`),
    e: ids.map(id => `${id}:${ch(id, 'n' + e.sel, 'c')}`),
    f: ids.map(id => `:${ch(id, e.t, '')}`),
    g: ids.map(id => `:${ch(id, 'oui', '')}`),
    h: ids.map(id => `:${ch(id, e.t, 'non')}`),
    k: ids.map(id => ':' + (e.sel === id)),
  }
}
const stripEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '').replace(/\bexport\s+default\s+/g, '').replace(/\bexport\s+/g, '').replace(/import\.meta\.url/g, "'http://localhost/'")
const pause    = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

describe('dispatch filtré d\'une ligne de {for} : champs, cases cochées et formes voisines', function () {
  this.timeout(120000)
  after(async () => {
    await terminateSharedWorkerPool()
  })
  it('chaque geste : la valeur attendue', async function () {
    const root   = mjsTmp('filtre-champs')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'zq.mjs'), SOURCE)
    const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') }
    const stats = await new Bundler(opts).compile()
    assert.equal(stats.errors.length, 0, stats.errors.map(e => e.message).join('\n'))
    const files = readdirSync(outDir)
    const core  = stripEsm(readFileSync(join(outDir, files.find(f => /^mjs_core-/.test(f))!), 'utf-8'))
    const comp  = stripEsm(readFileSync(join(outDir, files.find(f => /^zq-.*\.js$/.test(f))!), 'utf-8'))
    const win: any = new Window({ url: 'http://localhost/' })
    const ecarts: string[] = []
    try {
      win.eval(`${core}\nglobalThis.µ = µ;\n${comp}`)
      win.document.body.innerHTML = '<mjs-zq></mjs-zq>'
      const el: any = win.document.body.firstElementChild
      await pause(150)
      const lire = (): Record<string, string[]> => {
        const sh  = el._shadow
        const out: Record<string, string[]> = {}
        for (const cl of ['a', 'b', 'c', 'd', 'e']) out[cl] = Array.from(sh.querySelectorAll('.' + cl + ' li')).map((li: any) => li.textContent.trim() + ':' + (li.getAttribute('title') ?? '-') + (cl === 'd' ? '|' + (li.getAttribute('data-x') ?? '-') : ''))
        for (const cl of ['f', 'g', 'h']) out[cl] = Array.from(sh.querySelectorAll('.' + cl + ' input')).map((i: any) => ':' + i.value)
        out.k = Array.from(sh.querySelectorAll('.k input')).map((i: any) => ':' + i.checked)
        return out
      }
      const e: Etat = { sel: 1, t: 'A', nom: 'o1', n: 2, base: 0 }
      const comparer = (etape: string) => {
        const obs = lire()
        const att = attendu(e)
        for (const cl of Object.keys(att)) if (JSON.stringify(obs[cl]) !== JSON.stringify(att[cl])) ecarts.push(`${etape} | liste ${cl} : attendu ${JSON.stringify(att[cl])}, lu ${JSON.stringify(obs[cl])}`)
      }
      comparer('départ')
      for (const [quoi, geste, effet] of ETAPES) {
        geste(el)
        effet(e)
        await pause(100)
        comparer(quoi)
      }
    }
    finally {
      win.close?.()
    }
    assert.deepEqual(ecarts, [])
  })
})
