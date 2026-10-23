// l'extension ModularJS : la coloration vient de la grammaire (syntaxes/) ; ici, les effets — la
// complétion des 124 effets `*nom`, de leurs réglages et de leurs mots permis pendant la frappe, et leur
// aide au survol (cf. effects-help.js)

const vscode = require('vscode');
const help   = require('./effects-help.js');

const KINDS = {
  effect:  vscode.CompletionItemKind.Function,
  setting: vscode.CompletionItemKind.Property,
  value:   vscode.CompletionItemKind.EnumMember
};

function activate(context) {
  const completion = {
    provideCompletionItems: function(document, position) {
      const before = document.lineAt(position.line).text.slice(0, position.character);
      return help.suggest(before).map(function(s, i) {
        const item = new vscode.CompletionItem(s.label, KINDS[s.kind]);
        item.detail        = s.detail;
        item.documentation = s.help ? new vscode.MarkdownString(s.help) : undefined;
        item.insertText    = s.insert;
        item.sortText      = String(i).padStart(4, '0');
        // un réglage aux mots permis : la liste de ses mots s'ouvre tout de suite
        if (s.retrigger) item.command = { command: 'editor.action.triggerSuggest', title: '' };
        return item;
      });
    }
  };
  const hovering = {
    provideHover: function(document, position) {
      const md = help.hover(document.lineAt(position.line).text, position.character);
      return md ? new vscode.Hover(new vscode.MarkdownString(md)) : null;
    }
  };
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider('modularjs', completion, '*', '(', ',', ' ', ':'));
  context.subscriptions.push(vscode.languages.registerHoverProvider('modularjs', hovering));
}

function deactivate() {}

module.exports = { activate: activate, deactivate: deactivate };
