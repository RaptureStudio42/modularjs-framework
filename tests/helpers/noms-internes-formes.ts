// les formes du gabarit où le code de l'auteur est évalué à côté du code que le compilateur écrit : une même table sert à
// jouer chaque nom interne en variable de l'auteur (navigateur) et à relever les noms que le code émis déclare (audit)
// - une forme écrit un fragment de gabarit qui lit ou écrit un MEMBRE de la variable sous test (`NOM.c`) : cachée par un nom
//   du compilateur, la lecture rend `undefined` (ou lève) et l'écriture va ailleurs, ce que le rendu montre
// - chaque forme se joue à la racine, dans une ligne de `{for}` et dans la branche d'un `{await}`

export const CONTEXTES = ['racine', 'boucle', 'attente'] as const
export type Contexte = typeof CONTEXTES[number]

const dans = (ctx: Contexte, corps: string): string => ctx === 'racine'
  ? corps
  : ctx === 'boucle' ? `{for l in $lignes}\n${corps}\n{end}` : `{await $p}\n<i>attente</i>\n{success w}\n${corps}\n{end}`

export type Forme = {
  id: string
  titre: string
  // les noms que le gabarit donne EXPRÈS au code de l'auteur dans cette forme : le gestionnaire reçoit `e` et `el`
  sauf?: string[]
  // les contextes où la forme existe (par défaut tous) : les formes qui lisent la ligne n'ont de sens que dans un `{for}`
  ctxs?: Contexte[]
  html: (n: string, c: Contexte) => string
}

