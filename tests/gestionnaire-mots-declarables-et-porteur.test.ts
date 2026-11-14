// `@evt=nom` : un mot du langage que Civet prend pour un nom (`yes`, `no`, `on`, `off`, `of`, `by`, `when`, `then`), déclaré dans
// le <script>, est appelé sur une balise globale et dans le fallback d'un `<@failed>` comme sur un élément ; que rien ne le
// déclare, il est refusé avec la déclaration à écrire. Sur `<@window>`, la ligne citée reste celle de l'attribut quand une valeur
// sans guillemets porte le nom d'un événement écrit plus bas, ou quand le même événement est écrit avant entre accolades. Un
// commentaire écrit par l'auteur, même fait de sauts de ligne seuls, reste tel qu'écrit (`<textarea>`, `<title>`, valeur
// d'attribut, `<@head>`). `cancelIdleCallback` et `createImageBitmap` sont refusées avec la bonne écriture ; `setTimeout` et
// `setInterval`, avec le seul message des minuteries. Les messages disent ce qui arriverait vraiment (`constructor` est `Window`,
// `valueOf` ne ferait rien ou lèverait)

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const S           = '<script>\n$n = 0\n</script>\n'
const DECLARABLES = ['yes', 'no', 'on', 'off', 'of', 'by', 'when', 'then']

// le message de l'erreur de construction, '' quand la construction passe
async function refus(src: string): Promise<string> {
  const orig = console.error
  console.error = () => {}
  try {
    await transpile(src, { moduleName: 'cas' })
  }
  catch (err: any) {
    return String(err?.message ?? err)
  }
  finally {
    console.error = orig
  }
  return ''
}

// la sortie, et ce que la construction écrit en console
async function sortie(src: string): Promise<{ code: string; ecrit: string }> {
  const vus   = [] as string[]
  const garde = [console.warn, console.log, console.error, console.info]
  const capte = (...a: unknown[]) => { vus.push(a.map(String).join(' ')) }
  console.warn  = capte
  console.log   = capte
  console.error = capte
  console.info  = capte
  try {
    const r: any = await transpile(src, { moduleName: 'cas' })
    return { code: String(r.output), ecrit: vus.join('\n') }
  }
  finally {
    [console.warn, console.log, console.error, console.info] = garde
  }
}

const lignes = (msg: string): number[] => [...msg.matchAll(/\(ligne (\d+)\)/g)].map((m) => Number(m[1]))

// les places d'un gestionnaire fait d'un nom seul
const places = (attr: string): string[] => [
  `${S}<button @click=${attr}>b</button>\n`,
  `${S}<button @click={${attr}}>b</button>\n`,
  `${S}<@window @keyup=${attr} />\n<p>x</p>\n`,
  `${S}<@failed err reset>\n<button @click=${attr}>a</button>\n</@failed>\n<p>x</p>\n`,
]

