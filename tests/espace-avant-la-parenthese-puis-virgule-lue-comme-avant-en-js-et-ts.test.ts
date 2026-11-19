// Dans un composant en JavaScript ou en TypeScript, `µafter (d), 1`, `µevery (d), 2` et `µtoggle ($a), 1` ne se lisent que d'une
// façon : la parenthèse est celle de l'appel, comme dans son <script>. Ses gestionnaires d'événement et ses rappels de transition
// sortent donc tels que le compilateur les sortait avant le refus de cette forme, qui ne vaut que pour un composant en Civet ou en
// CoffeeScript (une virgule après la parenthèse y sépare aussi les arguments de la rune). Sans <script>, ou avec un <script> sans
// `lang`, la langue est celle du projet (`defaultScriptLang`, Civet par défaut).

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

// un composant au <script> en JavaScript ou en TypeScript, et son gabarit
const js     = (lang: string, gabarit: string) => `${gabarit}\n<script lang="${lang}">\n$a = '';\nconst d = 20;\n</script>\n`
// un composant au <script> en Civet (sans `lang`) ou en CoffeeScript
const civet  = (gabarit: string, lang = '') => `${gabarit}\n<script${lang ? ` lang="${lang}"` : ''}>\n$a = ''\nd = 20\n</script>\n`
// un rappel de transition, sur la balise d'un `{if}`
const rappel = (code: string) => `{if $a}<p :transition=*slide(x, duration: 250ms) @introend={${code}}>x</p>{end}`

const compiler = (source: string, defaultScriptLang?: 'civet' | 'coffee' | 'js' | 'ts') => transpile(source, { moduleName: 'essai', devWarnings: true, ...(defaultScriptLang ? { defaultScriptLang } : {}) })
const utiles   = (sortie: string) => sortie.split('\n').filter(l => /µ\.|_mjs_cb_introend/.test(l)).join('\n').slice(0, 2000)

// nom, gabarit, morceau de la sortie (la lecture d'avant)
const LUS: [string, string, string][] = [
  ['gestionnaire : Promise.race([µafter (d), 1])', '<p>{$a}</p><button @click={() => Promise.race([µafter (d), 1])}>b</button>', 'return () => Promise.race([µ.after(_mjsThis, d), 1])'],
  ['gestionnaire : console.log(µafter (d), 1)', '<p>{$a}</p><button @click={() => console.log(µafter (d), 1)}>b</button>', 'return () => console.log(µ.after(_mjsThis, d), 1)'],
  ['gestionnaire : console.log(µtoggle ($a), 1)', '<p>{$a}</p><button @click={() => console.log(µtoggle ($a), 1)}>b</button>', "return () => console.log(((_v) => (µ._set(_mjsThis, 'a', _v), _v))(!$.a), 1)"],
  ['gestionnaire : [µevery (d), 2]', '<p>{$a}</p><button @click={() => { const t = [µevery (d), 2]; }}>b</button>', 'const t = [µ.every(_mjsThis, d), 2]; }'],
  ['rappel de transition : console.log(µafter (d), 1)', rappel('console.log(µafter (d), 1)'), '_mjs_cb_introend = () => { console.log(µ.after(_mjsThis, d), 1); }'],
  ['rappel de transition : t = [µevery (d), 2]', rappel('t = [µevery (d), 2]'), '_mjs_cb_introend = () => { let t = [µ.every(_mjsThis, d), 2]; }']
]

// nom, source, langue du projet : la forme reste refusée
const REFUSEES: [string, string, ('civet' | 'coffee')?][] = [
  ['gestionnaire d\'un composant en Civet', civet('<p>{$a}</p><button @click={-> console.log(µafter (d), 1)}>b</button>')],
  ['rappel de transition d\'un composant en Civet', civet(rappel('console.log(µafter (d), 1)'))],
  ['gestionnaire d\'un composant en CoffeeScript', civet('<p>{$a}</p><button @click={-> console.log(µafter (d), 1)}>b</button>', 'coffee')],
  ['sans <script>, langue du projet par défaut (Civet)', '<p>x</p><button @click={-> console.log(µafter (20), 1)}>b</button>\n'],
  ['sans <script>, langue du projet CoffeeScript', '<p>x</p><button @click={-> console.log(µafter (20), 1)}>b</button>\n', 'coffee']
]

describe('µafter (d), 1 dans un composant en JavaScript ou en TypeScript : gestionnaires et rappels de transition lus comme avant', () => {
  for (const lang of ['js', 'ts']) {
    for (const [nom, gabarit, morceau] of LUS) {
      it(`${lang} — ${nom}`, async () => {
        const sortie = String((await compiler(js(lang, gabarit))).output)
        assert.ok(sortie.includes(morceau), `« ${morceau} » attendu dans :\n${utiles(sortie)}`)
      })
    }
  }

  for (const lang of ['js', 'ts'] as const) {
    it(`sans <script>, langue du projet ${lang} : lu comme avant`, async () => {
      const sortie = String((await compiler('<p>x</p><button @click={() => console.log(µafter (20), 1)}>b</button>\n', lang)).output)
      assert.ok(sortie.includes('return () => console.log(µ.after(_mjsThis, 20), 1)'), utiles(sortie))
    })
  }

  it('un <script> sans lang, langue du projet js : lu comme avant', async () => {
    const source = '<p>{$a}</p><button @click={() => console.log(µafter (d), 1)}>b</button>\n<script>\n$a = \'\';\nconst d = 20;\n</script>\n'
    const sortie = String((await compiler(source, 'js')).output)
    assert.ok(sortie.includes('return () => console.log(µ.after(_mjsThis, d), 1)'), utiles(sortie))
  })

  for (const [nom, source, langue] of REFUSEES) {
    it(`toujours refusée : ${nom}`, async () => {
      await assert.rejects(compiler(source, langue), (err: any) => {
        assert.match(String(err?.message ?? err), /µafter \(…\), …/)
        return true
      })
    })
  }
})
