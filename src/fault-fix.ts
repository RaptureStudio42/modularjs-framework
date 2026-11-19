// fault-fix — la correction qu'un refus du compilateur sait écrire : celle que dit son message, ou, pour une minuterie, son nom
// rendu inerte. `mjs check` la pose sur la source, puis relit le fichier pour trouver la faute suivante (Bundler.nextFaults).
// Une correction ne rallonge jamais le texte et garde ses retours à la ligne : les lignes et les colonnes que citent les fautes
// suivantes restent celles du fichier. Un refus sans correction (une faute de syntaxe, qui arrête la lecture, ou une faute que
// MJS ne sait pas corriger) clôt la liste de son fichier

export interface Fix {
  /** le texte fautif, tel qu'écrit dans le fichier */
  from:  string
  /** ce qu'il faut écrire à sa place : une ligne, jamais plus longue que `from` */
  to:    string
  /** la ligne du fichier où `from` commence, quand le refus la connaît ; sans elle, `from` doit être unique dans le fichier */
  line?: number
}

export class FaultFix {
  /** pose la correction sur l'erreur et rend l'erreur (`throw FaultFix.attach(new Error(…), fautif, juste, ligne)`) ; une
   *  correction plus longue que le texte fautif, ou sur plusieurs lignes, n'est pas posée */
  static attach<E extends Error>(err: E, from: string, to: string, line?: number | string | null): E {
    if (from !== '' && from !== to && to.length <= from.length && !to.includes('\n')) {
      (err as any).mjsFix = { from, to, line: typeof line === 'number' && line > 0 ? line : undefined }
    }
    return err
  }

  /** la correction d'une erreur, cherchée aussi dans ses causes (une erreur enveloppée garde celle de l'erreur d'origine) */
  static of(err: unknown): Fix | null {
    let e = err as any
    for (let n = 0; e && n < 8; n++) {
      if (e.mjsFix) return e.mjsFix
      e = e.cause
    }
    return null
  }

  /** la source corrigée et la place de la faute (ligne et colonne comptées depuis 1) ; null quand le texte fautif n'est pas
   *  à sa place (absent de sa ligne, ou présent plus d'une fois sans ligne) */
  static apply(content: string, fix: Fix): { content: string, line: number, column: number } | null {
    let at = content.indexOf(fix.from)
    if (fix.line === undefined) {
      if (at < 0 || content.indexOf(fix.from, at + 1) >= 0) return null
    }
    else {
      const lines = content.split('\n')
      if (fix.line > lines.length) return null
      const start = fix.line === 1 ? 0 : lines.slice(0, fix.line - 1).join('\n').length + 1
      at          = content.indexOf(fix.from, start)
      if (at < 0 || at > start + lines[fix.line - 1].length) return null
    }
    const newlines = fix.from.split('\n').length - 1
    const to       = newlines > 0 ? fix.to + '\n'.repeat(newlines) : fix.to.padEnd(fix.from.length)
    const before   = content.slice(0, at)
    return { content: before + to + content.slice(at + fix.from.length), line: before.split('\n').length, column: at - before.lastIndexOf('\n') }
  }
}
