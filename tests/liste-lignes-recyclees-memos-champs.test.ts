// Une liste à clés recycle le sous-arbre d'une ligne supprimée pour une ligne neuve (`pool`). Les champs
// de la ligne recyclée sont remis au gabarit (valeur, case, option choisie) puis les liaisons de la nouvelle
// clé s'appliquent — mais une liaison `value={…}`, `checked={…}` ou `selected={…}` n'écrit que quand sa
// valeur change : la mémoire de ce qu'elle a écrit est remise à zéro avec le champ. Sans elle, une ligne
// neuve dont la valeur égale celle de l'ancienne clé restait au gabarit (champ vide, case décochée, option
// non choisie). Quatre mémoires, une par famille de champ : saisie et zone de texte (valeur), case
// (coche), options d'un <select> dans la ligne, lignes qui SONT les options d'un <select> posé dehors.
// La ligne d'une clé supprimée n'est reprise qu'au rendu suivant (les lignes neuves se fabriquent avant que
// les anciennes ne partent au pool) : chaque cas remplace donc les clés deux fois de suite.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function monter(prefixe: string, fichiers: Record<string, string>) {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, source] of Object.entries(fichiers)) writeFileSync(join(srcDir, nom), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const files  = readdirSync(outDir).filter((f) => f.endsWith('.js'))
  const rang   = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
  const code   = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${code}\nglobalThis.µ = µ;`)
  return window
}

const PAGE = `<script>
  $rows = [{id: 1, name: 'Alice', on: true, c: 'b'}, {id: 2, name: 'Bob', on: false, c: 'a'}]
  $opts = [{id: 1, v: 'x', sel: false}, {id: 2, v: 'y', sel: true}]
</script>

