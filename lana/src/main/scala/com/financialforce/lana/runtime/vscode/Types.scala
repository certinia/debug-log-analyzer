/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
package com.financialforce.lana.runtime.vscode

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSBracketAccess, JSImport}
import scala.scalajs.js.{UndefOr, |}

@js.native
@JSImport("vscode", "languages")
object Languages extends js.Object {
  type DocumentSelector = DocumentFilter

  def createDiagnosticCollection(name: String): DiagnosticCollection = js.native

  def registerCodeLensProvider(selector: DocumentSelector, provider: CodeLensProvider): Disposable =
    js.native

  def registerDefinitionProvider(selector: DocumentSelector,
                                 provider: DefinitionProvider): Disposable = js.native

  def registerDocumentSymbolProvider(selector: DocumentSelector,
                                     provider: DocumentSymbolProvider): Disposable = js.native
}

trait DocumentFilter extends js.Object {
  val language: String
  val scheme: String
}

trait PatternDocumentFilter extends DocumentFilter {
  val pattern: String
}

@js.native
@JSImport("vscode", "DiagnosticCollection")
class DiagnosticCollection extends Disposable {
  def name: String = js.native

  def set(uri: Uri, diagnostics: js.Array[Diagnostic] | Unit): Unit = js.native

  def set(entries: js.Array[js.Tuple2[Uri, js.Array[Diagnostic] | Unit]]): Unit = js.native

  def delete(uri: Uri): Unit = js.native

  def clear(): Unit = js.native

  def forEach(callback: js.Function3[Uri, js.Array[Diagnostic], DiagnosticCollection, Any],
              thisArg: js.Any): Unit = js.native

  def get(uri: Uri): js.UndefOr[js.Array[Diagnostic]] = js.native

  def has(uri: Uri): Boolean = js.native
}

@js.native
@JSImport("vscode", "Uri")
class Uri extends js.Object {
  val fsPath: String = js.native
}

@js.native
@JSImport("vscode", "Uri")
object Uri extends js.Object {
  def file(path: String): Uri = js.native
}

@js.native
@JSImport("vscode", "Diagnostic")
class Diagnostic extends js.Object {
  def this(range: Range, message: String, severity: DiagnosticSeverity) = this()

  var range: Range = js.native
  var message: String = js.native
  var source: String = js.native
  var severity: DiagnosticSeverity = js.native
  var code: String | Double = js.native
}

trait CodeLensProvider extends js.Object {
  type ProviderResult[T] = T | js.Promise[T]

  def provideCodeLenses(document: TextDocument,
                        token: CancellationToken): ProviderResult[js.Array[CodeLens]]

  def resolveCodeLens(codeLens: CodeLens, token: CancellationToken): ProviderResult[CodeLens]
}

trait DefinitionProvider extends js.Object {
  type ProviderResult[T] = T | js.Promise[T]
  type DefinitionLink = LocationLink

  def provideDefinition(document: TextDocument,
                        position: Position,
                        token: CancellationToken): ProviderResult[js.Array[DefinitionLink]]
}

trait DocumentSymbolProvider extends js.Object {
  type ProviderResult[T] = T | js.Promise[T]

  def provideDocumentSymbols(document: TextDocument,
                             token: CancellationToken): ProviderResult[js.Array[DocumentSymbol]]
}

trait LocationLink extends js.Object {
  val originSelectionRange: Range
  val targetRange: Range
  val targetUri: Uri
}

@js.native
trait Event[T] extends js.Object {
  def apply(listener: js.Function1[T, Any],
            thisArgs: js.Any,
            disposables: js.Array[Disposable]): Disposable = js.native
}

@js.native
trait CancellationToken extends js.Object {
  var isCancellationRequested: Boolean = js.native
  var onCancellationRequested: Event[js.Any] = js.native
}

@JSImport("vscode", "CodeLens")
@js.native
class CodeLens protected () extends js.Object {
  def this(range: Range, command: Command) = this()

  var range: Range = js.native
  var command: Command = js.native

  def isResolved: Boolean = js.native
}

trait Command extends js.Object {
  val title: String
  val command: String
  val arguments: js.Array[js.Any]
}

@js.native
@JSImport("vscode", "Range")
class Range protected () extends js.Object {
  def this(start: Position, end: Position) = this()

  def this(startLine: Int, startCharacter: Int, endLine: Int, endCharacter: Int) = this()

  def start: Position = js.native

  def end: Position = js.native

  var isEmpty: Boolean = js.native
  var isSingleLine: Boolean = js.native

