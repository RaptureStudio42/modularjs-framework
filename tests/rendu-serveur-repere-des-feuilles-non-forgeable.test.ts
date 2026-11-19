// Repère des feuilles partagées dans le HTML rendu (moteur happy-dom) : la sérialisation écrit un repère à la
// place de chaque feuille partagée, puis le remplace par la feuille une fois le fragment entier connu. Une
// donnée de la page (recherche de l'adresse, paramètre de route, texte d'un composant) qui porte la forme
// de ce repère (NUL, `mjsf`, un numéro, NUL) doit rester une donnée : ni feuille posée à sa place (une
// balise `<link>` dont le guillemet ferme l'attribut qui la contient), ni rendu en échec sur un numéro sans
// feuille.

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'
import { startRenderServer } from '../src/server/render-server.js'
import { createRenderHandler } from '../src/server/render-request.js'
import { prerenderPages } from '../src/server/prerender.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const NUL                 = '\u0000'
const REPERE_FEUILLE      = NUL + 'mjsf0' + NUL
const REPERE_SANS_FEUILLE = NUL + 'mjsf7' + NUL

// chargeur : la recherche `q` de l'adresse devient le titre de la page
const CHARGEUR = `export default {
  props: {
    '/': (params, req) -> { titre: decodeURIComponent(String(req.url).split('q=')[1] or 'defaut') }
  }
}
`

function projet(nom: string, extra: Record<string, unknown> = {}) {
  const root = mjsTmp(nom)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'home.mjs'), '<h1 class="t" title={$titre}>{$titre}</h1>\n')
  writeFileSync(join(root, 'src', 'fiche.mjs'), '<p class="id">fiche {$id}</p>\n')
  writeFileSync(join(root, 'serve.server.mjs'), CHARGEUR)
  const config = {
    sourceDir: 'src', outputDir: 'out', ...extra,
    render: { routes: { '/': { component: 'mjs-home', mode: 'ssr' }, '/p/:id': { component: 'mjs-fiche', mode: 'ssr' } } },
  }
  return { root, config }
}

// morceau du HTML de la première occurrence de `debut` jusqu'à `fin` comprise
function entre(html: string, debut: string, fin: string): string {
  const i = html.indexOf(debut)
  return i < 0 ? '' : html.slice(i, html.indexOf(fin, i) + fin.length)
}

after(async () => {
  await terminateSharedWorkerPool()
  sweepRegistered()
})

describe('rendu par requête (mjs serve) : un repère venu de l\'adresse reste une donnée', function () {
  this.timeout(60000)
  let running: any
  before(async function () {
    const { root, config } = projet('repere-feuilles-serve')
    running = await startRenderServer(config as any, root, { port: 0, host: '127.0.0.1' })
  })
  after(async () => { await running?.close() })
  const lire = async (chemin: string) => {
    const r = await fetch(`http://127.0.0.1:${running.port}${chemin}`)
    return { status: r.status, html: await r.text() }
  }

  it('témoin : une page ordinaire porte sa feuille partagée et aucun repère ne reste dans le HTML', async () => {
    const { status, html } = await lire('/?q=bonjour')
    assert.equal(status, 200)
    assert.match(entre(html, '<h1', '</h1>'), />bonjour<\/h1>/, html)
    assert.ok(entre(html, '<template', '<h1').includes('<style'), 'la feuille partagée de la racine manque : ' + html)
    assert.ok(!html.includes(NUL), 'un repère est resté dans le HTML : ' + JSON.stringify(html))
  })

  it('numéro sans feuille dans la recherche : la page est servie, la donnée intacte', async () => {
    const { status, html } = await lire('/?q=%00mjsf7%00')
    assert.equal(status, 200, 'le rendu échoue sur une simple donnée : ' + html.slice(0, 300))
    assert.ok(entre(html, '<h1', '</h1>').includes('>' + REPERE_SANS_FEUILLE + '</h1>'), 'la donnée a changé : ' + JSON.stringify(entre(html, '<h1', '</h1>')))
  })

  it('numéro d\'une feuille existante dans la recherche : aucune feuille posée à la place de la donnée', async () => {
    const { status, html } = await lire('/?q=A%00mjsf0%00B')
    const h1               = entre(html, '<h1', '</h1>')
    assert.equal(status, 200)
    assert.ok(!/<(style|link)/.test(h1), 'une feuille a été posée à la place de la donnée : ' + JSON.stringify(h1.slice(0, 300)))
    assert.ok(h1.includes('title="A' + REPERE_FEUILLE + 'B"') && h1.includes('>A' + REPERE_FEUILLE + 'B</h1>'), 'la donnée a changé : ' + JSON.stringify(h1.slice(0, 300)))
  })

  it('repère répété puis balise dans la recherche : l\'attribut garde toute la donnée, aucune balise fabriquée', async () => {
    const q                = REPERE_FEUILLE.repeat(20) + '<img src=x onerror=1>'
    const { status, html } = await lire('/?q=' + encodeURIComponent(q))
    const h1               = entre(html, '<h1', '</h1>')
    assert.equal(status, 200)
    assert.ok(!/<(style|link)/.test(h1), 'une feuille a été posée à la place de la donnée : ' + JSON.stringify(h1.slice(0, 300)))
    assert.ok(h1.startsWith('<h1 class="t" title="' + q + '"'), 'l\'attribut a été refermé avant la fin de la donnée : ' + JSON.stringify(h1.slice(0, 300)))
  })
})

