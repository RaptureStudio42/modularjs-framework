// `@evt.modificateur=nom` suit la règle de `@evt=nom` dans le fallback d'un `<@failed>` et sur une balise globale : un nom que
// rien ne fournit est refusé à la construction, avec la ligne de l'attribut, même quand un attribut voisin porte un modificateur
// et, pour valeur sans guillemets, le nom d'un événement écrit plus bas (cette valeur posait un écouteur fantôme). Dans le
// fallback, un modificateur, jamais posé, est refusé avec sa ligne. Un commentaire de plusieurs lignes qui cite une balise du
// langage, écrit dans une chaîne d'une interpolation, ne laisse aucun caractère NUL dans le code ni dans le rendu serveur, et
// les lignes qui le suivent gardent leur numéro ; un commentaire de l'auteur dans une telle chaîne y reste tel qu'écrit. `toString`, `__proto__` et `__defineGetter__` sont nommés comme des propriétés
// que la fenêtre hérite, `comptime` et `arguments` comme des mots qu'aucune fonction ne peut porter

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'
import { renderToString } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const S   = '<script>\n$n = 0\n</script>\n'
const BT  = String.fromCharCode(96)
const NUL = String.fromCharCode(0)

// le code compilé ('' quand la construction s'arrête), le message de l'arrêt et les erreurs écrites en console
async function construit(src: string): Promise<{ code: string; refus: string; console: string[] }> {
  const orig = console.error
  const vus  = [] as string[]
  console.error = (...a: unknown[]) => { vus.push(a.map(String).join(' ')) }
  try {
    const r: any = await transpile(src, { moduleName: 'cas' })
    return { code: String(r.output), refus: '', console: vus }
  }
  catch (err: any) {
    return { code: '', refus: String(err?.message ?? err), console: vus }
  }
  finally {
    console.error = orig
  }
}

// les lignes citées par un arrêt, dans l'ordre
const lignes = (msg: string): number[] => [...msg.matchAll(/\(ligne (\d+)\)/g)].map((m) => Number(m[1]))