<div class="host">{for r in $rows by id}<p class="r"><input class="f" aria-label="f" value={r.name}><textarea class="ta" aria-label="ta" value={r.name}></textarea><input class="cb" aria-label="cb" type="checkbox" checked={r.on}><select class="s" aria-label="s"><option value="a" selected={r.c is 'a' ? true : null}>a</option><option value="b" selected={r.c is 'b' ? true : null}>b</option></select></p>{end}</div>
<select class="sel" aria-label="sel">{for o in $opts by id}<option value={o.v} selected={o.sel}>{o.v}</option>{end}</select>
`

describe('liste à clés : une ligne recyclée reçoit les valeurs de sa clé, même égales à celles de l\'ancienne', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  async function ouvrir() {
    const window = await monter('lignes-recyclees', { 'demo-recycle.mjs': PAGE })
    window.document.body.innerHTML = '<mjs-demo-recycle></mjs-demo-recycle>'
    const c = window.document.querySelector('mjs-demo-recycle')
    await attendre(() => !!c._shadow?.querySelector('.f') && !!c._shadow?.querySelector('.sel option'))
    await pause(30)
    // la valeur de chaque champ de chaque ligne : saisie, zone de texte, case, choix du <select> de la ligne
    const lignes  = () => JSON.stringify([...c._shadow.querySelectorAll('.r')].map((p: any) => [p.querySelector('.f').value, p.querySelector('.ta').value, p.querySelector('.cb').checked, p.querySelector('.s').value]))
    // le choix de chaque option du <select> posé dehors
    const options = () => JSON.stringify([...c._shadow.querySelectorAll('.sel option')].map((o: any) => [o.value, o.selected]))
    const pose    = async (cle: string, valeur: any) => {
      window.eval(`document.querySelector('mjs-demo-recycle')._set(${JSON.stringify(cle)}, ${JSON.stringify(valeur)})`)
      await pause(40)
    }
    return { window, c, lignes, options, pose }
  }

  // les `.f` du moment, et ceux d'un rendu d'avant revenus à l'écran : des lignes reprises au pool
  const reprises = (c: any, vus: Set<any>, avant: any[]) => {
    const courants = [...c._shadow.querySelectorAll('.f')]
    const n = courants.filter((x: any) => vus.has(x) && !avant.includes(x)).length
    for (const x of courants) vus.add(x)
    return n
  }

  it('remplacement total des clés : saisie, zone de texte, case et options de la ligne reprise', async () => {
    const { window, c, lignes, pose } = await ouvrir()
    try {
      const vus = new Set<any>([...c._shadow.querySelectorAll('.f')])
      assert.equal(lignes(), JSON.stringify([['Alice', 'Alice', true, 'b'], ['Bob', 'Bob', false, 'a']]), 'départ')
      let avant = [...c._shadow.querySelectorAll('.f')]
      await pose('rows', [{id: 3, name: 'Alice', on: true, c: 'b'}, {id: 4, name: 'Bob', on: false, c: 'a'}])
      assert.equal(lignes(), JSON.stringify([['Alice', 'Alice', true, 'b'], ['Bob', 'Bob', false, 'a']]), 'clés neuves, mêmes valeurs')
      reprises(c, vus, avant)
      avant = [...c._shadow.querySelectorAll('.f')]
      await pose('rows', [{id: 5, name: 'Alice', on: true, c: 'b'}, {id: 6, name: 'Bob', on: false, c: 'a'}])
      assert.ok(reprises(c, vus, avant) > 0, 'les lignes des clés parties sont reprises')
      assert.equal(lignes(), JSON.stringify([['Alice', 'Alice', true, 'b'], ['Bob', 'Bob', false, 'a']]), 'clés neuves encore, mêmes valeurs que l\'ancienne clé')
      avant = [...c._shadow.querySelectorAll('.f')]
      await pose('rows', [{id: 7, name: 'Bob', on: false, c: 'a'}, {id: 8, name: 'Alice', on: true, c: 'b'}])
      assert.equal(lignes(), JSON.stringify([['Bob', 'Bob', false, 'a'], ['Alice', 'Alice', true, 'b']]), 'clés neuves, valeurs échangées')
    }
    finally {
      window.close()
    }
  })

  it('remplacement partiel : la ligne gardée ne bouge pas, la ligne reprise reçoit les valeurs de sa clé', async () => {
    const { window, c, lignes, pose } = await ouvrir()
    try {
      const vus = new Set<any>([...c._shadow.querySelectorAll('.f')])
      let avant = [...c._shadow.querySelectorAll('.f')]
      await pose('rows', [{id: 2, name: 'Bob', on: false, c: 'a'}, {id: 7, name: 'Alice', on: true, c: 'b'}])
      assert.equal(lignes(), JSON.stringify([['Bob', 'Bob', false, 'a'], ['Alice', 'Alice', true, 'b']]), 'une clé partie, une clé neuve de même valeur')
      reprises(c, vus, avant)
      avant = [...c._shadow.querySelectorAll('.f')]
      await pose('rows', [{id: 7, name: 'Alice', on: true, c: 'b'}, {id: 8, name: 'Bob', on: false, c: 'a'}])
      assert.ok(reprises(c, vus, avant) > 0, 'la ligne de la clé partie est reprise')
      assert.equal(lignes(), JSON.stringify([['Alice', 'Alice', true, 'b'], ['Bob', 'Bob', false, 'a']]), 'la clé 2 part, la clé 8 reprend sa ligne avec les mêmes valeurs')
      await pose('rows', [{id: 7, name: 'Alice', on: true, c: 'b'}, {id: 9, name: 'Bob', on: false, c: 'a'}])
      assert.equal(lignes(), JSON.stringify([['Alice', 'Alice', true, 'b'], ['Bob', 'Bob', false, 'a']]), 'encore une clé neuve de même valeur')
    }
    finally {
      window.close()
    }
  })

  it('une valeur changée avant le départ de la ligne : la ligne reprise ne retombe pas au gabarit', async () => {
    const { window, c, lignes, pose } = await ouvrir()
    try {
      const vus = new Set<any>([...c._shadow.querySelectorAll('.f')])
      await pose('rows', [{id: 1, name: 'Alice', on: true, c: 'b'}, {id: 2, name: 'Zed', on: true, c: 'b'}])
      assert.equal(lignes(), JSON.stringify([['Alice', 'Alice', true, 'b'], ['Zed', 'Zed', true, 'b']]), 'la clé 2 change de valeurs (le gabarit de la ligne, lui, a gardé celles du départ)')
      await pose('rows', [{id: 1, name: 'Alice', on: true, c: 'b'}])
      const avant = [...c._shadow.querySelectorAll('.f')]
      await pose('rows', [{id: 1, name: 'Alice', on: true, c: 'b'}, {id: 9, name: 'Zed', on: true, c: 'b'}])
      assert.ok(reprises(c, vus, avant) > 0, 'la ligne de la clé 2 est reprise par la clé 9')
      assert.equal(lignes(), JSON.stringify([['Alice', 'Alice', true, 'b'], ['Zed', 'Zed', true, 'b']]), 'la clé 9 a les valeurs que la clé 2 avait en partant, pas celles du gabarit')
    }
    finally {
      window.close()
    }
  })

  it('lignes qui SONT les options d\'un <select> posé dehors : l\'option choisie suit la clé neuve', async () => {
    const { window, options, pose } = await ouvrir()
    try {
      assert.equal(options(), JSON.stringify([['x', false], ['y', true]]), 'départ')
      await pose('opts', [{id: 3, v: 'x', sel: false}, {id: 4, v: 'y', sel: true}])
      assert.equal(options(), JSON.stringify([['x', false], ['y', true]]), 'clés neuves, mêmes choix')
      await pose('opts', [{id: 5, v: 'x', sel: false}, {id: 6, v: 'y', sel: true}])
      assert.equal(options(), JSON.stringify([['x', false], ['y', true]]), 'clés neuves encore, mêmes choix que l\'ancienne clé')
      await pose('opts', [{id: 7, v: 'x', sel: true}, {id: 8, v: 'y', sel: false}])
      assert.equal(options(), JSON.stringify([['x', true], ['y', false]]), 'clés neuves, choix inversés')
      await pose('opts', [{id: 9, v: 'x', sel: true}, {id: 10, v: 'y', sel: false}])
      assert.equal(options(), JSON.stringify([['x', true], ['y', false]]), 'clés neuves, mêmes choix qu\'avant')
    }
    finally {
      window.close()
    }
  })
})
