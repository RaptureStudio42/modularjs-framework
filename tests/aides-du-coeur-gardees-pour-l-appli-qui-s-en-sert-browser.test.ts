// une appli qui se sert des aides que la production retire des autres les garde, et marche : la référence `:this` vidée quand le composant
// quitte la page, la case écrite sans rendu (µwrite), la classe filtrée que plusieurs lignes portent, la balise dynamique qui garde son
// gestionnaire en changeant de nom, l'appel et la suppression profonds, l'état lu comme une valeur — et, dans une appli à part où rien
// d'autre ne les nomme, les mêmes aides appelées après un `++` suivi d'une division, une autre barre oblique plus loin sur la ligne (le
// nom de l'aide suffit à la garder, où qu'il soit écrit). Une appli qui ne s'en sert pas marche
// sans elles : liste gardée par clé retournée puis mélangée, classe filtrée par la clé, écriture profonde, composant retiré de la page puis
// un autre posé. Chromium, Firefox et WebKit réels ; développement et production (vrai build en un seul fichier, non minifié : le test
// lit dans le texte du cœur ce qu'il porte)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

const SERVIE: Record<string, string> = {
  'carte-ref.mjs': `<script>
  el = null
  @vu = -> if el then 'la' else 'vide'
</script>
<b :this=!{el}>x</b>
`,
  'carte-ecrite.mjs': `<script>
  $n = 0
  @poser = (v) -> µwrite $n, v
  @lire = -> $n
</script>
<p class="n">{$n}</p>
`,
  'carte-groupes.mjs': `<script>
  $rows = [{id: 1, g: 'a'}, {id: 2, g: 'a'}, {id: 3, g: 'b'}]
  $choix = 'a'
  @choisir = (g) -> $choix = g
</script>
<ul>{for row in $rows by id}<li :class{$choix === row.g}="on">{row.id}</li>{end}</ul>
`,
  'carte-balise.mjs': `<script>
  $tag = 'section'
  $clics = 0
  @changer = -> $tag = 'article'
  @clic = -> $clics++
</script>
<@element $tag class="dyn" @click={@clic()}>x</@element>
<p class="c">{$clics}</p>
`,
  'carte-profonde.mjs': `<script>
  $l = [1]
  $o = {a: 1}
  $n = 1
  @ajouter = -> $l.push(2)
  @oter = -> delete $o.a
  @tout = -> Object.assign($, {n: 2})
</script>
<p class="l">{$l.length}</p><p class="a">{$o.a}</p><p class="n">{$n}</p>
`
}
const PIEGE: Record<string, string> = {
  'carte-compte.mjs': `<script lang="js">
  $liste = [1];
  $objet = { a: 1, b: 2 };
  $n     = 0;
  $total = 0;
  $bilan = '';
  let compte = 0;
  const pousser   = () => { const m = compte++ / 2; $liste.push(m); $total = m / 4; };
  const supprimer = () => { const m = compte++ / 2; delete $objet.a; $total = m / 4; };
  const valeur    = () => { const m = compte++ / 2; Object.assign($, { n: 7 }); $total = m / 4; };
  const ecrire    = () => { const m = compte++ / 2; µwrite($n, 41); $total = m / 4; };
  const bilan     = () => { $bilan = JSON.stringify([$liste, $objet, $n, $total]); };
</script>
<button class="p" @click={pousser()}>p</button><button class="s" @click={supprimer()}>s</button><button class="v" @click={valeur()}>v</button><button class="e" @click={ecrire()}>e</button><button class="b" @click={bilan()}>b</button>
<p class="bilan">{$bilan}</p>
`
}

const SOBRE: Record<string, string> = {
  'carte-liste.mjs': `<script>
  $rows = [{id: 1, n: 'a'}, {id: 2, n: 'b'}, {id: 3, n: 'c'}, {id: 4, n: 'd'}]
  $choix = 1
  $o = {a: 1}
  @retourner = -> $rows = [...$rows].reverse()
  @melanger = -> $rows = [3, 1, 4, 2].map((i) -> $rows.find((r) -> r.id === i))
  @choisir = (id) -> $choix = id
  @changer = -> $o.a = 2
</script>
<ul>{for row in $rows by id}<li :class{$choix === row.id}="on">{row.n}</li>{end}</ul>
<p class="a">{$o.a}</p>
`
}

