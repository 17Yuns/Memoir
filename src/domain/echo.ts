import type { Text } from "@codemirror/state";

export type EchoContext = {
  sourcePath: string;
  version: object;
  doc: Text;
  anchor: number;
  head: number;
  from: number;
  to: number;
  kind: "selection" | "paragraph";
  text: string;
  composing: boolean;
};

