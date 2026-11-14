// `@click=nom` et `@click=@nom` : le refus cite la ligne du FICHIER, même après un bloc `<@head>`, `<@failed>` ou `<@window>`
// écrit sur plusieurs lignes (le passage des balises du langage retirait leurs lignes avant que le parseur ne compte) ; chaque
// faute n'est donnée qu'une fois (le générateur parcourt le gabarit deux fois) ; un nom que le gabarit fournit (`{for}`,
// `{success}`, `{error}`) écrit avec `@` fait proposer la forme sans `@` ; un nom que les trois navigateurs fournissent n'est
// jamais dit absent (`find` est appelée, `Date` et `console` sont refusés pour ce qu'ils sont) ; les balises globales
// (`<@window>`, `<@document>`, `<@body>`) suivent la même règle que les éléments

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const SCRIPT = '<script>\n$n = 0\n</script>\n'

// le message de l'erreur de construction, '' quand la construction passe
async function refus(src: string, moduleName = 'boutons'): Promise<string> {
  try {
    await transpile(src, { moduleName })
  }
  catch (err: any) {
    return String(err?.message ?? err)
  }
  return ''
}

// les lignes citées par un refus, une par faute, dans l'ordre
const lignes = (msg: string): number[] => [...msg.matchAll(/\(ligne (\d+)\)/g)].map((m) => Number(m[1]))

async function avertissements(src: string, type: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try {
    await transpile(src, { moduleName: 'carte' })
  }
  finally {
    console.warn = orig
  }
  return vus.filter((m) => m.includes(`[lint.${type}]`))
}

