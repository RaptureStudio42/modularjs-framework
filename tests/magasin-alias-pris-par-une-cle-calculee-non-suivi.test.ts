// magasin global, la limite écrite au chapitre 14 : une variable prise entre crochets dans `µ.store` (`x = µ.store[k]`, même
// `µ.store['cfg']`, ou `s[k]`) ne suit pas une écriture faite par elle deux niveaux plus bas — l'écran garde la valeur d'avant ; au premier
// niveau (`x.top = v`), elle est suivie ; écrire par le chemin (`µ.store[k].sous.valeur`) ou prendre la clé par un point (`µ.store.cfg`)
// ou par `$$cfg` est suivi. Développement et production
import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const SOURCE = [
  '<script lang="coffee">',
  '$$cfg = { sous: { valeur: \'depart\' }, top: \'t0\' }',
  '@a = (k) ->',
  '  x = µ.store[k]',
  '  x.sous.valeur = \'A\'',
  '@b = (k) -> µ.store[k].sous.valeur = \'B\'',
  '@c = ->',
  '  x = µ.store.cfg',
  '  x.sous.valeur = \'C\'',
  '@d = (k) ->',
  '  x = µ.store[k].sous',
  '  x.valeur = \'D\'',
  '@e = ->',
  '  x = $$cfg',
  '  x.sous.valeur = \'E\'',
  '@f = (k) ->',
  '  s = µ.store',
  '  x = s[k]',
  '  x.sous.valeur = \'F\'',
  '@g = ->',
  '  x = µ.store[\'cfg\']',
  '  x.sous.valeur = \'G\'',
  '@h = (k) ->',
  '  x = µ.store[k]',
  '  x.top = \'H\'',
  '@i = ->',
  '  x = µ.store[\'cfg\']',
  '  x.top = \'I\'',
  '</script>',
  '<p class="v">{$$cfg ? $$cfg.sous.valeur : \'-\'}</p><p class="t">{$$cfg ? $$cfg.top : \'-\'}</p>',
].join('\n')

describe('magasin global : alias pris entre crochets, non suivi deux niveaux plus bas (limite écrite)', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })
  for (const [mode, reglages] of [['développement', {}], ['production', { env: 'prod', minify: false }]] as const) {
    it(`${mode} : deux niveaux plus bas, seuls le chemin et la clé prise par un point ou par $$cfg sont suivis ; au premier niveau, l'alias l'est aussi`, async () => {
      const { hote, erreurs } = await monterHote(SOURCE, 'sonde-cle-calc', reglages)
      const texte = () => hote._shadow.querySelector('.v').textContent.trim() + '|' + hote._shadow.querySelector('.t').textContent.trim()
      const vu    = [texte()]
      for (const [m, arg] of [['a', 'cfg'], ['b', 'cfg'], ['c', null], ['d', 'cfg'], ['e', null], ['f', 'cfg'], ['g', null], ['h', 'cfg'], ['i', null]] as const) {
        hote[m](arg)
        await pause(40)
        vu.push(`${m}:${texte()}`)
      }
      console.log(`      ${mode} ${JSON.stringify(vu)}`)
      // a, d, f, g : alias pris entre crochets (même `µ.store['cfg']`), écriture deux niveaux plus bas : l'écran garde la valeur d'avant ;
      // h, i : écriture au premier niveau par ce même alias, suivie ; b : le chemin ; c, e : la clé prise par un point ou par `$$cfg`
      assert.deepEqual(vu, ['depart|t0', 'a:depart|t0', 'b:B|t0', 'c:C|t0', 'd:C|t0', 'e:E|t0', 'f:E|t0', 'g:E|t0', 'h:G|H', 'i:G|I'])
      assert.equal(erreurs.length, 0, erreurs.join('\n'))
    })
  }
})