export const FORMES: Forme[] = [
  { id: 'cls', titre: '@class{…}',                          html: (n, c) => `<div class="f-cls-${c}" @class{${n}.c is 'red'}="on">a</div>` },
  { id: 'sty', titre: '@style.color={…}',                   html: (n, c) => `<div class="f-sty-${c}" @style.color={${n}.c}>a</div>` },
  { id: 'stc', titre: '@style.width{…}="10px"',             html: (n, c) => `<div class="f-stc-${c}" @style.width{${n}.b}="10px">a</div>` },
  { id: 'ttl', titre: 'title={…}',                          html: (n, c) => `<div class="f-ttl-${c}" title={${n}.c}>a</div>` },
  { id: 'ttx', titre: 'title="a-{…}"',                      html: (n, c) => `<div class="f-ttx-${c}" title="a-{${n}.c}">a</div>` },
  { id: 'dat', titre: 'data-x={… + …}',                     html: (n, c) => `<div class="f-dat-${c}" data-x={${n}.c + '!'}>a</div>` },
  { id: 'txt', titre: 'texte {…}',                          html: (n, c) => `<p class="f-txt-${c}">{${n}.c}</p>` },
  { id: 'raw', titre: 'html {{…}}',                         html: (n, c) => `<p class="f-raw-${c}">{{${n}.h}}</p>` },
  { id: 'cmp', titre: 'prop de composant x={…}',            html: (n, c) => `<@c-fils class="f-cmp-${c}" x={${n}.c}></@c-fils>` },
  { id: 'spr', titre: 'étalement {...…}',                   html: (n, c) => `<@c-fils class="f-spr-${c}" {...${n}.o}></@c-fils>` },
  { id: 'att', titre: '@attach={…}',                        html: (n, c) => `<div class="f-att-${c}" @attach={${n}.f}>a</div>` },
  { id: 'trn', titre: '@transition et @introstart={…}',     html: (n, c) => `<div class="f-trn-${c}" @transition.global=*fade(duration: 100ms) @introstart={$tr = ${n}.c}>a</div>` },
  { id: 'fcl', titre: '@class{$choix is ligne} (index inverse)', ctxs: ['boucle'], html: (n, c) => `<div class="f-fcl-${c}" @class{$sel is l}="on">a</div>` },
  { id: 'fat', titre: 'data-s={$choix is ligne} (index inverse)', ctxs: ['boucle'], html: (n, c) => `<div class="f-fat-${c}" data-s={$sel is l}>a</div>` },
  { id: 'fst', titre: '@style.color={$choix is ligne ? …} (index inverse)', ctxs: ['boucle'], html: (n, c) => `<div class="f-fst-${c}" @style.color={$sel is l ? 'red' : 'blue'}>a</div>` },
  { id: 'spn', titre: 'étalement {...…} sur une balise native', html: (n, c) => `<div class="f-spn-${c}" {...${n}.o}>a</div>` },
  { id: 'pau', titre: 'paused=!{…}',                       html: (n, c) => `<audio class="f-pau-${c}" paused=!{${n}.pz}></audio>` },
  { id: 'out', titre: '@out et @outrostart={…}',           html: (n, c) => `<div class="f-out-${c}" @out=*fade(duration: 100ms) @outrostart={$ot = ${n}.c}>a</div>` },
  { id: 'tr2', titre: '@in et @introstart={…}',               html: (n, c) => `<div class="f-tr2-${c}" @in.global=*fade(duration: 100ms) @introstart={$tr2 = ${n}.c}>a</div>` },
  { id: 'flp', titre: '@flip={duration: …}',                html: (n, c) => `<div class="f-flp-${c}" @flip={duration: ${n}.n}>a</div>` },
  { id: 'evt', titre: '@click={…}', sauf: ['e', 'el'],      html: (n, c) => `<button class="f-evt-${c}" @click={$ev = ${n}.c}>a</button>` },
  { id: 'inp', titre: 'value=!{…}',                         html: (n, c) => `<input aria-label="champ" class="f-inp-${c}" value=!{${n}.t_${c}}>` },
  { id: 'chk', titre: 'checked=!{…}',                       html: (n, c) => `<input type="checkbox" aria-label="case" class="f-chk-${c}" checked=!{${n}.bc_${c}}>` },
  { id: 'gra', titre: '@group=!{…}',                        html: (n, c) => `<input type="radio" aria-label="a" class="f-gra-${c}" value="a" @group=!{${n}.g_${c}}><input type="radio" aria-label="b" class="f-grb-${c}" value="b" @group=!{${n}.g_${c}}>` },
  { id: 'txe', titre: '@text=!{…}',                         html: (n, c) => `<div class="f-txe-${c}" contenteditable @text=!{${n}.e_${c}}></div>` },
  { id: 'sel', titre: 'value=!{…} sur un <select multiple>', html: (n, c) => `<select multiple aria-label="choix" class="f-sel-${c}" value=!{${n}.l_${c}}><option value="a">a</option><option value="b">b</option></select>` },
  { id: 'opn', titre: 'open=!{…}',                          html: (n, c) => `<details class="f-opn-${c}" open=!{${n}.bo_${c}}><summary>s</summary>x</details>` },
  { id: 'mda', titre: 'currentTime=!{…}',                   html: (n, c) => `<audio class="f-mda-${c}" currentTime=!{${n}.n_${c}}></audio>` },
  { id: 'dim', titre: 'clientWidth=!{…}',                   html: (n, c) => `<div class="f-dim-${c}" clientWidth=!{${n}.w_${c}}>a</div>` },
  { id: 'ref', titre: '@this=!{…}',                         html: (n, c) => `<div class="f-ref-${c}" @this=!{${n}.r_${c}}>a</div>` },
]

// la lecture que le bouton `.lire` fait des membres écrits par les formes d'écriture : un élément se lit par sa balise, une largeur par son signe
const MEMBRES_ECRITS = ['t', 'bc', 'bo', 'g', 'l', 'e', 'n', 'w', 'r']