describe('createRenderHandler appelé par un hôte : un paramètre de route qui porte le repère', function () {
  this.timeout(60000)

  it('numéro sans feuille dans le paramètre : statut 200, la donnée intacte', async () => {
    const { root, config } = projet('repere-feuilles-hote')
    const handler = await createRenderHandler(config as any, root)
    try {
      const temoin = await handler.handle('/p/42')
      assert.equal(temoin.status, 200, temoin.body)
      const r = await handler.handle('/p/' + REPERE_SANS_FEUILLE)
      assert.equal(r.status, 200, 'le rendu échoue sur un paramètre de route : ' + r.body.slice(0, 300))
      assert.ok(r.body.includes('fiche ' + REPERE_SANS_FEUILLE), 'la donnée a changé : ' + JSON.stringify(entre(r.body, '<p', '</p>')))
    }
    finally {
      await handler.close()
    }
  })
})

describe('prérendu au build (moteur happy-dom) : un texte de la page qui porte le repère', function () {
  this.timeout(120000)
  let rapport: any
  before(async function () {
    const root = mjsTmp('repere-feuilles-prerendu')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'accueil.mjs'), `<script>\n  $a = 'A\\u0000mjsf0\\u0000B'\n</script>\n\n<p class="a" title={$a}>{$a}</p>\n`)
    writeFileSync(join(root, 'src', 'vide.mjs'), `<script>\n  $b = '\\u0000mjsf7\\u0000'\n</script>\n\n<p class="b">{$b}</p>\n`)
    const config = {
      sourceDir: 'src',
      outputDir: 'out',
      render:    { default: 'prerender', routes: { '/': { component: 'mjs-accueil', engine: 'happy-dom' }, '/vide': { component: 'mjs-vide', engine: 'happy-dom' } } },
    }
    rapport = await prerenderPages(config as any, root)
  })

  it('numéro d\'une feuille existante : la page prérendue garde la donnée, sans feuille à sa place', () => {
    const page = rapport.generated.find((g: any) => g.url === '/')
    assert.ok(page, 'la page n\'est pas prérendue : ' + JSON.stringify(rapport.skipped))
    const p = entre(readFileSync(page.file, 'utf-8'), '<p class="a"', '</p>')
    assert.ok(!/<(style|link)/.test(p), 'une feuille a été posée à la place de la donnée : ' + JSON.stringify(p.slice(0, 300)))
    assert.ok(p.includes('title="A' + REPERE_FEUILLE + 'B"') && p.includes('A' + REPERE_FEUILLE + 'B</p>'), 'la donnée a changé : ' + JSON.stringify(p.slice(0, 300)))
  })

  it('numéro sans feuille : la page est prérendue, la donnée intacte', () => {
    const page = rapport.generated.find((g: any) => g.url === '/vide')
    assert.ok(page, 'le prérendu échoue sur une simple donnée : ' + JSON.stringify(rapport.skipped))
    assert.ok(entre(readFileSync(page.file, 'utf-8'), '<p class="b"', '</p>').includes(REPERE_SANS_FEUILLE + '</p>'), 'la donnée a changé')
  })
})

describe('mode csp : un repère venu de l\'adresse reste une donnée', function () {
  this.timeout(60000)
  let running: any
  before(async function () {
    const { root, config } = projet('repere-feuilles-csp', { csp: true })
    running = await startRenderServer(config as any, root, { port: 0, host: '127.0.0.1' })
  })
  after(async () => { await running?.close() })

  it('numéro sans feuille, puis numéro d\'une feuille existante : pages servies, données intactes', async () => {
    for (const [q, attendu] of [['%00mjsf7%00', REPERE_SANS_FEUILLE], ['A%00mjsf0%00B', 'A' + REPERE_FEUILLE + 'B']]) {
      const r    = await fetch(`http://127.0.0.1:${running.port}/?q=${q}`)
      const html = await r.text()
      const h1   = entre(html, '<h1', '</h1>')
      assert.equal(r.status, 200, html.slice(0, 300))
      assert.ok(!/<(style|link)/.test(h1) && h1.includes('>' + attendu + '</h1>'), 'la donnée a changé : ' + JSON.stringify(h1.slice(0, 300)))
    }
  })
})
