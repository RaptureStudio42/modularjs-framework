// `@sock` posé par le <script> d'une autre façon que `@sock = …` : déstructuration (`[@sock] = …`,
// `{ sock: @sock } = …`), `Object.assign @, { sock }`, un gestionnaire du HTML (`@click={ @sock = … }`).
// Le build disait à tort « ce composant ne pose pas @sock » : un effet en direct qui prend sa connexion
// dans `@sock` (sur <@document> ou sur une balise) doit les reconnaître. Un composant qui ne pose pas
// `@sock` reste refusé ; une écriture dont le nom ne se lit pas au build (`Object.assign @, reglages`)
// ne refuse jamais : un build qui marche ne tombe pas sur une erreur sans objet.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const SOCK    = "µsocket 'wss://x.fr/ws'"
const doc     = (script: string) => `<script>\n${script}\n</script>\n<@document *follow>\n<p>z</p>\n`
const balise  = (script: string) => `<script>\n${script}\n</script>\n<div *follow>z</div>\n`
const compile = (src: string) => transpile(src, { moduleName: 'carte' })

describe('@sock posé autrement que par `@sock = …`', () => {
  const posees: Array<[string, string]> = [
    ['référence : @sock = …', `@sock = ${SOCK}`],
    ['déstructuration d\'un tableau', `[@sock] = [${SOCK}]`],
    ['déstructuration d\'un objet', `{ sock: @sock } = { sock: ${SOCK} }`],
    ['déstructuration avec valeur par défaut', `[@sock = ${SOCK}] = []`],
    ['Object.assign @, { sock }', `sock = ${SOCK}\nObject.assign @, { sock }`],
    ['Object.assign @, { sock: … }', `Object.assign @, { sock: ${SOCK} }`],
    ['dans une fonction', `@connecter = ->\n  [@sock] = [${SOCK}]`],
    ['@@sock', `@@sock = ${SOCK}`],
    ['variable d\'une boucle for…of', 'for (@sock of [1]) { break }'],
    ['variable d\'une boucle for…in', 'for (@sock in { a: 1 }) { break }'],
    ['par un alias de @', `self = @\nself.sock = ${SOCK}`],
    ['par un alias constant', `self := @\nself.sock = ${SOCK}`],
    ['par un alias posé dans une fonction', `@connecter = ->\n  self = @\n  self.sock = ${SOCK}`],
    ['Object.assign sur un alias', `self = @\nObject.assign self, { sock: ${SOCK} }`],
  ]
  for (const [nom, script] of posees) {
    it(`${nom} : plus de fausse erreur, sur <@document> comme sur une balise`, async () => {
      await compile(doc(script))
      await compile(balise(script))
    })
  }

  it('un gestionnaire du HTML qui pose @sock : plus de fausse erreur', async () => {
    await compile(`<@document *follow>\n<button @click={ @sock = ${SOCK} }>go</button>\n`)
    await compile(`<div *follow>z</div>\n<button @click={ [@sock] = [${SOCK}] }>go</button>\n`)
    await compile(`<div *follow>z</div>\n<button @click={ { sock: @sock } = { sock: ${SOCK} } }>go</button>\n`)
  })

  it('une écriture dont le nom ne se lit pas au build n\'est jamais refusée', async () => {
    await compile(doc('reglages = { sock: 1 }\nObject.assign @, reglages'))
    await compile(doc('nom = \'sock\'\n@[nom] = 1'))
    await compile(balise('reglages = { sock: 1 }\nObject.assign @, reglages'))
  })

  it('ce qui ne pose pas @sock reste refusé', async () => {
    const attendu = /que ce composant ne pose pas/
    await assert.rejects(compile('<@document *follow>\n<p>z</p>\n'), attendu)
    await assert.rejects(compile(doc('@autre = 1')), attendu)
    await assert.rejects(compile(doc('[@autre] = [1]')), attendu)
    await assert.rejects(compile(doc('Object.assign @, { autre: 1 }')), attendu)
    await assert.rejects(compile(doc('{ a: @sockets } = { a: 1 }')), attendu)
    await assert.rejects(compile(balise('[@autre] = [1]')), attendu)
    await assert.rejects(compile('<@document *follow>\n<button @click={ @autre = 1 }>go</button>\n'), attendu)
    await assert.rejects(compile('<@document *follow>\n<button @click={ x = @sock }>go</button>\n'), attendu)
  })
})
