// Un `</script>` écrit dans une valeur d'attribut en expression (`title={"a </script> b"}`, un gestionnaire qui le cite
// dans une chaîne) ou dans une valeur sans guillemets faisait refuser la construction (« un </script> orphelin ») ; il
// est lu comme le navigateur : une valeur nue va jusqu'au blanc ou au `>` (`title=a</script>b>` donne le titre
// `a</script` et le texte `b>`). Dans le gabarit et les valeurs écrites par le JavaScript produit, il devient `<\/script>`
// (même valeur) : il ne refermerait pas la balise d'une page où ce code serait mis en ligne

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

const T = (html: string) => transpile(`<script>\n$a = 1\n</script>\n${html}\n`, { moduleName: 'fermante-expression' })

describe('</script> dans une expression ou une valeur nue', () => {
  it('expression d\'attribut et gestionnaire sur plusieurs lignes : construits', async () => {
    await T('<div title={"a </script> b"}>{$a}</div>')
    await T('<button @click={->\n  x = "</script>"\n}>{$a}</button>')
  })

  it('valeur nue : lue jusqu\'au `>`, comme le navigateur', async () => {
    const r = await T('<div title=a</script>b>{$a}</div>')
    assert.match(r.output, /<div title='a<\\\/script'>b>/)
  })

  it('gabarit : jamais de `</script>` tel quel dans la chaîne produite', async () => {
    const r = await T('<div title="a </script> b">{$a}</div>')
    assert.match(r.output, /a <\\\/script> b/)
    assert.doesNotMatch(r.output, /a <\/script> b/)
  })

  it('témoin : un `</script>` dans le texte reste refusé', async () => {
    await assert.rejects(T('<p>a </script> b {$a}</p>'), /orphelin/)
  })

  describe('composant monté', function () {
    this.timeout(90000)
    let app: any

    before(async () => {
      const root   = mjsTmp('fermante-expression')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fermante-valeurs.mjs'), '<script>\n$n = 1\n</script>\n<p class="e" title={"a </script> b"}>{$n}</p>\n<p class="nue" title=a</script>b>{$n}</p>\n<p class="g" title="c </script>">{$n}</p>\n')
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
      app = await createHarness({ root })
    })
    after(async () => { if (app) await app.destroy() })

    it('les valeurs arrivent comme le navigateur les lit', async () => {
      const c = await app.mount('fermante-valeurs')
      try {
        assert.equal(c.find('.e').getAttribute('title'), 'a </script> b')
        assert.equal(c.find('.nue').getAttribute('title'), 'a</script')
        assert.equal(c.text('.nue'), 'b>1')
        assert.equal(c.find('.g').getAttribute('title'), 'c </script>')
      }
      finally { c.destroy() }
    })
  })
})
