// une construction rapide (`mjs build --cache`) en échec laisse `.mangle-cache.json` tel quel, et la construction d'après donne la
// sortie d'une construction complète partie de l'état d'avant l'essai. Scènes adverses : retrait d'un nom court pendant l'essai, erreur
// tardive (après les minifications), deux échecs de suite, retour arrière des sources, hors production minifiée par la ligne de
// commande, js bundle ; puis l'alternance échec, construction complète sans --cache, construction rapide.
// Chaque scène : la construction rapide d'après l'échec, et le repli complet, comparés à l'octet à la construction complète de l'état d'avant

import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { build, gaps, write } from './helpers/construction-cache.js'

const D       = String.fromCharCode(36)
const vivant  = (nom: string): string => '<script lang="js">\n  ' + D + 'n = 0;\n  @inc = function() { ' + D + 'n++; };\n</script>\n\n<div class="' + nom + '">\n  <button @click={@inc()}>{' + D + 'n}</button>\n  {if ' + D + 'n > 2}\n    <b>' + nom + '</b>\n  {end}\n</div>\n'
const bascule = (classe: string): string => '<script lang="js">\n  ' + D + 'c = 1;\n</script>\n\n<p class="cpt" :class{' + D + 'c > 1}="' + classe + '">{' + D + 'c}</p>\n'
const CASSE   = '<script>\n  x := ((\n</script>\n'
const TARDIF  = '<p>un</p>\n<div class="a" :in=*titreinconnu>x</div>\n'
const CONFIG  = { sourceDir: 'app/modularjs', outputDir: 'public/modularjs', manifestPath: 'public/modularjs/bundle.js', urlPrefix: '/modularjs' }
const MOTS    = new Set(['do', 'if', 'in', 'of', 'as', 'is'])

function copie(from: string, to: string): void {
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
}

interface Scene {
  config?: Record<string, unknown>
  args: string[]
  // sources ajoutées avec l'essai ; reçoit le cache des noms courts de la première construction
  essai: (src: string, noms: Record<string, string | false>) => void
  // second essai en échec, avant la réparation
  encore?: (src: string) => void
  reparer: (src: string) => void
}

function jouer(nom: string, scene: Scene): void {
  const root  = mjsTmp('echec-cache-' + nom)
  const src   = join(root, 'app/modularjs')
  const out   = join(root, 'public/modularjs')
  const names = join(out, '.mangle-cache.json')
  const at    = (dir: string): string => join(root, 'essai', dir)
  write(join(root, 'mjs.config.json'), JSON.stringify({ ...CONFIG, ...scene.config }))
  write(join(src, 'accueil.mjs'), vivant('accueil'))
  write(join(src, 'pied.mjs'), vivant('pied'))
  mkdirSync(join(root, 'node_modules'))
  const premier = build(root, [...scene.args, '--cache'])
  assert.equal(premier.status, 0, premier.out)
  copie(out, at('avant'))
  const avant = existsSync(names) ? readFileSync(names) : null
  scene.essai(src, avant === null ? {} : JSON.parse(avant.toString()))
  const essais = scene.encore ? [null, scene.encore] : [null]
  for (const suite of essais) {
    if (suite) suite(src)
    const failed = build(root, [...scene.args, '--cache'])
    assert.notEqual(failed.status, 0, failed.out)
    const apres = existsSync(names) ? readFileSync(names) : null
    assert.ok(avant === null ? apres === null : apres !== null && apres.equals(avant), 'échec : .mangle-cache.json réécrit')
  }
  copie(out, at('apres-echec'))
  scene.reparer(src)
  const rapide = build(root, [...scene.args, '--cache'])
  assert.equal(rapide.status, 0, rapide.out)
  console.log('      ' + nom + ' — rapide : ' + rapide.served + ' repris, ' + rapide.cold + ' recompilés ' + rapide.reason)
  copie(out, at('rapide'))
  copie(at('avant'), out)
  const complete = build(root, scene.args)
  assert.equal(complete.status, 0, complete.out)
  copie(out, at('reference'))
  const ecartsRapide = gaps(at('rapide'), at('reference'))
  copie(at('apres-echec'), out)
  rmSync(join(root, 'node_modules/.cache/mjs/build'), { recursive: true, force: true })
  assert.equal(build(root, scene.args).status, 0)
  const ecartsRepli = gaps(out, at('reference'))
  assert.deepEqual({ rapide: ecartsRapide, repli: ecartsRepli }, { rapide: [], repli: [] })
}

const ajouts = (src: string): void => {
  write(join(src, 'bascule-a.mjs'), bascule('haut'))
  write(join(src, 'bascule-z.mjs'), bascule('bas'))
}
const retirer = (src: string): void => {
  for (const f of ['aaa-casse.mjs', 'bascule-a.mjs', 'bascule-z.mjs']) rmSync(join(src, f))
}