  def contains(positionOrRange: Position | Range): Boolean = js.native

  def isEqual(other: Range): Boolean = js.native

  def intersection(range: Range): Range | Unit = js.native

  def union(other: Range): Range = js.native

  def `with`(start: Position, end: Position): Range = js.native

  def `with`(change: js.Any): Range = js.native
}

@js.native
@JSImport("vscode", "Position")
class Position protected () extends js.Object {
  def this(line: Int, character: Int) = this()

  def line: Int = js.native

  def character: Int = js.native

  def isBefore(other: Position): Boolean = js.native

  def isBeforeOrEqual(other: Position): Boolean = js.native

  def isAfter(other: Position): Boolean = js.native

  def isAfterOrEqual(other: Position): Boolean = js.native

  def isEqual(other: Position): Boolean = js.native

  def compareTo(other: Position): Int = js.native

  def translate(lineDelta: Int, characterDelta: Int): Position = js.native

  def translate(change: js.Any): Position = js.native

  def `with`(line: Int, character: Int): Position = js.native

  def `with`(change: js.Any): Position = js.native
}

@js.native
sealed trait DiagnosticSeverity extends js.Object

@js.native
@JSImport("vscode", "DiagnosticSeverity")
object DiagnosticSeverity extends js.Object {
  var Error: DiagnosticSeverity = js.native
  var Warning: DiagnosticSeverity = js.native
  var Information: DiagnosticSeverity = js.native
  var Hint: DiagnosticSeverity = js.native

  @JSBracketAccess
  def apply(value: DiagnosticSeverity): String = js.native
}
@js.native
@JSImport("vscode", "commands")
object commands extends js.Object {
  def registerCommand(command: String, callback: js.Function): Disposable = js.native
}

@js.native
@JSImport("vscode", "Disposable")
class Disposable protected () extends js.Object {
  def this(callOnDispose: js.Function) = this()

  def dispose(): js.Dynamic = js.native
}

@js.native
@JSImport("vscode", "workspace")
object workspace extends js.Object {
  val name: String = js.native
  val rootPath: String = js.native
  val workspaceFolders: js.UndefOr[js.Array[WorkspaceFolder]] = js.native

  def getConfiguration(section: String): WorkspaceConfiguration = js.native

  def openTextDocument(uri: Uri): js.Promise[TextDocument] = js.native

  def createFileSystemWatcher(globPattern: String,
                              ignoreCreateEvents: Boolean,
                              ignoreChangeEvents: Boolean,
                              ignoreDeleteEvents: Boolean): FileSystemWatcher = js.native

  val onDidOpenTextDocument: Event[TextDocument] = js.native
  val onDidChangeTextDocument: Event[TextDocumentChangeEvent] = js.native
  val onDidCloseTextDocument: Event[TextDocument] = js.native
}

@js.native
trait TextDocumentChangeEvent extends js.Object {
  val document: TextDocument
}

@js.native
@JSImport("vscode", "FileSystemWatcher")
class FileSystemWatcher extends Disposable {
  val onDidChange: Event[Uri] = js.native
  val onDidCreate: Event[Uri] = js.native
  val onDidDelete: Event[Uri] = js.native
}

@js.native
@JSImport("vscode", "WorkspaceFolder")
class WorkspaceFolder extends js.Object {
  val index: Int = js.native
  val name: String = js.native
  val uri: Uri = js.native
}

@js.native
@JSImport("vscode", "WorkspaceConfiguration")
class WorkspaceConfiguration extends js.Object {
  def get[T](section: String): UndefOr[T] = js.native
}

@js.native
@JSImport("vscode", "window")
object window extends js.Object {
  var activeTextEditor: js.UndefOr[TextEditor] = js.native

  def showInformationMessage(message: String): Unit = js.native

  def showErrorMessage(message: String): Unit = js.native

  def showQuickPick[T <: QuickPickItem](
    items: js.Array[T],
    options: QuickPickOptions,
    token: js.UndefOr[CancellationToken]): js.Promise[js.UndefOr[T | js.Array[T]]] = js.native

  def showTextDocument(textDocument: TextDocument): js.Promise[TextEditor] = js.native

  def createOutputChannel(name: String): OutputChannel = js.native

  def createWebviewPanel(viewType: String,
                         title: String,
                         showOptions: Int,
                         options: WebviewPanelOptions): WebviewPanel = js.native

  def createStatusBarItem(alignment: UndefOr[Int], priority: UndefOr[Int]): StatusBarItem =
    js.native
}