async function sceneServie() {
  const pause      = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const zone: any  = document.getElementById('zone')
  const ombre      = (x: any) => x._shadow || x.shadowRoot || x
  const texte      = (x: any, sel: string) => { const n = ombre(x).querySelector(sel); return n ? n.textContent : null }
  zone.innerHTML   = '<mjs-carte-ref></mjs-carte-ref><mjs-carte-ecrite></mjs-carte-ecrite><mjs-carte-groupes></mjs-carte-groupes><mjs-carte-balise></mjs-carte-balise><mjs-carte-profonde></mjs-carte-profonde>'
  const [ref, ecrite, groupes, balise, profonde]: any[] = [...zone.children]
  const pret = () => typeof ref.vu === 'function' && ref.vu() === 'la' && typeof ecrite.lire === 'function' && ombre(groupes).querySelectorAll('li').length === 3 && ombre(balise).querySelector('.dyn') && typeof profonde.tout === 'function'
  for (let i = 0; i < 150 && !pret(); i++) await pause(20)
  await pause(40)
  const r: Record<string, unknown[]> = {}
  // la référence se vide quand le composant quitte la page pour de bon
  r.reference = [ref.vu()]
  ref.remove()
  await pause(60)
  r.reference.push(ref.vu())
  // la case écrite sans rendu : l'écran garde l'ancienne valeur, le code lit la neuve
  ecrite.poser(5)
  await pause(40)
  r.sansRendu = [texte(ecrite, '.n'), ecrite.lire()]
  // deux lignes portent la valeur choisie, puis une, puis deux
  const allumes = () => [...ombre(groupes).querySelectorAll('li.on')].map((n: any) => n.textContent).join('')
  r.groupes = [allumes()]
  groupes.choisir('b')
  await pause(40)
  r.groupes.push(allumes())
  groupes.choisir('a')
  await pause(40)
  r.groupes.push(allumes())
  // la balise change de nom : la neuve répond encore au clic
  ombre(balise).querySelector('.dyn').click()
  await pause(40)
  r.balise = [ombre(balise).querySelector('.dyn').tagName, texte(balise, '.c')]
  balise.changer()
  await pause(60)
  ombre(balise).querySelector('.dyn').click()
  await pause(40)
  r.balise.push(ombre(balise).querySelector('.dyn').tagName, texte(balise, '.c'))
  // appel profond, suppression profonde, état lu comme une valeur
  profonde.ajouter()
  profonde.oter()
  profonde.tout()
  await pause(60)
  r.profonde = [texte(profonde, '.l'), texte(profonde, '.a'), texte(profonde, '.n')]
  return r
}
async function scenePiege() {
  const pause       = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const zone: any   = document.getElementById('zone')
  const ombre       = (x: any) => x._shadow || x.shadowRoot || x
  zone.innerHTML    = '<mjs-carte-compte></mjs-carte-compte>'
  const compte: any = zone.firstElementChild
  for (let i = 0; i < 150 && !ombre(compte).querySelector('.b'); i++) await pause(20)
  await pause(40)
  // appel profond, suppression profonde, état lu comme une valeur, case écrite sans rendu, puis le bilan
  for (const bouton of ['.p', '.s', '.v', '.e', '.b']) ombre(compte).querySelector(bouton).click()
  await pause(60)
  return { bilan: ombre(compte).querySelector('.bilan').textContent }
}

async function sceneSobre() {
  const pause      = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const zone: any  = document.getElementById('zone')
  const ombre      = (x: any) => x._shadow || x.shadowRoot || x
  const ordre      = (x: any) => [...ombre(x).querySelectorAll('li')].map((n: any) => n.textContent).join('')
  const allume     = (x: any) => [...ombre(x).querySelectorAll('li.on')].map((n: any) => n.textContent).join('')
  zone.innerHTML   = '<mjs-carte-liste></mjs-carte-liste>'
  const liste: any = zone.firstElementChild
  for (let i = 0; i < 150 && !(typeof liste.melanger === 'function' && ombre(liste).querySelectorAll('li').length === 4); i++) await pause(20)
  await pause(40)
  const r: Record<string, unknown> = {}
  r.depart = [ordre(liste), allume(liste), ombre(liste).querySelector('.a').textContent]
  liste.retourner()
  await pause(40)
  r.retournee = ordre(liste)
  liste.melanger()
  await pause(40)
  r.melangee = ordre(liste)
  liste.choisir(3)
  liste.changer()
  await pause(40)
  r.choisie = [allume(liste), ombre(liste).querySelector('.a').textContent]
  // le composant quitte la page sans rien avoir à défaire, un autre s'y pose
  liste.remove()
  await pause(60)
  zone.innerHTML = '<mjs-carte-liste></mjs-carte-liste>'
  const neuve: any = zone.firstElementChild
  for (let i = 0; i < 150 && ombre(neuve).querySelectorAll('li').length !== 4; i++) await pause(20)
  r.neuve = [ordre(neuve), allume(neuve)]
  return r
}

