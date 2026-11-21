// un vrai lien placé dans un <pre> ou un <code> reçoit les mots de MJS lus sur le texte d'une balise comme ailleurs : le même attribut,
// sur la balise de l'exemple elle-même comme dans un exemple écrit dans un autre ; une forme refusée y donne le même message ; le texte
// d'un exemple reste tel qu'écrit, et la construction passe

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { SCRIPT } from './helpers/composants-pieges.js'

// code compilé d'un composant
async function compile(src: string): Promise<string> {
  return String(((await transpile(SCRIPT + src + '\n', { moduleName: 'cas' })) as any).output)
}

// issue d'une compilation : le code, ou le message de son refus
async function issue(src: string): Promise<{ code?: string, err?: string }> {
  try {
    return { code: await compile(src) }
  }
  catch (e) {
    return { err: String((e as Error).message) }
  }
}

// chaque mot sous une forme valide, et l'attribut qu'il produit dans le code compilé
const MOTS: Array<[string, string, RegExp]> = [
  [':noUJS', '<a href="/x" :noUJS>l</a>', /mjs-no-ujs(?:='[^']*')?/],
  [':permanent', '<div id="p" :permanent>l</div>', /mjs-permanent(?:='[^']*')?/],
  [':preload', '<a href="/x" :preload="hover">l</a>', /data-mjs-preload='[^']*'/],
  [':method', '<a href="/x" :method="delete">l</a>', /mjs-method='[^']*'/],
  [':confirm en chaîne', '<a href="/x" :confirm="Sûr ?">l</a>', /mjs-confirm='[^']*'/],
  [':confirm en objet', '<a href="/x" :confirm={ text: \'Sûr ?\', ok: \'Oui\' }>l</a>', /mjs-confirm='[^']*'/],
  [':callback', '<form action="/x" :callback="fini">l</form>', /mjs-callback='[^']*'/],
  [':flash', '<a href="/x" :flash="popup">l</a>', /mjs-flash='[^']*'/],
  [':title', '<a href="/x" :title="Aide">l</a>', /mjs-title='[^']*'/],
  [':pageTransition', '<a href="/x" :pageTransition="fade">l</a>', /mjs-vt='[^']*'/],
  [':viewTransition', '<a href="/x" :viewTransition.hero>l</a>', /setProperty\('view-transition-name', [^)]*\)/]
]

// la balise du témoin portée par un <pre> ou un <code> : ses attributs sur la balise de l'exemple
const surBalise = (bloc: string, forme: string): string => forme.replace(/^<(\w+)([^>]*)>l<\/\1>$/, `<${bloc}$2>l</${bloc}>`)

// chaque place d'un vrai lien dans un exemple
const PLACES: Array<[string, (forme: string) => string]> = [
  ['dans un <pre>', (f) => `<pre>${f}</pre>`],
  ['dans un <code>', (f) => `<code>${f}</code>`],
  ['sur la balise <pre>', (f) => surBalise('pre', f)],
  ['sur la balise <code>', (f) => surBalise('code', f)],
  ['dans un <pre> écrit dans un <pre>', (f) => `<pre><pre>${f}</pre></pre>`],
  ['après un <pre> écrit dans un <pre>', (f) => `<pre><pre>b</pre>${f}</pre>`],
  ['dans un <code> écrit dans un <code>', (f) => `<code><code>${f}</code></code>`],
  ['après un <code> écrit dans un <code>', (f) => `<code><code>b</code>${f}</code>`],
  ['dans un <pre title="</code>"> écrit dans un <code>', (f) => `<code>a<pre title="</code>">${f}</pre>c</code>`],
  ['dans un <pre title=\'</code>\'> écrit dans un <code>', (f) => `<code>a<pre title='</code>'>${f}</pre>c</code>`]
]

describe('un vrai lien dans un <pre> ou un <code> reçoit ses mots de MJS comme ailleurs', function () {
  it('chaque mot y produit le même attribut que hors exemple, à chaque place', async () => {
    for (const [mot, forme, attribut] of MOTS) {
      // témoin : la même balise hors exemple produit bien l'attribut (sans lui, le cas passerait à vide)
      const temoin = (await compile(forme)).match(attribut)
      assert.ok(temoin, `témoin ${mot} : ${forme}`)
      for (const [place, placer] of PLACES) {
        const r = await issue(placer(forme))
        assert.equal(r.err ?? r.code!.match(attribut)?.[0], temoin[0], `${mot}, ${place} : ${placer(forme)}`)
      }
    }
  })

  it('une forme refusée hors exemple l\'est aussi dans un <pre>, avec le même message', async () => {
    for (const forme of ['<a href="/x" :noUJS="x">l</a>', '<div id="p" :permanent="nom">l</div>', '<a href="/x" :preload="eager">l</a>', '<a href="/x" :bogus>l</a>', '<a href="/x" @noUJS>l</a>']) {
      const hors = await issue(forme)
      assert.ok(hors.err, 'témoin, refusé hors exemple : ' + forme)
      assert.equal((await issue(`<pre>${forme}</pre>`)).err, hors.err, forme)
    }
    // la casse de `:permanent` est libre hors exemple (mjs-permanent) : la même dans un <pre>
    const hors = await compile('<div id="p" :Permanent>l</div>')
    assert.ok(hors.includes('mjs-permanent'), 'témoin :Permanent')
    const dedans = await issue('<pre><div id="p" :Permanent>l</div></pre>')
    assert.ok(dedans.code?.includes('mjs-permanent'), dedans.err ?? dedans.code)
  })

  it('le texte d\'un exemple reste tel qu\'écrit, et la construction passe', async () => {
    const textes: Array<[string, string]> = [
      ['<pre class="api-signature">:confirm="message"</pre>', ':confirm="message"'],
      ['<pre><code>&lt;a href="/account" :method="delete" :confirm=&#123; text: \'Sûr ?\' &#125;&gt;</code></pre>', '&lt;a href="/account" :method="delete" :confirm=&#123; text: \'Sûr ?\' &#125;&gt;'],
      ['<pre>:preload="eager" :noUJS="x"</pre>', ':preload="eager" :noUJS="x"'],
      ['<code>:confirm="Sûr ?"</code>', ':confirm="Sûr ?"']
    ]
    for (const [src, texte] of textes) {
      const code = await compile(src)
      // le texte dans le gabarit du code, tel qu'écrit (chaîne JavaScript), et aucun attribut tiré de lui
      assert.ok(code.includes(JSON.stringify(texte).slice(1, -1)), src)
      assert.ok(!/mjs-(?:confirm|method|preload|no-ujs)/.test(code), src)
    }
  })
})
