// Las hojas de estilo se importan por su efecto (las procesa Vite).
declare module "*.css";

// Archivos que Vite publica tal cual y devuelve su URL (el worker de MapLibre).
declare module "*?url" {
  const url: string;
  export default url;
}