describe('gestionnaire fait d\'un nom seul : ligne du fichier, une fois par faute, noms du gabarit et du navigateur, balises globales', () => {
  describe('la ligne du fichier, après un bloc écrit sur plusieurs lignes', () => {
    it('après un <@head> : lignes 7 et 8, chacune une fois', async () => {
      const msg = await refus(`${SCRIPT}<@head>\n<title>x</title>\n</@head>\n<button @click=inconnuA>a</button>\n<button @click=inconnuB>b</button>\n`)
      assert.deepEqual(lignes(msg), [7, 8], msg)
    })

    it('après un <@failed> : ligne 7', async () => {
      const msg = await refus(`${SCRIPT}<@failed err reset>\n<button @click=reset>R</button>\n</@failed>\n<button @click=inconnuC>c</button>\n`)
      assert.deepEqual(lignes(msg), [7], msg)
    })

    it('après un <@window> dont la balise tient sur deux lignes : ligne 8', async () => {
      const msg = await refus('<script>\n$n = 0\n@taille = -> 1\n@touche = -> 2\n</script>\n<@window @resize=@taille\n  @keydown=@touche />\n<button @click=inconnuD>d</button>\n')
      assert.deepEqual(lignes(msg), [8], msg)
    })

    it('après un commentaire qui cite une balise du langage sur deux lignes : ligne 6', async () => {
      const msg = await refus(`${SCRIPT}<!-- <@window> ici\nautrefois -->\n<button @click=inconnuG>g</button>\n`)
      assert.deepEqual(lignes(msg), [6], msg)
    })

    it('dans un <@failed> qui suit un <@head> : ligne 8', async () => {
      const msg = await refus(`${SCRIPT}<@head>\n<title>x</title>\n</@head>\n<@failed err reset>\n<button @click=inconnuF>R</button>\n</@failed>\n`)
      assert.deepEqual(lignes(msg), [8], msg)
    })
  })

  it('une faute du gabarit est donnée une seule fois', async () => {
    const msg = await refus(`${SCRIPT}<button @click=inconnuA>a</button>\n`)
    assert.deepEqual(lignes(msg), [4], msg)
  })

  describe('un nom que le gabarit fournit, écrit avec @', () => {
    it('variable d\'un {for} : propose @click=f', async () => {
      const msg = await refus('<script>\n$fs = [1]\n</script>\n{for f in $fs}\n<button @click=@f>x</button>\n{end}\n')
      assert.match(msg, /« @click=f »/)
      assert.match(msg, /gabarit/)
      assert.doesNotMatch(msg, /Déclarez « @f = -> … »/)
    })

    it('valeur d\'un {success} et d\'un {error} : proposent @click=r et @click=x', async () => {
      const msg = await refus('<script>\n$p = null\n</script>\n{await $p}\n<p>…</p>\n{success r}\n<button @click=@r>x</button>\n{error x}\n<button @click=@x>y</button>\n{end}\n')
      assert.match(msg, /« @click=r »/)
      assert.match(msg, /« @click=x »/)
      assert.doesNotMatch(msg, /Déclarez « @[rx] = -> … »/)
    })
  })

  describe('un nom que les trois navigateurs fournissent n\'est jamais dit absent', () => {
    it('@click=find : acceptée, c\'est une fonction du navigateur', async () => {
      assert.equal(await refus(`${SCRIPT}<button @click=find>f</button>\n`), '')
    })

    for (const nom of ['Date', 'console', 'name', 'navigation', 'URLPattern', 'valueOf']) {
      it(`@click=${nom} : refusé comme objet ou constructeur du navigateur, jamais « introuvable »`, async () => {
        const msg = await refus(`${SCRIPT}<button @click=${nom}>x</button>\n`)
        assert.match(msg, new RegExp(`« ${nom} » est fourni par le navigateur`))
        assert.doesNotMatch(msg, /ni le navigateur ne fournit|is not defined/)
      })
    }

    it('avertissement events d\'une méthode find citée nue : fonction du navigateur, jamais « n\'existe pas »', async () => {
      const vus = await avertissements('<script>\n$n = 0\n@find = -> 1\n</script>\n<button @click={find(1)}>f</button>\n', 'events')
      assert.equal(vus.length, 1, vus.join(' | '))
      assert.match(vus[0], /fonction du navigateur/)
      assert.doesNotMatch(vus[0], /n'existe pas/)
    })
  })

  describe('balises globales : même règle que les éléments', () => {
    for (const [balise, attr] of [['window', '@keydown=inconnuW'], ['document', '@click=inconnuD'], ['body', '@click={inconnuB}']]) {
      it(`<@${balise} ${attr}> : refusé, ligne 4`, async () => {
        const msg = await refus(`${SCRIPT}<@${balise} ${attr} />\n<p>a</p>\n`)
        assert.match(msg, new RegExp(`« ${attr.replace(/[{}]/g, '\\$&')} » appelle la fonction`))
        assert.deepEqual(lignes(msg), [4], msg)
      })
    }

    it('<@window @keydown=@absente> : refusé, méthode introuvable', async () => {
      const msg = await refus(`${SCRIPT}<@window @keydown=@absente />\n<p>a</p>\n`)
      assert.match(msg, /« @keydown=@absente » appelle la méthode « @absente »/)
    })

    it('<@window @keydown=valider> quand le composant a @valider : refusé, propose @keydown=@valider', async () => {
      const msg = await refus('<script>\n$n = 0\n@valider = -> 1\n</script>\n<@window @keydown=valider />\n<p>a</p>\n')
      assert.match(msg, /« @keydown=@valider »/)
    })

    it('la ligne de l\'attribut dans une balise globale sur plusieurs lignes, rangée avec les fautes du gabarit', async () => {
      const msg = await refus(`${SCRIPT}<@window\n  @resize=inconnuR\n/>\n<button @click=inconnuE>e</button>\n`)
      assert.deepEqual(lignes(msg), [5, 7], msg)
    })

    it('ce qui existe passe : méthode, fonction du <script>, fonction du navigateur, appel', async () => {
      const src = '<script>\n$n = 0\n@touche = -> 1\ntaille = -> 2\n</script>\n<@window @keydown=@touche @resize=taille @scroll=alert @blur={taille(1)} />\n<@document @click={@touche} />\n<p>a</p>\n'
      assert.equal(await refus(src), '')
    })
  })
})
