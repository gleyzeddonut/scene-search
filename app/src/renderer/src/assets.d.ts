// let TypeScript treat image imports as URL strings (Vite resolves them at build)
declare module '*.png' {
  const src: string
  export default src
}