describe('construction --cache en échec : scènes adverses', function () {
  this.timeout(240000)

  it('retrait de noms courts pendant un essai (un état porte le nom court de propriété interne), production', () => {
    let pris: string[] = []
    jouer('retrait', {
      args: ['--prod'],
      essai: (src, noms) => {
        ajouts(src)
        pris = Object.values(noms).filter(v => typeof v === 'string' && /^[a-z]{1,2}$/i.test(v) && !MOTS.has(v)).slice(0, 3) as string[]
        assert.equal(pris.length, 3, 'pas assez de noms courts')
        write(join(src, 'etats.mjs'), '<script lang="js">\n' + pris.map((p, i) => '  ' + D + p + ' = ' + i + ';').join('\n') + '\n</script>\n\n<p class="etats">' + pris.map(p => '{' + D + p + '}').join(' ') + '</p>\n')
        write(join(src, 'aaa-casse.mjs'), CASSE)
      },
      reparer: src => write(join(src, 'aaa-casse.mjs'), bascule('fixe')),
    })
    console.log('      noms courts repris par des états : ' + pris.join(', '))
  })

  it('erreur tardive (transition inconnue, après toutes les minifications), production', () => {
    jouer('tardif', {
      args: ['--prod'],
      essai: src => { ajouts(src); write(join(src, 'zz-tardif.mjs'), TARDIF) },
      reparer: src => write(join(src, 'zz-tardif.mjs'), bascule('fixe')),
    })
  })

  it('deux échecs de suite, le second sur des sources changées, production', () => {
    jouer('deux', {
      args: ['--prod'],
      essai: src => { ajouts(src); write(join(src, 'aaa-casse.mjs'), CASSE) },
      encore: src => { write(join(src, 'bascule-a.mjs'), bascule('milieu')); write(join(src, 'accueil.mjs'), bascule('accueil2')) },
      reparer: src => write(join(src, 'aaa-casse.mjs'), bascule('fixe')),
    })
  })

  it('retour arrière : les sources ajoutées sont retirées, production', () => {
    jouer('retour', {
      args: ['--prod'],
      essai: src => { ajouts(src); write(join(src, 'aaa-casse.mjs'), CASSE) },
      reparer: retirer,
    })
  })

  it('hors production, minify true, par la ligne de commande', () => {
    jouer('dev-minifie', {
      config: { minify: true },
      args: [],
      essai: src => { ajouts(src); write(join(src, 'aaa-casse.mjs'), CASSE) },
      reparer: src => write(join(src, 'aaa-casse.mjs'), bascule('fixe')),
    })
  })

  it('hors production, minify true, retour arrière des sources', () => {
    jouer('dev-minifie-retour', {
      config: { minify: true },
      args: [],
      essai: src => { ajouts(src); write(join(src, 'accueil.mjs'), vivant('accueil-change')); write(join(src, 'aaa-casse.mjs'), CASSE) },
      reparer: src => { retirer(src); write(join(src, 'accueil.mjs'), vivant('accueil')) },
    })
  })

  it('js bundle, production', () => {
    jouer('bundle', {
      config: { js: 'bundle' },
      args: ['--prod'],
      essai: src => { ajouts(src); write(join(src, 'aaa-casse.mjs'), CASSE) },
      reparer: src => write(join(src, 'aaa-casse.mjs'), bascule('fixe')),
    })
  })

  it('erreur tardive, hors production minifiée', () => {
    jouer('tardif-dev', {
      config: { minify: true },
      args: [],
      essai: src => { ajouts(src); write(join(src, 'zz-tardif.mjs'), TARDIF) },
      reparer: src => write(join(src, 'zz-tardif.mjs'), bascule('fixe')),
    })
  })
})

// après l'échec, une construction complète SANS --cache (le cache de l'échec reste sur le disque, jamais jeté), puis des sources
// changées et une construction rapide : comparée à la construction complète du même état
function alterner(nom: string, config: Record<string, unknown>, args: string[]): void {
  const root = mjsTmp('echec-cache-' + nom)
  const src  = join(root, 'app/modularjs')
  const out  = join(root, 'public/modularjs')
  const at   = (dir: string): string => join(root, 'essai', dir)
  write(join(root, 'mjs.config.json'), JSON.stringify({ ...CONFIG, ...config }))
  write(join(src, 'accueil.mjs'), vivant('accueil'))
  write(join(src, 'pied.mjs'), vivant('pied'))
  mkdirSync(join(root, 'node_modules'))
  assert.equal(build(root, [...args, '--cache']).status, 0)
  ajouts(src)
  write(join(src, 'aaa-casse.mjs'), CASSE)
  assert.notEqual(build(root, [...args, '--cache']).status, 0)
  write(join(src, 'aaa-casse.mjs'), bascule('fixe'))
  assert.equal(build(root, args).status, 0)
  copie(out, at('milieu'))
  write(join(src, 'accueil.mjs'), vivant('accueil3'))
  write(join(src, 'bascule-m.mjs'), bascule('milieu'))
  const rapide = build(root, [...args, '--cache'])
  assert.equal(rapide.status, 0, rapide.out)
  console.log('      ' + nom + ' — rapide : ' + rapide.served + ' repris, ' + rapide.cold + ' recompilés ' + rapide.reason)
  copie(out, at('rapide'))
  copie(at('milieu'), out)
  assert.equal(build(root, args).status, 0)
  assert.deepEqual(gaps(at('rapide'), out), [])
  // et la construction rapide suivante, sans changement, sur la sortie de la construction complète
  const encore = build(root, [...args, '--cache'])
  assert.equal(encore.status, 0, encore.out)
  console.log('      ' + nom + ' — rapide sans changement : ' + encore.served + ' repris, ' + encore.cold + ' recompilés ' + encore.reason)
  assert.deepEqual(gaps(out, at('rapide')), [])
}

describe('construction --cache en échec, puis construction complète sans --cache, puis construction rapide', function () {
  this.timeout(240000)

  it('production', () => alterner('alternance-prod', {}, ['--prod']))
  it('hors production, minify true', () => alterner('alternance-dev', { minify: true }, []))
  it('js bundle, production', () => alterner('alternance-bundle', { js: 'bundle' }, ['--prod']))
})
