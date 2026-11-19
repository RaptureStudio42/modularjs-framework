// mode `csp` : la tête des tailles du texte d'un fragment (page prérendue, corps rendu par requête) lie une feuille hachée. Le dossier de
// sortie n'est relu que quand la feuille liée change : une lecture pour cinq fragments au même bloc, une de plus quand le bloc change,
// et l'ancienne feuille quitte alors le dossier (compte des lectures du dossier, `readdirSync`)

import assert from 'node:assert/strict'
import fs, { mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import type { MjsConfig } from '../src/bundler/config.js'
import { fontSizeFragmentHead } from '../src/server/ssr-head.js'
import { mjsTmp } from './helpers/tmp.js'

const bloc  = (n: number): string => `:root{--mjs-fs-41:${n}rem}@media (min-width:768px){:root{--mjs-fs-41:${n + 0.25}rem}}`
const tetes = (dir: string): string[] => readdirSync(dir).filter(f => /^mjs_ssr_head-[0-9a-f]{8}\.css$/.test(f)).sort()
const liee  = (tete: string): string => (/href="\/m\/(mjs_ssr_head-[0-9a-f]{8}\.css)"/.exec(tete) ?? [])[1] ?? ''

describe('mode csp — les feuilles des tailles du texte : le dossier relu une fois par feuille liée', function () {
  it('cinq fragments au même bloc : une lecture ; le bloc change : une de plus, l\'ancienne feuille retirée', () => {
    const out      = join(mjsTmp('csp-tailles-compte'), 'public/m')
    const source   = join(out, 'mjs_ssr_head-font-sizes.css')
    const manifest = join(out, 'bundle.js')
    const config   = { csp: true, urlPrefix: '/m' } as MjsConfig
    mkdirSync(out, { recursive: true })
    writeFileSync(source, bloc(2))
    const lectures: string[] = []
    const lire = fs.readdirSync
    fs.readdirSync = ((p: fs.PathLike, ...reste: unknown[]) => {
      lectures.push(String(p))
      return (lire as (...a: unknown[]) => unknown)(p, ...reste)
    }) as typeof fs.readdirSync
    syncBuiltinESMExports()
    try {
      const premiers = Array.from({ length: 5 }, () => fontSizeFragmentHead(config, out, manifest))
      assert.equal(new Set(premiers).size, 1, 'les cinq fragments lient la même feuille')
      assert.equal(lectures.filter(p => p === out).length, 1, 'une lecture du dossier pour cinq fragments')
      const premiere = liee(premiers[0])
      writeFileSync(source, bloc(3))
      utimesSync(source, new Date(Date.now() + 5000), new Date(Date.now() + 5000))
      const seconds = Array.from({ length: 3 }, () => fontSizeFragmentHead(config, out, manifest))
      const seconde = liee(seconds[0])
      assert.notEqual(seconde, premiere, 'le bloc a changé : une autre feuille')
      assert.equal(lectures.filter(p => p === out).length, 2, 'une lecture de plus quand la feuille liée change')
      assert.deepEqual(tetes(out), [seconde], 'l\'ancienne feuille ne reste pas')
    }
    finally {
      fs.readdirSync = lire
      syncBuiltinESMExports()
    }
  })
})
