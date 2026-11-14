// Stores — la variable d'un {for} de racine dont la ligne est pure (texte, `{f.x}`, balises natives, événements sans modificateur)
// écrit par le magasin, exactement comme la même écriture par le chemin du store (`$$flux[1].n = …`) : sur un store typé, la règle
// du champ s'applique (refus avec le même message et valeur d'avant gardée, ou valeur corrigée) ; la ligne, un autre bloc du composant
// qui lit le store et un autre composant abonné montrent ce que tient le magasin. Formes : `=`, `++`, `+=`, `push` sur un champ liste, champ profond
// `f.a.b = …`, sur un store typé et sur un store sans type. La ligne reste pure : aucun indice posé sur ses balises

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

// écriture jouée sur la ligne 1 (bouton `v-…` par la variable de boucle, `s-…` par le chemin du store), puis la ligne 1 attendue
// dans le store typé (null : refusée, la valeur d'avant reste, avec un message ; une valeur hors règle qui se corrige est corrigée)
// et dans le store sans type
const ECRITURES: Array<[string, string, string | null, string]> = [
  ['egal', 'n = 7', '{"n":7,"tags":[],"a":{"b":1}}', '{"n":7,"tags":[],"a":{"b":1}}'],
  ['incr', 'n++', '{"n":2,"tags":[],"a":{"b":1}}', '{"n":2,"tags":[],"a":{"b":1}}'],
  ['ajout', 'n += 2', '{"n":3,"tags":[],"a":{"b":1}}', '{"n":3,"tags":[],"a":{"b":1}}'],
  ['pousse', "tags.push('x')", '{"n":1,"tags":["x"],"a":{"b":1}}', '{"n":1,"tags":["x"],"a":{"b":1}}'],
  ['profond', 'a.b = 4', '{"n":1,"tags":[],"a":{"b":4}}', '{"n":1,"tags":[],"a":{"b":4}}'],
  ['texte', "n = 'zz'", null, '{"n":"zz","tags":[],"a":{"b":1}}'],
  ['borne', 'n += 500', '{"n":100,"tags":[],"a":{"b":1}}', '{"n":501,"tags":[],"a":{"b":1}}'],
  ['nombre', 'tags.push(3)', '{"n":1,"tags":["3"],"a":{"b":1}}', '{"n":1,"tags":[3],"a":{"b":1}}'],
  ['texteprofond', "a.b = 'zz'", null, '{"n":1,"tags":[],"a":{"b":"zz"}}'],
]

const DEPART = '[{ n: 0, tags: [], a: { b: 0 } }, { n: 1, tags: [], a: { b: 1 } }]'

const boucle = (cle: string) => [
  `{for f in $$${cle}}`,
  '<li class="f"><span class="v">{f.n}/{f.tags.length}/{f.a.b}</span>',
  ...ECRITURES.map(([nom, ecrit]) => `<button class="v-${nom}" @click={f.${ecrit}}>v</button><button class="s-${nom}" @click={$$${cle}[1].${ecrit}}>s</button>`),
  '</li>',
  '{end}',
]

// une liste d'objets passe par un type nommé, rangé dans un fichier *.types.mjs
const SOURCES: Record<string, string> = {
  'flux.types.mjs': ['<types>', '  Flux', '    n     int 0..100', '    tags  string[]', '    a', '      b  int 0..100', '</types>', ''].join('\n'),
  'typee.mjs': ['<vars>', '  $$flux  Flux[]', '</vars>', '', '<script>', `$$flux = ${DEPART}`, '</script>', '', '<ul>', ...boucle('flux'), '</ul>', '<p class="autre">{JSON.stringify($$flux)}</p>'].join('\n'),
  'libre.mjs': ['<script>', `$$libre = ${DEPART}`, '</script>', '', '<ul>', ...boucle('libre'), '</ul>', '<p class="autre">{JSON.stringify($$libre)}</p>'].join('\n'),
  'abonne.mjs': '<p class="a">{JSON.stringify($$flux)}#{JSON.stringify($$libre)}</p>',
}

let code = ''
const compiles: Record<string, string> = {}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Releve { brut: string, ligne: string, autre: string, abonne: string, messages: string[] }