describe('gestionnaire nommé seul : modificateurs, jeton interne, derniers noms', () => {
  it('un commentaire de plusieurs lignes qui cite une balise, dans une chaîne d\'interpolation, ne laisse aucun NUL', async () => {
    const seul = await construit(S + '<p>{' + BT + 'x<!-- <@window>\n-->y' + BT + '}</p>\n')
    assert.equal(seul.refus, '')
    assert.ok(!seul.code.includes(NUL), 'caractère NUL dans le code : ' + JSON.stringify(seul.code.slice(seul.code.indexOf('updText'), seul.code.indexOf('updText') + 60)))
    assert.ok(seul.code.includes(BT + 'xy' + BT), 'texte attendu : xy')
    const apresBloc = await construit(S + '<@window\n  @keydown={-> $n++}\n/>\n<p>{"x<!-- <@w>\n-->y"}</p>\n<p>{' + BT + 'a<!-- <@head>\n\n-->b' + BT + '}</p>\n')
    assert.equal(apresBloc.refus, '')
    assert.ok(!apresBloc.code.includes(NUL), 'caractère NUL dans le code après un bloc de plusieurs lignes')
    const auteur = await construit(S + '<p>{"a<!-- b -->c"}</p>\n')
    assert.equal(auteur.refus, '')
    assert.ok(!auteur.code.includes(NUL) && auteur.code.includes('a<!-- b -->c'), 'commentaire de l\'auteur dans une chaîne : ' + JSON.stringify(auteur.code.slice(auteur.code.indexOf('updText'), auteur.code.indexOf('updText') + 60)))
  })

  it('les lignes qui suivent ce commentaire gardent leur numéro', async () => {
    const r = await construit(S + '<p>{' + BT + 'x<!-- <@window>\n-->y' + BT + '}</p>\n<button @click=inconnuL>b</button>\n')
    assert.deepEqual(lignes(r.refus), [6], r.refus)
  })

  it('rendu serveur : aucun NUL, le texte de l\'auteur sans le commentaire', async () => {
    const root   = mjsTmp('jeton-interne-ssr')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'ip.mjs'), S + '<@window\n  @keydown={-> $n++}\n/>\n<p class="ip">{' + BT + 'x<!-- <@window>\n-->y' + BT + '}</p>\n')
    const garde = console.warn
    console.warn = () => {}
    let rendu: unknown
    try {
      rendu = await renderToString({ sourceDir: srcDir, outputDir: join(root, 'out'), tag: 'mjs-ip' } as any)
    }
    finally {
      console.warn = garde
    }
    const html = typeof rendu === 'string' ? rendu : JSON.stringify(rendu)
    assert.ok(!html.includes(NUL) && !html.includes('\\u0000'), 'caractère NUL dans le rendu serveur : ' + html.slice(0, 300))
    assert.ok(html.includes('xy'), 'texte attendu : xy, rendu ' + html.slice(0, 300))
  })

  it('fallback d\'un <@failed> : un nom absent avec un modificateur est refusé, avec la ligne', async () => {
    const r = await construit(S + '<@failed err reset>\n<button @click.once=inconnuF>f</button>\n</@failed>\n<p>{$n}</p>\n')
    assert.ok(r.refus.includes('« @click.once=inconnuF »'), r.refus || 'la construction passe')
    assert.deepEqual(lignes(r.refus), [5], r.refus)
  })

  it('fallback d\'un <@failed> : un modificateur, jamais posé, est refusé avec sa ligne (nom fourni compris)', async () => {
    const r = await construit(S + '<@failed err reset>\n<p>{err.message}</p>\n<button @click.once=reset>f</button>\n</@failed>\n<p>{$n}</p>\n')
    assert.equal(r.refus, '')
    assert.ok(r.console.some((m) => m.includes('« @click.once »') && m.includes('<@failed>') && m.includes('(ligne 6)')), JSON.stringify(r.console))
  })

  it('balises globales : un nom absent avec un modificateur est refusé, avec la ligne de son attribut', async () => {
    for (const [balise, attendu] of [
      ['<@window @resize.once=@inconnuM />', '« @resize.once=@inconnuM »'],
      ['<@window @resize.once=inconnuR />', '« @resize.once=inconnuR »'],
      ['<@document @click.stop=inconnuD />', '« @click.stop=inconnuD »'],
      ['<@body @click.prevent={inconnuP} />', '« @click.prevent={inconnuP} »'],
    ]) {
      const r = await construit(S + balise + '\n<p>{$n}</p>\n')
      assert.ok(r.refus.includes(attendu), balise + ' : ' + (r.refus || 'la construction passe'))
      assert.deepEqual(lignes(r.refus), [4], balise + ' : ' + r.refus)
    }
  })

  it('<@window> : la valeur sans guillemets d\'un attribut à modificateur ne pose aucun écouteur et ne déplace pas la ligne', async () => {
    const voisin = await construit('<script>\n$n = 0\n@resize = -> $n++\n</script>\n<@window\n  @scroll.passive=@resize\n  @resize=inconnuR\n/>\n<p>{$n}</p>\n')
    assert.ok(voisin.refus.includes('« @resize=inconnuR »'), voisin.refus || 'la construction passe')
    assert.deepEqual(lignes(voisin.refus), [7], voisin.refus)
    const methode = await construit('<script>\n$n = 0\n@ok = -> $n++\n</script>\n<@window @resize.once=@ok />\n<p>{$n}</p>\n')
    assert.equal(methode.refus, '')
    assert.ok(!/\bok\(e\)/.test(methode.code), 'écouteur fantôme de l\'événement ok')
  })

  it('toString, __proto__ et __defineGetter__ : des propriétés que la fenêtre hérite, jamais dites absentes', async () => {
    for (const nom of ['toString', '__proto__', '__defineGetter__']) {
      for (const balise of [`<button @click=${nom}>a</button>`, `<@window @keydown=${nom} />`]) {
        const r = await construit(S + balise + '\n<p>{$n}</p>\n')
        assert.ok(r.refus.includes(`Object.prototype.${nom}`), balise + ' : ' + (r.refus || 'la construction passe'))
        assert.ok(!r.refus.includes('ni le navigateur ne fournit'), balise + ' : ' + r.refus)
      }
    }
  })

  it('comptime et arguments : des mots qu\'aucune fonction ne peut porter, sans déclaration impossible proposée', async () => {
    for (const nom of ['comptime', 'arguments']) {
      const r = await construit(S + `<button @click=${nom}>a</button>\n`)
      assert.ok(r.refus.includes('aucune fonction ne peut porter ce nom'), nom + ' : ' + (r.refus || 'la construction passe'))
      assert.ok(!r.refus.includes(`Déclarez « ${nom} = -> … »`), nom + ' : ' + r.refus)
      assert.deepEqual(lignes(r.refus), [4], r.refus)
    }
  })
})
