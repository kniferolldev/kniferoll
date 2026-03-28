// CSS imports with { type: "text" } attribute
declare module "*.css" {
  const content: string;
  export default content;
}
