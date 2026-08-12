/// <reference types="vite/client" />

declare module '*.ttf?inline' {
    const dataUri: string;
    export default dataUri;
}

declare module '*.svg?inline' {
    const dataUri: string;
    export default dataUri;
}