// monte les trois composants, clique `bouton` sur la ligne 1 de `balise` (aucun clic sans bouton) puis relève le magasin, la
// ligne, l'autre bloc du composant, l'abonné et les messages
async function jouer(balise: string, cle: string, bouton: string | null): Promise<Releve> {
  const window: any = new Window({ url: 'http://localhost/' })
  const messages: string[] = []
  window.structuredClone = structuredClone
  window.eval(`${code}\nglobalThis.µ = µ;`)
  window.µ._typesMode = 'warn'
  window.µ.warn = (m: string) => messages.push(m)
  window.document.body.innerHTML = '<mjs-typee></mjs-typee><mjs-libre></mjs-libre><mjs-abonne></mjs-abonne>'
  const comp = window.document.querySelector(balise)
  const fin  = Date.now() + 5000
  while (Date.now() < fin && comp._shadow?.querySelectorAll('.f').length !== 2) await pause(10)
  if (bouton) comp._shadow.querySelectorAll('.f')[1].querySelector('.' + bouton).dispatchEvent(new window.Event('click', { bubbles: true }))
  await pause(60)
  const r: Releve = {
    brut:     JSON.stringify(window.µ._mjs_storeRaw[cle]),
    ligne:    comp._shadow.querySelectorAll('.f .v')[1].textContent,
    autre:    comp._shadow.querySelector('.autre').textContent,
    abonne:   window.document.querySelector('mjs-abonne')._shadow.querySelector('.a').textContent,
    messages: messages.slice(),
  }
  window.close?.()
  return r
}

describe('stores — variable d’un {for} en ligne pure : l’écriture passe par le magasin, comme par le chemin du store', function() {
  this.timeout(60000)

  before(async function() {
    this.timeout(120000)
    const root   = mjsTmp('store-ligne-pure-ecrit')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [f, s] of Object.entries(SOURCES)) writeFileSync(join(srcDir, f), s)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), env: 'dev' } as any)
    const stats   = await bundler.compile()
    assert.deepEqual(stats.errors.map((e: any) => e.message), [])
    await bundler.close()
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b))
    for (const f of files) compiles[f] = readFileSync(join(outDir, f), 'utf-8')
    code = files.map((f) => stripEsm(compiles[f], { bridgeCore: true })).join('\n')
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('la ligne reste pure : aucun indice posé sur ses balises, le gestionnaire lit l’entrée de la ligne', () => {
    for (const nom of ['typee', 'libre']) {
      const f = Object.keys(compiles).find((x) => x.startsWith(nom + '-'))
      assert.ok(f, `${nom} : composant construit`)
      assert.ok(!/data-mjs-idx-0|_mjs_nIdx/.test(compiles[f]), `${nom} : aucun indice posé sur les balises de la ligne`)
      assert.ok(/_mjs_en\b/.test(compiles[f]), `${nom} : le gestionnaire lit l’entrée de la ligne`)
    }
  })

  for (const [balise, cle, type] of [['mjs-typee', 'flux', true], ['mjs-libre', 'libre', false]] as const) {
    for (const [nom, ecrit, attType, attLibre] of ECRITURES) {
      const attendu = type ? attType : attLibre
      it(`${type ? 'store typé' : 'store sans type'} : f.${ecrit} ${attendu === null ? 'est refusé' : 's’écrit'} comme $$${cle}[1].${ecrit}, la ligne, un autre bloc et l’abonné le montrent`, async () => {
        const depart = await jouer(balise, cle, null)
        const parF   = await jouer(balise, cle, 'v-' + nom)
        const parS   = await jouer(balise, cle, 's-' + nom)
        assert.deepEqual(parF, parS)
        // la ligne, l'autre bloc et l'abonné montrent ce que tient le magasin
        const l = JSON.parse(parF.brut)[1]
        assert.equal(parF.ligne, `${l.n}/${l.tags.length}/${l.a.b}`)
        assert.equal(parF.autre, parF.brut)
        assert.ok(parF.abonne.includes(parF.brut), parF.abonne)
        if (attendu === null) {
          assert.equal(parF.brut, depart.brut)
          assert.ok(parF.messages.some((m) => m.includes(`$$${cle}[1].`) && m.includes('refuse')), parF.messages.join(' | '))
        }
        else assert.equal(JSON.stringify(l), attendu)
      })
    }
  }
})
