// un bloc refermé ({if} à la racine, {if} dans un {for}, {key} dont la clé change), un contenu `{{…}}` remplacé, détruit ses nœuds sans attendre la
// destruction : sur le chemin rapide (aucune transition ni aucun nettoyage écrit), elle rend la promesse résolue
// partagée, et un `.catch` posé dessus par nœud détruit coûtait une fonction, une promesse et une microtâche pour rien.
// Le rejet d'une destruction qui peut échouer (chemin des transitions et des nettoyages) est toujours rapporté, une fois
// par nœud, par `µ.error` et le message du bloc : aucune erreur avalée, aucun rejet laissé sans prise.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const BOUTON = '<button class="t" @click={$on = !$on}>t</button>'
const COMPOSANTS: Record<string, string> = {
  'prise-si':   `<script>\n$on = true\n</script>\n{if $on}<p>a</p><p>b</p><p>c</p>{end}\n${BOUTON}`,
  'prise-pour': `<script>\n$on = true\n$l = [1, 2]\n</script>\n{for i in $l}<p class="row">{if $on}<b>a</b><b>b</b>{end}</p>{end}\n${BOUTON}`,
  'prise-cle':  `<script>\n$on = true\n</script>\n{key $on}<i>a</i><i>b</i>{end}\n${BOUTON}`,
  'prise-html': `<script>\n$on = true\n$trois = '<p>a</p><p>b</p><p>c</p>'\n$un = '<p>d</p>'\n</script>\n<div class="h">{{$on ? $trois : $un}}</div>\n${BOUTON}`,
}

// le message que chaque bloc donne au rejet d'une destruction
const MESSAGES: Record<string, string> = {
  'mjs-prise-si':   'destruction de branche {if} en erreur',
  'mjs-prise-pour': 'destruction de branche {if}/{key} imbriquée en erreur',
  'mjs-prise-cle':  'destruction de l\'ancienne clé {key} en erreur',
  'mjs-prise-html': 'destruction de contenu {@html} en erreur',
}

const pause = (ms = 30) => new Promise((r) => setTimeout(r, ms))

describe('blocs — destruction non attendue : aucune prise par nœud sur le chemin rapide, aucun rejet avalé', function () {
  this.timeout(60000)
  let window: any

  before(async () => {
    const root   = mjsTmp('blocs-prise-par-noeud')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    for (let i = 0; i < 100 && !comp._shadow?.querySelector('.t'); i++) await pause(10)
    await pause()
    return comp
  }

  // le premier nœud du contenu des blocs : parti quand le bloc se referme, remplacé quand la clé change
  const premier = (comp: any) => comp._shadow.querySelector('b') || comp._shadow.querySelector('p:not(.row), i')

  for (const tag of Object.keys(MESSAGES)) {
    it(`${tag} : refermé, aucun \`.catch\` posé sur la promesse résolue partagée`, async () => {
      const comp = await monter(tag)
      const avant = premier(comp)
      // la promesse que rend le chemin rapide (un nœud texte meurt toujours tout de suite)
      const partagee = comp._mjs_destroyNodeAndChildren(window.document.createTextNode(''))
      const proto = Object.getPrototypeOf(partagee)
      const origine = proto.catch
      let prises = 0
      proto.catch = function (this: any, ...a: any[]) {
        if (this === partagee) prises++
        return origine.apply(this, a)
      }
      try {
        comp._shadow.querySelector('.t').click()
        await pause(80)
      } finally {
        proto.catch = origine
      }
      assert.ok(avant && premier(comp) !== avant, 'le bloc a bien été refait')
      assert.equal(prises, 0, `${prises} \`.catch\` posés sur la promesse partagée, un par nœud détruit`)
    })

    it(`${tag} : une destruction qui rejette est rapportée par µ.error, une fois par nœud, sans rejet laissé sans prise`, async () => {
      const comp = await monter(tag)
      const µ = window.µ
      const erreurs: any[] = []
      const errorOrigine = µ.error
      const sansPrise: any[] = []
      const surRejet = (r: any) => sansPrise.push(r)
      process.on('unhandledRejection', surRejet)
      const boum = new Error('boum')
      let appels = 0
      comp._mjs_destroyNodeAndChildren = function () {
        appels++
        return Promise.reject(boum)
      }
      µ.error = (...a: any[]) => { erreurs.push(a) }
      try {
        comp._shadow.querySelector('.t').click()
        await pause(80)
      } finally {
        µ.error = errorOrigine
        process.off('unhandledRejection', surRejet)
        delete comp._mjs_destroyNodeAndChildren
      }
      assert.ok(appels > 0, 'la destruction a été demandée')
      const rapports = erreurs.filter((a) => String(a[0]).includes(MESSAGES[tag]) && a[1] === boum)
      assert.equal(rapports.length, appels, `un rapport par destruction rejetée (${appels}) : ${JSON.stringify(erreurs.map((a) => String(a[0])))}`)
      assert.equal(sansPrise.length, 0, 'aucun rejet laissé sans prise')
    })
  }
})
