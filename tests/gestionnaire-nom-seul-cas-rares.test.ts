// `@click=nom` dans les cas rares : la ligne citée reste celle du fichier (sur `<@window>`, un événement écrit après un autre dont
// il est le début, `@scroll` après `@scrollend` ; le texte `@keydown` dans un attribut précédent ; un commentaire qui cite une
// balise du langage dans un `<@failed>` ; un `<@element>` écrit sur plusieurs lignes) ; garder ces lignes ne change aucune
// sortie (`<textarea>`, `<title>`, valeur d'attribut, `<@head>`, fallback d'un `<@failed>` : la sortie est celle du même
// gabarit sans le commentaire) ; dans un `<@failed>`, `@click=@nom` appelle la méthode avec le composant pour `this` ; un mot du
// langage, une valeur écrite comme un nom et une fonction du navigateur qui lève quand on l'appelle avec l'événement sont
// refusés à la construction, avec la bonne écriture

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const S = '<script>\n$n = 0\n$xs = [1, 2]\n@k = -> $n++\n</script>\n'

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

async function sortie(src: string): Promise<string> {
  const r: any = await transpile(src, { moduleName: 'cas' })
  return String(r.output)
}

const lignes = (msg: string): number[] => [...msg.matchAll(/\(ligne (\d+)\)/g)].map((m) => Number(m[1]))

// les trois places d'un gestionnaire fait d'un nom seul
const contextes = (nom: string): Array<[string, string]> => [
  ['élément', `${S}<button @click=${nom}>b</button>\n`],
  ['balise globale', `${S}<@window @keydown=${nom} />\n<p>x</p>\n`],
  ['<@failed>', `${S}<@failed err reset>\n<button @click=${nom}>R</button>\n</@failed>\n<p>x</p>\n`],
]

