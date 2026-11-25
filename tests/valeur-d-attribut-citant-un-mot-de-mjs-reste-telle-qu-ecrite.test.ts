// la valeur d'un attribut qui n'est ni un mot de MJS ni un événement, et qui cite un mot (`title='voir :noUJS="x"'`,
// `title='<a :confirm="…">'`, `data-x='ancien @vt="cube"'`, `title={"tapez :confirm='oui'"}`), n'est qu'un texte : elle reste telle
// qu'écrite et la construction passe, entre guillemets comme entre accolades, sur toute balise, dans un <pre> ou un <code> comme
// ailleurs, et collée sans blanc à la valeur d'avant (`href="/x"title=':permanent ici'`) ; les vrais mots de la même balise restent
// lus, un refus cite la balise telle qu'écrite

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { SCRIPT } from './helpers/composants-pieges.js'

// le code compilé d'un composant, ou le message de son refus
async function compile(src: string): Promise<{ code?: string, err?: string }> {
  try {
    return { code: String(((await transpile(SCRIPT + src + '\n', { moduleName: 'cas' })) as any).output) }
  }
  catch (e) {
    return { err: String((e as Error).message) }
  }
}

// gabarit compilé d'un composant (la chaîne de son clonage), ou le message de son refus
async function issue(src: string): Promise<{ tpl?: string, err?: string }> {
  const r = await compile(src)
  if (r.code === undefined) return r
  return { tpl: (r.code.match(/_mjs_cloneTpl\("([^\n]*?)"\)/)?.[1] ?? r.code).replaceAll('\\"', '"') }
}

// un attribut produit par un mot, ou un caractère d'usage privé : ni l'un ni l'autre ne vient d'une valeur citée
const WORD_ATTR = /mjs-(?:no-ujs|preload|confirm|method|permanent|callback|flash|title|vt)/
const PRIVATE   = /[-]/

// une valeur qui cite des mots, et ce qui doit en rester dans le gabarit
const VALEURS: Array<[string, string]> = [
  [`title='voir :noUJS="x"'`, ':noUJS="x"'],
  [`data-x=':preload=eager'`, ':preload=eager'],
  [`title='<a :confirm="Sûr ?">'`, ':confirm="Sûr ?"'],
  [`title='voir :permanent et :noUJS ici'`, ':permanent et :noUJS ici'],
  [`data-x='ancien @vt="cube"'`, '@vt="cube"']
]

// chaque place de la balise qui porte la valeur
const PLACES: Array<[string, (attr: string) => string]> = [
  ['sur un <p>', (a) => `<p ${a}>t</p>`],
  ['sur un <pre>', (a) => `<pre ${a}>t</pre>`],
  ['sur un <code>', (a) => `<code ${a}>t</code>`],
  ['sur un <span> dans un <pre>', (a) => `<pre><span ${a}>t</span></pre>`]
]

// une valeur entre accolades qui cite un mot, et ce qui doit en rester dans le code
const ACCOLADES: Array<[string, string]> = [
  [`<p title={"tapez :confirm='oui'"}>t</p>`, `tapez :confirm='oui'`],
  [`<p title={"voir :permanent ici"}>t</p>`, 'voir :permanent ici'],
  [`<p data-x={"ancien @vt=cube"}>t</p>`, 'ancien @vt=cube'],
  [`<pre><code title={"voir :noUJS='x'"}>t</code></pre>`, `voir :noUJS='x'`],
  [`<mjs-carte titre={"voir :noUJS='x'"}></mjs-carte>`, `voir :noUJS='x'`]
]

// une valeur collée sans blanc à la valeur d'avant (après un guillemet double, un guillemet simple, une accolade), et ce qui doit
// en rester dans le code : la valeur citée telle qu'écrite, le vrai mot de la balise lu
const COLLEES: Array<[string, string[]]> = [
  [`<a href="/x"title=":permanent ici" :permanent>l</a>`, [`title=':permanent ici'`, ` mjs-permanent>`]],
  [`<a href='/x'title=":noUJS ici" :noUJS>l</a>`, [`title=':noUJS ici'`, ` mjs-no-ujs>`]],
  [`<a href={"/x"}title=":permanent ici" :permanent>l</a>`, [`title=':permanent ici'`, ` mjs-permanent>`]],
  [`<a :confirm="Sûr ?"title=":noUJS ici">l</a>`, [`mjs-confirm='Sûr ?'`, `title=':noUJS ici'`]]
]

