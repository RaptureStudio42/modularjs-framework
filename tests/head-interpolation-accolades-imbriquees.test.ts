// <@head> (et le repli de <@failed>, qui partage sa lecture) : une interpolation se lit comme dans le reste du gabarit, jusqu'à SON accolade
// fermante — accolades imbriquées (un objet passé à une fonction, `µt('clé', { n: 1 })`), chaîne qui contient une accolade, `{{…}}` du HTML brut.
// Lue jusqu'à la première accolade fermante, `<title>{µt('page.head', { a: 1 })}</title>` affichait « {µt('page.head', [object Object])} »,
// une chaîne qui contient `}` cassait la construction, et un objet dans une valeur d'attribut était refusé comme une expression hors guillemets.
// Une accolade écrite dans un commentaire HTML n'ouvre rien au-dehors (lue jusqu'au commentaire suivant, elle avalait le titre et cassait la
// construction), et une interpolation vide ne rend rien, comme dans le corps de la page (elle affichait « undefined »).
// Compilation (sortie du transpileur, fautes relevées), puis rendu réel en développement et en production : titre de l'onglet et `<meta>`.

import assert from 'node:assert/strict'
import { processGlobalMacros } from '../src/transpiler/macros.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { projet } from './helpers/i18n-rendu-projet.js'

const attendre = (ms = 80) => new Promise((r) => setTimeout(r, ms))

// le code d'injection d'un <@head>, sans faute de construction
const injection = (head: string): string => {
  const r = processGlobalMacros(head)
  assert.deepEqual(r.errors, [])
  return r.setup
}

// le cas relevé : un titre traduit avec un paramètre, et le même appel dans le corps de la page
const TITRE = `<@head>
  <title>{µt('titre', { a: 1 })}</title>
</@head>

<p class="corps">{µt('titre', { a: 1 })}</p>
`

// accolades imbriquées dans une valeur entre guillemets, chaîne qui contient `}` dans une valeur `attr={…}`, `{{…}}` du HTML brut
const META = `<@head>
  <meta name="mjs-imbrique" content="{µt('nav.fermer', { a: { b: 2 } })}">
  <meta name="mjs-chaine" content={µt('titre', { a: '}' }) + ' {x}'}>
  {{ '<meta name="mjs-brut" content="' + µt('nav.fermer', { a: 1 }) + '">' }}
</@head>

<p>meta</p>
`

// des commentaires HTML qui portent chacun une accolade, autour du titre
const COMMENTAIRES = `<script>
  $n = 5
</script>
<@head>
  <!-- a { --><title>{$n}</title><!-- } -->
</@head>

<p>commentaires</p>
`

// une interpolation vide dans le titre, dans une valeur entre guillemets, et dans le corps de la page
const VIDE = `<@head>
  <title>a {} b</title>
  <meta name="mjs-vide" content="{}">
</@head>

<p class="corps">a {} b</p>
`

// l'expression rendue par µ._setHead (ou posée en innerHTML par un repli), évaluée : seulement des morceaux de texte quand rien n'est à lire
const evalue = (setup: string, re: RegExp): string => {
  const m = re.exec(setup)
  assert.ok(m, setup)
  return eval(m[1]) // eslint-disable-line no-eval -- des littéraux de chaîne concaténés, rien d'autre
}

