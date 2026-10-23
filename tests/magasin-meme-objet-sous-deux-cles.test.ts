// Un même objet rangé sous deux clés du magasin (`$$cfg = $$autre`) : une écriture profonde faite par une clé (`$$cfg.on = v`,
// `$$l2.push(x)`, `delete $$cfg.on`) prévient aussi les lecteurs de l'autre clé, dans un autre composant comme dans le même —
// la promesse de la page 14 (stores). Avant, seule la clé écrite était prévenue : ce qui affichait `$$autre` restait figé sur
// l'ancienne valeur. Une clé qui ne partage plus son objet ne prévient plus l'autre.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const stripEsm = (s: string) => s
  .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
  .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
  .replace(/\bexport\s+default\s+/g, '')
  .replace(/\bexport\s+/g, '')
  .replace(/import\.meta\.url/g, "'http://localhost/'")

const pause = (ms: number) => new Promise(r => setTimeout(r, ms))

// compile les composants dans un même dossier (un seul cœur) et les monte dans une même fenêtre (un seul magasin)
async function monter(sources: Record<string, string>) {
  const root   = mjsTmp('magasin-partage')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries(sources)) writeFileSync(join(srcDir, `${nom}.mjs`), src)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))

  const window: any = new Window({ url: 'http://localhost/' })
  const document: any = window.document
  const fichiers = readdirSync(outDir)
  const coeur = fichiers.find((f: string) => /^mjs_core-/.test(f))
  assert.ok(coeur)
  let source = `${stripEsm(readFileSync(join(outDir, coeur!), 'utf-8'))}\nglobalThis.µ = µ;\n`
  for (const nom of Object.keys(sources)) {
    const fichier = fichiers.find((f: string) => new RegExp(`^${nom}-`).test(f))
    assert.ok(fichier, `composant compilé introuvable : ${nom}`)
    source += stripEsm(readFileSync(join(outDir, fichier!), 'utf-8')) + '\n'
  }
  window.eval(source)

  const els: Record<string, any> = {}
  for (const nom of Object.keys(sources)) {
    document.body.insertAdjacentHTML('beforeend', `<mjs-${nom}></mjs-${nom}>`)
    els[nom] = document.body.querySelector(`mjs-${nom}`)
  }
  await pause(80)
  return { window, els }
}

// clés reçues par `_mjs_invalidate` d'une instance, sans changer son comportement
function suivre(el: any): string[] {
  const recues: string[] = []
  const orig = el._mjs_invalidate.bind(el)
  el._mjs_invalidate = function (k: string) { recues.push(k); return orig(k) }
  return recues
}

const texte = (el: any, sel: string) => el._shadow.querySelector(sel).textContent.trim()

const clic = async (el: any, sel: string) => { el._shadow.querySelector(sel).click(); await pause(50) }

const ECRIVAIN = [
  '<script>',
  '  $$cfg = { on: true, nom: \'cfg\' }',
  '  $$autre = { on: true, nom: \'autre\' }',
  '  $$l1 = [1, 2]',
  '  $$l2 = []',
  '  partager = -> $$cfg = $$autre',
  '  ecrire = -> $$cfg.on = \'direct\'',
  '  renommer = -> $$autre.nom = \'renomme\'',
  '  effacer = -> delete $$cfg.on',
  '  separer = -> $$cfg = { on: \'seul\', nom: \'neuf\' }',
  '  ecrireSeul = -> $$cfg.on = \'apres\'',
  '  partagerListe = -> $$l2 = $$l1',
  '  pousser = -> $$l2.push(3)',
  '</script>',
  '<button class="partager" @click={partager()}>p</button>',
  '<button class="ecrire" @click={ecrire()}>e</button>',
  '<button class="renommer" @click={renommer()}>r</button>',
  '<button class="effacer" @click={effacer()}>d</button>',
  '<button class="separer" @click={separer()}>s</button>',
  '<button class="ecrireseul" @click={ecrireSeul()}>es</button>',
  '<button class="partagerliste" @click={partagerListe()}>pl</button>',
  '<button class="pousser" @click={pousser()}>pu</button>',
  '<p class="s">{$$cfg.nom}:{$$cfg.on} {$$autre.nom}:{$$autre.on}</p>',
].join('\n')

// ne lit que `$$autre` et `$$l1` : abonné à ces deux clés seulement
const LECTEUR = [
  '<script>',
  '</script>',
  '<p class="autre">{$$autre.nom}:{$$autre.on}</p>',
  '<p class="l1">{$$l1.length}</p>',
].join('\n')

describe('magasin — un même objet sous deux clés : écrire par l une prévient les lecteurs de l autre', function () {
  this.timeout(40000)
  after(async () => { await terminateSharedWorkerPool() })

  it('$$cfg = $$autre puis $$cfg.on = v : ce qui affiche $$autre est redessiné, ici et dans un autre composant', async () => {
    const { els } = await monter({ ecrivain: ECRIVAIN, lecteur: LECTEUR })
    const { ecrivain, lecteur } = els
    assert.equal(texte(ecrivain, 'p.s'), 'cfg:true autre:true')
    assert.equal(texte(lecteur, 'p.autre'), 'autre:true')

    await clic(ecrivain, 'button.partager')
    assert.equal(texte(ecrivain, 'p.s'), 'autre:true autre:true')

    await clic(ecrivain, 'button.ecrire')
    assert.equal(texte(ecrivain, 'p.s'), 'autre:direct autre:direct', 'le même composant affiche $$autre à jour')
    assert.equal(texte(lecteur, 'p.autre'), 'autre:direct', 'un composant qui ne lit que $$autre est redessiné')

    // dans l'autre sens : écrire par $$autre redessine ce qui affiche $$cfg
    await clic(ecrivain, 'button.renommer')
    assert.equal(texte(ecrivain, 'p.s'), 'renomme:direct renomme:direct')
    assert.equal(texte(lecteur, 'p.autre'), 'renomme:direct')

    // suppression profonde par $$cfg
    await clic(ecrivain, 'button.effacer')
    assert.equal(texte(lecteur, 'p.autre'), 'renomme:', 'delete $$cfg.on prévient le lecteur de $$autre')
  })

  it('$$l2 = $$l1 puis $$l2.push(x) : le lecteur de $$l1 est redessiné', async () => {
    const { els } = await monter({ ecrivain: ECRIVAIN, lecteur: LECTEUR })
    const { ecrivain, lecteur } = els
    assert.equal(texte(lecteur, 'p.l1'), '2')
    await clic(ecrivain, 'button.partagerliste')
    await clic(ecrivain, 'button.pousser')
    assert.equal(texte(lecteur, 'p.l1'), '3')
  })

  it('une clé qui ne partage plus son objet ne prévient plus l autre', async () => {
    const { els } = await monter({ ecrivain: ECRIVAIN, lecteur: LECTEUR })
    const { ecrivain, lecteur } = els
    await clic(ecrivain, 'button.partager')
    await clic(ecrivain, 'button.separer')
    const recues = suivre(lecteur)
    await clic(ecrivain, 'button.ecrireseul')
    assert.equal(texte(ecrivain, 'p.s'), 'neuf:apres autre:true')
    assert.equal(texte(lecteur, 'p.autre'), 'autre:true')
    assert.deepEqual(recues, [], 'le lecteur de $$autre ne reçoit rien')
  })
})
