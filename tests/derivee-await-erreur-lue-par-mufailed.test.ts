// l'erreur d'une valeur dérivée qui attend : la valeur d'avant reste à l'écran, `µfailed($resultats)` rend l'erreur (gabarit et
// script), la réponse juste suivante l'efface. `µfailed (err, reset)->` reste la frontière d'erreur, `µerror('…', x)` reste la
// fonction du journal. Une erreur que rien ne lit va à la console d'erreurs (µ.error) ; quoi écrire est dit une fois.
// Méthode : le vrai Bundler (développement), happy-dom, un faux `fetch` qui ne répond que sur ordre du test

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { construire, monter, repondre, texte, pause } from './helpers/derivee-await-banc.js'

const LU = `<script>
  $q         = ''
  rechercher = (q) -> fetch("/api/s-#{q}").then((r) -> r.json())
  $resultats = await rechercher($q)
  @chercher  = (q) -> $q = q
  @lire      = -> µfailed($resultats)?.message
  @journal   = -> µerror('journal', $resultats)
  µfailed (err, reset)->
    "<p>repli</p>"
</script>
<ul>{for r in ($resultats or []) by id}<li>{r.pseudo}</li>{end}</ul><b class="err">{µfailed($resultats)?.message}</b>
`
const MUET = `<script>
  $q         = ''
  rechercher = (q) -> fetch("/api/m-#{q}").then((r) -> r.json())
  $resultats = await rechercher($q)
  @chercher  = (q) -> $q = q
</script>
<ul>{for r in ($resultats or []) by id}<li>{r.pseudo}</li>{end}</ul>
`
const liste = (el: any) => Array.from(el._shadow.querySelectorAll('li')).map((l: any) => l.textContent.trim()).join(',')

