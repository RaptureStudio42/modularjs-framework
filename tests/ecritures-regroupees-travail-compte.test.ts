// Écritures de l'état moins chères et regroupées, le travail compté (happy-dom, composants construits) :
// - un `.forEach` écrit hors de toute boucle dont le rappel écrit l'état écrit le DOM une fois, à la sortie de l'appel, et
//   l'instruction qui suit lit le DOM final ;
// - une boucle d'un enfant qui écrit une prop liée à deux sens (`v=!{$x}`) n'envoie qu'un événement `mjs-bind:v`, à sa sortie :
//   juste après, la variable et le DOM du parent ont la valeur finale ;
// - une écriture d'un composant à 300 valeurs dérivées ne touche aucune de leurs fiches (aucun marquage) ; relue, une valeur
//   dérivée se recalcule une fois, et seulement si une variable du composant a changé depuis son dernier calcul ;
// - une écriture profonde d'un objet que nul autre composant ne tient ne fait pas avancer l'époque des liaisons ; tenu par
//   deux composants (prop d'un enfant, objet partagé), elle la fait avancer et l'autre composant suit ;
// - un gestionnaire d'événement n'est pas regroupé : le DOM relu juste après une écriture voit la valeur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const DERIVES = ['<script lang="js">', '$a = 0', ...Array.from({ length: 300 }, (_, i) => `$d${i} = $a + ${i}`), '</script>', '<p class="a">{$a}</p>'].join('\n')

const SOURCES: Record<string, string> = {
  'rl-fe': `<script>
$n = 0
@fe = (l) ->
  l.forEach (x) -> $n += x
  @@_shadow.querySelector('.n').textContent
</script>
<p class="n">{$n}</p>
`,
  'rl-enfant': `<script>
$v = 0
@remplir = (n) ->
  for i in [1..n]
    $v = i
  return
</script>
<p class="v">{$v}</p>
`,
  'rl-parent': `<script>
$x = 0
</script>
<@rl-enfant v=!{$x} />
<p class="x">{$x}</p>
`,
  'rl-derives': DERIVES,
  'rl-profond': `<script lang="js">
$o = { a: { b: { c: 0 } } }
@profond = function(n) { for (let i = 1; i <= n; i++) $o.a.b.c = i }
</script>
<p class="o">{$o.a.b.c}</p>
`,
  'rl-lecteur': `<script>
$data = null
</script>
<p class="d">{$data?.x}</p>
`,
  'rl-porteur': `<script>
$obj = {x: 1}
@changer = -> $obj.x = 2
</script>
<@rl-lecteur data={$obj} />
`,
  'rl-partage': `<script module>
PARTAGE = {n: 1}
</script>
<script>
$p = PARTAGE
@changer = -> $p.n = 5
@relire = -> $p = PARTAGE
</script>
<p class="n">{$p.n}</p>
`,
  'rl-clic': `<script>
$n = 0
clic = ->
  $n = 1
  window.lu.push @@_shadow.querySelector('.n').textContent
  $n = 2
  window.lu.push @@_shadow.querySelector('.n').textContent
</script>
<p class="n">{$n}</p>
<button @click={clic()}>b</button>
`,
}