trait WebviewPanelOptions extends js.Object {
  val enableCommandUris: Boolean
  val enableScripts: Boolean
  val retainContextWhenHidden: Boolean
  val enableFindWidget: Boolean
  val localResourceRoots: js.Array[Uri]
}

@js.native
@JSImport("vscode", "WebviewPanel")
class WebviewPanel extends js.Object {
  val active: Boolean = js.native
  val webview: WebView = js.native
  val onDidDispose: Event[Unit] = js.native
}

@js.native
@JSImport("vscode", "WebView")
class WebView extends js.Object {
  var html: String = js.native
  val onDidReceiveMessage: Event[js.Any] = js.native
  def postMessage(message: js.Object): js.Promise[Boolean] = js.native
  def asWebviewUri(s: Uri): Uri = js.native
}

trait QuickPickItem extends js.Object {
  val alwaysShow: Boolean
  val label: String
  val description: String
  val detail: String
  val picked: Boolean
}

trait QuickPickOptions extends js.Object {
  val canPickMany: Boolean
  val ignoreFocusOut: Boolean
  val placeHolder: String
}

@js.native
@JSImport("vscode", "TextEditor")
class TextEditor extends js.Object {
  var document: TextDocument = js.native

  def revealRange(range: Range): Unit = js.native
}

@js.native
@JSImport("vscode", "TextDocument")
class TextDocument extends js.Object {
  var uri: Uri = js.native
  var languageId: String = js.native

  def lineCount: Int = js.native

  def lineAt(line: Int): TextLine = js.native

  def getText(): String = js.native
}

@js.native
trait TextLine extends js.Object {
  def lineNumber: Int = js.native

  def text: String = js.native

  def range: Range = js.native

  def rangeIncludingLineBreak: Range = js.native

  def firstNonWhitespaceCharacterIndex: Int = js.native

  def isEmptyOrWhitespace: Boolean = js.native
}

@js.native
@JSImport("vscode", "StatusBarItem")
class StatusBarItem(var text: String, var command: String, var tooltip: String) extends Disposable {
  def show(): Unit = js.native

  def hide(): Unit = js.native
}

object StatusBarAlignment {
  val Left: Int = 1
  val Right: Int = 2
}
@js.native
@JSImport("vscode", "OutputChannel")
class OutputChannel extends Disposable {
  def append(value: String): Unit = js.native
  def appendLine(line: String): Unit = js.native
  def clear(): Unit = js.native
  def hide(): Unit = js.native
  def show(preserveFocus: Boolean): Unit = js.native
}

@js.native
@JSImport("vscode", "Disposable")
class ExtensionContext extends js.Object {
  val subscriptions: js.Array[Disposable] = js.native
  val extensionPath: String = js.native
}

@js.native
sealed trait SymbolKind extends js.Object

@js.native
@JSImport("vscode", "SymbolKind")
object SymbolKind extends js.Object {
  var Array: SymbolKind = js.native
  var Boolean: SymbolKind = js.native
  var Class: SymbolKind = js.native
  var Constant: SymbolKind = js.native
  var Constructor: SymbolKind = js.native
  var Enum: SymbolKind = js.native
  var EnumMember: SymbolKind = js.native
  var Event: SymbolKind = js.native
  var Field: SymbolKind = js.native
  var Function: SymbolKind = js.native
  var Interface: SymbolKind = js.native
  var Key: SymbolKind = js.native
  var Method: SymbolKind = js.native
  var Module: SymbolKind = js.native
  var Namespace: SymbolKind = js.native
  var Null: SymbolKind = js.native
  var Number: SymbolKind = js.native
  var Object: SymbolKind = js.native
  var Operator: SymbolKind = js.native
  var Package: SymbolKind = js.native
  var Property: SymbolKind = js.native
  var String: SymbolKind = js.native
  var Struct: SymbolKind = js.native
  var TypeParameter: SymbolKind = js.native
  var Variable: SymbolKind = js.native

  @JSBracketAccess
  def apply(value: SymbolKind): String = js.native
}

@JSImport("vscode", "DocumentSymbol")
@js.native
class DocumentSymbol protected () extends js.Object {
  def this(name: String, detail: String, kind: SymbolKind, range: Range, selectionRange: Range) =
    this()

  var children: js.Array[DocumentSymbol] = js.native
  var detail: String = js.native
  var kind: SymbolKind = js.native
  var name: String = js.native
  var range: Range = js.native
  var selectionRange: Range = js.native

  def isResolved: Boolean = js.native
}