describe('gestionnaire fait d\'un nom seul : cas rares', () => {
  describe('la ligne du fichier', () => {
    it('<@window> : @scroll écrit après @scrollend, ligne 8', async () => {
      const msg = await refus(`${S}<@window\n  @scrollend={-> $n++}\n  @scroll=inconnuS\n/>\n`)
      assert.deepEqual(lignes(msg), [8], msg)
    })

    it('<@window> : @focus écrit après @focusin, ligne 8', async () => {
      const msg = await refus(`${S}<@window\n  @focusin={-> $n++}\n  @focus=inconnuFo\n/>\n`)
      assert.deepEqual(lignes(msg), [8], msg)
    })

    it('<@window> : le texte « @keydown » dans un attribut précédent, ligne 8', async () => {
      const msg = await refus(`${S}<@window\n  @click={-> console.log("@keydown")}\n  @keydown=inconnuK\n/>\n`)
      assert.deepEqual(lignes(msg), [8], msg)
    })

    it('<@window> : le même événement deux fois, lignes 7 et 8', async () => {
      const msg = await refus(`${S}<@window\n  @keydown=inconnu1\n  @keydown=inconnu2\n/>\n`)
      assert.deepEqual(lignes(msg), [7, 8], msg)
    })

    it('un commentaire qui cite une balise du langage dans un <@failed> : lignes 11 et 13', async () => {
      const msg = await refus(`${S}<@failed err reset>\n<p>x</p>\n<!-- c\n<@head>\n-->\n<button @click=inconnuF>R</button>\n</@failed>\n<button @click=inconnuG>g</button>\n`)
      assert.deepEqual(lignes(msg), [11, 13], msg)
    })

    it('après un <@element> écrit sur plusieurs lignes : ligne 7', async () => {
      const msg = await refus('<script>\n$tag = "div"\n</script>\n<@element $tag\n  class="a"\n>x</@element>\n<button @click=inconnuE>b</button>\n')
      assert.deepEqual(lignes(msg), [7], msg)
    })
  })

  describe('garder les lignes ne change aucune sortie : celle du même gabarit sans le commentaire', () => {
    const cas: Array<[string, string, string]> = [
      ['<textarea>', `${S}<textarea>avant`, `après</textarea>\n<p>{$n}</p>\n`],
      ['<title>', `${S}<title>t`, `u</title>\n<p>{$n}</p>\n`],
      ['valeur d\'attribut', `${S}<div title="a`, `c">{$n}</div>\n`],
      ['<@head>', `${S}<@head>\n<title>x</title>\n`, `\n<meta name="a">\n</@head>\n<p>{$n}</p>\n`],
      ['fallback d\'un <@failed>', `${S}<@failed err reset>\n<p>x</p>\n`, `\n<button @click=@k>R</button>\n</@failed>\n<p>{$n}</p>\n`],
    ]
    for (const [nom, avant, apres] of cas) {
      it(nom, async () => {
        assert.equal(await sortie(`${avant}<!-- voir\n<@head>\n-->${apres}`), await sortie(`${avant}${apres}`))
      })
    }
  })

  it('<@failed> : @click=@k et @click={@k} appellent la méthode avec le composant pour this', async () => {
    for (const ecrit of ['@k', '{@k}']) {
      const out = await sortie(`${S}<@failed err reset>\n<button @click=${ecrit}>R</button>\n</@failed>\n<p>x</p>\n`)
      assert.doesNotMatch(out, /addEventListener\('click', this\.k\)/, ecrit)
      assert.match(out, /addEventListener\('click', \(event\) => this\.k\(event\)\)/, ecrit)
    }
  })

  describe('refusés à la construction, dans les trois places', () => {
    for (const nom of ['if', 'return', 'new', 'class', 'typeof', 'delete', 'void', 'await', 'yield', 'function', 'do', 'then', 'unless', 'loop', 'yes', 'no', 'on', 'off']) {
      it(`le mot du langage « ${nom} »`, async () => {
        for (const [ou, src] of contextes(nom)) {
          const msg = await refus(src)
          // un mot que Civet prend pour un nom (`on`, `yes`…) se dit « un mot du langage » que rien ne déclare
          assert.match(msg, new RegExp(`« ${nom} », (qui est )?un mot du langage`), `${ou} : ${msg}`)
          assert.deepEqual(lignes(msg).length, 1, `${ou} : ${msg}`)
        }
      })
    }

    for (const nom of ['null', 'undefined', 'true', 'false', 'this', 'NaN', 'Infinity']) {
      it(`la valeur « ${nom} »`, async () => {
        for (const [ou, src] of contextes(nom)) {
          const msg = await refus(src)
          assert.match(msg, new RegExp(`« ${nom} », qui est une valeur, pas une fonction`), `${ou} : ${msg}`)
        }
      })
    }

    for (const nom of ['requestIdleCallback', 'queueMicrotask', 'structuredClone', 'postMessage', 'requestAnimationFrame', 'atob', 'getComputedStyle', 'dispatchEvent']) {
      it(`la fonction du navigateur « ${nom} », qui lève quand on l'appelle avec l'événement`, async () => {
        for (const [ou, src] of contextes(nom)) {
          const msg = await refus(src)
          const attr = ou === 'balise globale' ? '@keydown' : '@click'
          assert.match(msg, new RegExp(`fonction du navigateur « ${nom} »`), `${ou} : ${msg}`)
          assert.ok(msg.includes(`« ${attr}={-> ${nom}(…)} »`), `${ou} : ${msg}`)
        }
      })
    }
  })

  it('une fonction du navigateur qui accepte l\'événement passe toujours (alert, print, find)', async () => {
    for (const nom of ['alert', 'print', 'find']) {
      for (const [ou, src] of contextes(nom)) assert.equal(await refus(src), '', `${nom}, ${ou}`)
    }
  })

  it('valueOf et constructor : refusés pour ce qu\'ils sont, des propriétés que la fenêtre hérite comme tout objet', async () => {
    for (const nom of ['valueOf', 'constructor', 'hasOwnProperty']) {
      const msg = await refus(`${S}<button @click=${nom}>b</button>\n`)
      // `constructor`, lu sur la fenêtre, est `Window`, pas `Object.prototype.constructor`
      assert.match(msg, nom === 'constructor' ? /« Window »/ : new RegExp(`Object\\.prototype\\.${nom}`), msg)
      assert.doesNotMatch(msg, /un objet, un constructeur ou une valeur/, msg)
    }
  })
})
