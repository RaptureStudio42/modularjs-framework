// chaque masque du compilateur porte un sceau : une chaîne qui cite `<style>` ou `<script>` dans une interpolation d'un `<@head>` ou
// d'un `<@failed>` sort telle qu'écrite ; un NUL écrit par l'auteur, suivi du nom d'un masque et d'un numéro, reste tel quel dans un
// script, une interpolation, un gestionnaire ou le titre d'un `<@head>` ; des milliers de commentaires qui citent `<code>` se lisent
// en temps linéaire ; un `<pre>` ouvert dans un `<code>` l'emporte sur lui, hors des commentaires

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { maskDocBlocks } from '../src/transpiler/lint.js'
import { SCRIPT, nuls, autour, vers } from './helpers/composants-pieges.js'

const NUL   = String.fromCharCode(0)
const BARRE = String.fromCharCode(92)
// chaque masque y pose au moins deux jetons : commentaire, `<pre>`, `<code>`, `<@head>` à deux `<style>`, `<@failed>`, texte statique
const DECOR = '<!-- c --><pre>p</pre><code>q</code>\n<@head>\n<title>t</title>\n<style>s{}</style>\n<style>u{}</style>\n</@head>\n<@failed err reset>\n<p>f</p>\n</@failed>\n<b>{$n}</b>\n'

// code compilé d'un composant
async function compile(src: string): Promise<string> {
  return String(((await transpile(src, { moduleName: 'cas' })) as any).output)
}

// le texte figure dans le code tel qu'écrit, NUL brut ou échappé
const ecrit = (code: string, texte: string): boolean => [NUL, BARRE + 'x00', BARRE + 'u0000', BARRE + '0'].some((n) => code.includes(texte.split(NUL).join(n)))

// durée d'une compilation, en millisecondes
async function duree(src: string): Promise<number> {
  const debut = performance.now()
  await compile(src)
  return performance.now() - debut
}

describe('masques du compilateur : un sceau pour chacun', function () {
  this.timeout(120000)

  it('une chaîne qui cite <style> ou <script> dans une interpolation de <@head> ou de <@failed> sort telle qu\'écrite', async () => {
    for (const [gabarit, attendu] of [
      ['<@head>\n<title>{"<style>x</style>"}</title>\n</@head>\n<p>t</p>', 'µ._esc("<style>x</style>")'],
      ['<@head>\n<meta name="d" content={"<script>a</script>"}>\n</@head>\n<p>t</p>', 'µ._esc("<script>a</script>")'],
      ['<@head>\n<title>{"<style>x{}</style>"}</title>\n<style>s{}</style>\n</@head>\n<p>t</p>', 'µ._esc("<style>x{}</style>")'],
      ['<@failed err reset>\n<p>{"<style>x</style>"}</p>\n</@failed>\n<p>t</p>', 'µ._esc("<style>x</style>")'],
      ['<@failed err reset>\n<div>{{"<script>a</script>"}}</div>\n</@failed>\n<p>t</p>', 'String("<script>a</script>")'],
    ]) {
      const code = await compile(SCRIPT + gabarit + '\n')
      assert.equal(nuls(code), 0, gabarit + ' : ' + autour(code))
      assert.ok(code.includes(attendu), gabarit + ' : ' + vers(code, '_esc('))
    }
  })

  it('un NUL écrit par l\'auteur, suivi du nom d\'un masque et d\'un numéro, reste tel quel', async () => {
    const fautes = [] as string[]
    for (const jeton of ['CM0', 'MJSDOC0', 'MJSHTML0', 'MJSHTML1', 'MJSHF0', 'MJSHF1', 'MJSHEADLIT0', 'MJSHEADLIT1', 'MJSSTR0', 'NREF0']) {
      const forge = 'QA' + NUL + jeton + NUL + 'QZ'
      for (const [lieu, src] of [
        ['script', '<script>\n$n = 0\n$s = "x"\n$f = "' + forge + '"\n</script>\n' + DECOR + '<p>{$f}</p>\n'],
        ['interpolation', SCRIPT + DECOR + '<p>{"' + forge + '"}</p>\n'],
        ['gestionnaire', SCRIPT + DECOR + '<button @click={-> $s = "' + forge + '"}>{$s}</button>\n'],
        ['titre de tête', SCRIPT + '<@head>\n<title>{"' + forge + '"}</title>\n<style>s{}</style>\n<style>u{}</style>\n</@head>\n<p>t</p>\n'],
      ]) {
        try {
          const code = await compile(src)
          if (!ecrit(code, forge)) fautes.push(jeton + ', ' + lieu + ' : ' + vers(code, 'QA'))
        }
        catch (e: any) {
          fautes.push(jeton + ', ' + lieu + ' : erreur ' + String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 140))
        }
      }
    }
    assert.deepEqual(fautes, [])
  })

  it('des milliers de commentaires qui citent <code> se lisent en temps linéaire', async () => {
    const n      = 24000
    const piege  = SCRIPT + '<!-- <code> -->\n'.repeat(n) + '<p>{$n}</p>\n<code>z</code>\n'
    const temoin = SCRIPT + '<!-- cccccc -->\n'.repeat(n) + '<p>{$n}</p>\n<code>z</code>\n'
    // témoin, piège, piège, témoin : la machine peut être chargée, le meilleur de chaque compte
    const t1      = await duree(temoin)
    const p1      = await duree(piege)
    const p2      = await duree(piege)
    const t2      = await duree(temoin)
    const rapport = Math.min(p1, p2) / Math.min(t1, t2)
    assert.ok(rapport < 2, `piège ${Math.round(Math.min(p1, p2))} ms, témoin ${Math.round(Math.min(t1, t2))} ms : rapport ${rapport.toFixed(1)}`)
  })

  it('un <pre> ouvert dans un <code> l\'emporte sur lui, hors des commentaires', async () => {
    const src = '<code>a<pre>b</code>c</pre> <!-- <pre> --><p>d</p><!-- </pre> -->'
    const { masked, restore } = maskDocBlocks(src)
    assert.ok(masked.startsWith('<code>a') && !masked.includes('</pre>') && masked.includes('<p>d</p>'), JSON.stringify(masked))
    assert.equal(restore(masked), src)
    // témoin : la même balise, hors de tout <pre> et de tout <code>, reçoit bien son mot (sans lui, le cas passerait à vide)
    const temoin = await compile(SCRIPT + '<a href="/x" :noUJS>l</a>\n')
    assert.ok(temoin.includes('mjs-no-ujs'), 'témoin : ' + vers(temoin, 'href'))
    // seul dans un <code>, seul dans un <pre>, ou `</code>` écrit dans une valeur d'attribut du `<pre>` (guillemets doubles ou simples) :
    // le lien reçoit son mot comme le témoin
    for (const exemple of ['<code><a href="/x" :noUJS>l</a></code>', '<pre><a href="/x" :noUJS>l</a></pre>', '<code>a<pre title="</code>"><a href="/x" :noUJS>l</a></pre>c</code>', '<code>a<pre title=\'</code>\'><a href="/x" :noUJS>l</a></pre>c</code>']) {
      const code = await compile(SCRIPT + exemple + '\n')
      assert.ok(code.includes('mjs-no-ujs'), exemple + ' : ' + vers(code, 'href'))
    }
  })
})
