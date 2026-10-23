// un alias du composant (`self = @`) vaut dans la fonction qui le pose, pas dans tout le script : le même nom
// donné à un autre objet ailleurs (`self = {}`), une variable de boucle, un paramètre ne sont pas le
// composant : `self.setAttribute = …` ou `el.title = …` dessus n'est ni refusé ni averti

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

// les avertissements `[lint.naming]` d'une compilation qui doit passer (le coffee avertit qu'il est déprécié)
async function compile(lang: string, script: string): Promise<string[]> {
  const orig = console.warn
  const vus: string[] = []
  console.warn = (...a: unknown[]) => { vus.push(String(a[0])) }
  try { await transpile(`<script lang="${lang}">\n${script}\n</script>\n<p>x</p>\n`, { moduleName: 'carte' }) } finally { console.warn = orig }
  return vus.filter(m => m.includes('[lint.naming]'))
}

const refus = (nom: string) => (e: Error) => e.message.includes(`@${nom} = …`) && e.message.includes(`${nom}()`)

describe('alias du composant : il suit sa portée', () => {
  const libres: Array<[string, string, string]> = [
    ['coffee', 'le même nom : alias dans une fonction, autre objet dans une autre', 'init = ->\n  self = @\n  self.x = 1\nautre = ->\n  self = {}\n  self.setAttribute = -> 1\n  self'],
    ['coffee', 'une variable de boucle qui reprend le nom', 'el = @\nliste = []\nfor el in liste\n  el.title = \'x\''],
    ['civet', 'une variable de boucle qui reprend le nom', 'el .= @\nliste := []\nfor el of liste\n  el.title = \'x\''],
    ['civet', 'un alias réaffecté à un autre objet', 'self .= @\nself = {}\nself.setAttribute = -> 1'],
    ['civet', 'un paramètre du même nom', 'self := @\nf := (self) ->\n  self.setAttribute = (n, v) -> 1\n  return'],
    ['civet', 'un paramètre qui n\'est repris pour le composant qu\'après coup', 'f := (self) ->\n  self.setAttribute = (n, v) -> 1\n  self = @\n  return'],
  ]
  for (const [lang, nom, script] of libres) {
    it(`${lang} : ${nom} : ni refus ni avertissement`, async () => {
      assert.deepEqual(await compile(lang, script), [])
    })
  }

  const refusees: Array<[string, string, string]> = [
    ['coffee', 'l\'alias reste un alias dans sa fonction, malgré un homonyme ailleurs', 'init = ->\n  self = @\n  self.setAttribute = (n, v) -> 1\nautre = ->\n  self = {}\n  self.x = 1'],
    ['civet', 'l\'alias vu d\'une fonction imbriquée', 'init = ->\n  self = @\n  [1].forEach (n) -> self.setAttribute = (a, b) -> n'],
  ]
  for (const [lang, nom, script] of refusees) {
    it(`${lang} : ${nom} : refusé`, async () => {
      await assert.rejects(compile(lang, script), refus('setAttribute'))
    })
  }
})
