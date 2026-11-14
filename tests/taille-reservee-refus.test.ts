// `@size="largeurxhauteur"` sur la balise d'un composant de l'appli : la place que garde sa balise tant que son code n'est pas arrivé
// (fichiers séparés). À la construction : un attribut fixe sur la balise et, dans le style de base du composant qui l'écrit, une règle par
// valeur qui ne vaut que tant que la balise n'est pas définie (ni rendue par le serveur) ; rien du tout pour un composant qui ne l'écrit
// pas, et jamais l'écoute d'un événement « size ». Refusés à la construction, avec la forme à écrire : une valeur mal écrite, une valeur
// tenue par une variable, et `@size` sur une balise qui n'est pas un composant de l'appli. En développement seulement, le composant qui
// l'écrit compare la taille de l'enfant arrivé à celle annoncée

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { setMessagesLang } from '../src/messages/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const page = (balise: string): string => `<script lang="coffee">\n$l = 320\n</script>\n\n<h1>titre</h1>\n${balise}\n<p>après</p>\n`

const regle = (ecrit: string, decl: string): string => `[mjs-size="${ecrit}"]:not(:defined):not([mjs-ssr]){display:block;box-sizing:border-box;${decl};overflow:hidden}`

describe('@size : la place gardée d\'un composant dont le code arrive après la page', function () {
  this.timeout(60000)
  afterEach(() => setMessagesLang('fr'))
  after(async () => { await terminateSharedWorkerPool() })

  const VALIDES: Array<[string, string]> = [['320x48', 'width:320px;height:48px'], ['100%x48', 'width:100%;height:48px'], ['x48', 'height:48px'], ['20remx3.5em', 'width:20rem;height:3.5em'], ['50vwx10vh', 'width:50vw;height:10vh'], ['12emx40px', 'width:12em;height:40px']]
  for (const [ecrit, decl] of VALIDES) {
    it(`@size="${ecrit}" : un attribut fixe sur la balise, une règle qui ne vaut que tant qu'elle n'est pas définie`, async () => {
      const { data, output } = await transpile(page(`<mjs-carte :size="${ecrit}"></mjs-carte>`), { moduleName: 'mjs-place' })
      assert.ok(data.baseCss.includes(regle(ecrit, decl)), `la règle de ${ecrit} : ${data.baseCss}`)
      assert.match(output, new RegExp(`mjs-size=\\\\?['"]${ecrit.replace(/[.%]/g, '\\$&')}\\\\?['"]`), 'l\'attribut posé sur la balise')
      assert.equal(Object.keys(data.events ?? {}).includes('size'), false, 'jamais l\'écoute d\'un événement « size »')
    })
  }

  it('<@carte :size="x48"> : la balise écrite avec @ reçoit la place', async () => {
    const { data, output } = await transpile(page('<@carte :size="x48"></@carte>'), { moduleName: 'mjs-place-arobase' })
    assert.ok(data.baseCss.includes(regle('x48', 'height:48px')), data.baseCss)
    assert.match(output, /mjs-carte[^>]*mjs-size=/, 'l\'attribut posé sur la balise')
  })

  it('deux valeurs : deux règles ; la même valeur deux fois : une seule', async () => {
    const { data } = await transpile(page('<mjs-carte :size="320x48"></mjs-carte><mjs-carte :size="x48"></mjs-carte><mjs-fiche :size="320x48"></mjs-fiche>'), { moduleName: 'mjs-place-deux' })
    assert.equal(data.baseCss.split(':not(:defined):not([mjs-ssr])').length - 1, 2, data.baseCss)
  })

  it('un composant qui ne l\'écrit pas : ni attribut ni règle', async () => {
    const { data, output } = await transpile(page('<mjs-carte></mjs-carte>'), { moduleName: 'mjs-sans-place' })
    assert.equal(data.baseCss.includes('mjs-size'), false, data.baseCss)
    assert.equal(output.includes('mjs-size'), false)
  })

  it('développement : la taille de l\'enfant arrivé comparée à celle annoncée ; production : rien', async () => {
    const dev  = await transpile(page('<mjs-carte :size="320x48"></mjs-carte>'), { moduleName: 'mjs-place-dev', devWarnings: true })
    const prod = await transpile(page('<mjs-carte :size="320x48"></mjs-carte>'), { moduleName: 'mjs-place-prod' })
    assert.ok(dev.output.includes('[mjs-size]:not(:defined)') && dev.output.includes('whenDefined'), 'la comparaison posée en développement')
    assert.equal(prod.output.includes('[mjs-size]:not(:defined)'), false, 'rien en production')
  })

  for (const ecrit of [':size="320"', ':size="320x"', ':size="axb"', ':size="320x48pt"', ':size="0x48"', ':size="320x0"', ':size="320 x 48"', ':size={$l}', ':size']) {
    it(`<mjs-carte ${ecrit}> : refus qui donne la forme à écrire`, async () => {
      await assert.rejects(() => transpile(page(`<mjs-carte ${ecrit}></mjs-carte>`), { moduleName: 'mjs-place-refus' }), (e: any) => {
        assert.ok(e.message.includes(`« ${ecrit} »`), e.message)
        assert.ok(e.message.includes(':size="320x48"') && e.message.includes(':size="x48"'), 'la forme à écrire')
        assert.match(e.message, /sans accolades ni variable/, 'la valeur s\'écrit en dur')
        assert.ok(e.message.includes('µmount') && !e.message.includes('.propagate'), 'l\'écoute d\'un événement « size » se pose dans µmount, jamais par :size.propagate')
        assert.match(e.message, /docs\/02-composant\.md/)
        return true
      })
    })
  }

  for (const [balise, ecrit] of [['div', '<div :size="320x48"></div>'], ['mjs-core-switch', '<mjs-core-switch :size="320x48"></mjs-core-switch>']]) {
    it(`<${balise} @size> : refus, la place se garde sur la balise d'un composant de l'appli`, async () => {
      await assert.rejects(() => transpile(page(ecrit), { moduleName: 'mjs-place-balise' }), (e: any) => {
        assert.ok(e.message.includes(`« :size » sur une balise <${balise}>`), e.message)
        assert.ok(e.message.includes('<@carte :size="320x48">'), 'la forme à écrire')
        return true
      })
    })
  }

  for (const ecrit of ['<@window :size="320x48">', '<@document :size="0">', '<@element :size="320x48"></@element>']) {
    it(`${ecrit} : refus, une balise du langage n'est pas un composant de l'appli, jamais l'écoute d'un événement « size »`, async () => {
      const balise = /^<(@\w+)/.exec(ecrit)![1]
      // les balises du langage rendent leurs refus avec ceux du gabarit (`macroErrors`), que la construction donne comme erreurs
      const { data, output } = await transpile(page(ecrit), { moduleName: 'mjs-place-langage' })
      const dit = (data.macroErrors ?? []).join('\n')
      assert.ok(dit.includes(`« :size » sur une balise <${balise}>`), dit)
      assert.ok(dit.includes('<@carte :size="320x48">') && dit.includes('µmount'), 'la forme à écrire, l\'écouteur posé à la main')
      assert.equal(output.includes('mjs-size'), false, 'aucune place')
    })
  }

  it(':size.propagate={…} sur un composant : refus, ni l\'écoute d\'un événement « size », ni la place', async () => {
    await assert.rejects(() => transpile(page('<mjs-carte :size.propagate={$l = 1}></mjs-carte>'), { moduleName: 'mjs-place-evenement' }), (e: any) => {
      assert.match(e.message, /modificateur d'événement/)
      assert.ok(e.message.includes('µmount'), e.message)
      return true
    })
  })

  it('anglais : le refus dans la langue choisie', async () => {
    setMessagesLang('en')
    await assert.rejects(() => transpile(page('<mjs-carte :size="320"></mjs-carte>'), { moduleName: 'mjs-place-en' }), (e: any) => {
      assert.ok(e.message.includes('":size="320""') && e.message.includes(':size="320x48"'), e.message)
      assert.match(e.message, /the space this component's tag keeps/)
      return true
    })
  })
})