export const composant = (n: string): string => {
  const membres = CONTEXTES.map((c) => `t_${c}: 'texte', bc_${c}: true, bo_${c}: true, g_${c}: 'a', l_${c}: ['b'], e_${c}: 'edit', n_${c}: 2, w_${c}: 0, r_${c}: null`).join(', ')
  const lus     = CONTEXTES.flatMap((c) => MEMBRES_ECRITS.map((m) => m === 'w' ? `vue(${n}.w_${c} > 0)` : `vue(${n}.${m}_${c})`)).join(', ')
  const corps   = CONTEXTES.map((c) => dans(c, FORMES.filter((f) => !f.ctxs || f.ctxs.includes(c)).map((f) => f.html(n, c)).join('\n'))).join('\n')
  return `<script>
  poser = (_node) ->
    _node.dataset.att = 'oui'
    null
  vue = (x) -> if x and x.localName then '<' + x.localName + '>' else x
  ${n} = { c: 'red', h: '<b>x</b>', b: true, n: 2, pz: false, o: { x: 'sp' }, f: poser, ${membres} }
  $lignes = [1]
  $sel    = 1
  $p      = Promise.resolve('ok')
  lire    = -> $lu = JSON.stringify([${lus}])
</script>
${corps}
<button class="lire" @click={lire()}>lire</button>
<pre class="lu">{$lu}</pre>
<p class="f-evo-g">{$ev}</p>
<p class="f-tro-g">{$tr}</p>
<p class="f-tro2-g">{$tr2}</p>
<@window @noms-internes={$gl = ${n}.c}/>
<p class="f-glo-g">{$gl}</p>
`
}

export const ENFANT = '<p class="vu">{$x}</p>\n'

// dans la page : touche chaque contrôle d'écriture (une frappe, un clic, un choix), puis lit le résultat
export const JOUER = `(() => {
  const s = document.querySelector('BALISE')._shadow
  const q = (c) => s.querySelector(c)
  for (const ctx of ['racine', 'boucle', 'attente']) {
    const inp = q('.f-inp-' + ctx)
    if (inp) { inp.value = 'zz'; inp.dispatchEvent(new Event('input', { bubbles: true })) }
    const chk = q('.f-chk-' + ctx)
    if (chk) chk.click()
    const grb = q('.f-grb-' + ctx)
    if (grb) grb.click()
    const txe = q('.f-txe-' + ctx)
    if (txe) { txe.textContent = 'zz'; txe.dispatchEvent(new Event('input', { bubbles: true })) }
    const sel = q('.f-sel-' + ctx)
    if (sel) { sel.options[0].selected = true; sel.dispatchEvent(new Event('input', { bubbles: true })) }
    const opn = q('.f-opn-' + ctx)
    if (opn) opn.open = false
    const evt = q('.f-evt-' + ctx)
    if (evt) evt.click()
  }
})()`

// ce que la page montre de chaque forme : classes, attributs, texte, valeurs, et la ligne que le bouton a écrite
export const LIRE = `(() => {
  const s = document.querySelector('BALISE')._shadow
  const out = {}
  for (const el of s.querySelectorAll('[class]')) {
    const cle = [...el.classList].find((c) => c.startsWith('f-'))
    if (!cle) continue
    const attrs = {}
    for (const a of el.attributes) if ((a.name !== 'class' && !a.name.startsWith('mjs-')) || a.name === 'mjs-flip') attrs[a.name] = a.value
    const fils = el._shadow && el._shadow.querySelector('.vu') ? el._shadow.querySelector('.vu').textContent : undefined
    const enfant = el.localName.startsWith('mjs-')
    const r = { classes: [...el.classList].filter((c) => !c.startsWith('f-')).sort().join(' '), attrs, texte: enfant ? undefined : el.textContent.trim(), fils }
    if (el.localName === 'input' || el.localName === 'select') r.valeur = el.localName === 'select' ? [...el.selectedOptions].map((o) => o.value).join(',') : el.value
    if (el.type === 'checkbox' || el.type === 'radio') r.coche = el.checked
    if (el.localName === 'details') r.ouvert = el.open
    if (el.localName === 'audio') r.temps = el.currentTime
    if (el.dataset && el.dataset.att) r.att = el.dataset.att
    out[cle] = r
  }
  out.lu = (s.querySelector('.lu') || {}).textContent
  return JSON.stringify(out)
})()`
