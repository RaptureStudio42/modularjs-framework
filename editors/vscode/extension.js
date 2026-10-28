// l'extension ModularJS : la coloration vient de la grammaire (syntaxes/) ; ici, les effets — la complétion des effets `*nom`, des
// alias `*effet.nom` (ceux que ModularJS livre et ceux de l'appli), de leurs réglages et de leurs mots permis pendant la frappe, et
// leur aide au survol (cf. effects-help.js), dans la langue de VS Code. Les effets de l'appli sont lus dans les fichiers
// `*.effects.mjs` de l'espace de travail, relus à chaque enregistrement, oubliés quand le fichier disparaît (cf. effects-app.js)

const vscode = require('vscode');
const help   = require('./effects-help.js');
const app    = require('./effects-app.js');

const KINDS = {
  effect:  vscode.CompletionItemKind.Function,
  setting: vscode.CompletionItemKind.Property,
  value:   vscode.CompletionItemKind.EnumMember
};

function activate(context) {
  const store = app.createStore();
  const lang  = help.language(vscode.env.language);
  const ctx   = function() { return { lang: lang, app: store.effects() }; };
  // un fichier d'effets lu depuis le disque ; illisible, ses effets sont oubliés
  const read = function(uri) {
    return vscode.workspace.fs.readFile(uri).then(function(bytes) { store.put(uri.toString(), new TextDecoder('utf-8').decode(bytes)); }, function() { store.drop(uri.toString()); });
  };
  vscode.workspace.findFiles('**/*.effects.mjs', '**/node_modules/**').then(function(uris) { uris.forEach(read); });
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.effects.mjs');
  watcher.onDidCreate(read);
  watcher.onDidChange(read);
  watcher.onDidDelete(function(uri) { store.drop(uri.toString()); });
  context.subscriptions.push(watcher);
  // l'enregistrement d'un fichier d'effets, même hors de l'espace de travail : son texte tel qu'enregistré
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(function(document) {
    if (app.isEffectsFile(document.uri.path)) store.put(document.uri.toString(), document.getText());
  }));
  const completion = {
    provideCompletionItems: function(document, position) {
      const before = document.lineAt(position.line).text.slice(0, position.character);
      return help.suggest(before, ctx()).map(function(s, i) {
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
      const md = help.hover(document.lineAt(position.line).text, position.character, ctx());
      return md ? new vscode.Hover(new vscode.MarkdownString(md)) : null;
    }
  };
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider('modularjs', completion, '*', '.', '(', ',', ' ', ':'));
  context.subscriptions.push(vscode.languages.registerHoverProvider('modularjs', hovering));
}

function deactivate() {}

module.exports = { activate: activate, deactivate: deactivate };
