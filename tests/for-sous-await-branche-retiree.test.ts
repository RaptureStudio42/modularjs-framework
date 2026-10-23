// Un `{for}` dans la branche `{success}` d'un `{await}` se refait quand une variable du dehors lue par
// une ligne change (cf. for-sous-await-variable-externe). La liste refaite doit rester celle de la branche
// affichée : une branche remplacée (la promesse repart en attente) ne reçoit plus rien et ne lève aucune
// erreur quand la variable change, la branche revenue relit la valeur du moment, et deux `{await}` de la
// même page ne se répondent pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const PAGE = `<script>
  $p = Promise.resolve({items: [{id: 1, n: 'a'}, {id: 2, n: 'b'}]})
  $q = 0
</script>

<div class="host">
{await $p}{success d}{for x in d.items by id}<i class="x">{x.n}-{$q}</i>{end}{end}
</div>
`

const DEUX = `<script>
  $p = Promise.resolve([{id: 1, n: 'a'}])
  $r = Promise.resolve([{id: 1, n: 'b'}, {id: 2, n: 'c'}])
  $q = 0
  $s = 0
</script>

<div class="un">{await $p}{success d}{for x in d by id}<i class="x">{x.n}-{$q}</i>{end}{end}</div>
<div class="deux">{await $r}{success d}{for x in d by id}<i class="y">{x.n}-{$s}</i>{end}{end}</div>
`

describe('{for} sous {await} : la liste refaite est celle de la branche affichée', function () {
  this.timeout(60000)
  let window: any
  const erreurs: string[] = []

  before(async () => {
    const root   = mjsTmp('for-sous-await-retiree')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'liste-attente.mjs'), PAGE)
    writeFileSync(join(srcDir, 'deux-attentes.mjs'), DEUX)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.addEventListener('error', (e: any) => erreurs.push(String(e.error?.message ?? e.message)))
    window.console.error = (...a: unknown[]) => { erreurs.push(a.map(String).join(' ')) }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('la promesse repart en attente : la variable change sans erreur, la branche revenue relit la valeur du moment', async () => {
    window.document.body.innerHTML = '<mjs-liste-attente></mjs-liste-attente>'
    const c = window.document.querySelector('mjs-liste-attente')
    await attendre(() => (c._shadow?.querySelectorAll('.host > i.x').length ?? 0) === 2)
    await pause(40)
    // les lignes du bloc, pas celles du squelette que la page dessine pendant l'attente
    const lire = () => [...c._shadow.querySelectorAll('.host > i.x')].map((i: any) => i.textContent).join(',')
    assert.equal(lire(), 'a-0,b-0', 'montage')
    c._set('p', new Promise(() => {}))
    await pause(80)
    assert.equal(lire(), '', 'la branche en attente n\'a pas de ligne')
    const refaites: number[] = []
    const origine = c._mjs_updList
    c._mjs_updList = function (...args: unknown[]) { refaites.push(1); return origine.apply(this, args) }
    c._set('q', 7)
    await pause(80)
    assert.equal(lire(), '', 'la branche retirée ne reçoit rien')
    assert.equal(refaites.length, 0, 'la liste de la branche retirée n\'est pas refaite')
    delete c._mjs_updList
    assert.deepEqual(erreurs, [], 'aucune erreur à la mise à jour d\'une liste retirée')
    c._set('p', Promise.resolve({items: [{id: 3, n: 'z'}]}))
    await attendre(() => c._shadow.querySelectorAll('.host > i.x').length === 1)
    await pause(40)
    assert.equal(lire(), 'z-7', 'la branche revenue lit la valeur du moment')
    c._set('q', 8)
    await pause(60)
    assert.equal(lire(), 'z-8', 'et la suit')
    assert.deepEqual(erreurs, [])
  })

  it('deux {await} dans la page : chaque liste suit sa variable, pas celle de l\'autre', async () => {
    window.document.body.innerHTML = '<mjs-deux-attentes></mjs-deux-attentes>'
    const c = window.document.querySelector('mjs-deux-attentes')
    await attendre(() => (c._shadow?.querySelectorAll('i.x').length ?? 0) === 1 && (c._shadow?.querySelectorAll('i.y').length ?? 0) === 2)
    await pause(40)
    const lire = (classe: string) => [...c._shadow.querySelectorAll(`i.${classe}`)].map((i: any) => i.textContent).join(',')
    assert.equal(lire('x'), 'a-0')
    assert.equal(lire('y'), 'b-0,c-0')
    c._set('q', 1)
    await pause(60)
    assert.equal(lire('x'), 'a-1', 'la première suit $q')
    assert.equal(lire('y'), 'b-0,c-0', 'la seconde ne bouge pas')
    c._set('s', 2)
    await pause(60)
    assert.equal(lire('x'), 'a-1')
    assert.equal(lire('y'), 'b-2,c-2', 'la seconde suit $s')
    assert.deepEqual(erreurs, [])
  })
})
