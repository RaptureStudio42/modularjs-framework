// gestionnaires d'événement du gabarit (`@click={…}`) : une variable qu'ils affectent sans la déclarer est la leur, comme en CoffeeScript,
// sauf une globale du navigateur dont l'affectation agit (`location`, `opener`, un gestionnaire de la fenêtre : `onresize`, `onload`…) ;
// en développement, une variable locale qui porte le nom d'une variable posée par la page le dit au clic

import { parseModuleAst } from './lint.js'

// gestionnaires de la fenêtre, liste fermée : ceux de GlobalEventHandlers et WindowEventHandlers (norme HTML, avec ceux que les animations,
// les transitions et les pointeurs y ajoutent) que Chromium, Firefox et WebKit ont tous les trois ; un autre (`onpointerrawupdate`) reste une
// variable du gestionnaire : `window.onpointerrawupdate = …` l'écrit
const WINDOW_HANDLERS = [
  'abort', 'auxclick', 'beforeinput', 'beforematch', 'beforetoggle', 'blur', 'cancel', 'canplay', 'canplaythrough', 'change', 'click',
  'close', 'command', 'contextmenu', 'cuechange', 'dblclick', 'drag', 'dragend', 'dragenter', 'dragleave', 'dragover', 'dragstart', 'drop',
  'durationchange', 'emptied', 'ended', 'error', 'focus', 'formdata', 'input', 'invalid', 'keydown', 'keypress', 'keyup', 'load',
  'loadeddata', 'loadedmetadata', 'loadstart', 'mousedown', 'mouseenter', 'mouseleave', 'mousemove', 'mouseout', 'mouseover', 'mouseup',
  'pause', 'play', 'playing', 'progress', 'ratechange', 'reset', 'resize', 'scroll', 'scrollend', 'securitypolicyviolation', 'seeked',
  'seeking', 'select', 'slotchange', 'stalled', 'submit', 'suspend', 'timeupdate', 'toggle', 'volumechange', 'waiting',
  'webkitanimationend', 'webkitanimationiteration', 'webkitanimationstart', 'webkittransitionend', 'wheel', 'animationstart',
  'animationiteration', 'animationend', 'animationcancel', 'transitionrun', 'transitionstart', 'transitionend', 'transitioncancel',
  'pointerover', 'pointerenter', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerout', 'pointerleave',
  'gotpointercapture', 'lostpointercapture', 'selectstart', 'selectionchange', 'afterprint', 'beforeprint', 'beforeunload', 'hashchange',
  'languagechange', 'message', 'messageerror', 'offline', 'online', 'pagehide', 'pageshow', 'popstate', 'rejectionhandled', 'storage',
  'unhandledrejection', 'unload',
].map(name => 'on' + name)

// globale du navigateur citée dans un texte : ni membre (`o.location`), ni variable de MJS (`$location`, `@location`, `§location`, `µlocation`)
const CITED_GLOBAL = new RegExp(`(?<![\\w$.@§µ])(?:location|opener|${WINDOW_HANDLERS.join('|')})(?![\\w$])`, 'g')

const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'])

// les globales du navigateur que cite le texte des gestionnaires ; une globale citée sans être affectée ne change rien
export function browserGlobals(text: string): string[] {
  return [...new Set(text.match(CITED_GLOBAL) ?? [])]
}

// le JavaScript d'un lot de gestionnaires (`this._mjs_inline = […]`, ou `this._mjs_inline[i] = …` d'un lot compilé par groupes) où chaque
// fonction qui déclare une variable que son gestionnaire affecte sans la déclarer (`gx = 1`) dit au clic, une fois par page, qu'une variable
// de ce nom est posée par la page : propriété de données propre, modifiable et énumérable de `globalThis` qui n'est pas une fonction du
// navigateur (`window.gx = 0`, `var gx` d'un script classique, une globale que le navigateur ajoute lui-même : `chrome` dans Chrome) ;
// jamais pour une propriété de la fenêtre que définit la norme (`name`, `status`, `length`, `top`, `open`). `sources` : le texte écrit de chaque gestionnaire ; `gabarit` : les noms que le gabarit lui donne, recréés en tête du
// gestionnaire ; `notice` : le message pour un nom
export function warnAboutLocals(js: string, sources: readonly string[], template: (i: number) => ReadonlySet<string>, notice: (name: string) => string): string {
  const ast: any = parseModuleAst(js)
  if (!ast) return js
  const insertions = new Map<number, Set<string>>()
  for (const stmt of ast.body) {
    const a      = stmt.type === 'ExpressionStatement' ? stmt.expression : null
    const left = a?.type === 'AssignmentExpression' ? a.left : null
    const target = left?.type === 'MemberExpression' && left.computed ? left.object : left
    if (target?.type !== 'MemberExpression' || target.object?.type !== 'ThisExpression' || target.property?.name !== '_mjs_inline') continue
    const handlers: [unknown, any][] = left.computed ? [[left.property?.value, a.right]] : (a.right?.elements ?? []).map((el: any, k: number) => [k, el])
    for (const [i, el] of handlers) {
      if (typeof i !== 'number' || !el) continue
      const written = sources[i] ?? ''
      const theirs = template(i)
      // nom affecté par `=` dans le texte écrit : ni déclaré (`.=`, `:=`), ni comparé
      const assigns = (name: string): boolean => new RegExp(`(?<![\\w$.@§µ])${name}\\s*=(?![=>])`).test(written)
      const visit = (n: any, fn: any): void => {
        if (FUNCTIONS.has(n.type)) fn = n
        if (n.type === 'VariableDeclaration' && fn?.body?.type === 'BlockStatement') {
          for (const d of n.declarations) {
            const name = d.id?.type === 'Identifier' ? d.id.name : null
            if (!name || name.startsWith('_') || theirs.has(name) || !assigns(name)) continue
            const pos = fn.body.start + 1
            insertions.set(pos, (insertions.get(pos) ?? new Set()).add(name))
          }
        }
        for (const key in n) {
          // tête d'une boucle : sa variable est celle de la boucle
          if ((n.type === 'ForStatement' && key === 'init') || ((n.type === 'ForOfStatement' || n.type === 'ForInStatement') && key === 'left')) continue
          const v = n[key]
          if (Array.isArray(v)) {
            for (const x of v) if (x && typeof x.type === 'string') visit(x, fn)
          }
          else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v, fn)
        }
      }
      visit(el, null)
    }
  }
  const isSet = `((d) => d != null && 'value' in d && d.writable && d.enumerable && !(typeof d.value === 'function' && /\\[native code\\]/.test(Function.prototype.toString.call(d.value))))`
  const tell  = (name: string): string => `if (${isSet}(Object.getOwnPropertyDescriptor(globalThis, ${JSON.stringify(name)}))) ((m) => { if (!(µ._mjs_toldLocals ??= new Set()).has(m)) { µ._mjs_toldLocals.add(m); console.warn(m) } })(${JSON.stringify(notice(name))}); `
  let text    = js
  for (const [pos, names] of [...insertions].sort((a, b) => b[0] - a[0])) text = text.slice(0, pos) + [...names].map(tell).join('') + text.slice(pos)
  return text
}
