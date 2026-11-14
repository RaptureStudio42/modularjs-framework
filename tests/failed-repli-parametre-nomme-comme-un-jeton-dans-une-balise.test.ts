// dans le repli d'un <@failed>, une expression qui commence par un mot de branche qu'un repli ne porte jamais (`{error …}`,
// `{success …}`), ou par le nom d'un de ses paramètres (`<@failed err end>` puis `{end}`), écrite dans une balise raccourcie
// (`<@carte>…</@carte>`, `<@@progress>…</@@progress>`) : rendue dans la balise, comme ailleurs dans le repli. Lue comme un jeton de
// bloc, elle rendait vide la balise ouverte autour d'elle : la construction était refusée (« balise fermante orpheline » sur une
// fermante qui a son ouvrante), ou le contenu sortait de la balise. Les vrais blocs et les vraies fermantes orphelines restent
// refusés. Développement et production, composant et partiel, fins de ligne CRLF
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const LEVE = '<p>{jette()}</p>\n<script>\n  jette = -> throw new Error(\'boum\')\n</script>\n'

// la construction d'une page dont le repli (paramètres `params`) porte `corps` à sa troisième ligne ; `partiel` : la page entière
// dans un partiel inclus ; `crlf` : fins de ligne CRLF. Rend le texte des erreurs, leur nombre et le code compilé de la page
async function construire(params: string, corps: string, facon: { prod?: boolean, partiel?: boolean, crlf?: boolean } = {}): Promise<{ texte: string, nombre: number, js: string }> {
  const root = mjsTmp('failed-repli-jeton-balise')
  const src  = join(root, 'src')
  const out  = join(root, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'carte.mjs'), '<p class="carte">carte {$titre}</p>\n<script>\n  $titre = \'\'\n</script>\n')
  let cas = `<@failed ${params}>\n  <p class="repli">repli</p>\n${corps}</@failed>\n${LEVE}`
  if (facon.crlf) cas = cas.replace(/\n/g, '\r\n')
  if (facon.partiel) writeFileSync(join(src, '_cas.mjs'), cas)
  writeFileSync(join(src, 'page.mjs'), facon.partiel ? '<div><@include cas></div>\n' : cas)
  const garde = { warn: console.warn, log: console.log, error: console.error }
  console.warn = console.log = console.error = () => {}
  try {
    const b     = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js'), env: facon.prod ? 'prod' : 'dev' })
    const stats = await b.compile()
    await b.close()
    const js = stats.errors.length ? '' : readdirSync(out).filter(f => /^page-.*\.js$/.test(f)).map(f => readFileSync(join(out, f), 'utf-8')).join('\n')
    return { texte: stats.errors.map(e => e.message).join('\n'), nombre: stats.errors.length, js }
  }
  finally {
    Object.assign(console, garde)
  }
}

// le code compilé, guillemets échappés et blancs ramenés à une espace
const lu = (js: string): string => js.replace(/\\(['"])/g, '$1').replace(/\\n/g, ' ').replace(/\s+/g, ' ')

describe('<@failed> : un paramètre nommé comme un jeton de bloc, dans une balise raccourcie du repli, y reste', function () {
  this.timeout(120000)

  after(async () => { await terminateSharedWorkerPool() })

  // le nom du cas, les paramètres, le corps du repli, l'ouvrante et la fermante rendues, le calcul attendu entre les deux (développement)
  const CAS: Array<[string, string, string, string, string, string]> = [
    ['{error || …} dans <@carte>', 'error reset', '  <@carte titre="x">{error || \'inconnue\'}</@carte>\n', '<mjs-carte titre="x">', '</mjs-carte>', '_esc(error || \'inconnue\')'],
    ['{error ? … : …} dans <@carte> sur trois lignes', 'error reset', '  <@carte>\n    {error ? error.message : \'x\'}\n  </@carte>\n', '<mjs-carte>', '</mjs-carte>', '_esc(error ? error.message : \'x\')'],
    ['{success and …} dans <@@progress>', 'success reset', '  <@@progress value="1" max="2">{success and \'a\'}</@@progress>\n', '<mjs-core-progress value="1" max="2">', '</mjs-core-progress>', '_esc(success && \'a\')'],
    ['{end} paramètre dans <@carte>', 'err end', '  <@carte>{end}</@carte>\n', '<mjs-carte>', '</mjs-carte>', '_esc(end)'],
    ['{error || …} variable du script dans <@carte>', 'err reset', '  <div><@carte>{error || \'x\'}</@carte></div>\n', '<mjs-carte>', '</mjs-carte>', '_esc(error || \'x\')']
  ]
  for (const prod of [false, true]) {
    for (const [nom, params, corps, ouvrante, fermante, calcul] of CAS) {
      for (const facon of [{ prod }, { prod, partiel: true }, { prod, crlf: true }]) {
        it(`${nom}, ${prod ? 'production' : 'développement'}${facon.partiel ? ', partiel' : ''}${facon.crlf ? ', CRLF' : ''}`, async () => {
          const { texte, js } = await construire(params, corps, facon)
          assert.equal(texte, '', 'construction refusée')
          const code = lu(js)
          const a    = code.indexOf(ouvrante)
          const b    = code.indexOf(fermante, a)
          assert.ok(a >= 0 && b > a, `${ouvrante}…${fermante} absents : ${code.slice(code.indexOf('_mjs_fallback'), code.indexOf('_mjs_fallback') + 500)}`)
          assert.ok(!/<\/@@?[a-z]/i.test(code.slice(a)), 'une fermante raccourcie reste telle qu\'écrite')
          if (!prod) assert.ok(code.slice(a, b).includes(calcul), `le calcul hors de la balise : ${code.slice(a - 40, b + 40)}`)
        })
      }
    }
  }

  it('deux paramètres nommés comme des jetons (`key`, `end`) sur une ligne : deux expressions', async () => {
    const { texte, js } = await construire('key end', '  <p>{key ? \'a\' : \'b\'} {end}</p>\n')
    assert.equal(texte, '')
    assert.ok(lu(js).includes('_esc(key ? \'a\' : \'b\') + \' \' + µ._esc(end)'), lu(js).slice(lu(js).indexOf('_mjs_fallback'), lu(js).indexOf('_mjs_fallback') + 400))
  })

  it('un vrai bloc dans une balise raccourcie, une vraie fermante orpheline : refusés, une fois, à leur ligne', async () => {
    const bloc = await construire('error reset', '  <@carte>{if error}x{end}</@carte>\n')
    assert.equal(bloc.nombre, 1, bloc.texte)
    assert.match(bloc.texte, /<@failed> ligne 3 : le bloc \{if\} ne peut pas vivre/)
    assert.doesNotMatch(bloc.texte, /ORPHELINE/)
    const attente = await construire('err reset', '  <@carte>{await Promise.resolve(1)}<i>a</i>{error e}<i>e</i>{end}</@carte>\n')
    assert.equal(attente.nombre, 1, attente.texte)
    assert.match(attente.texte, /<@failed> ligne 3 : le bloc \{await\} ne peut pas vivre/)
    const casse = await construire('error reset', '  <p>a</p>\n  <@Carte>{error || \'x\'}</@carte>\n')
    assert.equal(casse.nombre, 1, casse.texte)
    assert.match(casse.texte, /\[BALISE FERMANTE ORPHELINE\] `<\/@carte>` ligne 4 : aucune balise ouvrante correspondante/)
  })
})
