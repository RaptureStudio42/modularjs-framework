// écriture par la valeur que rend une méthode qui modifie une liste de l'état (`$pile.pop().fait = true`, `$file.shift().vu++`,
// `$l.splice(i, 1)[0].n = v`, `$l.sort(f)[0].x = v`, `$l.reverse()[i].n = v`, `$l.fill(o)[0].n = 1`, `delete $l.pop().n`,
// `$g.pop().push(1)`) : la méthode est compilée (elle prévient l'écran), puis l'écriture par sa valeur se compile à son tour — en
// JavaScript, CoffeeScript et Civet, dans le script et dans un gestionnaire, avec le réglage `proxy: false` comme sans lui. Avec le
// réglage, l'écriture passe par l'aide gardée du composant (une clé venue de l'extérieur n'y atteint aucun prototype) ; une clé
// calculée prise dans la méthode compilée (`$g[i].pop()`) reste celle du chemin compilé

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const FORMES_JS = [
  '$pile.pop().fait = true',
  '$pile.shift().vu++',
  '$pile.splice(i, 1)[0].n = 1',
  '$pile.sort((a, b) => a.n - b.n)[0].premier = true',
  '$pile.reverse()[i].n = 1',
  '$pile.fill({ n: 0 })[0].n = 1',
  'delete $pile.pop().n',
  '$lignes.pop().push(1)',
  '$pile.pop()[k].n = 1',
  '$grille[i].pop()[k].n = 1',
  'delete $pile.pop()?.n',
  '$lignes.pop()?.push(1)',
]
const FORMES_COFFEE = ['$pile.pop().fait = true', '$pile.shift().vu++', '$pile.splice(i, 1)[0].n = 1', 'delete $pile.pop().n', '$lignes.pop().push 1', '$pile.pop()[k].n = 1']
const FORMES_CIVET  = ['$pile.pop().fait = true', '$pile.shift().vu++', '$pile.splice(i, 1)[0].n = 1', 'delete $pile.pop().n', '$lignes.pop().push 1', '$pile.pop()[k].n = 1']

const ETAT_JS = '$pile = [{ n: 0 }, { n: 1 }];\n  $lignes = [[1]];\n  $grille = [[{ n: 0 }]];\n  let i = 0, k = \'n\';'
const ETAT    = '$pile = [{ n: 0 }, { n: 1 }]\n  $lignes = [[1]]\n  i = 0\n  k = \'n\''

// le composant d'une forme : dans le script (méthode), puis dans un gestionnaire
function source(lang: string, forme: string, gestionnaire: boolean): string {
  if (lang === 'js') return `<script lang="js">\n  ${ETAT_JS}\n  @f = function() { ${gestionnaire ? '' : forme + ';'} };\n</script>\n${gestionnaire ? `<button @click={${forme}}>b</button>\n` : ''}<p>{$pile.length}</p>\n`
  return `<script${lang === 'coffee' ? ' lang="coffee"' : ''}>\n  ${ETAT}\n  @f = -> ${gestionnaire ? 'null' : forme}\n</script>\n${gestionnaire ? `<button @click={${forme}}>b</button>\n` : ''}<p>{$pile.length}</p>\n`
}

describe('écriture par le retour d\'une méthode qui modifie une liste de l\'état : compilée, avec et sans le réglage proxy: false', function () {
  this.timeout(120000)
  after(() => terminateSharedWorkerPool())

  for (const [lang, formes] of [['js', FORMES_JS], ['coffee', FORMES_COFFEE], ['civet', FORMES_CIVET]] as [string, string[]][]) {
    it(`${lang} : chaque forme se compile, dans le script et dans un gestionnaire, dans les deux modes`, async () => {
      const echecs: string[] = []
      for (const forme of formes) for (const gestionnaire of [false, true]) for (const proxy of [false, true]) {
        try {
          const r: any = await transpile(source(lang, forme, gestionnaire), { moduleName: 'x', ...(proxy ? {} : { proxy: false }) } as any)
          // avec le réglage, l'écriture par la valeur rendue passe par l'aide gardée du composant
          if (!proxy && !/_mjs_deep(?:Set|Call|Delete)On\(/.test(r.output)) echecs.push(`${forme} [${gestionnaire ? 'gestionnaire' : 'script'}, proxy: false] : écriture non gardée`)
        }
        catch (e: any) {
          echecs.push(`${forme} [${gestionnaire ? 'gestionnaire' : 'script'}, ${proxy ? 'défaut' : 'proxy: false'}] : ${String(e.message).slice(0, 120)}`)
        }
      }
      assert.deepEqual(echecs, [])
    })
  }
})
