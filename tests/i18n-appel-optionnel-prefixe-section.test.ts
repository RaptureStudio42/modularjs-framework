// i18n — l'appel OPTIONNEL de la traduction reçoit le préfixe de la section `@i18n` comme l'appel
// simple. Avec `@i18n 'admin'`, `µt?.('nb')` restait `µ.t?.('nb')` (repère `⟦nb⟧` à l'écran) alors
// que `µt('nb')` devenait `µ.t('admin.nb')` : seul le marqueur `µ.t(` était cherché dans le compilé.
// Formes couvertes : `µt?.(…)`, `µt?(…)` (Civet le compile en `?.(`), `µ.t?.(…)`, `µ?.t(…)`, `µ?.t?.(…)`,
// dans le script, une valeur calculée, un gestionnaire et le gabarit ; la forme écrite est gardée.
// Gardes : rien n'est préfixé dans une chaîne, un commentaire, une propriété `o.t`, une fonction `t`
// de l'appli, ni sur l'objet d'une appli dont le nom finit par `µ`

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.ts'

async function compile(lignes: string[], nom: string): Promise<string> {
  const { output } = await transpile(lignes.join('\n'), { moduleName: nom })
  return output
}

describe('i18n — appel optionnel de µt : préfixe de la section @i18n', function () {
  this.timeout(8000)

  it('script Civet : µt?.(), µt?(), µ.t?.(), µ?.t(), µ?.t?.() préfixés, forme optionnelle gardée', async () => {
    const out = await compile([
      "@i18n 'admin'",
      '<script lang="civet">',
      "a := µt?.('kc1', {n: 1})",
      "b := µt?('kc2')",
      "c := µ.t?.('kc3')",
      "d := µ?.t('kc4')",
      "e := µ?.t?.('kc5')",
      "f := µt('kc0')",
      '</script>',
      '<p>{a}{b}{c}{d}{e}{f}</p>',
    ], 'mjs-i18n-opt-civet')
    assert.match(out, /µ\.t\?\.\('admin\.kc1', \{n: 1\}\)/)
    assert.match(out, /µ\.t\?\.\('admin\.kc2'\)/)
    assert.match(out, /µ\.t\?\.\('admin\.kc3'\)/)
    assert.match(out, /µ\?\.t\('admin\.kc4'\)/)
    assert.match(out, /µ\?\.t\?\.\('admin\.kc5'\)/)
    assert.match(out, /µ\.t\('admin\.kc0'\)/)
  })

  it('script JavaScript : µt?.(), µ.t?.(), µ?.t(), µ?.t?.() préfixés', async () => {
    const out = await compile([
      "@i18n 'admin'",
      '<script lang="js">',
      "const a = µt?.('kj1')",
      "const c = µ.t?.('kj3')",
      "const d = µ?.t('kj4', { n: 2 })",
      "const e = µ?.t?.('kj5')",
      '</script>',
      '<p>{a}{c}{d}{e}</p>',
    ], 'mjs-i18n-opt-js')
    assert.match(out, /µ\.t\?\.\('admin\.kj1'\)/)
    assert.match(out, /µ\.t\?\.\('admin\.kj3'\)/)
    assert.match(out, /µ\?\.t\('admin\.kj4', \{ n: 2 \}\)/)
    assert.match(out, /µ\?\.t\?\.\('admin\.kj5'\)/)
  })

  it('valeur calculée du script : µt?.() et µ?.t() préfixés', async () => {
    const out = await compile([
      "@i18n 'admin'",
      '<script lang="civet">',
      '$n = 1',
      "$total = µt?.('kv1', {n: $n})",
      "$deux = µ?.t('kv2', {n: $n})",
      '</script>',
      '<p>{$total}{$deux}</p>',
    ], 'mjs-i18n-opt-derivee')
    assert.match(out, /µ\.t\?\.\('admin\.kv1'/)
    assert.match(out, /µ\?\.t\('admin\.kv2'/)
    assert.doesNotMatch(out, /\('kv[12]'/)
  })

  it('gestionnaire : µt?.(), µt?(), µ.t?.(), µ?.t() préfixés', async () => {
    const out = await compile([
      "@i18n 'admin'",
      '<script lang="civet">',
      "$x = ''",
      '</script>',
      "<button @click={$x = µt?.('kh1')}>a</button>",
      "<button @click={$x = µt?('kh2')}>b</button>",
      "<button @click={$x = µ.t?.('kh3')}>c</button>",
      "<button @click={$x = µ?.t('kh4')}>d</button>",
      '<p>{$x}</p>',
    ], 'mjs-i18n-opt-gestionnaire')
    for (const k of ['kh1', 'kh2', 'kh3', 'kh4']) {
      assert.match(out, new RegExp(`'admin\\.${k}'`), `${k} préfixé`)
      assert.doesNotMatch(out, new RegExp(`'${k}'`), `${k} jamais laissé nu`)
    }
  })

  it('gabarit (texte et attribut) : µt?.(), µt?(), µ.t?.(), µ?.t() préfixés', async () => {
    const out = await compile([
      "@i18n 'admin'",
      "<p>{µt?.('kg1', {n: 2})}</p>",
      "<p>{µt?('kg2')}</p>",
      "<p>{µ.t?.('kg3')}</p>",
      "<p>{µ?.t('kg4')}</p>",
      "<p title={µt?.('kg5')}>x</p>",
    ], 'mjs-i18n-opt-gabarit')
    assert.match(out, /µ\.t\?\.\('admin\.kg1', \{n: 2\}\)/)
    assert.match(out, /µ\.t\?\.\('admin\.kg2'\)/)
    assert.match(out, /µ\.t\?\.\('admin\.kg3'\)/)
    assert.match(out, /µ\?\.t\('admin\.kg4'\)/)
    assert.match(out, /µ\.t\?\.\('admin\.kg5'\)/)
  })

  it('chemin absolu, mode de @i18nPlaceholder et sections en plus : comme µt()', async () => {
    const out = await compile([
      "@i18n 'admin' 'commun'",
      '@i18nPlaceholder wait',
      "<p>{µt?.('/nav.fermer')}</p>",
      "<p>{µ?.t('km')}</p>",
    ], 'mjs-i18n-opt-options')
    assert.match(out, /µ\.t\?\.\('nav\.fermer', undefined, 'wait'\)/)
    assert.match(out, /µ\?\.t\('admin\.km', undefined, 'wait', \['commun\.km'\]\)/)
  })

  it('aucun préfixe à tort : chaîne, commentaire, propriété o.t, fonction t de l\'appli, objet nommé …µ', async () => {
    const out = await compile([
      "@i18n 'admin'",
      '<script lang="js">',
      'const o = { t: (x) => x }',
      'function t(x) { return x }',
      'const fooµ = { t: (x) => x }',
      "const g = o.t?.('nkj1')",
      "const n = t?.('nkj2')",
      "const s = \"µt?.('nkj3')\"",
      "// µt?.('nkj4')",
      "const p = fooµ.t?.('nkj5')",
      "const q = fooµ.t('nkj6')",
      '</script>',
      '<p>{g}{n}{s}{p}{q}</p>',
      "<p>{\"µt?.('nkg1')\"}</p>",
    ], 'mjs-i18n-opt-gardes')
    for (const k of ['nkj1', 'nkj2', 'nkj3', 'nkj5', 'nkj6', 'nkg1']) {
      assert.match(out, new RegExp(`'${k}'`), `${k} intact`)
    }
    assert.doesNotMatch(out, /admin\.nk/)
  })
})
