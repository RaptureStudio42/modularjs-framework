// rendu serveur et prérendu (moteur happy-dom) : une page appelle `structuredClone` comme au navigateur. happy-dom ne le donne pas, et
// le rendu s'arrêtait (« structuredClone is not defined »), donc aussi `mjs build` qui prérend cette page. La copie est faite des objets
// de la page (tableau, objet, date, table, erreur, tampon transféré, cycle gardé), un refus est une `DOMException` « DataCloneError »
// de la page, l'erreur levée par la page pendant la copie (un accesseur) sort telle quelle, même nommée « DataCloneError », une structure
// trop profonde lève une `RangeError` de la page, une seconde page (fenêtre neuve) copie de même, et le canal de la copie ne retient pas Node

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSSRRenderer } from '../src/server/renderToString.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('rendu serveur : structuredClone comme au navigateur', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('la page copie avec ses propres objets, refuse ce que le navigateur refuse, et ne retient pas Node', async () => {
    const root   = mjsTmp('ssr-clone')
    const srcDir = join(root, 'src'), outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'clonessr.mjs'), `
<script lang="coffee">
refus = (valeur) ->
  try
    structuredClone(valeur)
    'aucun'
  catch e
    e.name + '/' + (e instanceof DOMException)
# l'erreur que lève la page pendant la copie (un accesseur) : la même, comme au navigateur
leve = (erreur) ->
  piege = {}
  Object.defineProperty(piege, 'x', { enumerable: true, get: -> throw erreur })
  try
    structuredClone(piege)
    'aucune'
  catch e
    String(e is erreur)
# une structure trop profonde : la RangeError de la page
profonde = ->
  tete = {}
  bout = tete
  for i in [0...1000000]
    bout.a = {}
    bout = bout.a
  try
    structuredClone(tete)
    'aucune'
  catch e
    (e instanceof RangeError) + '/' + e.name
source = { liste: [1, 2], quand: new Date(5), table: new Map([['a', { b: 1 }]]), erreur: new RangeError('r') }
source.moi = source
copie = structuredClone(source)
copie.liste.push(3)
tampon = new ArrayBuffer(8)
recu = structuredClone(tampon, { transfer: [tampon] })
$rapport = [
  'liste ' + source.liste.length + '/' + copie.liste.length
  'tableau ' + (copie.liste instanceof Array)
  'objet ' + (Object.getPrototypeOf(copie) is Object.prototype)
  'cycle ' + (copie.moi is copie)
  'date ' + (copie.quand instanceof Date) + '/' + copie.quand.getTime()
  'table ' + (copie.table instanceof Map) + '/' + (copie.table.get('a').constructor is Object)
  'erreur ' + (copie.erreur instanceof RangeError) + '/' + copie.erreur.message
  'tampon ' + tampon.byteLength + '/' + recu.byteLength + '/' + (recu instanceof ArrayBuffer)
  'fonction ' + refus(-> 1)
  'symbole ' + refus(Symbol('s'))
  'accesseur ' + leve(new DOMException('à moi', 'DataCloneError')) + '/' + leve(new TypeError('t'))
  'profonde ' + profonde()
].join(' ; ')
</script>
<p class="rapport">{$rapport}</p>
`)
    const ports    = () => process.getActiveResourcesInfo().filter(r => r === 'MessagePort').length
    const avant    = ports()
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir })
    const premier  = await renderer.renderToString('mjs-clonessr')
    const second   = await renderer.renderToString('mjs-clonessr')
    await renderer.close()
    const attendu = 'liste 2/3 ; tableau true ; objet true ; cycle true ; date true/5 ; table true/true ; erreur true/r ; tampon 0/8/true ; fonction DataCloneError/true ; symbole DataCloneError/true ; accesseur true/true ; profonde true/RangeError'
    assert.ok(premier.html.includes(attendu), `la page copie comme au navigateur ; rendu : ${premier.html.match(/class="rapport">([^<]*)/)?.[1]}`)
    assert.ok(second.html.includes(attendu), 'une seconde page, dans une fenêtre neuve, copie de même')
    assert.equal(ports(), avant, 'aucun port de la copie ne retient Node')
  })
})
