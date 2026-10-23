// `{success}` et `{error}` écrits sans nom, au niveau des branches d'un `{await}`, ouvrent la branche exactement comme `{success }` (avec une espace) : la branche n'a pas de valeur
// nommée. Ils étaient lus comme l'affichage d'une variable `success` / `error` (« success is not defined » dans la page), alors que le bloc `{await}` dit qu'une branche s'ouvre.
// Hors d'un `{await}`, ou plus bas que ses branches (dans une balise, un `{if}`, un `{for}` ou un `{key}` de la branche), ils restent une interpolation ordinaire.
// `{success v}` avec un nom, et les mots qui commencent par `success` ou `error` (`{successCount}`, `{error.message}`), sont inchangés.

import assert from 'node:assert/strict'
import { parse } from '../src/parser/index.js'
import { transpile } from '../src/transpiler/index.js'

// l'arbre lu, sans les numéros de ligne : deux écritures qui disent la même chose donnent le même texte
const arbre = (html: string): string => JSON.stringify(parse(html), (cle, valeur) => cle === 'line' ? undefined : valeur)

// le composant entier, sans la carte de source : deux écritures qui disent la même chose donnent la même sortie
async function sortie(corps: string, nom: string): Promise<string> {
  const source = ['<script>', '  $p = Promise.resolve(1)', '  $on = true', '</script>', corps, ''].join('\n')
  const { output } = await transpile(source, { moduleName: nom })
  return output.replace(/\/\/# sourceMappingURL=.*$/m, '')
}

// les types des branches d'un `{await}`, avec leur valeur nommée : `pending`, `success:v`, `error`
const branches = (html: string): string[] => {
  const bloc = parse(html).children.find((n: any) => n.type === 'await')
  assert.ok(bloc, 'aucun {await} lu')
  return bloc!.branches.map((b: any) => b.type + (b.arg ? ':' + b.arg : ''))
}

// l'expression d'un nœud d'affichage
const expression = (n: any): string | null => n.type === 'expr' ? n.expr : null

describe('{success} et {error} sans nom, dans un {await}', () => {
  describe('ils ouvrent la branche, comme avec une espace', () => {
    const AVEC_ESPACE = '{await $p}<i>attente</i>{success }<b>arrivé</b>{error }<u>raté</u>{end}'
    const SANS_ESPACE = '{await $p}<i>attente</i>{success}<b>arrivé</b>{error}<u>raté</u>{end}'

    it('l\'arbre lu est celui de l\'écriture avec une espace', () => {
      assert.equal(arbre(SANS_ESPACE), arbre(AVEC_ESPACE))
    })

    it('trois branches : attente, {success}, {error}', () => {
      assert.deepEqual(branches(SANS_ESPACE), ['pending', 'success', 'error'])
    })

    it('aucune branche n\'a de valeur nommée, et rien ne reste en affichage de variable', () => {
      const bloc = parse(SANS_ESPACE).children[0]
      for (const b of bloc.branches) {
        assert.ok(!b.arg, `la branche ${b.type} a une valeur nommée : ${JSON.stringify(b.arg)}`)
        assert.deepEqual(b.children.filter((n: any) => n.type === 'expr'), [], `la branche ${b.type} contient un affichage`)
      }
    })

    it('le contenu de chaque branche est celui qui la suit', () => {
      const [attente, succes, erreur] = parse(SANS_ESPACE).children[0].branches
      assert.equal(attente.children[0].children[0].content, 'attente')
      assert.equal(succes.children[0].children[0].content, 'arrivé')
      assert.equal(erreur.children[0].children[0].content, 'raté')
    })

    it('{success} seul, {error} seul', () => {
      assert.deepEqual(branches('{await $p}<i>a</i>{success}<b>b</b>{end}'), ['pending', 'success'])
      assert.deepEqual(branches('{await $p}<i>a</i>{error}<u>c</u>{end}'), ['pending', 'error'])
      assert.deepEqual(branches('{await $p}{success}<b>b</b>{end}'), ['pending', 'success'])
    })

    it('mêlés aux branches nommées : {success v} puis {error}, {success} puis {error err}', () => {
      assert.deepEqual(branches('{await $p}<i>a</i>{success v}<b>{v}</b>{error}<u>c</u>{end}'), ['pending', 'success:v', 'error'])
      assert.deepEqual(branches('{await $p}<i>a</i>{success}<b>b</b>{error err}<u>{err}</u>{end}'), ['pending', 'success', 'error:err'])
    })

    it('plusieurs espaces ou un retour à la ligne avant l\'accolade : la branche s\'ouvre toujours, avec le même arbre', () => {
      assert.equal(arbre('{await $p}<i>a</i>{success  }<b>b</b>{error\n}<u>c</u>{end}'), arbre('{await $p}<i>a</i>{success}<b>b</b>{error}<u>c</u>{end}'))
    })

    it('sur plusieurs lignes, comme on l\'écrit', () => {
      const html = '{await $p}\n  <i>attente</i>\n{success}\n  <b>arrivé</b>\n{error}\n  <u>raté</u>\n{end}\n'
      assert.deepEqual(branches(html), ['pending', 'success', 'error'])
    })

    it('un {await} dans un {if} : ses {success} et {error} ouvrent encore ses branches', () => {
      const racine = parse('{if $on}{await $p}<i>a</i>{success}<b>b</b>{error}<u>c</u>{end}{end}')
      const dedans = racine.children[0].branches[0].children[0]
      assert.equal(dedans.type, 'await')
      assert.deepEqual(dedans.branches.map((b: any) => b.type), ['pending', 'success', 'error'])
    })

    it('un {await} dans un {for} ou un {key} : même chose', () => {
      for (const ouvrant of ['{for n in $l}', '{key $on}']) {
        const racine = parse(`${ouvrant}{await $p}<i>a</i>{success}<b>b</b>{end}{end}`)
        const dedans = racine.children[0].children[0]
        assert.equal(dedans.type, 'await', ouvrant)
        assert.deepEqual(dedans.branches.map((b: any) => b.type), ['pending', 'success'], ouvrant)
      }
    })

    it('deux {await} l\'un après l\'autre : chacun a ses branches', () => {
      const racine = parse('{await $p}<i>a</i>{success}<b>b</b>{end}{await $q}<i>c</i>{error}<u>d</u>{end}')
      assert.deepEqual(racine.children.map((n: any) => n.type), ['await', 'await'])
      assert.deepEqual(racine.children[0].branches.map((b: any) => b.type), ['pending', 'success'])
      assert.deepEqual(racine.children[1].branches.map((b: any) => b.type), ['pending', 'error'])
    })

    it('un {await} dans une branche d\'un autre : le {success} rencontré est celui du plus proche', () => {
      const racine  = parse('{await $p}<i>a</i>{success v}{await $q}<i>b</i>{success}<b>c</b>{end}{error}<u>d</u>{end}')
      const externe = racine.children[0]
      assert.deepEqual(externe.branches.map((b: any) => b.type + (b.arg ? ':' + b.arg : '')), ['pending', 'success:v', 'error'])
      const interne = externe.branches[1].children.find((n: any) => n.type === 'await')
      assert.deepEqual(interne.branches.map((b: any) => b.type), ['pending', 'success'])
    })
  })

  describe('ailleurs, ils restent l\'affichage d\'une variable', () => {
    it('à la racine', () => {
      assert.deepEqual(parse('<p>a</p>{success}{error}').children.map(expression), [null, 'success', 'error'])
    })

    it('dans une balise, à la racine', () => {
      const p = parse('<p>{success} {error}</p>').children[0]
      assert.deepEqual(p.children.map(expression), ['success', null, 'error'])
    })

    it('dans un {if}, un {for} ou un {key} qui ne sont pas dans un {await}', () => {
      for (const ouvrant of ['{if $on}', '{for n in $l}', '{key $on}']) {
        const bloc    = parse(`${ouvrant}{success}{error}{end}`).children[0]
        const enfants = bloc.type === 'if' ? bloc.branches[0].children : bloc.children
        assert.deepEqual(enfants.map(expression), ['success', 'error'], ouvrant)
      }
    })

    it('dans une balise de la branche d\'attente, de {success} ou de {error}', () => {
      const bloc = parse('{await $p}<i>{success}</i>{success v}<b>{success}</b>{error err}<u>{error}</u>{end}').children[0]
      assert.deepEqual(bloc.branches.map((b: any) => b.type), ['pending', 'success', 'error'])
      assert.deepEqual(bloc.branches.map((b: any) => b.children[0].children.map(expression)), [['success'], ['success'], ['error']])
    })

    it('dans un {if}, un {for} ou un {key} placé dans une branche : un affichage, pas une branche', () => {
      for (const ouvrant of ['{if $on}', '{for n in $l}', '{key $on}']) {
        const bloc = parse(`{await $p}<i>a</i>{success v}${ouvrant}{success}{error}{end}{end}`).children[0]
        assert.deepEqual(bloc.branches.map((b: any) => b.type), ['pending', 'success'], ouvrant)
        const dedans  = bloc.branches[1].children[0]
        const enfants = dedans.type === 'if' ? dedans.branches[0].children : dedans.children
        assert.deepEqual(enfants.map(expression), ['success', 'error'], ouvrant)
      }
    })

    it('après le {end} de l\'{await} : un affichage', () => {
      const racine = parse('{await $p}<i>a</i>{success}<b>b</b>{end}{success}')
      assert.deepEqual(racine.children.map((n: any) => n.type), ['await', 'expr'])
      assert.equal(racine.children[1].expr, 'success')
    })

    it('un mot qui commence par success ou error, ou un accès : un affichage, même au niveau des branches', () => {
      const bloc = parse('{await $p}{successCount}{error.message}{errors}{success.length}{success}<b>b</b>{end}').children[0]
      assert.deepEqual(bloc.branches.map((b: any) => b.type), ['pending', 'success'])
      assert.deepEqual(bloc.branches[0].children.map(expression), ['successCount', 'error.message', 'errors', 'success.length'])
    })

    it('avec une espace après l\'accolade ouvrante : un affichage (le nom s\'écrit collé à l\'accolade)', () => {
      const bloc = parse('{await $p}<i>a</i>{ success }<b>b</b>{end}').children[0]
      assert.deepEqual(bloc.branches.map((b: any) => b.type), ['pending'])
      assert.equal(bloc.branches[0].children.map(expression).filter(Boolean)[0], 'success')
    })
  })

  describe('avec un nom : inchangé', () => {
    it('{success v} et {error err} ouvrent leur branche avec leur valeur nommée', () => {
      assert.deepEqual(branches('{await $p}<i>a</i>{success v}<b>{v}</b>{error err}<u>{err}</u>{end}'), ['pending', 'success:v', 'error:err'])
    })

    it('un nom réservé reste refusé', () => {
      assert.throws(() => parse('{await $p}<i>a</i>{success el}<b>b</b>{end}'), /\[NOM RÉSERVÉ\].*`el`/s)
    })
  })

  describe('le composant construit', () => {
    const CORPS_NU     = '{await $p}\n  <i class="att">attente</i>\n{success}\n  <b class="ok">arrivé</b>\n{error}\n  <u class="ko">raté</u>\n{end}'
    const CORPS_ESPACE = '{await $p}\n  <i class="att">attente</i>\n{success }\n  <b class="ok">arrivé</b>\n{error }\n  <u class="ko">raté</u>\n{end}'

    it('{success}{error} donne la même sortie que {success }{error }', async () => {
      assert.equal(await sortie(CORPS_NU, 'sans-nom'), await sortie(CORPS_ESPACE, 'sans-nom'))
    })

    it('la sortie ne lit aucune variable success ni error', async () => {
      const code = await sortie(CORPS_NU, 'sans-lecture')
      assert.doesNotMatch(code, /\$\{(?:success|error)\}/, 'un texte lit success ou error')
      assert.doesNotMatch(code, /_mjs_updText\('[^']+', (?:success|error)\)/, 'un affichage lit success ou error')
      assert.match(code, /arrivé/)
      assert.match(code, /raté/)
    })

    it('hors d\'un {await}, {success} se construit en lecture d\'une variable success', async () => {
      const source = ['<script>', '  success = \'bravo\'', '</script>', '<p class="v">{success}</p>', ''].join('\n')
      const { output } = await transpile(source, { moduleName: 'lecture-variable' })
      assert.match(output, /_mjs_updText\('[^']+', success\)/)
    })
  })
})
