// Les mots de MJS sur une balise s'écrivent avec deux-points (`:size="320x48"`, `:lightDom`, `:flip`, `:class{$on}="vif"`), un effet garde
// l'étoile (`*nom`, `*nom(réglages)`), et `@` ne sert plus qu'aux événements. Chaque mot sous sa forme `:` donne le code de toujours ; un
// effet garde son nom à côté du mot du même nom ; un événement à soi s'écoute par `@` ; l'ancienne écriture `@mot` est refusée à la
// construction avec la nouvelle dans le message (jamais lue en silence comme l'écoute d'un événement), un `:inconnu` aussi, avec la liaison
// de MJS ; une pseudo-classe d'une feuille de style, une chaîne du script, un `xlink:href`, un `:title=` du texte ne bougent pas
import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { parse } from '../src/parser/index.js'

const TETE = "<script>\n$l = [{ id: 1 }]\n$on = true\n$c = 'red'\n$h = '<b>x</b>'\n$g = []\n$off = true\n$r = 0\n$d = 0\n$$sock = null\nref = null\n</script>\n"

const sortie = async (gabarit: string, nom = 'motsDeuxPoints'): Promise<string> => (await transpile(TETE + gabarit + '\n', { moduleName: nom })).output

// le message de l'erreur levée par la construction, '' si elle passe
async function refus(gabarit: string): Promise<string> {
  try {
    await sortie(gabarit, 'motsDeuxPointsRefus')
    return ''
  }
  catch (e: any) {
    return String(e?.message ?? e)
  }
}

// les attributs de la première balise `nom` de l'arbre lu
function attributs(gabarit: string, nom: string): { name?: string, val?: unknown, expr?: string, type: string }[] {
  const pile: any[] = [parse(gabarit)]
  while (pile.length) {
    const n = pile.shift()
    if (n.type === 'tag' && n.name === nom) return n.attrs
    pile.push(...(n.children ?? []))
  }
  return []
}

