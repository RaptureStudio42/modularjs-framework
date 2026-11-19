// garde de poids : le fichier de départ (`bundle.js`) d'une petite appli typique — {await}, {for}, {if},
// événements, liaison `value=!{…}`, sans i18n, `runtime: 'core'`, `js: 'bundle'`, production — ne doit
// pas grossir en silence. Chaque Ko compte au premier affichage sur un réseau lent : ce qui entre au
// cœur sans signal de détection se paie dans TOUS les builds. Le plafond est la taille mesurée + 2 %.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

// mesure reprise le 16/11/2026 : 55 105 → 56 954 o (20 598 o en gzip -9 -n). Entré depuis la mesure d'avant, au cœur de toute appli de ce genre :
// - jusqu'au 15/11 au matin, sous le plafond : +207 (55 312 o)
// - le registre des détenteurs de l'enveloppe : +1 423 (un objet tenu par deux composants, un état ou un magasin suit chaque écriture ; rien ne prouve à la construction qu'aucun objet n'est tenu deux fois) ; sa part des familles de µ.state et de µ.Store (109 o) part avec eux
// - la marque de lecture des attributs : +103 (une prop écrite en clair reste la valeur de départ au déplacement et au retour du cache, Safari compris)
// - la redite d'un objet µraw reposé : +96 (l'appli passe µraw(…) en prop)
// - mjs-props relu seulement quand son texte change : +25
// - le déballage borné de µ._mjs_toRaw : +16
// - un objet tenu par seize composants ou plus, prévenu de chaque écriture : +1
// - la clé morte templateCacheSize retirée : −22
// - l'attribut layout laissé à la variable $layout ou $template : 0 (son aide part avec son signal quand aucune unité ne déclare l'une d'elles)
const MESUREE  = 56954 // octets mesurés, runtime core + js bundle + production
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
