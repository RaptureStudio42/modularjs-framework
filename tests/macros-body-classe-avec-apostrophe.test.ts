// une classe de <@body>/<@html> qui porte une apostrophe (valeurs arbitraires à la Tailwind :
// `bg-[url('/a.png')]`, `content-['x']`) arrive telle quelle sur l'élément. Collée nue entre apostrophes
// dans le code produit, elle le cassait : à l'exécution pour `@class{…}="…"` (construction verte, erreur au
// montage), à la construction pour `class="…"` (erreur Civet qui ne citait ni la balise ni la classe)

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote } from './helpers/coeur-monter.js'

describe('<@body> — une classe qui porte une apostrophe arrive telle quelle', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('@class{…}="…" : la classe exacte est posée sur document.body', async () => {
    const { window } = await monterHote([
      '<script>',
      '  $sombre = true',
      '</script>',
      `<@body @class{$sombre}="bg-[url('/a.png')] fond">`,
      '<p>{$sombre}</p>',
    ].join('\n'), 'body-classe-apostrophe-dyn')
    const classes = [...window.document.body.classList]
    assert.ok(classes.includes("bg-[url('/a.png')]"), `classes du body : ${JSON.stringify(classes)}`)
    assert.ok(classes.includes('fond'), `classes du body : ${JSON.stringify(classes)}`)
  })

  it('class="…" statique sur <@html> : la construction passe et la classe exacte est posée', async () => {
    const { window } = await monterHote([
      '<script>',
      '  $n = 0',
      '</script>',
      `<@html class="content-['x'] fond">`,
      '<p>{$n}</p>',
    ].join('\n'), 'body-classe-apostrophe-stat')
    const classes = [...window.document.documentElement.classList]
    assert.ok(classes.includes("content-['x']"), `classes de <html> : ${JSON.stringify(classes)}`)
    assert.ok(classes.includes('fond'), `classes de <html> : ${JSON.stringify(classes)}`)
  })
})
