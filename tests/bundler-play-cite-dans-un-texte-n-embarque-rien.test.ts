// `µplay` se cherche dans le code compilé aux chaînes masquées, comme `µinspect` : un texte qui le cite (chaîne du script, exemple
// affiché dans un `<pre>`, valeur d'attribut) n'est pas un appel et n'emmène pas son module ; un vrai appel, écrit en sucre ou en
// clair, en CoffeeScript ou en Civet, l'emmène toujours
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { scanCompiledFeatures } from '../src/bundler/features.js'

async function releve(src: string, moduleName: string): Promise<Set<string>> {
  const { output, data } = await transpile(src, { moduleName })
  return scanCompiledFeatures(output, data)
}

const CITES: Record<string, string> = {
  chaine:   "<script lang=\"coffee\">\n@s = 'appel µ.play(el) dans une chaîne'\n</script>\n<p>y</p>\n",
  civet:    "<script>\n$s = 'appel µ.play(el, \"fade\") dans une chaîne'\n</script>\n<p>{$s}</p>\n",
  pre:      '<pre>µ.play(el, \'fade\')</pre>\n',
  preSucre: '<pre>µplay($el, \'fade\')</pre>\n',
  attribut: '<p title="µ.play(el)">y</p>\n'
}

const APPELS: Record<string, string> = {
  coffee: "<script lang=\"coffee\">\n@go = ->\n  µplay($el, 'x')\n</script>\n<p>y</p>\n",
  clair:  "<script lang=\"coffee\">\n@go = ->\n  µ.play(@el, 'x')\n</script>\n<p>y</p>\n",
  civet:  "<script>\ngo := (el) => µ.play(el, 'x')\n</script>\n<p>y</p>\n"
}

describe('µplay cité dans un texte : aucun module embarqué', function () {
  this.timeout(30000)

  for (const [nom, src] of Object.entries(CITES)) {
    it(`texte qui le cite (${nom}) : "play" absent`, async () => {
      assert.equal((await releve(src, `play-cite-${nom.toLowerCase()}`)).has('play'), false)
    })
  }

  for (const [nom, src] of Object.entries(APPELS)) {
    it(`vrai appel (${nom}) : "play" présent`, async () => {
      assert.ok((await releve(src, `play-appel-${nom}`)).has('play'))
    })
  }
})
