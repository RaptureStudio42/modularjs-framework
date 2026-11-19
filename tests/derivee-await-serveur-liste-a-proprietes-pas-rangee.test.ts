// rendu serveur : une liste qui porte d'autres propriétés que ses éléments (`Object.assign([1, 2, 3], { page: 2 })`), ou dont le prototype
// n'est pas celui des listes (une sous-classe), ne revient pas identique de JSON — ni dans les valeurs citées (la clé), ni dans la
// réponse : rien n'est rangé, et le navigateur appelle ; une liste simple est rangée et reprise

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { servir, reprendre, appels } from './helpers/derivee-await-serveur.js'

const SOURCES: Record<string, string> = {
  'x-cle.mjs': `<script>
  f = (l) ->
    (globalThis.__appels ||= []).push('c:' + l.length + (if l.page then '+page' else '') + (if Object.getPrototypeOf(l) is Array.prototype then '' else '+sous'))
    Promise.resolve((if µ.server then 'S' else 'N') + l.length)
  $r = await f($l)
</script>
<i>{$r}</i>
`,
  'x-rep.mjs': `<script>
  g = (s) ->
    (globalThis.__appels ||= []).push('r:' + s)
    l = [1, 2]
    l.page = 2 if s is 'page'
    l = Object.setPrototypeOf(l, Object.create(Array.prototype)) if s is 'sous'
    Promise.resolve(l)
  $r = await g($sorte)
</script>
<i>{$r.length}|{$r.page}|{$r and Object.getPrototypeOf($r) is Array.prototype}</i>
`,
  'x-listes.mjs': `<script>
  $simple = [1, 2, 3]
  $page   = Object.assign([1, 2, 3], { page: 2 })
  $sous   = Object.setPrototypeOf([1, 2, 3], Object.create(Array.prototype))
</script>
<@x-cle class="c-simple" l={$simple}></@x-cle>
<@x-cle class="c-page" l={$page}></@x-cle>
<@x-cle class="c-sous" l={$sous}></@x-cle>
<@x-rep class="r-simple" sorte="simple"></@x-rep>
<@x-rep class="r-page" sorte="page"></@x-rep>
<@x-rep class="r-sous" sorte="sous"></@x-rep>
`
}

const racine = (e: any) => e && (e._shadow || e.shadowRoot)
// le texte de chaque composant de la page, par sa classe
function textes(w: any): Record<string, string> {
  const out: Record<string, string> = {}
  const fouille = (r: any) => r.querySelectorAll('*').forEach((e: any) => {
    if (e.localName === 'mjs-x-cle' || e.localName === 'mjs-x-rep') out[e.className] = racine(e)?.querySelector('i')?.textContent ?? '∅'
    if (racine(e)) fouille(racine(e))
  })
  fouille(w.document)
  return out
}

describe('dérivée qui attend — liste qui ne revient pas identique de JSON', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('liste à propriété en plus ou sous-classe : rien de rangé, le navigateur appelle', async () => {
    const { graine } = await servir('await-listes', SOURCES, 'mjs-x-listes')
    const rangees = Object.keys(graine ?? {}).sort()
    assert.equal(rangees.length, 2, 'la liste simple seule, dans la clé et dans la réponse — ' + JSON.stringify(graine))
    for (const g of rangees) assert.equal(graine[g].n, 1, g)
    const w = await reprendre('await-listes-nav', SOURCES, graine, '<mjs-x-listes mjs-ssr></mjs-x-listes>')
    const vu = textes(w)
    const faits = appels(w).sort()
    w.close()
    assert.deepEqual(faits, ['c:3+page', 'c:3+sous', 'r:page', 'r:sous'], 'la liste simple reprend, les autres appellent')
    assert.deepEqual(vu, { 'c-simple': 'S3', 'c-page': 'N3', 'c-sous': 'N3', 'r-simple': '2||true', 'r-page': '2|2|true', 'r-sous': '2||false' })
  })
})