describe('gestionnaire fait d\'un nom seul : mots déclarables, lignes, commentaire de l\'auteur, fonctions refusées', function () {
  this.timeout(60000)

  for (const w of DECLARABLES) {
    it(`« ${w} » déclaré dans le <script> est appelé sur <@window> et dans le fallback d'un <@failed>`, async () => {
      const { code } = await sortie(`<script>\n$n = 0\n${w} = -> $n++\n</script>\n<@window @keyup=${w} />\n<@failed err reset>\n<button @click=${w}>a</button>\n</@failed>\n<p>{$n}</p>\n`)
      assert.ok(code.includes(`addEventListener('click', ${w})`), `fallback : ${w} attaché`)
      assert.ok(code.includes(`return ${w}(e)`), `<@window> : ${w}(e) appelé`)
      assert.ok(!code.includes('undefined(e)') && !code.includes('addEventListener(\'click\', null)'), 'aucun nom neutralisé')
    })
  }

  it('un mot déclarable que rien ne déclare est refusé partout, avec la déclaration à écrire', async () => {
    for (const src of places('on')) {
      const msg = await refus(src)
      assert.match(msg, /nomme « on »/)
      assert.ok(msg.includes('« on = -> … »') && !msg.includes('aucune fonction'), msg)
    }
    const msg = await refus(`${S}<button @click=if>b</button>\n`)
    assert.ok(msg.includes('aucune fonction ne peut porter ce nom'), msg)
  })

  it('<@window> : une valeur sans guillemets qui porte le nom d\'un événement écrit plus bas ne déplace pas la ligne', async () => {
    const msg = await refus('<script>\n$n = 0\n@resize = -> $n++\n</script>\n<@window\n  @scroll=@resize\n  @resize=inconnuR\n/>\n<p>{$n}</p>\n')
    assert.deepEqual(lignes(msg), [7], msg)
  })

  it('<@window> : le même événement écrit avant entre accolades ne déplace pas la ligne', async () => {
    const msg = await refus(`${S}<@window\n  @scroll={-> $n++}\n  @scroll=inconnuS\n/>\n<p>{$n}</p>\n`)
    assert.deepEqual(lignes(msg), [6], msg)
  })

  it('un commentaire écrit par l\'auteur, fait de sauts de ligne seuls, reste tel qu\'écrit', async () => {
    const cas: Array<[string, string, string]> = [
      ['<textarea>', `${S}<textarea aria-label="t">qz<!--\n\n-->wk</textarea>\n<p>{$n}</p>\n`, 'qz<!--\\n\\n-->wk</textarea>'],
      ['valeur d\'attribut', `${S}<p title="qz<!--\n\n-->wk">t</p>\n`, 'title=\'qz<!--\\n\\n-->wk\''],
      ['<title>', `${S}<title>qz<!--\n\n-->wk</title>\n<p>{$n}</p>\n`, '<title>qz<!--\\n\\n-->wk</title>'],
      ['<title> d\'un <@head>', `${S}<@head>\n<title>qz<!--\n\n-->wk</title>\n</@head>\n<p>{$n}</p>\n`, '<title>qz<!--\\n\\n-->wk</title>'],
    ]
    for (const [lieu, src, attendu] of cas) {
      const { code } = await sortie(src)
      assert.ok(code.includes(attendu), `${lieu} : ${attendu} attendu`)
    }
  })

  it('cancelIdleCallback et createImageBitmap sont refusées partout, avec l\'appel à écrire', async () => {
    for (const nom of ['cancelIdleCallback', 'createImageBitmap']) {
      for (const src of places(nom)) {
        const msg = await refus(src)
        assert.ok(msg.includes(`={-> ${nom}(…)} »`), `${nom} : ${msg}`)
      }
    }
  })

  it('setTimeout et setInterval nommés seuls : le seul message des minuteries, partout', async () => {
    for (const [nom, rune] of [['setTimeout', 'µafter'], ['setInterval', 'µevery']]) {
      for (const src of places(nom)) {
        const msg = await refus(src)
        assert.ok(msg.includes(`« ${nom} » est refusé dans un composant`) && msg.includes(rune), msg)
        assert.ok(!msg.includes('appelle la fonction du navigateur'), msg)
      }
    }
  })

  it('les messages disent ce que ferait le nom : constructor est Window, valueOf ne ferait rien ou lèverait', async () => {
    const ctor = await refus(`${S}<button @click=constructor>b</button>\n`)
    assert.ok(ctor.includes('« Window »') && !ctor.includes('Object.prototype.constructor'), ctor)
    const vo = await refus(`${S}<button @click=valueOf>b</button>\n`)
    assert.ok(vo.includes('ne ferait rien ou lèverait') && !vo.includes('lève une erreur à chaque fois'), vo)
  })

  it('l\'avertissement events d\'une méthode citée nue sous le nom valueOf ne la dit ni objet, ni constructeur, ni valeur', async () => {
    const { ecrit } = await sortie('<script>\n$n = 0\n@valueOf = -> $n++\n</script>\n<button @click={valueOf()}>b</button>\n<p>{$n}</p>\n')
    assert.ok(ecrit.includes('« valueOf »'), ecrit)
    assert.ok(!ecrit.includes('d\'un objet, d\'un constructeur ou d\'une valeur'), ecrit)
  })
})
