/**
 * Dark-theme shell script editor (CodeMirror) for deploy script form fields.
 */

import CodeMirror from "@uiw/react-codemirror";
import { StreamLanguage } from "@codemirror/language";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { useMemo } from "react";

import styles from "./ShellScriptEditor.module.scss";

export interface ShellScriptEditorProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  id?: string;
}

const shellLanguage = StreamLanguage.define(shell);

function ShellScriptEditor({
  value = "",
  onChange,
  placeholder,
  minHeight = 280,
  id,
}: ShellScriptEditorProps) {
  const extensions = useMemo((): Extension[] => {
    return [
      shellLanguage,
      EditorView.lineWrapping,
      EditorView.theme({
        "&": {
          minHeight: `${minHeight}px`,
          fontSize: "13px",
        },
        ".cm-scroller": {
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          lineHeight: "1.5",
        },
        ".cm-content": {
          minHeight: `${minHeight}px`,
          padding: "10px 0",
        },
        ".cm-gutters": {
          minHeight: `${minHeight}px`,
        },
      }),
    ];
  }, [minHeight]);

  return (
    <div className={styles.editor} id={id}>
      <CodeMirror
        value={value}
        height="auto"
        minHeight={`${minHeight}px`}
        theme={oneDark}
        extensions={extensions}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          bracketMatching: true,
          autocompletion: false,
          searchKeymap: true,
        }}
        onChange={(next) => {
          onChange?.(next);
        }}
      />
    </div>
  );
}

export default ShellScriptEditor;
