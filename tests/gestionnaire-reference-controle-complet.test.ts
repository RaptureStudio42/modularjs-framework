// `@click=nom` et `@click={nom}` (un nom seul, avec ou sans accolades) appellent la fonction `nom` ; `@click=@nom` et
// `@click={@nom}` la méthode `@nom` du composant. Un nom que rien ne fournit arrête la construction : à la ligne de
// l'attribut (balise écrite sur plusieurs lignes comprise), dans le fallback d'un `<@failed>` comme ailleurs, et toutes
// les fautes d'un fichier dans un seul arrêt. Une fonction du navigateur passe (la liste vient de la déclaration
// TypeScript du DOM et des fonctions globales de JavaScript, sans les noms propres à Node) et s'appelle sans la balise
// pour `this` : appelée avec la balise, `alert` levait « Illegal invocation » au clic.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { getMessagesLang, setMessagesLang } from '../src/messages/index.js'

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

// le code produit
async function produit(src: string): Promise<string> {
  const r: any = await transpile(src, { moduleName: 'boutons' })
  return String(r?.output ?? r?.code ?? '')
}

describe('gestionnaire — contrôle complet des références `@click=nom` et `@click={nom}`', function () {
  this.timeout(60000)

  it('une fonction du navigateur qui accepte l\'événement passe (reportError, alert…), un nom propre à Node est refusé', async () => {
    // celles qui lèvent quand elles reçoivent l'événement (requestIdleCallback, queueMicrotask…) sont refusées, avec l'écriture `@click={-> nom(…)}`
    for (const nom of ['requestIdleCallback', 'queueMicrotask', 'structuredClone', 'getComputedStyle']) {
      assert.match(await refus(SCRIPT + `<button @click=${nom}>x</button>\n`), new RegExp(`« @click=\\{-> ${nom}\\(…\\)\\} »`), nom)
    }
    for (const nom of ['reportError', 'alert', 'print', 'close', 'parseInt']) {
      assert.equal(await refus(SCRIPT + `<button @click=${nom}>x</button>\n`), '', nom)
    }
    for (const nom of ['Buffer', 'process', 'setImmediate', 'global']) {
      assert.match(await refus(SCRIPT + `<button @click=${nom}>x</button>\n`), new RegExp(`« ${nom} »`), nom)
    }
  })

  it('une fonction du navigateur s\'appelle sans la balise pour `this` ; une fonction du <script> du même nom garde sa forme', async () => {
    const code = await produit(SCRIPT + '<button @click=alert>x</button>\n<button @click={print}>y</button>\n<button @click.stop=close>z</button>\n')
    assert.match(code, /alert\(e, el\)/)
    assert.match(code, /print\(e, el\)/)
    // `requestIdleCallback` est refusée (elle lève quand elle reçoit l'événement) : `close` porte le modificateur
    assert.match(code, /close\(e, el\)/)
    const propre = await produit('<script>\n$n = 0\nstop = -> $n++\n</script>\n<button @click=stop>x</button>\n')
    assert.doesNotMatch(propre, /stop\(e, el\)/)
  })

  it('balise écrite sur plusieurs lignes : le message donne la ligne de l\'attribut', async () => {
    assert.match(await refus(SCRIPT + '<button\n  class="a"\n  @click=inconnu\n>x</button>\n'), /ligne 6\)/)
    assert.match(await refus(SCRIPT + '<input\n  @input={inconnu}\n  @change=@absente>\n'), /ligne 5\)[\s\S]*ligne 6\)/)
  })

  it('`@click=@envoyer` quand `envoyer` vient d\'un `@import` : le message dit « importée »', async () => {
    const msg = await refus("@import envoyer './outils.js'\n" + SCRIPT + '<button @click=@envoyer>x</button>\n')
    assert.match(msg, /importée/)
    assert.match(msg, /@click=envoyer/)
    assert.match(await refus('<script>\n$n = 0\nvalider = -> 1\n</script>\n<button @click=@valider>x</button>\n'), /fonction du <script>/)
  })

  it('`<@failed>` : un nom que rien ne fournit est refusé, ligne nommée ; ses paramètres, le <script> et le navigateur passent', async () => {
    const failed = (bouton: string, params = 'err reset') => SCRIPT + `<@failed ${params}>\n<p>x</p>\n${bouton}\n</@failed>\n<p>{$n}</p>\n`
    const msg = await refus(failed('<button @click=inconnu>R</button>'))
    assert.match(msg, /ligne 6\)/)
    assert.match(msg, /« inconnu »/)
    assert.match(await refus(failed('<button @click={inconnu}>R</button>')), /« inconnu »/)
    assert.match(await refus(failed('<button @click=@absente>R</button>')), /« @absente »/)
    const passent = [
      failed('<button @click=reset>R</button>'),
      failed('<button @click={reset()}>R</button>'),
      failed('<button @click=retente>R</button>', 'e retente'),
      failed('<button @click=alert>R</button>'),
      '<script>\n$n = 0\nrelance = -> 1\n@remet = -> 2\n</script>\n<@failed err reset>\n<button @click=relance>R</button>\n<button @click=@remet>M</button>\n</@failed>\n<p>{$n}</p>\n',
    ]
    for (const src of passent) assert.equal(await refus(src), '', src)
  })

  it('toutes les fautes d\'un fichier dans un seul arrêt, chacune avec sa ligne', async () => {
    const msg = await refus(SCRIPT + '<button @click=faux1>a</button>\n<button @click=@faux2>b</button>\n<button @click={faux3}>c</button>\n<@failed err reset>\n<button @click=faux4>R</button>\n</@failed>\n<p>{$n}</p>\n')
    assert.match(msg, /ligne 4\)[^\n]*« faux1 »/)
    assert.match(msg, /ligne 5\)[^\n]*« @faux2 »/)
    assert.match(msg, /ligne 6\)[^\n]*« faux3 »/)
    assert.match(msg, /ligne 8\)[^\n]*« faux4 »/)
  })

  it('un nom seul entre accolades suit la même règle que sans accolades', async () => {
    // `null` et `undefined` lèvent à chaque clic sur un élément : refusés, entre accolades comme sans
    for (const nom of ['null', 'undefined']) assert.match(await refus(SCRIPT + `<button @click={${nom}}>x</button>\n`), new RegExp(`« ${nom} », qui est une valeur`), nom)
    const msg = await refus(SCRIPT + '<button @click={inconnu}>x</button>\n')
    assert.match(msg, /ligne 4\)/)
    assert.match(msg, /« @click=\{inconnu\} »/)
    assert.match(await refus('<script>\n$n = 0\n@valider = -> $n++\n</script>\n<button @click={valider}>ok</button>\n'), /@click=\{@valider\}/)
    assert.match(await refus(SCRIPT + '<button @click={@absente}>ok</button>\n'), /« @absente »/)
    const passent = [
      '<script>\najoute = -> 1\n</script>\n<button @click={ajoute}>x</button>\n',
      '<script>\n$fonctions = []\n</script>\n{for f in $fonctions}<button @click={f}>x</button>{end}\n',
      SCRIPT + '<button @click={alert}>x</button>\n',
      '<script>\n$n = 0\n@valider = -> $n++\n</script>\n<button @click={@valider}>x</button>\n<button @click={o.valider}>y</button>\n',
    ]
    for (const src of passent) assert.equal(await refus(src), '', src)
  })

  it('les messages existent en anglais', async () => {
    const avant = getMessagesLang()
    setMessagesLang('en')
    try {
      assert.match(await refus(SCRIPT + '<button\n  @click=inconnu>x</button>\n'), /line 5\)/)
      assert.match(await refus("@import envoyer './outils.js'\n" + SCRIPT + '<button @click=@envoyer>x</button>\n'), /imported/)
    }
    finally {
      setMessagesLang(avant)
    }
  })
})
