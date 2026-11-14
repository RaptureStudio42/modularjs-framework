// Un mot de MJS ne prend pas de modificateur d'événement : `:size.propagate={f}` (de même `.prevent`, `.stop`, `.self`, `.once`,
// `.emit.nom`) se construisait comme l'écoute de l'événement « size » — le signe `:` ne sert qu'aux mots. Il est refusé, le message donne
// la forme du mot et renvoie à µmount pour écouter un événement de ce nom ; le refus de l'ancienne écriture `@size.propagate` ne propose plus
// `:size.propagate`. Les modificateurs propres à un mot restent permis (`:in.global`, `:in.shared`, `:attach.once`, `:emit.nom`, `:group.x`,
// `:style.x`, `:viewTransition.nom`), et un événement garde les siens
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const TETE = "<script>\n$l = [{ id: 1 }]\n$g = []\nf = -> 1\n</script>\n"

// le message de l'erreur levée par la construction, '' si elle passe
async function refus(gabarit: string): Promise<string> {
  try {
    await transpile(TETE + gabarit + '\n', { moduleName: 'motsModificateurs' })
    return ''
  }
  catch (e: any) {
    return String(e?.message ?? e)
  }
}

const MESSAGE = 'modificateur d\'événement'

describe('mots de MJS en `:mot` : pas de modificateur d\'événement', function () {
  this.timeout(60000)

  const REFUSES: [string, string][] = [
    ['<mjs-c-child :size.propagate={f}></mjs-c-child>', ':size="…"'],
    ['<span :title.propagate={f}>x</span>', ':title="…"'],
    ['<mjs-c-child :size.prevent={f}></mjs-c-child>', ':size="…"'],
    ['<mjs-c-child :size.stop={f}></mjs-c-child>', ':size="…"'],
    ['<mjs-c-child :size.self={f}></mjs-c-child>', ':size="…"'],
    ['<mjs-c-child :size.once={f}></mjs-c-child>', ':size="…"'],
    ['<mjs-c-child :size.emit.x={f}></mjs-c-child>', ':size="…"'],
    ['<details :open.once={f}>x</details>', ':open={…}'],
    ['<mjs-c-child :lightDom.stop></mjs-c-child>', ':lightDom'],
    ['<a href="/x" :noUJS.stop>x</a>', ':noUJS'],
    ['<p :in.once=*fly(up)>x</p>', ':in=*effet(…)'],
  ]
  for (const [gabarit, forme] of REFUSES) it(`refusé : ${gabarit}`, async () => {
    const message = await refus(gabarit)
    for (const attendu of [MESSAGE, forme, 'µmount']) assert.ok(message.includes(attendu), `« ${attendu} » attendu dans : ${message || '(construit sans erreur)'}`)
  })

  const ANCIENS: [string, string, string][] = [
    ['<mjs-c-child @size.propagate={f}></mjs-c-child>', ':size="…"', ':size.propagate'],
    ['<span @title.prevent={f}>x</span>', ':title="…"', ':title.prevent'],
  ]
  for (const [gabarit, forme, faux] of ANCIENS) it(`ancienne écriture : ${gabarit}`, async () => {
    const message = await refus(gabarit)
    for (const attendu of [forme, 'µmount']) assert.ok(message.includes(attendu), `« ${attendu} » attendu dans : ${message}`)
    assert.ok(!message.includes(faux), `l'écriture fausse « ${faux} » ne doit pas être proposée : ${message}`)
  })

  const PERMIS = [
    '{if $l}<p :in.global=*fade>x</p>{end}',
    '{if $l}<p :in.shared=*fade>x</p>{end}',
    '<p :attach.once={ (n) -> n.dataset.v = 1 }>x</p>',
    '<mjs-c-child :emit.choix={ n: 1 }></mjs-c-child>',
    '<input type="checkbox" aria-label="a" value="a" :group.x=!{$g}>',
    "<p :style.color={'red'}>x</p>",
    '<img alt="" src="/a.png" :viewTransition.hero>',
    '<button @click.prevent={f()}>x</button>',
    '<mjs-c-child @reorder.stop={f()}></mjs-c-child>',
  ]
  for (const gabarit of PERMIS) it(`permis : ${gabarit}`, async () => {
    const message = await refus(gabarit)
    assert.ok(!message.includes(MESSAGE), `pas de refus de modificateur attendu : ${message}`)
  })
})
