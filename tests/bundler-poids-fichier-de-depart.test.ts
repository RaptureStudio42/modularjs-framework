// garde de poids : le fichier de départ (`bundle.js`) d'une petite appli typique — {await}, {for}, {if},
// événements, liaison `value=!{…}`, sans i18n, `runtime: 'core'`, `js: 'bundle'`, production — ne doit
// pas grossir en silence. Chaque Ko compte au premier affichage sur un réseau lent : ce qui entre au
// cœur sans signal de détection se paie dans TOUS les builds. Le plafond est la taille mesurée + 2 %.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MESUREE  = 54493 // octets mesurés, runtime core + js bundle + production
const PLAFOND  = Math.ceil(MESUREE * 1.02)

const SOURCES: Record<string, string> = {
  'meteo-app.mjs': [
    '<script>',
    '$city = \'Paris\'',
    '$req = null',
    '',
    'load = ->',
    '  $req = fetch(\'/api\').then((r) -> r.json())',
    '',
    'search = (c) ->',
    '  $city = c',
    '  load()',
    '</script>',
    '',
    '<@meteo-form value=!{$city} @search={search($city)}></@meteo-form>',
    '{await $req}',
    '  <@meteo-attente></@meteo-attente>',
    '{success data}',
    '  <@meteo-liste items={µraw(data.items)}></@meteo-liste>',
    '{error err}',
    '  <@meteo-erreur message={err.message}></@meteo-erreur>',
    '{end}'
  ].join('\n'),
  'meteo-form.mjs': [
    '<script>',
    '$value = \'\'',
    'submit = -> µemit \'search\'',
    '</script>',
    '',
    '<form @submit.prevent={submit()}>',
    '  <input type="text" value=!{$value}>',
    '  <button type="submit">Chercher</button>',
    '</form>'
  ].join('\n'),
  'meteo-liste.mjs': [
    '<script>',
    '$items = []',
    '$open = null',
    'pick = (i) -> $open = i',
    '</script>',
    '',
    '<ul>',
    '  {for item in $items}<li @click={pick(item)}>{item.name}</li>{end}',
    '</ul>',
    '{if $open}<p class="open">{$open.name}</p>{end}'
  ].join('\n'),
  'meteo-attente.mjs': '<p class="attente">Chargement</p>',
  'meteo-erreur.mjs': ['<script>', '$message = \'\'', '</script>', '<p class="erreur">{$message}</p>'].join('\n')
}

describe('poids du fichier de départ — petite appli typique, production', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it(`bundle.js ne dépasse pas ${PLAFOND} octets`, async () => {
    const root   = mjsTmp('poids-depart')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, contenu] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), contenu + '\n')
    const manifeste = join(root, 'dist', 'assets', 'bundle.js')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: join(root, 'dist', 'assets'), manifestPath: manifeste, runtime: 'core', js: 'bundle', env: 'prod' } as any)
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const taille = statSync(manifeste).size
    assert.ok(taille <= PLAFOND, `le fichier de départ a grossi : ${taille} octets, plafond ${PLAFOND} — cherchez ce qui est entré au cœur (un fichier du runtime sans signal de détection, un libellé du manifeste posé sans lecteur)`)
  })
})
