// generateCreateFnBodyImperative (generator/paths.ts) testait la présence de l'attribut
// `mjs-light` (réécrit depuis `@lightDom` en amont) par une regex sur le texte BRUT des
// attributs du tag, sans protéger les valeurs QUOTÉES : un attribut SANS RAPPORT (`title`) qui
// mentionne « mjs-light » en PROSE (plausible pour la propre documentation de MJS sur sa
// fonctionnalité `@lightDom`) forçait à tort le mode léger — perte silencieuse du Shadow DOM
// (isolation CSS, :host, contenu slotté) sur un composant qui n'a jamais demandé ce mode. Le
// mode impératif (`document.createElement`) n'est émis que si le fragment contient une
// interpolation `${...}` — d'où le `{$n}` dans les gabarits ci-dessous.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function compileSuccessBranch(cardAttrs: string): Promise<string> {
  const src = [
    '<script>', '$p = Promise.resolve(1)', '$n = \'x\'', '</script>',
    '{await $p}', '{success d}',
    `<mjs-card ${cardAttrs}>{$n}</mjs-card>`,
    '{end}',
  ].join('\n')
  const { output } = await transpile(src, { moduleName: 'pathsLightFauxPositif' })
  return output
}

describe('generator/paths.ts — détection mjs-light ignore le texte des attributs quotés', () => {
  it('une prose mentionnant "mjs-light" dans un attribut sans rapport ne force pas le mode léger', async () => {
    const output = await compileSuccessBranch('title="Astuce : mjs-light desactive le shadow DOM"')
    assert.equal(output.includes('_mjs_lightNext'), false)
  })

  it('non-régression — un vrai @lightDom force toujours le mode léger, même à côté du même piège', async () => {
    const output = await compileSuccessBranch('@lightDom title="Astuce : mjs-light desactive le shadow DOM"')
    assert.match(output, /µ\._mjs_lightNext = "mjs-card"/)
  })
})