describe('mots de MJS en `:mot` : la construction', function () {
  this.timeout(60000)

  describe('chaque mot sous sa forme `:` donne le code de toujours', () => {
    const CAS: [string, string, string][] = [
      [':lightDom', '<mjs-c-child :lightDom></mjs-c-child>', ' mjs-light'],
      [':noUJS', '<a href="/x" :noUJS>x</a>', 'mjs-no-ujs'],
      [':permanent', '<div id="p" :permanent>x</div>', 'mjs-permanent'],
      [':offscreen', '<div :offscreen>x</div>', "mjs-offscreen='24px'"],
      [':offscreen=48', '<div :offscreen=48>x</div>', "mjs-offscreen='48px'"],
      [':flip', '<ul :flip>{for t in $l by id}<li>{t.id}</li>{end}</ul>', "mjs-flip='200'"],
      [':flip=300', '<ul :flip=300>{for t in $l by id}<li>{t.id}</li>{end}</ul>', "mjs-flip='300'"],
      [':childtransition="all"', '<div :childtransition="all">{if $on}<p :out=*fade>x</p>{end}</div>', "mjs-childtransition='all'"],
      [':size="320x48"', '<mjs-c-child :size="320x48"></mjs-c-child>', "mjs-size='320x48'"],
      [':wake=view', '<mjs-c-child :wake=view></mjs-c-child>', "mjs-wake='view'"],
      [':disabled={$off}', '<input aria-label="x" :disabled={$off}>', "'disabled', $.off"],
      [':preload=hover', '<a href="/x" :preload=hover>x</a>', "mjs-preload='hover'"],
      [':method=delete', '<a href="/x" :method=delete>x</a>', "mjs-method='delete'"],
      [':confirm="Sûr ?"', '<a href="/x" :confirm="Sûr ?">x</a>', "mjs-confirm='Sûr ?'"],
      [':callback="fini"', '<form action="/x" :callback="fini"></form>', "mjs-callback='fini'"],
      [':flash="popup"', '<a href="/x" :flash="popup">x</a>', "mjs-flash='popup'"],
      [':title="Aide"', '<span :title="Aide">x</span>', "mjs-title='Aide'"],
      [':pageTransition="fade"', '<a href="/x" :pageTransition="fade">x</a>', "mjs-vt='fade'"],
      [':viewTransition.hero', '<img alt="" src="/a.png" :viewTransition.hero>', "'view-transition-name'"],
      [':viewTransition.nom={…} sur <@view>', '<@view main :viewTransition.cube={ dir: left }>', "data-mjs-vt='cube=&#123; dir: left &#125;'"],
      [':emit.choix={…}', '<mjs-c-child :emit.choix={ n: 1 }></mjs-c-child>', "this._mjs_emit('choix', {n: 1})"],
      [':group.x=!{…}', '<input type="checkbox" aria-label="a" value="a" :group.x=!{$g}>', "name='mjs-grp-g'"],
    ]
    for (const [ecrit, gabarit, attendu] of CAS) it(`${ecrit}`, async () => {
      const code = await sortie(gabarit)
      assert.ok(code.includes(attendu), `${ecrit} : « ${attendu} » attendu dans le code`)
    })

    // les mots sans attribut à eux dans le code : le lecteur donne au générateur l'attribut qu'il traite depuis toujours
    const LUS: [string, string, string, string, unknown][] = [
      [':class{$on}="vif"', '<p :class{$on}="vif">x</p>', 'p', '@class{$on}', 'vif'],
      [':style.color={…}', "<p :style.color={$on ? 'red' : 'blue'}>x</p>", 'p', '@style.color', "$on ? 'red' : 'blue'"],
      [':style.color{$on}=red', '<p :style.color{$on}=red>x</p>', 'p', '@style.color{$on}', 'red'],
      [':in=*fly(up)', '<p :in=*fly(up)>x</p>', 'p', '@in', '*fly(up)'],
      [':in.global=*fade', '<p :in.global=*fade>x</p>', 'p', '@in.global', '*fade()'],
      [':transition=*crossfade(key: id)', '<p :transition=*crossfade(key: id)>x</p>', 'p', '@transition', '*crossfade(key: id)'],
      [':this=!{ref}', '<p :this=!{ref}>x</p>', 'p', '@this', '!{ref}'],
      [':html=!{…}', '<p :html=!{$h}>x</p>', 'p', '@html', '!{$h}'],
      [':text=!{…}', '<p :text=!{$h}>x</p>', 'p', '@text', '!{$h}'],
      [':attach.once={…}', '<p :attach.once={ (n) -> n.dataset.v = 1 }>x</p>', 'p', '@attach.once', ' (n) -> n.dataset.v = 1 '],
      [':lightDom', '<mjs-c-child :lightDom></mjs-c-child>', 'mjs-c-child', '@lightDom', undefined],
    ]
    for (const [ecrit, gabarit, balise, nom, valeur] of LUS) it(`${ecrit} : lu comme le mot de toujours`, async () => {
      const a = attributs(gabarit, balise).find((x) => x.name === nom)
      assert.ok(a, `${ecrit} : attribut ${nom} attendu, lu : ${JSON.stringify(attributs(gabarit, balise))}`)
      assert.equal(a!.type === 'dynamic' ? a!.expr : a!.val, valeur)
      await sortie(gabarit)
    })
  })

  describe('un effet garde son nom à côté du mot du même nom', () => {
    it('*flip(direction: up) et *flash restent des effets, :flip et :flash="popup" des mots, sur d\'autres balises', async () => {
      const code = await sortie('<span *flip(direction: up)>a</span><span *flash>b</span><div *skeleton>c</div><span *follow($$sock)>d</span><ul :flip>{for t in $l by id}<li>{t.id}</li>{end}</ul><a href="/x" :flash="popup">x</a>')
      for (const attendu of ['"flip", {"direction":"up"}', '"flash", {}', '"skeleton", {}', '"follow"', "mjs-flip='200'", "mjs-flash='popup'"]) assert.ok(code.includes(attendu), `« ${attendu} » attendu dans le code`)
    })
  })

  describe('un événement à soi s\'écoute par `@`', () => {
    it('@reorder et @dom sont des événements', async () => {
      const code = await sortie('<mjs-c-child @reorder={ $r = 1 } @dom={ $d = 1 }></mjs-c-child>')
      assert.ok(code.includes('"reorder":{') && code.includes('"dom":{'), 'écouteurs « reorder » et « dom » attendus')
    })
  })

  describe('le signe ne se lit que sur une balise du gabarit', () => {
    it('pseudo-classes du style, chaîne du script, xlink:href et texte restent tels quels', async () => {
      const src = "<script>\nt = ':titreDuScript'\n</script>\n<svg><use xlink:href=\"#a\"></use></svg>\n<p>Écrivez :title=\"Aide\" ici</p>\n<style>\n  input:disabled\n    color: red\n  :host(:hover)\n    color: blue\n  details:open\n    color: green\n</style>\n"
      const { output } = await transpile(src, { moduleName: 'motsDeuxPointsIntacts' })
      for (const attendu of ['input:disabled', ':host(:hover)', 'details:open', ':titreDuScript', 'xlink:href', ':title=']) assert.ok(output.includes(attendu), `« ${attendu} » attendu tel quel`)
      assert.ok(!output.includes('mjs-title'), 'le :title= du texte n\'est pas un mot')
    })
  })

  describe('la transition : l\'ancienne écriture est refusée, la nouvelle dans le message', () => {
    const ANCIENS: [string, string[]][] = [
      ['<mjs-c-child @size="320x48"></mjs-c-child>', [':size="320x48"', 'µmount']],
      ['<mjs-c-child @lightDom></mjs-c-child>', [':lightDom']],
      ['<details @open={$on}>x</details>', [':open={$on}', 'µmount']],
      ['<input aria-label="x" @disabled>', [':disabled']],
      ['<ul @flip>{for t in $l by id}<li>{t.id}</li>{end}</ul>', [':flip']],
      ['<div @offscreen>x</div>', [':offscreen']],
      ['<div @childtransition>{if $on}<p>x</p>{end}</div>', [':childtransition']],
      ['<a href="/x" @noUJS>x</a>', [':noUJS']],
      ['<div id="p" @permanent>x</div>', [':permanent']],
      ['<a href="/x" @confirm="Sûr ?">x</a>', [':confirm="Sûr ?"']],
      ['<p @class{$on}="vif">x</p>', [':class{$on}="vif"']],
      ['<p @style.color={$c}>x</p>', [':style.color={$c}']],
      ['<p @this=!{ref}>x</p>', [':this=!{ref}']],
      ['<mjs-c-child @wake=view></mjs-c-child>', [':wake=view']],
      ['<p @in=*fly(up)>x</p>', [':in=*fly(up)']],
      ['<a href="/x" @title="Aide">x</a>', [':title="Aide"']],
      ['<a href="/x" @pageTransition="fade">x</a>', [':pageTransition="fade"']],
      ['<img alt="" src="/a.png" @viewTransition.hero>', [':viewTransition.hero']],
    ]
    for (const [gabarit, attendus] of ANCIENS) it(`${gabarit}`, async () => {
      const message = await refus(gabarit)
      assert.ok(message, `${gabarit} : refus attendu`)
      for (const attendu of attendus) assert.ok(message.includes(attendu), `« ${attendu} » attendu dans : ${message}`)
    })

    it('un mot écrit avec l\'étoile d\'un effet : le message d\'effet inconnu donne le mot', async () => {
      for (const [gabarit, attendu] of [['<mjs-c-child *lightDom></mjs-c-child>', ':lightDom'], ['<mjs-c-child *size></mjs-c-child>', ':size']]) {
        const message = await refus(gabarit)
        assert.ok(message.includes(attendu), `« ${attendu} » attendu dans : ${message}`)
      }
    })

    it('un `:inconnu` est refusé : la liste des mots, et la liaison de MJS pour un attribut ou une prop', async () => {
      const message = await refus('<p :inconnu=3>x</p>')
      for (const attendu of [':inconnu', ':size', ':lightDom', ':wake', 'inconnu={3}']) assert.ok(message.includes(attendu), `« ${attendu} » attendu dans : ${message}`)
      const vue = await refus('<mjs-c-child :titre="x"></mjs-c-child>')
      assert.ok(vue.includes('titre={x}'), `« titre={x} » attendu dans : ${vue}`)
    })

    it('un message de `:size` cite le mot tel qu\'il s\'écrit, jamais son nom interne', async () => {
      for (const gabarit of ['<mjs-c-child :size></mjs-c-child>', '<mjs-c-child :size="0x48"></mjs-c-child>']) {
        const message = await refus(gabarit)
        assert.ok(message.includes('« :size'), `« :size attendu dans : ${message}`)
        assert.ok(!message.includes('@size'), `aucun @size dans : ${message}`)
      }
    })
  })
})
