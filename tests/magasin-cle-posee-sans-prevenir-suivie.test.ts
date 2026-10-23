// Le magasin partagé `$$` et un objet rangé sous deux clés.
// Un objet posé sans prévenir (`µwrite`) sous une clé et par une affectation sous une autre : une écriture profonde
// faite par la seconde prévient aussi les lecteurs de la première. Avant, ils restaient sur l'ancienne valeur tant
// qu'aucune écriture profonde n'était passée par la première clé.
// Garde : le magasin range ce qu'on lui donne. L'élément d'une boucle rangé dans `$$sel` reste celui de la boucle —
// `$$sel === item` vaut vrai dans le composant qui l'a rangé.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'mdd-choix': [
    '<script>',
    "$items = [{ t: 'a' }, { t: 'b' }]",
    '</script>',
    "{for item in $items}<button class=\"i\" @click={$$sel = item}>{item.t}{$$sel === item ? '*' : ''}</button>{end}",
  ].join('\n'),
  'mdd-ecrivain': [
    '<script>',
    'poser = ->',
    '  o = { quantite: 1 }',
    '  µwrite $$autre, o',
    '  $$cfg = o',
    'changer = -> $$cfg.quantite = 3',
    '</script>',
    '<button class="p" @click={poser()}>p</button><button class="m" @click={changer()}>m</button>',
  ].join('\n'),
  'mdd-autre': '<p class="a">{$$autre ? $$autre.quantite : \'-\'}</p>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('magasin — clé posée sans prévenir, élément de boucle rangé tel quel', function () {
  this.timeout(60000)
  const modules: Record<string, string> = {}
  let core = ''
  const fenetres: any[] = []

  before(async () => {
    const root   = mjsTmp('magasin-cle-sans-prevenir')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), source + '\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire  = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    core = lire(files.find((f) => /^mjs_core-/.test(f))!)
    for (const nom of Object.keys(COMPOSANTS)) modules[nom] = lire(files.find((f) => new RegExp(`^${nom}-[0-9a-z]{5}\\.js$`).test(f))!)
  })

  after(async () => {
    for (const w of fenetres) w.close?.()
    await terminateSharedWorkerPool()
  })

  function fenetre(noms: string[]) {
    const w: any = new Window({ url: 'http://localhost/' })
    fenetres.push(w)
    w.eval(`${core}\nglobalThis.µ = µ;`)
    for (const nom of noms) w.eval(modules[nom])
    return w
  }

  async function monter(w: any, nom: string) {
    w.document.body.insertAdjacentHTML('beforeend', `<mjs-${nom}></mjs-${nom}>`)
    const el = w.document.body.querySelector(`mjs-${nom}`)
    await attendre(() => !!el._shadow)
    return el
  }

  const texte = (el: any, sel: string) => el._shadow.querySelector(sel)?.textContent

  it('l\'élément d\'une boucle rangé dans $$sel se compare toujours à lui-même (`$$sel === item`)', async () => {
    const w = fenetre(['mdd-choix'])
    const choix = await monter(w, 'mdd-choix')
    const lignes = () => Array.from(choix._shadow.querySelectorAll('.i') as ArrayLike<any>).map((p: any) => p.textContent).join(',')
    assert.equal(lignes(), 'a,b')
    choix._shadow.querySelectorAll('.i')[1].click()
    await attendre(() => lignes() === 'a,b*')
    assert.equal(lignes(), 'a,b*')
  })

  it('objet posé par µwrite sous une clé et affecté sous une autre : écrit par la seconde, les lecteurs de la première suivent', async () => {
    const w = fenetre(['mdd-ecrivain', 'mdd-autre'])
    const ecrivain = await monter(w, 'mdd-ecrivain')
    const autre = await monter(w, 'mdd-autre')
    ecrivain._shadow.querySelector('.p').click()
    await attendre(() => !!w.µ._mjs_storeRaw.cfg)
    assert.equal(w.µ._mjs_storeRaw.autre, w.µ._mjs_storeRaw.cfg, 'un seul objet sous les deux clés')
    ecrivain._shadow.querySelector('.m').click()
    await attendre(() => texte(autre, '.a') === '3')
    assert.equal(texte(autre, '.a'), '3', 'le lecteur de $$autre suit l\'écriture faite par $$cfg')
  })
})
