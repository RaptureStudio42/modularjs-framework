// Symbole ASCII (`sigil: 'mjs'`) : `mjs.x` / `mjs$x` s'écrivent pour `µ.x` / `µ$x` dans le CODE du composant
// (script, expressions `{…}`, lignes `@import`), jamais dans ce qui s'affiche ou se lit tel quel : texte,
// liens et autres attributs, `<pre>`, chaînes et commentaires du script, feuille de style. Avant, `mjs.dev`
// devenait `µ.dev` à l'écran et dans les liens, et le sélecteur `.mjs.actif` devenait `.µ.actif` (style
// perdu). Un appel d'asset ou d'image écrit en clair dans un attribut (`src="mjs.asset('x.png')"`) reste
// reconnu.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const mjs = (src: string, opts: Record<string, unknown> = {}) => transpile(src, { moduleName: 'symbole-mjs', sigil: 'mjs', ...opts })

describe('symbole mjs : alias dans le code seul', () => {
  it('le texte, les liens, <pre> et les chaînes du script restent tels qu\'écrits', async () => {
    const { output, data } = await mjs('<p>Site : mjs.dev</p>\n<a href="https://mjs.dev/x">lien</a>\n<pre>mjs.config.json</pre>\n<script>\nmsg = \'voir mjs.config.json\'\n</script>')
    assert.ok(output.includes('Site : mjs.dev'), 'texte')
    assert.ok(output.includes('https://mjs.dev/x'), 'lien')
    assert.ok(data.surgicalHtml.includes('mjs.config.json'), '<pre>')
    assert.ok(output.includes('voir mjs.config.json'), 'chaîne du script')
    assert.doesNotMatch(output, /µ\.(dev|config)/)
  })

  it('la feuille de style garde ses sélecteurs', async () => {
    const { data } = await mjs('<style>\n.mjs.actif\n  color: red\n</style>\n<p class="mjs actif">x</p>')
    // la feuille de base s'ouvre sur la règle qui cache un composant `hidden`, posée à tout composant : seul le sélecteur écrit compte ici
    assert.ok(data.baseCss.endsWith('.mjs.actif{color:red}'), data.baseCss)
    assert.doesNotMatch(data.baseCss, /µ/)
  })

  it('le code garde l\'alias : script, interpolation d\'une chaîne du script, expressions du HTML', async () => {
    const src = "<script>\n$n = 1\nmjs.effect -> console.log $n\nlabel = \"n : #{mjs.t('x')}\"\n</script>\n<p>{mjs.t('titre')}</p>\n<button @click={mjs.emit('choix')}>ok</button>"
    const { output } = await mjs(src)
    assert.doesNotMatch(output, /\bmjs\.(effect|t|emit)\b/)
  })

  it('un appel d\'asset écrit en clair dans un attribut est résolu', async () => {
    const { output } = await mjs('<img src="mjs.asset(\'logo.png\')" alt="">', { resolveAsset: async (p: string) => '/a/' + p })
    assert.ok(output.includes('/a/logo.png'), 'asset résolu')
  })
})
