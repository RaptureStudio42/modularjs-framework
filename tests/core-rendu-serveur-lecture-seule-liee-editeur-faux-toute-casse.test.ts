// le HTML rendu par le serveur écrit ce qu'écrit le navigateur, en développement comme en production (le serveur construit dans le même
// environnement que le client) :
// - `readonly={$x}` (valeur liée) sur la case, l'interrupteur, le radio, le bouton rotatif et la jauge : vraie, l'attribut est écrit sur la
//   balise, comme le fait le navigateur, qui sort alors le champ de la validation ; fausse, `null` ou « false » (toute casse), il ne l'est pas.
//   La liste ne le porte jamais, comme `<select>`, qui ignore `readonly`. `readonly="FALSE"` écrit dans la page sur la case et `readonly`
//   écrit sur la liste se rendent sans erreur (la lecture des attributs n'est pas coupée), comme un texte que cette lecture relit en JSON :
//   `readonly="[1]"` et `readonly="[]"` sur la liste, `readonly="[false]"` sur la case (la balise ne le porte plus, comme dans le
//   navigateur) ; `readonly="null"` écrit sur la case reste écrit, comme dans le navigateur
// - l'éditeur : `disabled="FALSE"` et `readonly="FALSE"` (toute casse) le laissent actif et modifiable, son champ caché écrit ; `readonly={$x}`
//   et `disabled={$x}` liés suivent leur valeur, « false » (toute casse) compris ; `answer="FALSE"` (toute casse) et `answer={$x}` lié au texte
//   « FALSE » laissent le mode « répondre » éteint, comme `answer="false"` et comme dans le navigateur. Les mêmes attributs écrits vides restent
//   vrais (témoins)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const MODULES = ['checkbox', 'switch', 'radio', 'knob', 'gauge']
const VALEURS: Record<string, string> = { vrai: 'true', faux: 'false', nul: 'null', bas: '\'false\'', haut: '\'FALSE\'', mixte: '\'False\'' }
const LISTE   = '<@@option value="">-</@@option><@@option value="a">A</@@option>'
const MODELE  = '<ul data-checklist><li>un</li></ul>'

const EDITEURS: Array<[string, string]> = [
  ['ed-dis', 'disabled="FALSE"'], ['ed-dis2', 'disabled="False"'], ['ed-dis-t', 'disabled'],
  ['ed-ro', 'readonly="FALSE"'], ['ed-ro2', 'readonly="False"'], ['ed-ro-t', 'readonly'],
  ['ed-ans', `answer="FALSE" value="${MODELE}"`], ['ed-ans3', `answer="false" value="${MODELE}"`], ['ed-ans-t', `answer value="${MODELE}"`], ['ed-lans-h', `answer={$haut} value="${MODELE}"`],
  ['ed-lro-v', 'readonly={$vrai}'], ['ed-lro-f', 'readonly={$faux}'], ['ed-lro-n', 'readonly={$nul}'], ['ed-lro-h', 'readonly={$haut}'],
  ['ed-ldis-v', 'disabled={$vrai}'], ['ed-ldis-f', 'disabled={$faux}'], ['ed-ldis-n', 'disabled={$nul}'], ['ed-ldis-h', 'disabled={$haut}']
]

const PAGE = `<script>
${Object.entries(VALEURS).map(([k, v]) => `  $${k} = ${v}`).join('\n')}
</script>

<form class="fs" method="get" action="/envoi">
${MODULES.map((m) => Object.keys(VALEURS).map((k) => `  <@@${m} class="${m}-${k}" name="${m}-${k}" value="1" readonly={$${k}}>x</@@${m}>`).join('\n')).join('\n')}
  <@@select class="ls" name="ls" readonly={$vrai}>${LISTE}</@@select>
  <@@checkbox class="ecrit-c" name="ecrit-c" readonly="FALSE">x</@@checkbox>
  <@@select class="ecrit-l" name="ecrit-l" readonly>${LISTE}</@@select>
${EDITEURS.map(([c, a]) => `  <@@editor class="${c}" name="${c}" toolbar="none" ${a}></@@editor>`).join('\n')}
</form>
`

