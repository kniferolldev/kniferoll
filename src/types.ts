export type Writer = { write(text: string): unknown };
export type StdinLike = ReadableStream | { text(): Promise<string> };

export interface IO {
    stdin: StdinLike;
    stdout: Writer;
    stderr: Writer;
    readFile: (path: string) => Promise<string>;
}