describe('<@head> — une interpolation se lit en entier, accolades imbriquées et chaînes comprises', function () {
  this.timeout(90000)
  after(async () => { await terminateSharedWorkerPool() })

  describe('compilation', function () {
    it('un objet passé à une fonction, dans le texte du titre : l\'expression entière est échappée', () => {
      const setup = injection(`<@head><title>{µt('k', { a: 1 })}</title></@head>`)
      assert.ok(setup.includes(`µ._setHead(@, '<title>' + µ._esc(µt('k', { a: 1 })) + '</title>')`), setup)
    })

    it('accolades imbriquées et chaîne qui contient une accolade fermante', () => {
      const setup = injection(`<@head><title>{µt('k', { a: { b: '}' } }) + ' {x}'}</title></@head>`)
      assert.ok(setup.includes(`'<title>' + µ._esc(µt('k', { a: { b: '}' } }) + ' {x}') + '</title>'`), setup)
    })

    it('valeur d\'attribut `attr={…}` : l\'objet n\'est plus pris pour une expression hors guillemets, la valeur est mise entre guillemets', () => {
      const setup = injection(`<@head><meta name="x" content={fn({ a: { b: 1 } })}></@head>`)
      assert.ok(setup.includes(`'<meta name="x" content="' + µ._esc(fn({ a: { b: 1 } })) + '">'`), setup)
    })

    it('valeur d\'attribut entre guillemets : l\'interpolation à objet reste dans la valeur', () => {
      const setup = injection(`<@head><meta name="x" content="n={fn({ a: 1 })}&m={'}'}"></@head>`)
      assert.ok(setup.includes(`'<meta name="x" content="n=' + µ._esc(fn({ a: 1 })) + '&m=' + µ._esc('}') + '">'`), setup)
    })

    it('`{{…}}` du HTML brut, objet et chaînes à guillemets dedans : rendu tel quel', () => {
      const setup = injection(`<@head>{{ '<meta name="b" content="' + fn({ a: 1 }) + '">' }}</@head>`)
      assert.ok(setup.includes(`µ._setHead(@, String('<meta name="b" content="' + fn({ a: 1 }) + '">'), true)`), setup)
    })

    it('valeur nue : toujours refusée, l\'expression citée en entier', () => {
      const r = processGlobalMacros(`<@head><meta name="x" content=x{fn({ a: 1 })}></@head>`)
      assert.equal(r.errors.length, 1, r.errors.join('\n'))
      assert.ok(r.errors[0].includes('content=x{fn({ a: 1 })}'), r.errors[0])
    })

    it('une accolade jamais refermée reste du texte', () => {
      const setup = injection(`<@head><title>a { b</title></@head>`)
      assert.ok(setup.includes(`µ._setHead(@, '<title>a { b</title>')`), setup)
    })

    it('repli de <@failed> : la même lecture', () => {
      const r = processGlobalMacros(`<@failed err reset><p>{fn({ m: err.message })}</p></@failed>`)
      assert.deepEqual(r.errors, [])
      assert.ok(r.setup.includes(`_mjs_d.innerHTML = µ._mjs_th('<p>' + µ._esc(fn({ m: err.message })) + '</p>')`), r.setup)
    })

    it('une accolade dans un commentaire HTML n\'ouvre rien au-dehors : le titre qui suit se lit, les commentaires restent tels quels', () => {
      const setup = injection(`<@head><!-- a { --><title>{$n}</title><!-- } --></@head>`)
      assert.ok(setup.includes(`µ._setHead(@, '<!-- a { --><title>' + µ._esc($n) + '</title><!-- } -->')`), setup)
    })

    it('une interpolation écrite dans un commentaire se lit dans ce commentaire, sans jamais en sortir', () => {
      const setup = injection(`<@head><!-- {$a} { --><title>{$n}</title><!-- {fn({ b: 1 })} } --></@head>`)
      assert.ok(setup.includes(`µ._setHead(@, '<!-- ' + µ._esc($a) + ' { --><title>' + µ._esc($n) + '</title><!-- ' + µ._esc(fn({ b: 1 })) + ' } -->')`), setup)
    })

    it('une interpolation vide ne rend rien : texte, valeur entre guillemets, `attr={}`, HTML brut', () => {
      const setup = injection(`<@head><title>a {} b { } c {{}} d</title><meta name="g" content="{}"><meta name="q" content={ }></@head>`)
      assert.doesNotMatch(setup, /µ\._esc\(\s*\)|String\(\s*\)/)
      assert.equal(evalue(setup, /µ\._setHead\(@, (.+)\)$/), '<title>a  b  c  d</title><meta name="g" content=""><meta name="q" content="">')
    })

    it('repli de <@failed> : une interpolation vide ne rend rien non plus', () => {
      const r = processGlobalMacros(`<@failed err reset><p title="{}">a {} b</p></@failed>`)
      assert.deepEqual(r.errors, [])
      assert.doesNotMatch(r.setup, /µ\._esc\(\s*\)|String\(\s*\)/)
      assert.equal(evalue(r.setup, /_mjs_d\.innerHTML = µ\._mjs_th\((.+)\)$/m), '<p title="">a  b</p>')
    })
  })

  for (const prod of [false, true]) {
    describe(`rendu (happy-dom, build ${prod ? 'de production' : 'de développement'})`, function () {
      it('le titre porte la traduction, comme le même appel hors de <@head>', async () => {
        const p = await projet({ prod, sources: { titre: TITRE } })
        p.document.title = 'Mon site'
        const el = p.monte('titre')
        await attendre()
        assert.equal(el._shadow.querySelector('p.corps').textContent.trim(), 'Bienvenue', 'hors de <@head>, la même écriture')
        assert.equal(p.document.title, 'Bienvenue')
        p.window.close?.()
      })

      it('les <meta> portent la traduction : accolades imbriquées, chaîne qui contient `}`, HTML brut', async () => {
        const p = await projet({ prod, sources: { meta: META } })
        p.monte('meta')
        await attendre()
        const contenu = (nom: string): string => p.document.head.querySelector(`meta[name="${nom}"]`)?.getAttribute('content') ?? 'absent'
        assert.equal(contenu('mjs-imbrique'), 'Fermer')
        assert.equal(contenu('mjs-chaine'), 'Bienvenue {x}')
        assert.equal(contenu('mjs-brut'), 'Fermer')
        p.window.close?.()
      })

      it('des accolades dans des commentaires HTML : la page se construit, le titre se lit', async () => {
        const p = await projet({ prod, sources: { commentaires: COMMENTAIRES } })
        p.document.title = 'Mon site'
        p.monte('commentaires')
        await attendre()
        assert.equal(p.document.title, '5')
        p.window.close?.()
      })

      it('une interpolation vide ne rend rien, comme dans le corps de la page', async () => {
        const p = await projet({ prod, sources: { vide: VIDE } })
        p.document.title = 'Mon site'
        const el = p.monte('vide')
        await attendre()
        assert.equal(el._shadow.querySelector('p.corps').textContent, 'a  b', 'dans le corps de la page')
        assert.equal(p.document.querySelector('title')?.textContent, 'a  b')
        assert.equal(p.document.head.querySelector('meta[name="mjs-vide"]')?.getAttribute('content'), '')
        p.window.close?.()
      })
    })
  }
})
