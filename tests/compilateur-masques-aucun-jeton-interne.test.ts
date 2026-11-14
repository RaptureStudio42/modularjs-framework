// aucun jeton interne du compilateur ne sort : un commentaire qui cite `<code>` ou `<pre>`, écrit dans une chaîne, une valeur
// d'attribut, une `<textarea>`, un `<title>` de `<@head>`, le fallback d'un `<@failed>`, le corps d'un gestionnaire ou un contenu
// glissé, ne laisse aucun caractère NUL dans le code, la carte de source (`sourcesContent` compris) ni le rendu serveur, et un
// commentaire de l'auteur dans une chaîne y reste tel qu'écrit ; un `<pre>` cité dans un commentaire n'ouvre rien : le balisage qui
// le suit reste, ses directives traduites ; un NUL écrit par l'auteur reste tel quel, même suivi d'un nom de masque et d'un numéro

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { renderToString } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { SCRIPT, PIEGES, HOTE, nuls, autour, vers } from './helpers/composants-pieges.js'

const NUL = String.fromCharCode(0)

// une valeur du résultat, en texte
function texte(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? ''
  }
  catch {
    return ''
  }
}

// le code compilé, le résultat entier en texte (code, carte de source, données) et la carte de source
async function compile(src: string): Promise<{ code: string; tout: string; carte: any }> {
  const r: any = await transpile(src, { moduleName: 'cas' })
  return { code: String(r.output), tout: Object.values(r).map(texte).join('\n'), carte: typeof r.sourceMap === 'string' ? JSON.parse(r.sourceMap) : r.sourceMap }
}

describe('masques du compilateur : aucun jeton interne dans une sortie', function () {
  this.timeout(120000)

  it('composants piégés : aucun NUL dans le code ni dans la carte de source', async () => {
    for (const [nom, gabarit] of Object.entries(PIEGES)) {
      const r = await compile(SCRIPT + gabarit + '\n')
      assert.equal(nuls(r.tout), 0, nom + ' : ' + autour(r.tout))
    }
  })

  it('un commentaire de l\'auteur dans une chaîne reste tel qu\'écrit, même s\'il cite <code> ou <pre>', async () => {
    for (const [gabarit, attendu] of [
      ['<p>{"a<!-- voir <code>npm i</code> pour installer -->c"}</p>', 'a<!-- voir <code>npm i</code> pour installer -->c'],
      ['<p>{"a<!-- <pre>x</pre> -->c"}</p>', 'a<!-- <pre>x</pre> -->c'],
      ['<p title={"a<!-- <code>x</code> -->c"}>t</p>', 'a<!-- <code>x</code> -->c'],
      ['<button @click={-> $s = "a<!-- <code>x</code> -->c"}>{$s}</button>', 'a<!-- <code>x</code> -->c'],
    ]) {
      const r = await compile(SCRIPT + gabarit + '\n')
      assert.ok(r.code.includes(attendu), gabarit + ' : ' + vers(r.code, 'a<!--'))
    }
  })

  it('la carte de source porte la source telle qu\'écrite', async () => {
    const r       = await compile(SCRIPT + '<p>QQ<!-- <code>x</code> -->ZZ</p>\n<b>{$n}</b>\n')
    const contenu = (r.carte?.sourcesContent ?? []).join('\n')
    assert.ok(contenu.includes('<p>QQ<!-- <code>x</code> -->ZZ</p>'), vers(contenu, 'QQ'))
  })

  it('un <pre> cité dans un commentaire n\'ouvre rien : le balisage qui le suit reste, ses directives traduites', async () => {
    const r = await compile(SCRIPT + '<!-- <pre> --><p>QQ visible ZZ</p><!-- </pre> -->\n<!-- <pre> --><a href="/x" :noUJS>lien</a><!-- </pre> -->\n')
    assert.ok(r.code.includes('QQ visible ZZ'), vers(r.code, 'QQ'))
    assert.ok(r.code.includes('mjs-no-ujs') && !r.code.includes(':noUJS'), vers(r.code, 'lien'))
  })

  it('un NUL écrit par l\'auteur reste tel quel, même suivi d\'un nom de masque et d\'un numéro', async () => {
    for (const [avant, jeton] of [['<!-- z -->', 'CM0'], ['<!-- <code>z</code> -->', 'MJSDOC0'], ['<!-- <code>z</code> -->', 'MJSDOC1']]) {
      const forge = 'a' + NUL + jeton + NUL + 'c'
      const r     = await compile(SCRIPT + avant + '<p>{"' + forge + '"}</p>\n')
      assert.ok(r.code.includes(forge), jeton + ' : ' + vers(r.code, '_mjs_updText'))
    }
  })

  it('rendu serveur des composants piégés : aucun NUL, le texte de l\'auteur', async () => {
    const root   = mjsTmp('masques-pieges-ssr')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote.mjs'), HOTE)
    for (const [nom, gabarit] of Object.entries(PIEGES)) writeFileSync(join(srcDir, nom + '.mjs'), SCRIPT + gabarit + '\n')
    const garde = console.warn
    console.warn = () => {}
    try {
      for (const nom of Object.keys(PIEGES)) {
        const html = texte(await renderToString({ sourceDir: srcDir, outputDir: join(root, 'out'), tag: 'mjs-' + nom } as any))
        assert.equal(nuls(html), 0, nom + ' : ' + autour(html))
        if (nom === 'chaine') assert.ok(html.includes('npm i') && html.includes('pour installer'), vers(html, 'class="k"'))
      }
    }
    finally {
      console.warn = garde
    }
  })
})