const ATTENDU_SERVIE = {
  reference: ['la', 'vide'],
  sansRendu: ['0', 5],
  groupes:   ['12', '3', '12'],
  balise:    ['SECTION', '1', 'ARTICLE', '2'],
  profonde:  ['2', '', '2']
}
const ATTENDU_PIEGE = { bilan: '[[1,0],{"b":2},41,0.375]' }
const ATTENDU_SOBRE = {
  depart:    ['abcd', 'a', '1'],
  retournee: 'dcba',
  melangee:  'cadb',
  choisie:   ['c', '2'],
  neuve:     ['abcd', 'a']
}

describe('aides du cœur retirées de la production des applis qui ne s\'en servent pas : qui s\'en sert les garde et marche, qui ne s\'en sert pas marche sans elles', function () {
  this.timeout(240000)
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const [nom, sources] of [['servie', SERVIE], ['sobre', SOBRE], ['piege', PIEGE]] as const) {
      for (const env of ['dev', 'prod'] as const) {
        const root   = mjsTmp('aides-gardees-' + nom + '-' + env)
        const srcDir = join(root, 'src')
        const outDir = join(root, 'out')
        mkdirSync(srcDir, { recursive: true })
        for (const [f, s] of Object.entries(sources)) writeFileSync(join(srcDir, f), s)
        const prod      = env === 'prod'
        const opts: any = { sourceDir: srcDir, outputDir: outDir, manifestPath: join(prod ? outDir : root, 'bundle.js'), lint: { a11y: false } }
        if (prod) Object.assign(opts, { env: 'prod', js: 'bundle', minify: false, runtime: 'core' })
        const bundler = new Bundler(opts)
        const stats   = await bundler.compile()
        await bundler.close()
        assert.equal(stats.errors.length, 0, stats.errors.map((x: any) => x.message).join('\n'))
        if (prod) {
          scripts[nom + '-' + env] = readFileSync(join(outDir, 'bundle.js'), 'utf-8').replace(/import\.meta\.url/g, "'http://localhost/'").replace(/export\s*\{[^}]*\}\s*;?/g, '') + '\nglobalThis.µ = µ;'
          continue
        }
        const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
        const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
        scripts[nom + '-' + env] = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      }
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('production : l\'appli qui s\'en sert porte chaque aide, l\'appli sobre n\'en porte aucune', () => {
    const portes = [/µ\._mjs_evCopy = function/, /µ\._mjs_rawWrite = function/, /µ\._mjs_filtPut = function/, /µ\._mjs_deepCall = function/, /µ\._mjs_deepDelete = function/, /µ\._mjs_makeDeepProxy = function/, /if \(this\._mjs_attachments\) \{/]
    for (const porte of portes) {
      assert.match(scripts['servie-prod'], porte)
      assert.doesNotMatch(scripts['sobre-prod'], porte)
    }
    assert.match(scripts['sobre-prod'], /µ\._mjs_lis = function/, 'l\'appli sobre a une liste : la plus longue suite croissante y reste')
    assert.match(scripts['sobre-prod'], /µ\._mjs_deepSet = function/, 'l\'appli sobre écrit en profondeur : l\'écriture profonde y reste')
  })

  it('production : l\'appli qui appelle les aides après un `++` suivi d\'une division les porte', () => {
    assert.match(scripts['piege-prod'], /compte\+\+ \/ 2;/, 'garde muette : la division qui suit le `++` est dans le code de l\'appli')
    assert.match(scripts['piege-prod'], /µ\._mjs_deepCall\(_mjsThis/, 'garde muette : le code de l\'appli appelle l\'aide')
    for (const porte of [/µ\._mjs_deepCall = function/, /µ\._mjs_deepDelete = function/, /µ\._mjs_makeDeepProxy = function/, /µ\._mjs_rawWrite = function/]) assert.match(scripts['piege-prod'], porte)
  })

  for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
    for (const env of ['dev', 'prod'] as const) {
      for (const [nom, scene, attendu] of [['servie', sceneServie, ATTENDU_SERVIE], ['sobre', sceneSobre, ATTENDU_SOBRE], ['piege', scenePiege, ATTENDU_PIEGE]] as const) {
        it(`${moteur}, ${env}, appli ${nom} : l'écran et les valeurs sont ceux attendus, sans erreur`, async function () {
          const playwright: any = await import('playwright')
          if (!existsSync(playwright[moteur].executablePath())) this.skip()
          const navigateur = await playwright[moteur].launch()
          try {
            const page = await navigateur.newPage()
            const erreurs: string[] = []
            page.on('pageerror', (x: any) => erreurs.push(x.message))
            page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') erreurs.push(m.text().slice(0, 200)) })
            await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="zone"></div><script>${scripts[nom + '-' + env]}</script></body></html>`, { waitUntil: 'load' })
            const vu = await page.evaluate(scene)
            assert.deepEqual(vu, attendu)
            assert.deepEqual(erreurs, [])
          }
          finally {
            await navigateur.close()
          }
        })
      }
    }
  }
})
