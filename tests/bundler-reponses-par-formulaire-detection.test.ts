// Les réponses du serveur rangées par formulaire (mjs_form_answers.ts) n'entrent que pour une application qui les lit : une balise form,
// la navigation, et un lecteur — <@@field> (qui écrit `µ._mjs_formView`) ou l'objet formulaire `µform` ; un module de saisie du cœur
// sans <@@field> (une case, un nombre, un éditeur) ne les lit pas et n'en paie rien. L'avis de développement de deux formulaires au même
// `id` dans un même composant existe en développement et sort de la production, son code de détection compris.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIER = 'mjs_form_answers.ts'

// tout le texte d'un dossier de sortie
function texte(d: string): string {
  let s = ''
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    s += statSync(p).isDirectory() ? texte(p) : readFileSync(p, 'utf8')
  }
  return s
}

async function construire(nom: string, source: string, prod: boolean): Promise<string> {
  const root = mjsTmp('form-answers-' + nom + (prod ? '-prod' : '-dev'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'app.mjs'), source)
  const opts    = prod ? { forceMinify: true, minimalRuntime: true, js: 'bundle', env: 'prod' } : {}
  const bundler = new Bundler({ sourceDir: join(root, 'src'), outputDir: join(root, 'dist'), manifestPath: join(root, 'dist', 'bundle.js'), urlPrefix: '/modularjs', runtime: ['ujs', 'ajax', 'vault'], ...opts } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  return texte(join(root, 'dist'))
}

describe('les réponses rangées par formulaire n’entrent que pour une application qui les lit', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('le choix des fichiers : une balise form, la navigation et un lecteur (<@@field> ou µform) ; un module de saisie sans <@@field> n’en est pas un', () => {
    const b    = new Bundler({ runtime: ['ujs', 'ajax', 'vault'] } as any)
    const avec = (used: string[]) => b.resolveRuntimeFiles(new Set(used)).files.includes(FICHIER)
    assert.equal(avec(['form_tag', 'form_view']), true, '<@@field> dans une application qui écrit un formulaire')
    assert.equal(avec(['form_tag', 'form']), true, 'µform dans une application qui écrit un formulaire')
    assert.equal(avec(['form_tag', 'form_reset']), false, 'une case, un nombre ou un éditeur du cœur seuls ne lisent pas les réponses')
    assert.equal(avec(['form_view']), false, 'un <@@field> sans aucune balise form')
    const sans = new Bundler({ runtime: ['ajax'] } as any)
    assert.equal(sans.resolveRuntimeFiles(new Set(['form_tag', 'form_view'])).files.includes(FICHIER), false, 'sans la navigation, rien à ranger')
  })

  it('une construction de production : formulaire et case à cocher sans <@@field> ni µform, le fichier n’entre pas ; avec un <@@field>, il entre', async () => {
    const marque = 'getAttribute("id")||""'
    const coche  = await construire('case', '<form id="f" action="/f" method="post"><@@checkbox name="c"></@@checkbox><button>go</button></form>\n', true)
    const champ  = await construire('champ', '<form id="f" action="/f" method="post"><@@field label="q"><input name="q"></@@field><button>go</button></form>\n', true)
    assert.equal(coche.includes(marque), false, 'case à cocher seule')
    assert.equal(champ.includes(marque), true, 'un champ')
  })

  it('deux formulaires au même id dans un composant : l’avis existe en développement et sort de la production', async () => {
    const source = '<form id="f" action="/f" method="post"><@@field label="a"><input name="a"></@@field></form>\n<form id="f" action="/g" method="post"><@@field label="b"><input name="b"></@@field></form>\n'
    const dev    = await construire('double', source, false)
    const prod   = await construire('double', source, true)
    assert.equal(dev.includes('dev.formIdTwice'), true, 'l’avis en développement')
    assert.equal(prod.includes('formIdTwice') || prod.includes('un seul formulaire'), false, 'ni le message ni sa clé en production')
  })
})