describe('dérivée qui attend — l\'erreur lue par µfailed($x)', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('µfailed($x) est lu, pas pris pour la frontière d\'erreur ; µfailed (err, reset)-> et µerror(\'…\', x) gardent leur sens', async () => {
    const { unites } = await construire('await-failed-compile', { 'lu.mjs': LU })
    assert.match(unites, /_mjs_awFailed\(_mjsThis, 'resultats'\)/, 'µfailed($resultats) lit l\'erreur de la valeur qui attend')
    assert.match(unites, /_mjs_hook\(\s*'failed'/, 'µfailed (err, reset)-> reste la frontière d\'erreur')
    assert.match(unites, /µ\.error\('journal', \$\.resultats\)/, 'µerror(\'…\', x) reste la fonction du journal')
    assert.doesNotMatch(unites, /_mjs_awError/, 'µerror n\'est jamais réécrit')
  })

  it('l\'erreur se lit, la valeur d\'avant reste ; la réponse juste suivante l\'efface ; rien dans la console', async () => {
    const w  = await monter('await-failed-lu', { 'lu.mjs': LU }, '<mjs-lu></mjs-lu>')
    const el = w.document.querySelector('mjs-lu')
    await repondre(w, '/api/s-', [{ id: 1, pseudo: 'Ann' }])
    assert.equal(liste(el), 'Ann')
    assert.equal(texte(el, '.err'), '')
    el.chercher('x')
    await pause(60)
    await repondre(w, '/api/s-x', 'serveur en panne', true)
    assert.equal(texte(el, '.err'), 'serveur en panne', 'µfailed($resultats) rend l\'erreur')
    assert.equal(el.lire(), 'serveur en panne', 'lue aussi dans le script')
    assert.equal(liste(el), 'Ann', 'la valeur d\'avant reste à l\'écran')
    el.chercher('y')
    await pause(60)
    await repondre(w, '/api/s-y', [{ id: 3, pseudo: 'Yan' }])
    assert.equal(texte(el, '.err'), '', 'la réponse suivante efface l\'erreur')
    assert.equal(el.lire(), undefined)
    assert.equal(liste(el), 'Yan')
    el.journal()
    assert.equal(w.__erreurs.length, 1, 'µerror(\'…\', x) écrit au journal')
    assert.match(w.__erreurs[0], /^journal /)
    assert.deepEqual([...w.__avis], [], 'l\'erreur est lue : aucun message')
    w.close()
  })

  it('une erreur que rien ne lit va à la console d\'erreurs ; quoi écrire est dit une fois', async () => {
    const w  = await monter('await-failed-muet', { 'muet.mjs': MUET }, '<mjs-muet></mjs-muet>')
    const el = w.document.querySelector('mjs-muet')
    await repondre(w, '/api/m-', [{ id: 1, pseudo: 'Ann' }])
    el.chercher('x')
    await pause(60)
    await repondre(w, '/api/m-x', 'serveur en panne', true)
    assert.equal(liste(el), 'Ann', 'la valeur d\'avant reste')
    assert.equal(w.__erreurs.length, 1, 'un message — ' + w.__erreurs.join(' | '))
    assert.match(w.__erreurs[0], /\$resultats/)
    assert.match(w.__erreurs[0], /µfailed\(\$resultats\)/)
    assert.match(w.__erreurs[0], /serveur en panne/)
    el.chercher('z')
    await pause(60)
    await repondre(w, '/api/m-z', 'encore', true)
    assert.equal(w.__erreurs.length, 2, 'chaque échec va à la console d\'erreurs')
    assert.doesNotMatch(w.__erreurs[1], /µfailed/, 'quoi écrire est dit une fois par composant et par valeur')
    w.close()
  })
  it('une dérivée qui lit µfailed($x) ou µpending($x) se refait quand ils changent', async () => {
    const src = `<script>\n  $q = ''\n  rechercher = (q) -> fetch("/api/d-#{q}").then((r) -> r.json())\n  $resultats = await rechercher($q)\n  $msg = (µfailed($resultats)?.message) or 'aucune'\n  $occupe = µpending($resultats)\n  @chercher = (q) -> $q = q\n</script>\n<b class="msg">{$msg}</b><i class="occ">{$occupe}</i>\n`
    const w  = await monter('await-failed-derivee', { 'der.mjs': src }, '<mjs-der></mjs-der>')
    const el = w.document.querySelector('mjs-der')
    const vu = () => texte(el, '.msg') + '|' + texte(el, '.occ')
    assert.equal(vu(), 'aucune|true', 'au départ : en attente')
    await repondre(w, '/api/d-', [1])
    assert.equal(vu(), 'aucune|false')
    el.chercher('x')
    await pause(60)
    assert.equal(vu(), 'aucune|true', 'une nouvelle demande : $occupe le dit')
    await repondre(w, '/api/d-x', 'panne', true)
    assert.equal(vu(), 'panne|false', 'l\'échec : $msg le dit')
    el.chercher('y')
    await pause(60)
    await repondre(w, '/api/d-y', [2])
    assert.equal(vu(), 'aucune|false', 'la réponse suivante efface l\'erreur')
    w.close()
  })

  const MAL = (ligne: string, gabarit: string) => `<script>\n  $q = ''\n  f = (q) -> fetch("/api/e-#{q}").then((r) -> r.json())\n  $r = await f($q)\n${ligne}</script>\n<i>${gabarit}</i>\n`
  for (const [nom, src] of [
    ['µfailed $r', MAL('  @lire = -> µfailed $r\n', '{($r or []).length}')],
    ['µfailed($$r)', MAL('  @lire = -> µfailed($$r)\n', '{($r or []).length}')],
    ['µfailed($r.message)', MAL('', '{µfailed($r.message)}')],
    ['µfailed()', MAL('', '{µfailed()}')],
  ] as Array<[string, string]>) {
    it('« ' + nom + ' » est refusé à la construction, le message dit la forme juste', async () => {
      await assert.rejects(() => transpile(src, { moduleName: 'mal', defaultScriptLang: 'civet', templateLang: 'civet', devWarnings: true } as any), (e: any) => {
        assert.match(String(e.message), /µfailed\(\$nom\)/, String(e.message))
        assert.doesNotMatch(String(e.message), /hooks de cycle de vie/, String(e.message))
        return true
      })
    })
  }
})
