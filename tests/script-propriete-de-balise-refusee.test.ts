// `@title = …`, `@hidden = …`, `@part = …` en tête du <script> : ce ne sont pas des données du
// composant mais des propriétés de sa balise (HTMLElement), écrites pendant sa construction.
// Mesuré dans Chromium : une propriété en lecture seule (`@children = …`) lève tout de suite, le
// composant tombe au montage quel que soit son chemin — refusée au build. Une propriété reflétée
// (`@title`, `@id`, `@hidden = true`…) pose un attribut sur la balise : créée par le routeur,
// `<@element>` ou `document.createElement`, la balise est refusée (« Fatal Error » au montage) ;
// tirée du HTML d'un parent, elle vit — averti au build (lint.naming), jamais refusé. Plus loin
// (dans `µmount ->`, une méthode), rien ne change, et `$title` (l'état) reste libre.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const compile = (script: string) => transpile(`<script>\n${script}\n</script>\n<p>x</p>\n`, { moduleName: 'carte' })

async function avertissements(script: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await compile(script) } finally { console.warn = orig }
  return vus.filter(m => m.includes('[lint.naming]'))
}

describe('<script> — une propriété de la balise écrite à la construction', () => {
  it('lecture seule (@children, @dataset, @offsetWidth) : refusée, le message dit quoi écrire', async () => {
    for (const nom of ['children', 'dataset', 'offsetWidth']) {
      await assert.rejects(compile(`@${nom} = 1`), (e: Error) => e.message.includes(`@${nom}`) && e.message.includes(`$${nom}`), nom)
    }
  })

  it('reflet (@title, @hidden, @part, @id, @ariaLabel, @textContent) : un avertissement par nom, le build passe', async () => {
    for (const nom of ['title', 'hidden', 'part', 'id', 'ariaLabel', 'textContent']) {
      const vus = await avertissements(`@${nom} = 'x'\n@${nom} = 'y'`)
      assert.equal(vus.length, 1, `${nom} : ${vus.join(' | ')}`)
      assert.ok(vus[0].includes(`@${nom}`) && vus[0].includes(`$${nom}`) && vus[0].includes('µmount'), vus[0])
    }
    assert.equal((await avertissements('if true\n  @title = \'x\'')).length, 1, 'dans un bloc de premier niveau : joué aussi à la construction')
  })

  it('rien : dans µmount ou une méthode, l\'état $title, un autre nom', async () => {
    assert.deepEqual(await avertissements('µmount ->\n  @title = \'x\'\n  @children2 = 1'), [])
    assert.deepEqual(await avertissements('@montrer = -> @hidden = false'), [])
    assert.deepEqual(await avertissements('$title = \'x\'\n$hidden = true'), [])
    assert.deepEqual(await avertissements('@titre = \'x\'\n@cache = true'), [])
    await compile('µmount ->\n  @dataset.x = 1')
  })
})