// les cas voisins, déjà justes : chevron, JSON, blancs autour du `=` ou dans la valeur, `=` dans la valeur, saut de ligne,
// accolades, exemple de balise dans un <pre><code> ; ce qui doit en rester dans le code
const VOISINS: Array<[string, string[]]> = [
  [`<a href="/x" title="a > b :confirm='x'" :confirm="Sûr ?">l</a>`, [`title='a > b :confirm=&#39;x&#39;'`, `mjs-confirm='Sûr ?'`]],
  [`<a href="/x" data-x='{"a": ":noUJS", "b": "@vt=cube"}' :noUJS>l</a>`, [`{"a": ":noUJS", "b": "@vt=cube"}`, ` mjs-no-ujs>`]],
  [`<a href="/x" title = "x :preload='eager'" :preload="hover">l</a>`, [`title='x :preload=&#39;eager&#39;'`, `data-mjs-preload='hover'`]],
  [`<a href="/x" title=" :noUJS " :noUJS>l</a>`, [`title=' :noUJS '`, ` mjs-no-ujs>`]],
  [`<a title='x="y" :confirm="z"' href="/" :confirm="Vraiment ?">l</a>`, [`title='x="y" :confirm="z"'`, `mjs-confirm='Vraiment ?'`]],
  [`<a\n  href="/x"\n  title="ligne 1\n  :noUJS ligne 2"\n  :method="delete"\n  :confirm="Supprimer ?">l</a>`, [`:noUJS ligne 2'`, `mjs-method='delete'`, `mjs-confirm='Supprimer ?'`]],
  [`<a href="/x" title={"tapez :confirm='oui' } et :noUJS"} data-y={$s + " :preload"} :noUJS>l</a>`, [`"tapez :confirm='oui' } et :noUJS"`, `$.s + " :preload"`, ` mjs-no-ujs>`]],
  [`<pre><code>&lt;a :confirm="…"&gt; <a href="/k" :confirm="Sûr ?" title=":noUJS">l</a></code></pre>`, [`&lt;a :confirm="…"&gt; <a href='/k' mjs-confirm='Sûr ?' title=':noUJS'>`]]
]

describe('la valeur d\'un attribut qui cite un mot de MJS reste telle qu\'écrite', function () {
  for (const [attr, reste] of VALEURS) {
    for (const [place, placer] of PLACES) {
      it(`${attr}, ${place}`, async () => {
        const r = await issue(placer(attr))
        assert.equal(r.err, undefined, r.err)
        assert.ok(r.tpl!.includes(reste), r.tpl)
        assert.ok(!WORD_ATTR.test(r.tpl!), r.tpl)
        assert.ok(!PRIVATE.test(r.tpl!), r.tpl)
      })
    }
  }

  for (const [src, reste] of ACCOLADES) {
    it(`entre accolades : ${src}`, async () => {
      const r = await compile(src)
      assert.equal(r.err, undefined, r.err)
      assert.ok(r.code!.replaceAll('\\"', '"').includes(reste), r.code)
      assert.ok(!WORD_ATTR.test(r.code!), r.code)
      assert.ok(!PRIVATE.test(r.code!), r.code)
    })
  }

  for (const [src, restes] of [...COLLEES, ...VOISINS]) {
    it(`collée ou voisine : ${src.replaceAll('\n', ' ')}`, async () => {
      const r = await compile(src)
      assert.equal(r.err, undefined, r.err)
      const code = r.code!.replaceAll('\\"', '"')
      for (const reste of restes) assert.ok(code.includes(reste), `${reste} absent de : ${code.match(/_mjs_cloneTpl\("([^\n]*?)"\)/)?.[1] ?? code}`)
      assert.ok(!PRIVATE.test(code), code)
    })
  }

  it('les vrais mots de la même balise restent lus, à côté de la valeur', async () => {
    const r = await issue(`<pre><a href="/x" title='voir :noUJS="x"' :confirm="Sûr ?" :method="delete">l</a></pre>`)
    assert.equal(r.err, undefined, r.err)
    assert.ok(r.tpl!.includes(`title='voir :noUJS="x"'`), r.tpl)
    assert.match(r.tpl!, /mjs-confirm='Sûr \?'/)
    assert.match(r.tpl!, /mjs-method='delete'/)
    const accolades = await compile(`<a href="/x" title={"voir :noUJS='x'"} :confirm="Sûr ?">l</a>`)
    assert.equal(accolades.err, undefined, accolades.err)
    assert.match(accolades.code!, /mjs-confirm='Sûr \?'/)
  })

  it('un refus cite la balise telle qu\'écrite, sans caractère mis de côté', async () => {
    const refus = await issue(`<a href="/x" title='a :b' :noUJS="x">l</a>`)
    assert.ok(refus.err?.includes(':no-ujs="x"'), refus.err ?? refus.tpl)
    const ouvert = await issue(`<p><a href="/x" :confirm="Sûr ? title='voir :noUJS'>l</a></p>`)
    assert.match(ouvert.err ?? '', /GUILLEMET JAMAIS REFERMÉ/)
    const vt = await issue(`<a href="/x" @vt="cube" title='voir @vt="cube"'>l</a>`)
    assert.match(vt.err ?? '', /@vt="cube"/)
    for (const message of [refus.err!, ouvert.err!, vt.err!]) assert.ok(!PRIVATE.test(message), message)
  })
})
