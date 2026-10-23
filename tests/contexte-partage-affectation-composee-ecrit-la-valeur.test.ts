// `§§n += 1`, les autres affectations composées, `§§n++` / `++§§n` / `§§n--` / `--§§n` et `||=` / `&&=` / `??=`
// écrivent la valeur partagée comme `§n` le fait pour le contexte, dans le <script> et dans un gestionnaire du
// gabarit.
//
// Défaut : une valeur simple posée par `§§n = 1` est rangée dans l'objet réactif `{ value }` que `§§n` rend ; le
// calcul partait de cet objet, et `§§n += 1` écrivait « [object Object]1 » dans le contexte partagé, sans erreur.
// `§§nom ||= 'invité'` ne remplaçait jamais un texte vide (l'objet n'est jamais faux).
//
// Correctif : une écriture composée calcule sur la valeur rangée (`value`) quand le contexte tient une valeur simple,
// sur l'objet lui-même sinon.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const SOURCES: Record<string, string> = {
  'ctx-somme-parent': [
    '<script>',
    '§§n = 1',
    "§§nom = ''",
    '§§objet = { c: 1 }',
    '$go = -> §§n += 1',
    '$inc = -> §§n++',
    "$nommer = -> §§nom ||= 'invité'",
    '$garder = -> §§objet ??= { c: 2 }',
    '</script>',
    '<p class="v">{§§n.value}|{§§nom.value}|{§§objet.c}</p>',
    '<mjs-ctx-somme-enfant></mjs-ctx-somme-enfant>',
    '<button class="a" @click={$go()}>a</button>',
    '<button class="b" @click={§§n += 10}>b</button>',
    '<button class="c" @click={$inc()}>c</button>',
    '<button class="d" @click={§§n++}>d</button>',
    '<button class="e" @click={--§§n}>e</button>',
    '<button class="f" @click={$nommer()}>f</button>',
    '<button class="g" @click={§§n *= 2}>g</button>',
    '<button class="h" @click={$garder()}>h</button>',
  ].join('\n'),
  'ctx-somme-enfant': [
    '<script>',
    '$x = 0',
    '</script>',
    '<p class="enfant">{§§n.value}</p>',
  ].join('\n'),
}

function projet(etiquette: string, config: Record<string, unknown>): string {
  const root = mjsTmp('contexte-partage-composee-' + etiquette)
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', ...config }))
  for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(root, 'src', `${nom}.mjs`), source + '\n')
  return root
}

describe('§§ — une affectation composée écrit la valeur partagée', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  for (const [etiquette, config] of [['dev', {}], ['minifie', { minify: true }]] as const) {
    it(`<script> et gestionnaires du gabarit, lus par le composant et par son enfant (${etiquette})`, async () => {
      const app = await createHarness({ root: projet(etiquette, config) })
      try {
        const c = await app.mount('ctx-somme-parent')
        const enfant = () => {
          const el = c.find('mjs-ctx-somme-enfant')
          return ((el?._shadow ?? el)?.textContent ?? '').trim()
        }
        await c.tick()
        assert.equal(c.text('.v'), '1||1')
        const etapes: [string, string][] = [
          ['a', '2||1'], ['b', '12||1'], ['c', '13||1'], ['d', '14||1'], ['e', '13||1'], ['f', '13|invité|1'], ['g', '26|invité|1'], ['h', '26|invité|1'],
        ]
        for (const [bouton, attendu] of etapes) {
          await c.click('.' + bouton)
          await c.tick()
          assert.equal(c.text('.v'), attendu, `après le bouton ${bouton}`)
        }
        assert.equal(enfant(), '26', 'l\'enfant lit la même valeur')
        c.destroy()
      }
      finally { await app.destroy() }
    })
  }
})