describe('écritures regroupées hors des boucles, plancher d\'écriture et dérivées — le travail compté', function () {
  this.timeout(60000)
  let window: any, document: any
  before(async () => {
    const root = mjsTmp('ecritures-regroupees')
    const srcDir = join(root, 'src'), outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(SOURCES)) writeFileSync(join(srcDir, `${nom}.mjs`), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'b.js') })
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const core = files.find((f) => /^mjs_core-/.test(f))!
    const comps = Object.keys(SOURCES).map((nom) => files.find((f) => f.startsWith(`${nom}-`))!)
    window = new Window({ url: 'http://localhost/' })
    document = window.document
    window.eval(`${stripEsm(readFileSync(join(outDir, core), 'utf-8'))}\nglobalThis.µ = µ;\n${comps.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')}`)
  })
  after(async () => {
    await window?.happyDOM?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(nom: string, n = 1) {
    document.body.innerHTML = Array.from({ length: n }, () => `<mjs-${nom}></mjs-${nom}>`).join('')
    await sleep(60)
    return Array.from(document.body.children) as any[]
  }

  it('un `.forEach` hors boucle qui écrit 1 000 fois l\'état écrit le DOM une fois, et le DOM est à jour juste après', async () => {
    const [el] = await monter('rl-fe')
    const obs = new window.MutationObserver(() => {})
    obs.observe(el._shadow, { subtree: true, characterData: true, childList: true })
    const lu = el.fe(Array.from({ length: 1000 }, () => 1))
    const ecritures = obs.takeRecords().length
    obs.disconnect()
    assert.equal(lu, '1000', 'l\'instruction qui suit l\'appel lit le DOM final')
    assert.equal(ecritures, 1, `écritures du DOM pendant l'appel : ${ecritures}`)
  })

  it('une boucle de l\'enfant qui écrit 50 fois une prop liée à deux sens envoie un seul `mjs-bind`, le parent à jour juste après', async () => {
    const [parent] = await monter('rl-parent')
    const enfant = parent._shadow.querySelector('mjs-rl-enfant')
    let evenements = 0
    enfant.addEventListener('mjs-bind:v', () => { evenements++ })
    enfant.remplir(50)
    assert.equal(parent._state.x, 50, 'la variable du parent a la valeur finale juste après la boucle')
    assert.equal(parent._shadow.querySelector('.x').textContent, '50', 'le DOM du parent aussi')
    assert.equal(enfant._shadow.querySelector('.v').textContent, '50')
    assert.equal(evenements, 1, `événements mjs-bind:v : ${evenements}`)
    // hors boucle, chaque écriture remonte toujours tout de suite
    enfant._set('v', 7)
    assert.equal(parent._shadow.querySelector('.x').textContent, '7')
    assert.equal(evenements, 2)
  })

  it('une écriture d\'un composant à 300 valeurs dérivées ne marque aucune fiche ; une valeur relue se recalcule une fois', async () => {
    const [el] = await monter('rl-derives')
    let marquages = 0, calculs = 0, ecriture = false
    for (const k of el._mjs_computedKeys) {
      el._mjs_computeds[k] = new Proxy(el._mjs_computeds[k], {
        set(t: any, p: any, v: any) { if (ecriture) marquages++; t[p] = v; return true },
        get(t: any, p: any) { if (p === 'f') calculs++; return t[p] },
      })
    }
    ecriture = true
    el._set('a', 5)
    ecriture = false
    assert.equal(marquages, 0, `fiches de dérivées touchées par une écriture : ${marquages}`)
    assert.equal(el._state.d299, 304)
    assert.equal(el._state.d0, 5)
    const apres = calculs
    assert.equal(el._state.d299, 304)
    assert.equal(calculs, apres, 'relue sans écriture entre-temps : valeur gardée')
    // même valeur écrite : rien ne change, rien ne se recalcule
    el._set('a', 5)
    assert.equal(el._state.d299, 304)
    assert.equal(calculs, apres)
    // une écriture : la valeur relue se recalcule, une fois
    el._set('a', 6)
    assert.equal(el._state.d299, 305)
    assert.equal(el._state.d299, 305)
    assert.equal(calculs, apres + 1)
    assert.equal(el._shadow.querySelector('.a').textContent, '6')
  })

  it('écriture profonde d\'un objet tenu par un seul composant : l\'époque des liaisons n\'avance pas', async () => {
    const [el] = await monter('rl-profond')
    const bump = window.µ._mjs_bumpEpoch
    let avances = 0
    window.µ._mjs_bumpEpoch = function (o: any) { avances++; return bump(o) }
    try {
      el.profond(1000)
    }
    finally {
      window.µ._mjs_bumpEpoch = bump
    }
    assert.equal(el._shadow.querySelector('.o').textContent, '1000')
    assert.equal(avances, 0, `époques avancées : ${avances}`)
  })

  it('objet tenu par deux composants (prop d\'un enfant, objet partagé) : l\'époque avance et l\'autre composant suit', async () => {
    const [porteur] = await monter('rl-porteur')
    const lecteur = porteur._shadow.querySelector('mjs-rl-lecteur')
    assert.equal(lecteur._shadow.querySelector('.d').textContent, '1')
    porteur.changer()
    await sleep(10)
    assert.equal(lecteur._shadow.querySelector('.d').textContent, '2', 'l\'enfant suit l\'écriture profonde du parent')
    const [a, b] = await monter('rl-partage', 2)
    a.changer()
    assert.equal(a._shadow.querySelector('.n').textContent, '5')
    b.relire()
    await sleep(10)
    assert.equal(b._shadow.querySelector('.n').textContent, '5', 'l\'autre instance relit l\'objet partagé changé')
  })

  it('un gestionnaire d\'événement n\'est pas regroupé : le DOM relu juste après chaque écriture voit la valeur', async () => {
    const [el] = await monter('rl-clic')
    window.lu = []
    el._shadow.querySelector('button').click()
    assert.deepEqual(window.lu, ['1', '2'])
  })
})
