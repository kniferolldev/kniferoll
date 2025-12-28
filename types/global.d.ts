// Global type declarations

// Runtime-generated editor bundle
declare module "/bundle.js" {
  const exports: Record<string, unknown>;
  export default exports;
}

// CSS imports with { type: "text" } attribute
declare module "*.css" {
  const content: string;
  export default content;
}
