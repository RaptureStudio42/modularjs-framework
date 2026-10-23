// rendu serveur (moteur happy-dom) : une valeur liée à une propriété de style — variable CSS `--x={…}`, `@style.prop={…}`, la pastille de
// <@@color> — n'ajoute jamais une déclaration au `style` écrit dans la page. Le navigateur refuse une telle valeur à l'écriture
// (`red; background-image: url(…)`) ; le DOM simulé du serveur l'écrivait telle quelle, et le navigateur qui recevait la page appliquait la
// déclaration ajoutée (une requête partait vers le site nommé). Une vraie valeur, `;` dans une chaîne ou dans `url(data:…)` compris, est
// toujours écrite.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer, isSafeStyleValue } from '../src/server/renderToString.js'

const HOTE = `<script>
  $v  = 'red; background-image: url(http://pisteur.invalid/p.png)'
  $w  = 'blue} p{background-image: url(http://pisteur.invalid/q.png)'
  $ok = 'rgb(1, 2, 3)'
  $s  = '"a;b"'
  $d  = 'url(data:image/png;base64,AAAA)'
</script>
<span class="var" --x={$v}></span>
<span class="prop" @style.color={$v}></span>
<span class="accolade" --y={$w}></span>
<span class="juste" --x={$ok} @style.color={$ok}></span>
<span class="chaine" --c={$s}></span>
<span class="donnee" --i={$d}></span>
<@@color class="pastille" value={$v}></@@color>
`

describe('rendu serveur — une valeur de style liée n\'ajoute jamais de déclaration', function () {
  this.timeout(120000)
  let html = ''

  before(async () => {
    const root = mjsTmp('ssr-style-declaration')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'hote-style.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: join(root, 'src'), bundlerOpts: { runtime: ['hydrate'] } } as any)
    try {
      html = (await renderer.renderToString('mjs-hote-style', { ssrMode: 'markers' } as any)).html
    } finally {
      await renderer.close()
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  const balise = (classe: string) => (html.match(new RegExp(`<span class="${classe}[^"]*"[^>]*>`)) || [''])[0]

  // le code de la couleur, lui, s'affiche en texte (échappé, sans effet) : seules les balises et leurs attributs sont lus
  it('`--x={…}`, `@style.color={…}` et la pastille de <@@color> : aucune balise de la page ne nomme l\'adresse ni n\'ajoute de déclaration', () => {
    assert.ok(balise('juste'), 'préalable : la page est rendue')
    const balises = [...html.matchAll(/<[^>]+>/g)].map((m) => m[0]).filter((t) => /pisteur|background-image/.test(t))
    assert.deepEqual(balises, [])
  })

  it('une vraie valeur est écrite : couleur, chaîne qui contient « ; », image `data:`', () => {
    assert.match(balise('juste'), /--x: rgb\(1, 2, 3\)/)
    assert.match(balise('juste'), /color: rgb\(1, 2, 3\)/)
    assert.match(balise('chaine'), /--c: (&quot;|")a;b(&quot;|")/)
    assert.match(balise('donnee'), /--i: url\(data:image\/png;base64,AAAA\)/)
  })

  it('la règle du navigateur : ni « ; », ni « ! », ni accolade hors chaîne et hors parenthèse ; rien laissé ouvert', () => {
    for (const v of ['red', 'rgb(1, 2, 3)', '"a;b"', '\'x}\'', 'url(data:image/svg+xml;utf8,<svg><style>a{fill:red}</style></svg>)', 'calc(1px + 2px)', 'a\\;b', '/* note */ blue', '"Helvetica Neue", Arial']) {
      assert.equal(isSafeStyleValue(v), true, v)
    }
    for (const v of ['red; background-image: url(x)', 'red !important', 'a}', '{a}', 'blue} p{color: red', 'url(x', '"abc', 'a /* b', 'a)', '(a]', '"a\nb"', 'a\\', '(a{b)c}']) {
      assert.equal(isSafeStyleValue(v), false, v)
    }
  })
})
