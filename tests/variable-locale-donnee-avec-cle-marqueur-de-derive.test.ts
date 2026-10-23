// Une donnée reçue qui porte la clé `_mjs_c` (dictionnaire aux clés choisies par un utilisateur, JSON d'un
// serveur), rangée dans une variable d'un composant (`$data = JSON.parse(…)`), se remplace et se vide comme
// n'importe quelle autre. Défaut garanti absent : la variable était figée — `$data = { nom: 'y' }` et
// `$data = null` étaient ignorés en silence, l'écran gardait l'ancienne valeur. Cette clé marque l'enveloppe
// d'une valeur dérivée compilée, qui porte toujours sa fonction `f` : une donnée n'en est pas une.

import assert from 'node:assert/strict'
import { monterHote, pause } from './helpers/coeur-monter.js'

const SOURCE = [
  '<script>',
  '$data = null',
  '$n = 2',
  '$double = $n * 2',
  'charger = -> $data = JSON.parse(\'{"_mjs_c":1,"nom":"x"}\')',
  'changer = -> $data = { nom: \'y\' }',
  'vider = -> $data = null',
  'monter = -> $n = 5',
  '</script>',
  '<p class="n">{$data?.nom}</p>',
  '<p class="d">{$double}</p>',
  '<button class="a" @click={charger()}>a</button>',
  '<button class="b" @click={changer()}>b</button>',
  '<button class="c" @click={vider()}>c</button>',
  '<button class="m" @click={monter()}>m</button>',
].join('\n')

describe('variable de composant : donnée qui porte la clé `_mjs_c`', function () {
  this.timeout(60000)

  it('se remplace et se vide comme toute donnée ; une valeur dérivée suit toujours sa source', async () => {
    const { hote, erreurs } = await monterHote(SOURCE, 'marqueur-local')
    const sh = hote._shadow
    sh.querySelector('.a').click(); await pause(60)
    assert.equal(sh.querySelector('.n').textContent, 'x')
    sh.querySelector('.b').click(); await pause(60)
    assert.equal(sh.querySelector('.n').textContent, 'y', 'AVANT : la variable restait figée sur la donnée marquée')
    sh.querySelector('.c').click(); await pause(60)
    assert.equal(sh.querySelector('.n').textContent, '', 'AVANT : vider la variable était ignoré')
    assert.equal(sh.querySelector('.d').textContent, '4')
    sh.querySelector('.m').click(); await pause(60)
    assert.equal(sh.querySelector('.d').textContent, '10', 'témoin : la valeur dérivée suit sa source')
    assert.equal(erreurs.length, 0, erreurs.join(' | '))
  })
})