for (const env of ['dev', 'prod'] as const) describe(`rendu serveur (${env === 'dev' ? 'développement' : 'production'}) : readonly lié des cinq modules et « false » de l'éditeur, écrits comme dans le navigateur`, function () {
  this.timeout(120000)
  const parts: Record<string, string> = {}

  before(async () => {
    const root = mjsTmp('rendu-serveur-lecture-liee-editeur-' + env)
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'hote-ssr.mjs'), PAGE)
    const renderer = await createSSRRenderer({ sourceDir: src, outputDir: join(root, 'out'), bundlerOpts: { runtime: ['hydrate'], ...(env === 'prod' ? { env: 'prod' } : {}) } } as any)
    try {
      const r = await renderer.renderToString('mjs-hote-ssr', { ssrMode: 'markers' } as any)
      // le HTML de chaque module, de sa balise à celle du module suivant
      for (const p of r.html.split(/(?=<mjs-core-(?:checkbox|switch|radio|knob|gauge|select|editor)\b)/)) {
        const c = (p.match(/^<mjs-core-[a-z]+ [^>]*class="([^"]+)"/) || [])[1]
        if (c) parts[c] = p
      }
    }
    finally {
      await renderer.close()
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  const balise  = (c: string) => (parts[c].match(/^<[^>]*>/) || [''])[0]
  const porte   = (c: string, a: string) => new RegExp(`\\s${a}(?=[\\s=>/])`).test(balise(c))
  const surface = (c: string) => (parts[c].match(/<div class="surface[^>]*>/) || [''])[0]
  const attr    = (c: string, a: string) => (surface(c).match(new RegExp(`\\s${a}="([^"]*)"`)) || [])[1] ?? null
  const champs  = (c: string) => (parts[c].match(new RegExp(`<input(?=[^>]*type="hidden")(?=[^>]*name="${c}")[^>]*>`, 'g')) || []).length
  // ce que dit la zone d'écriture de l'éditeur : [modifiable, aria-disabled, aria-readonly, rôle, champs cachés écrits]
  const zone    = (c: string) => [attr(c, 'contenteditable'), attr(c, 'aria-disabled'), attr(c, 'aria-readonly'), attr(c, 'role'), champs(c)]

  it('chaque module est rendu, readonly="FALSE" écrit sur la case et readonly écrit sur la liste compris', () => {
    assert.equal(Object.keys(parts).length, MODULES.length * Object.keys(VALEURS).length + 3 + EDITEURS.length)
    assert.ok(parts['ecrit-c'] && parts['ecrit-l'], 'la case et la liste écrites en dur')
  })

  it('readonly={$x} vrai : la case, l\'interrupteur, le radio, le bouton rotatif et la jauge portent readonly ; faux, null ou « false » (toute casse) : non', () => {
    for (const m of MODULES) assert.deepEqual(Object.keys(VALEURS).map((k) => porte(`${m}-${k}`, 'readonly')), [true, false, false, false, false, false], m)
  })

  it('readonly={$x} vrai : la liste ne porte pas readonly, comme <select>', () => {
    assert.equal(porte('ls', 'readonly'), false)
  })

  it('l\'éditeur : disabled="FALSE" (toute casse) le laisse actif, son champ caché écrit ; disabled écrit vide le désactive', () => {
    assert.deepEqual(['ed-dis', 'ed-dis2', 'ed-dis-t'].map(zone), [['true', null, null, 'textbox', 1], ['true', null, null, 'textbox', 1], ['false', 'true', null, 'textbox', 0]])
  })

  it('l\'éditeur : readonly="FALSE" (toute casse) le laisse modifiable ; readonly écrit vide le fige', () => {
    assert.deepEqual(['ed-ro', 'ed-ro2', 'ed-ro-t'].map(zone), [['true', null, null, 'textbox', 1], ['true', null, null, 'textbox', 1], ['false', null, 'true', 'textbox', 1]])
  })

  it('l\'éditeur : readonly={$x} et disabled={$x} liés suivent leur valeur ; faux, null ou « FALSE » : modifiable et actif', () => {
    assert.deepEqual(['ed-lro-v', 'ed-lro-f', 'ed-lro-n', 'ed-lro-h'].map(zone), [['false', null, 'true', 'textbox', 1], ['true', null, null, 'textbox', 1], ['true', null, null, 'textbox', 1], ['true', null, null, 'textbox', 1]])
    assert.deepEqual(['ed-ldis-v', 'ed-ldis-f', 'ed-ldis-n', 'ed-ldis-h'].map(zone), [['false', 'true', null, 'textbox', 0], ['true', null, null, 'textbox', 1], ['true', null, null, 'textbox', 1], ['true', null, null, 'textbox', 1]])
  })

  it('l\'éditeur : answer="FALSE" (toute casse) et answer={$x} lié au texte « FALSE » laissent le mode « répondre » éteint, comme answer="false" et comme dans le navigateur ; answer écrit vide l\'allume', () => {
    assert.deepEqual(['ed-ans', 'ed-ans3', 'ed-ans-t'].map((c) => attr(c, 'role')), ['textbox', 'textbox', 'group'])
    assert.equal(attr('ed-lans-h', 'role'), 'textbox', 'answer={$x} lié au texte « FALSE »')
  })
})

// chaque texte dans sa propre page : une page qui ne se rend pas ne cache pas les autres
const TEXTES: Array<[string, string]> = [
  ['liste-un', `<@@select class="m" name="m" readonly="[1]">${LISTE}</@@select>`],
  ['liste-vide', `<@@select class="m" name="m" readonly="[]">${LISTE}</@@select>`],
  ['case-faux', '<@@checkbox class="m" name="m" value="1" readonly="[false]">x</@@checkbox>'],
  ['case-null', '<@@checkbox class="m" name="m" value="1" readonly="null">x</@@checkbox>']
]

for (const env of ['dev', 'prod'] as const) describe(`rendu serveur (${env === 'dev' ? 'développement' : 'production'}) : readonly écrit sous un texte que la lecture des attributs relit`, function () {
  this.timeout(120000)
  const pages: Record<string, string> = {}

  before(async () => {
    const root = mjsTmp('rendu-serveur-lecture-texte-' + env)
    const src  = join(root, 'src')
    mkdirSync(src, { recursive: true })
    for (const [n, corps] of TEXTES) writeFileSync(join(src, `texte-${n}.mjs`), `<form method="get" action="/envoi">\n  ${corps}\n</form>\n`)
    const renderer = await createSSRRenderer({ sourceDir: src, outputDir: join(root, 'out'), bundlerOpts: { runtime: ['hydrate'], ...(env === 'prod' ? { env: 'prod' } : {}) } } as any)
    try {
      for (const [n] of TEXTES) {
        try {
          pages[n] = (await renderer.renderToString('mjs-texte-' + n, { ssrMode: 'markers' } as any)).html
        }
        catch (e: any) {
          pages[n] = 'ÉCHEC du rendu : ' + String(e && e.message || e)
        }
      }
    }
    finally {
      await renderer.close()
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  const balise = (n: string) => {
    assert.doesNotMatch(pages[n], /^ÉCHEC/, `la page se rend (${n})`)
    return (pages[n].match(/<mjs-core-(?:select|checkbox) [^>]*>/) || [''])[0]
  }
  const porte = (n: string) => /\sreadonly(?=[\s=>/])/.test(balise(n))

  it('readonly="[1]" et readonly="[]" sur la liste : la page se rend, la balise ne porte pas readonly', () => {
    assert.deepEqual([porte('liste-un'), porte('liste-vide')], [false, false])
  })

  it('readonly="[false]" sur la case : la page se rend, la balise ne porte pas readonly', () => {
    assert.equal(porte('case-faux'), false)
  })

  it('readonly="null" sur la case : la page se rend, readonly reste écrit', () => {
    assert.match(balise('case-null'), /\sreadonly="null"/)
  })
})
